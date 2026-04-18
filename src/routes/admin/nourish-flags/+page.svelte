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
  import { NOURISH_FLAG_KIND, NOURISH_FLAG_NAMESPACE } from '$lib/nourish/flagSubmit';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';

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
  type TabKind = 'recipes' | 'scans';

  let loading = true;
  let loadError = '';
  let anonFlags: AnonFlag[] = [];
  let signedFlags: SignedFlag[] = [];
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
    const events = await Promise.race([
      $ndk.fetchEvents({
        kinds: [NOURISH_FLAG_KIND],
        '#L': [NOURISH_FLAG_NAMESPACE]
      } as never),
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
    const scanHash = ev.tags.find((t) => t[0] === 'scan-hash')?.[1];
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

  async function loadAll() {
    loading = true;
    loadError = '';
    try {
      await Promise.all([loadAnon(), loadSigned()]);
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

  function keyOf(target: string, dimension: string): string {
    return `${target}|${dimension}`;
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
      direction: string,
      source: Source,
      author: string,
      reason: string,
      createdAt: string
    ) => {
      const matchesTab = isRecipesTab ? target.startsWith('a:') : target.startsWith('scan:');
      if (!matchesTab) return;
      const k = keyOf(target, dimension);
      const ts = Date.parse(createdAt) || 0;
      let g = map.get(k);
      if (!g) {
        g = {
          target,
          dimension,
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
        f.direction,
        'signed',
        `npub:${f.pubkey.slice(0, 8)}…`,
        f.reason,
        f.createdAt
      );
    }
    for (const f of anon) {
      push(
        f.target,
        f.dimension,
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
    </div>

    {#if groups.length === 0}
      <p class="status">No flags in this bucket yet.</p>
    {:else}
      <div class="list">
        {#each groups as g (keyOf(g.target, g.dimension))}
          {@const k = keyOf(g.target, g.dimension)}
          <div class="row" class:expanded={expandedKey === k}>
            <button
              type="button"
              class="row-header"
              on:click={() => toggleExpand(k)}
            >
              <span class="target">{g.target}</span>
              <span class="dim">{g.dimension}</span>
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
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

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
    grid-template-columns: 1fr auto auto auto;
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
