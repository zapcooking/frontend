<script lang="ts">
  /**
   * /admin/nourish-flags — read-only list of Nourish score flags.
   *
   * First route under /admin/*. Gated client-side via isAdmin() from
   * $lib/adminAuth (consistent with /sponsors). Merges two sources:
   *
   *   1. Signed flags (kind 1985 NIP-32) from wss://pantry.zap.cooking
   *      — queried client-side via NDK. Author pubkey is visible.
   *
   *   2. Anon flags from /api/admin/nourish-flags (KV-backed). IP hash
   *      shown (first 8 chars) for brigading detection; full IP is never
   *      stored.
   *
   *  Tabs: Recipes (a-tag targets) vs Scans (scan-hash targets). Each
   *  row expands to show sample reasons + per-source breakdown.
   */
  import { onMount } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { isAdmin } from '$lib/adminAuth';
  import {
    NOURISH_FLAG_KIND,
    NOURISH_FLAG_NAMESPACE,
    PANTRY_RELAY,
    SCAN_I_TAG_PREFIX
  } from '$lib/nourish/flagSubmit';
  import { NDKRelaySet, type NDKEvent } from '@nostr-dev-kit/ndk';
  import Modal from '../../../components/Modal.svelte';
  import { computeContentHash, queryNourishEvent } from '$lib/nourish/nourishRelay';
  import { parseMarkdownForEditing } from '$lib/parser';
  import type { NourishScores } from '$lib/nourish/types';
  import { NOURISH_PROMPT_VERSION } from '$lib/nourish/types';
  import {
    fetchOutOfVersionCandidates,
    type OutOfVersionCandidate
  } from '$lib/nourish/nourishDiscovery';

  interface AnonFlag {
    target: string;
    dimension: string;
    direction: string;
    score: number;
    nourishVer: string;
    reason: string;
    ipHash: string;
    createdAt: string;
  }

  interface SignedFlag {
    target: string;
    dimension: string;
    direction: string;
    score: number | null;
    nourishVer: string;
    reason: string;
    pubkey: string;
    createdAt: string;
  }

  type Source = 'signed' | 'anon';
  type TabKind = 'recipes' | 'scans' | 'candidates';

  let loading = true;
  let loadError = '';
  let anonFlags: AnonFlag[] = [];
  let signedFlags: SignedFlag[] = [];
  let candidates: OutOfVersionCandidate[] = [];
  let activeTab: TabKind = 'recipes';
  let expandedKey: string | null = null;

  $: authed = isAdmin($userPublickey);

  async function loadAnon() {
    if (!$userPublickey) return;
    const res = await fetch('/api/admin/nourish-flags', {
      headers: { 'x-admin-pubkey': $userPublickey }
    });
    if (!res.ok) {
      throw new Error(`anon flag fetch failed: ${res.status}`);
    }
    const body = (await res.json()) as { flags?: AnonFlag[] };
    anonFlags = body.flags ?? [];
  }

  async function loadSigned() {
    if (!$ndk) return;
    // Signed flags live on the pantry relay. The default relay set
    // doesn't include pantry, so we target it explicitly.
    const relaySet = NDKRelaySet.fromRelayUrls([PANTRY_RELAY], $ndk, true);
    const events = await Promise.race([
      $ndk.fetchEvents(
        {
          kinds: [NOURISH_FLAG_KIND],
          '#L': [NOURISH_FLAG_NAMESPACE]
        } as never,
        undefined,
        relaySet
      ),
      new Promise<Set<NDKEvent>>((resolve) =>
        setTimeout(() => resolve(new Set()), 6000)
      )
    ]);
    signedFlags = Array.from(events).map(parseSignedFlag).filter(notNull);
  }

  function notNull<T>(v: T | null): v is T {
    return v !== null;
  }

  function parseSignedFlag(ev: NDKEvent): SignedFlag | null {
    const lTag = ev.tags.find((t) => t[0] === 'l' && t[2] === NOURISH_FLAG_NAMESPACE);
    if (!lTag) return null;
    const labelValue = lTag[1];
    const [direction, dimension] = labelValue.split(':');
    if (!direction || !dimension) return null;

    const aTag = ev.tags.find((t) => t[0] === 'a')?.[1];
    // NIP-73 `i` tag with "nourish-scan:<hash>" prefix.
    const iTag = ev.tags
      .find((t) => t[0] === 'i' && typeof t[1] === 'string' && t[1].startsWith(SCAN_I_TAG_PREFIX))?.[1];
    const scanHash = iTag ? iTag.slice(SCAN_I_TAG_PREFIX.length) : undefined;
    const target = aTag ? `a:${aTag}` : scanHash ? `scan:${scanHash}` : '';
    if (!target) return null;

    const scoreRaw = ev.tags.find((t) => t[0] === 'score')?.[1];
    const score = scoreRaw ? Number(scoreRaw) : null;
    const nourishVer = ev.tags.find((t) => t[0] === 'nourish-ver')?.[1] ?? '';

    return {
      target,
      dimension,
      direction,
      score: score !== null && isFinite(score) ? score : null,
      nourishVer,
      reason: ev.content ?? '',
      pubkey: ev.pubkey,
      createdAt: new Date((ev.created_at ?? 0) * 1000).toISOString()
    };
  }

  async function loadCandidates() {
    if (!$ndk) return;
    candidates = await fetchOutOfVersionCandidates($ndk, NOURISH_PROMPT_VERSION);
  }

  async function loadAll() {
    loading = true;
    loadError = '';
    try {
      await Promise.all([loadAnon(), loadSigned(), loadCandidates()]);
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    if (authed) loadAll();
  });

  // Re-load when pubkey arrives after mount (common in this app).
  $: if (authed && loading && !loadError) loadAll();

  // ── Aggregation ────────────────────────────────────────────────────

  interface Group {
    target: string;
    dimension: string;
    nourishVer: string;
    tooHighSigned: number;
    tooHighAnon: number;
    tooLowSigned: number;
    tooLowAnon: number;
    total: number;
    lastAt: number;
    samples: Array<{
      source: Source;
      author: string;
      reason: string;
      direction: string;
      createdAt: string;
    }>;
  }

  // Grouping tuple partitions by (target, dimension, nourishVer) so
  // flags against a v1 score don't collapse with flags against a v2
  // score on the same target — the admin can see whether a prior
  // rescore cleared the v1 cluster.
  function keyOf(target: string, dimension: string, nourishVer: string): string {
    return `${target}|${dimension}|${nourishVer || 'unknown'}`;
  }

  function groupFlags(
    signed: SignedFlag[],
    anon: AnonFlag[],
    kind: TabKind
  ): Group[] {
    const isRecipesTab = kind === 'recipes';
    const map = new Map<string, Group>();
    const push = (
      target: string,
      dimension: string,
      nourishVer: string,
      direction: string,
      source: Source,
      author: string,
      reason: string,
      createdAt: string
    ) => {
      const matchesTab = isRecipesTab ? target.startsWith('a:') : target.startsWith('scan:');
      if (!matchesTab) return;
      const k = keyOf(target, dimension, nourishVer);
      const ts = Date.parse(createdAt) || 0;
      let g = map.get(k);
      if (!g) {
        g = {
          target,
          dimension,
          nourishVer: nourishVer || 'unknown',
          tooHighSigned: 0,
          tooHighAnon: 0,
          tooLowSigned: 0,
          tooLowAnon: 0,
          total: 0,
          lastAt: 0,
          samples: []
        };
        map.set(k, g);
      }
      if (direction === 'too-high') {
        if (source === 'signed') g.tooHighSigned++;
        else g.tooHighAnon++;
      } else {
        if (source === 'signed') g.tooLowSigned++;
        else g.tooLowAnon++;
      }
      g.total++;
      if (ts > g.lastAt) g.lastAt = ts;
      if (reason && g.samples.length < 5) {
        g.samples.push({ source, author, reason, direction, createdAt });
      }
    };

    for (const f of signed) {
      push(
        f.target,
        f.dimension,
        f.nourishVer,
        f.direction,
        'signed',
        // Truncated hex pubkey — labelling as "pubkey" honestly rather than
        // "npub" which would require nip19 encoding. Admin view.
        `pubkey:${f.pubkey.slice(0, 8)}…`,
        f.reason,
        f.createdAt
      );
    }
    for (const f of anon) {
      push(
        f.target,
        f.dimension,
        f.nourishVer,
        f.direction,
        'anon',
        `anon-${f.ipHash.slice(0, 4)}`,
        f.reason,
        f.createdAt
      );
    }

    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }

  $: groups = groupFlags(signedFlags, anonFlags, activeTab);

  // Total flag count per target (across all dimensions / directions /
  // sources) — used to prioritize candidates in the upgrade-candidates
  // tab. Keyed on the bare a-tag so it can be joined directly against
  // OutOfVersionCandidate.aTag.
  $: flagCountsByTarget = (() => {
    const counts = new Map<string, number>();
    const bump = (target: string) => {
      if (!target.startsWith('a:')) return;
      const aTag = target.slice(2);
      counts.set(aTag, (counts.get(aTag) ?? 0) + 1);
    };
    for (const f of signedFlags) bump(f.target);
    for (const f of anonFlags) bump(f.target);
    return counts;
  })();

  $: sortedCandidates = [...candidates]
    .map((c) => ({ candidate: c, flagCount: flagCountsByTarget.get(c.aTag) ?? 0 }))
    .sort((a, b) => b.flagCount - a.flagCount || b.candidate.createdAt - a.candidate.createdAt);

  function formatAgo(iso: number): string {
    if (!iso) return '—';
    const diff = Date.now() - iso;
    const h = Math.floor(diff / 3_600_000);
    if (h < 1) return `${Math.floor(diff / 60_000)}m ago`;
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function toggleExpand(key: string) {
    expandedKey = expandedKey === key ? null : key;
  }

  // ── Rescore state ──────────────────────────────────────────────────
  //
  // Per-row state tracks whether a rescore is in flight or has completed.
  // Keyed by the full group key (target|dimension|nourishVer). The
  // confirmation modal is a single instance driven by `pendingRescore`.
  // Previous score is captured client-side via queryNourishEvent BEFORE
  // the POST fires (per Phase 1 late-surface refinement) so the admin
  // can see old→new even after pantry has been overwritten.

  interface ScoreSnapshot {
    scores: NourishScores;
    createdAt: number;
    promptVersion: string;
  }

  type RescoreState =
    | { status: 'idle' }
    | { status: 'preparing' }
    | { status: 'prepare-error'; message: string }
    | { status: 'submitting' }
    | { status: 'success'; previous: ScoreSnapshot | null; next: ScoreSnapshot }
    | { status: 'error'; message: string };

  // Svelte 4 reactivity: reassign the object to trigger updates rather
  // than mutating the Map in place. All prepare/submit state is keyed
  // per row so one row's failure can't disable or leak error text into
  // another row's button.
  let rescoreStates: Record<string, RescoreState> = {};

  let pendingRescore:
    | {
        key: string;
        recipePubkey: string;
        recipeDTag: string;
        content: { title: string; ingredients: string[]; tags: string[]; servings: string };
        contentHash: string;
        previous: ScoreSnapshot | null;
      }
    | null = null;

  function getRescoreState(key: string): RescoreState {
    return rescoreStates[key] ?? { status: 'idle' };
  }

  function setRescoreState(key: string, state: RescoreState) {
    rescoreStates = { ...rescoreStates, [key]: state };
  }

  /**
   * Parse the target string back into (recipePubkey, recipeDTag).
   * Targets in the recipes tab are `a:30023:pubkey:dTag`. Returns null
   * for non-recipe targets or malformed a-tags.
   */
  function parseRecipeTarget(target: string): { recipePubkey: string; recipeDTag: string } | null {
    if (!target.startsWith('a:')) return null;
    const parts = target.slice(2).split(':');
    if (parts.length < 3) return null;
    // a-tag = kind:pubkey:dTag. We ignore kind (always 30023 here).
    const [, recipePubkey, ...rest] = parts;
    const recipeDTag = rest.join(':');
    if (!recipePubkey || !recipeDTag) return null;
    return { recipePubkey, recipeDTag };
  }

  /**
   * Fetch the kind-30023 recipe event from relays so we can extract
   * the content for the rescore pipeline. Returns null if the event
   * can't be located — rescore can't proceed without content.
   */
  async function fetchRecipeEvent(recipePubkey: string, recipeDTag: string): Promise<NDKEvent | null> {
    if (!$ndk) return null;
    try {
      const ev = await Promise.race([
        $ndk.fetchEvent({
          kinds: [30023 as number],
          authors: [recipePubkey],
          '#d': [recipeDTag]
        } as never),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000))
      ]);
      return ev ?? null;
    } catch {
      return null;
    }
  }

  async function prepareRescore(
    key: string,
    recipePubkey: string,
    recipeDTag: string
  ) {
    if (!$ndk) return;
    setRescoreState(key, { status: 'preparing' });
    try {
      // Capture previous score from pantry BEFORE POSTing. After rescore,
      // pantry will have replaced the event; this snapshot is the
      // admin's only before/after record.
      const [recipeEv, pantryRes] = await Promise.all([
        fetchRecipeEvent(recipePubkey, recipeDTag),
        queryNourishEvent($ndk, recipePubkey, recipeDTag)
      ]);

      if (!recipeEv) {
        setRescoreState(key, {
          status: 'prepare-error',
          message: 'Could not fetch the recipe event from relays.'
        });
        return;
      }

      const title =
        recipeEv.tags.find((t) => t[0] === 'title')?.[1] ||
        recipeEv.tags.find((t) => t[0] === 'd')?.[1] ||
        '';
      const tags = recipeEv.tags.filter((t) => t[0] === 't' && t[1]).map((t) => t[1]);
      const parsedMd = parseMarkdownForEditing(recipeEv.content || '');
      const servings = parsedMd.information?.servings || '';
      const ingredients = parsedMd.ingredients;

      if (!ingredients || ingredients.length === 0) {
        setRescoreState(key, {
          status: 'prepare-error',
          message: 'Recipe has no ingredients to score.'
        });
        return;
      }

      const contentHash = await computeContentHash(recipeEv.content || '');

      const previous: ScoreSnapshot | null =
        pantryRes.status === 'hit'
          ? {
              scores: pantryRes.result.scores,
              createdAt: pantryRes.result.createdAt,
              promptVersion: pantryRes.result.promptVersion
            }
          : null;

      pendingRescore = {
        key,
        recipePubkey,
        recipeDTag,
        content: { title, ingredients, tags, servings },
        contentHash,
        previous
      };
      // Preparation done; return to idle so the confirmation modal
      // (driven by pendingRescore) can take over. confirmRescore will
      // transition to submitting.
      setRescoreState(key, { status: 'idle' });
    } catch (err) {
      setRescoreState(key, {
        status: 'prepare-error',
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }

  async function handleRescoreClick(g: Group) {
    const key = keyOf(g.target, g.dimension, g.nourishVer);
    const parsed = parseRecipeTarget(g.target);
    if (!parsed) {
      setRescoreState(key, {
        status: 'prepare-error',
        message: 'Unable to parse recipe coordinates.'
      });
      return;
    }
    await prepareRescore(key, parsed.recipePubkey, parsed.recipeDTag);
  }

  async function handleCandidateRescoreClick(c: OutOfVersionCandidate) {
    // Candidate key uses the pantry d-tag + current version so it
    // doesn't collide with flag row keys. Candidates don't have a
    // dimension — rescore applies to the whole target.
    await prepareRescore(
      `candidate:${c.aTag}`,
      c.recipePubkey,
      c.recipeDTag
    );
  }

  function cancelRescore() {
    pendingRescore = null;
  }

  async function confirmRescore() {
    if (!pendingRescore || !$userPublickey) return;
    const { key, recipePubkey, recipeDTag, content, contentHash, previous } = pendingRescore;

    setRescoreState(key, { status: 'submitting' });
    // Keep the pending context around so we still know which row is
    // confirming; close the modal so the row shows submitting state.
    pendingRescore = null;

    try {
      const res = await fetch('/api/admin/nourish/rescore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-pubkey': $userPublickey
        },
        body: JSON.stringify({
          recipePubkey,
          recipeDTag,
          title: content.title,
          ingredients: content.ingredients,
          tags: content.tags,
          servings: content.servings,
          contentHash
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRescoreState(key, {
          status: 'error',
          message: typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`
        });
        return;
      }
      const data = await res.json();
      if (!data?.success || data?.published !== true) {
        setRescoreState(key, {
          status: 'error',
          message: typeof data?.error === 'string' ? data.error : 'Rescore failed'
        });
        return;
      }
      setRescoreState(key, {
        status: 'success',
        previous,
        next: {
          scores: data.scores,
          createdAt: data.createdAt,
          promptVersion: data.promptVersion
        }
      });
    } catch (err) {
      setRescoreState(key, {
        status: 'error',
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }

  function retryRescore(key: string) {
    setRescoreState(key, { status: 'idle' });
  }
</script>

<svelte:head>
  <title>Nourish Flags — Admin</title>
</svelte:head>

<div class="page">
  <h1>Nourish Flags</h1>

  {#if !authed}
    <div class="unauthorized">
      <p>Not authorized.</p>
    </div>
  {:else if loading}
    <p class="status">Loading flags…</p>
  {:else if loadError}
    <p class="status status-error">Couldn't load flags: {loadError}</p>
  {:else}
    <div class="tabs">
      <button
        class="tab"
        class:active={activeTab === 'recipes'}
        on:click={() => (activeTab = 'recipes')}
      >
        Recipes
      </button>
      <button
        class="tab"
        class:active={activeTab === 'scans'}
        on:click={() => (activeTab = 'scans')}
      >
        Scans
      </button>
      <button
        class="tab"
        class:active={activeTab === 'candidates'}
        on:click={() => (activeTab = 'candidates')}
      >
        Upgrade candidates
        {#if sortedCandidates.length > 0}
          <span class="tab-badge">{sortedCandidates.length}</span>
        {/if}
      </button>
    </div>

    {#if activeTab === 'candidates'}
      {#if sortedCandidates.length === 0}
        <p class="status">
          No candidates. All scored recipes match the current model version (v{NOURISH_PROMPT_VERSION}).
        </p>
      {:else}
        <div class="list">
          {#each sortedCandidates as { candidate, flagCount } (candidate.eventId)}
            {@const k = `candidate:${candidate.aTag}`}
            {@const rescoreState = getRescoreState(k)}
            <div class="row">
              <div class="row-header row-header-candidate">
                <span class="target">a:{candidate.aTag}</span>
                <span class="ver">
                  v{candidate.promptVersion} → v{NOURISH_PROMPT_VERSION}
                </span>
                <span class="candidate-flags">Flags: {flagCount}</span>
                <span class="candidate-score">
                  Overall {candidate.scores.overall.score}
                </span>
              </div>
              <div class="row-detail">
                {#if rescoreState.status === 'idle'}
                  <button
                    type="button"
                    class="btn-rescore"
                    on:click={() => handleCandidateRescoreClick(candidate)}
                  >
                    Rescore to current version
                  </button>
                {:else if rescoreState.status === 'preparing'}
                  <p class="rescore-submitting">Preparing…</p>
                {:else if rescoreState.status === 'prepare-error'}
                  <div class="rescore-error-block">
                    <p class="rescore-error">{rescoreState.message}</p>
                    <button
                      type="button"
                      class="btn-rescore-retry"
                      on:click={() => retryRescore(k)}
                    >
                      Retry
                    </button>
                  </div>
                {:else if rescoreState.status === 'submitting'}
                  <p class="rescore-submitting">Rescoring…</p>
                {:else if rescoreState.status === 'success'}
                  <div class="rescore-success">
                    <p class="rescore-label">Rescored</p>
                    <div class="rescore-diff">
                      <div class="rescore-col">
                        <span class="rescore-heading">Before</span>
                        {#if rescoreState.previous}
                          <span class="rescore-score">
                            {rescoreState.previous.scores.overall.score} ({rescoreState.previous.scores.overall.label})
                          </span>
                          <span class="rescore-meta">v{rescoreState.previous.promptVersion}</span>
                        {:else}
                          <span class="rescore-meta">No prior score</span>
                        {/if}
                      </div>
                      <span class="rescore-arrow">→</span>
                      <div class="rescore-col">
                        <span class="rescore-heading">After</span>
                        <span class="rescore-score">
                          {rescoreState.next.scores.overall.score} ({rescoreState.next.scores.overall.label})
                        </span>
                        <span class="rescore-meta">v{rescoreState.next.promptVersion}</span>
                      </div>
                    </div>
                  </div>
                {:else if rescoreState.status === 'error'}
                  <div class="rescore-error-block">
                    <p class="rescore-error">Rescore failed: {rescoreState.message}</p>
                    <button
                      type="button"
                      class="btn-rescore-retry"
                      on:click={() => retryRescore(k)}
                    >
                      Retry
                    </button>
                  </div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {:else if groups.length === 0}
      <p class="status">No flags in this bucket yet.</p>
    {:else}
      <div class="list">
        {#each groups as g (keyOf(g.target, g.dimension, g.nourishVer))}
          {@const k = keyOf(g.target, g.dimension, g.nourishVer)}
          {@const rescoreState = getRescoreState(k)}
          <div class="row" class:expanded={expandedKey === k}>
            <button
              type="button"
              class="row-header"
              on:click={() => toggleExpand(k)}
            >
              <span class="target">{g.target}</span>
              <span class="dim">{g.dimension}</span>
              <span class="ver">v{g.nourishVer}</span>
              <span class="counts">
                <span class="count high">↑ {g.tooHighSigned + g.tooHighAnon}</span>
                <span class="count low">↓ {g.tooLowSigned + g.tooLowAnon}</span>
              </span>
              <span class="ago">{formatAgo(g.lastAt)}</span>
            </button>
            {#if expandedKey === k}
              <div class="row-detail">
                <p class="breakdown">
                  Signed: {g.tooHighSigned + g.tooLowSigned} · Anon: {g.tooHighAnon +
                    g.tooLowAnon}
                </p>
                {#if g.samples.length === 0}
                  <p class="no-samples">No free-text reasons on these flags.</p>
                {:else}
                  <ul class="samples">
                    {#each g.samples as s}
                      <li class="sample">
                        <span class="sample-meta">
                          [{s.source}] {s.author} · {s.direction}
                        </span>
                        <p class="sample-text">{s.reason}</p>
                      </li>
                    {/each}
                  </ul>
                {/if}

                {#if activeTab === 'recipes'}
                  <div class="rescore-block">
                    {#if rescoreState.status === 'idle'}
                      <button
                        type="button"
                        class="btn-rescore"
                        on:click={() => handleRescoreClick(g)}
                      >
                        Rescore
                      </button>
                    {:else if rescoreState.status === 'preparing'}
                      <p class="rescore-submitting">Preparing…</p>
                    {:else if rescoreState.status === 'prepare-error'}
                      <div class="rescore-error-block">
                        <p class="rescore-error">{rescoreState.message}</p>
                        <button
                          type="button"
                          class="btn-rescore-retry"
                          on:click={() => retryRescore(k)}
                        >
                          Retry
                        </button>
                      </div>
                    {:else if rescoreState.status === 'submitting'}
                      <p class="rescore-submitting">Rescoring…</p>
                    {:else if rescoreState.status === 'success'}
                      <div class="rescore-success">
                        <p class="rescore-label">Rescored</p>
                        <div class="rescore-diff">
                          <div class="rescore-col">
                            <span class="rescore-heading">Before</span>
                            {#if rescoreState.previous}
                              <span class="rescore-score">
                                {rescoreState.previous.scores.overall.score} ({rescoreState.previous.scores.overall.label})
                              </span>
                              <span class="rescore-meta">v{rescoreState.previous.promptVersion}</span>
                            {:else}
                              <span class="rescore-meta">No prior score</span>
                            {/if}
                          </div>
                          <span class="rescore-arrow">→</span>
                          <div class="rescore-col">
                            <span class="rescore-heading">After</span>
                            <span class="rescore-score">
                              {rescoreState.next.scores.overall.score} ({rescoreState.next.scores.overall.label})
                            </span>
                            <span class="rescore-meta">v{rescoreState.next.promptVersion}</span>
                          </div>
                        </div>
                      </div>
                    {:else if rescoreState.status === 'error'}
                      <div class="rescore-error-block">
                        <p class="rescore-error">Rescore failed: {rescoreState.message}</p>
                        <button
                          type="button"
                          class="btn-rescore-retry"
                          on:click={() => retryRescore(k)}
                        >
                          Retry
                        </button>
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<!-- Confirmation modal — shared instance driven by pendingRescore. -->
<Modal open={pendingRescore !== null} compact cleanup={cancelRescore}>
  <span slot="title">Rescore this recipe?</span>
  <div class="confirm-body">
    <p>This will compute a new Nourish score and replace the current one. Cannot be undone.</p>
    {#if pendingRescore?.previous}
      <p class="confirm-meta">
        Current: {pendingRescore.previous.scores.overall.score} ({pendingRescore.previous.scores.overall.label}) · v{pendingRescore.previous.promptVersion}
      </p>
    {/if}
    <div class="confirm-actions">
      <button type="button" class="btn-cancel" on:click={cancelRescore}>Cancel</button>
      <button type="button" class="btn-confirm" on:click={confirmRescore}>Rescore</button>
    </div>
  </div>
</Modal>

<style>
  .page {
    max-width: 960px;
    margin: 0 auto;
    padding: 2rem 1.25rem;
    color: var(--color-text-primary);
  }

  h1 {
    font-size: 1.5rem;
    font-weight: 700;
    margin: 0 0 1rem;
  }

  .unauthorized,
  .status {
    padding: 2rem;
    text-align: center;
    color: var(--color-text-secondary);
  }

  .status-error {
    color: #ef4444;
  }

  .tabs {
    display: flex;
    gap: 0.5rem;
    border-bottom: 1px solid var(--color-input-border);
    margin-bottom: 1rem;
  }

  .tab {
    padding: 0.5rem 1rem;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .tab.active {
    color: var(--color-text-primary);
    border-bottom-color: var(--color-primary);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .row {
    border: 1px solid var(--color-input-border);
    border-radius: 0.5rem;
    background: var(--color-bg-secondary);
  }

  .row-header {
    display: grid;
    grid-template-columns: 1fr auto auto auto auto;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
    width: 100%;
    background: none;
    border: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
    font-family: inherit;
  }

  .ver {
    font-size: 0.6875rem;
    font-family: ui-monospace, monospace;
    color: var(--color-text-secondary);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    background: var(--color-bg-tertiary, rgba(255, 255, 255, 0.04));
  }

  .tab-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.25rem;
    padding: 0 0.375rem;
    margin-left: 0.375rem;
    border-radius: 9999px;
    background: var(--color-primary);
    color: white;
    font-size: 0.6875rem;
    font-weight: 600;
  }

  .row-header-candidate {
    /* Non-button header for candidate rows — no toggle-expand needed. */
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
  }

  .candidate-flags,
  .candidate-score {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .rescore-block {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--color-input-border);
  }

  .btn-rescore,
  .btn-rescore-retry {
    padding: 0.375rem 0.75rem;
    border-radius: 0.4rem;
    background: var(--color-primary);
    color: white;
    font-size: 0.8125rem;
    font-weight: 500;
    border: none;
    cursor: pointer;
  }

  .btn-rescore:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-rescore-retry {
    background: var(--color-bg-tertiary);
    color: var(--color-text-primary);
    border: 1px solid var(--color-input-border);
  }

  .rescore-submitting {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .rescore-error-block {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .rescore-error {
    margin: 0;
    font-size: 0.8125rem;
    color: #ef4444;
  }

  .rescore-success {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .rescore-label {
    margin: 0;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-secondary);
  }

  .rescore-diff {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .rescore-col {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .rescore-heading {
    font-size: 0.6875rem;
    color: var(--color-text-secondary);
  }

  .rescore-score {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .rescore-meta {
    font-size: 0.6875rem;
    font-family: ui-monospace, monospace;
    color: var(--color-text-secondary);
  }

  .rescore-arrow {
    font-size: 1.25rem;
    color: var(--color-text-secondary);
  }

  .confirm-body {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .confirm-meta {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .btn-cancel,
  .btn-confirm {
    padding: 0.4rem 0.9rem;
    border-radius: 0.4rem;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    border: none;
  }

  .btn-cancel {
    background: var(--color-bg-tertiary);
    color: var(--color-text-primary);
    border: 1px solid var(--color-input-border);
  }

  .btn-confirm {
    background: var(--color-primary);
    color: white;
  }

  .row-header:hover {
    background: var(--color-bg-tertiary);
  }

  .target {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dim {
    font-size: 0.875rem;
    font-weight: 500;
    text-transform: capitalize;
  }

  .counts {
    display: flex;
    gap: 0.5rem;
    font-size: 0.8125rem;
  }

  .count.high {
    color: #ef4444;
  }

  .count.low {
    color: #3b82f6;
  }

  .ago {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .row-detail {
    padding: 0.5rem 1rem 1rem;
    border-top: 1px solid var(--color-input-border);
  }

  .breakdown {
    margin: 0 0 0.5rem;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .no-samples {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    font-style: italic;
  }

  .samples {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .sample {
    border-left: 2px solid var(--color-input-border);
    padding-left: 0.75rem;
  }

  .sample-meta {
    display: block;
    font-family: ui-monospace, monospace;
    font-size: 0.6875rem;
    color: var(--color-text-secondary);
    margin-bottom: 0.1875rem;
  }

  .sample-text {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.4;
  }
</style>
