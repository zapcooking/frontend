<script lang="ts">
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import type { Event } from 'nostr-tools';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKNip46Signer } from '@nostr-dev-kit/ndk';
  import {
    applyLazarusPrivateTags,
    fitsLazarusRemoteRestore,
    getLazarusItemRange,
    groupLazarusCandidates,
    isPastEmptyVersion,
    rankLazarusCandidates,
    lazarusScanReachedNoRelay,
    loadOlderLazarusVersions,
    scanLazarusKind,
    sortLazarusCandidates,
    type LazarusCandidate,
    type LazarusListItem,
    type LazarusPrivateTags,
    type LazarusRelayOutcome,
    type LazarusScanResult,
    type LazarusSortOrder
  } from '$lib/lazarus/recovery';
  import { getContentEncryption, parsePrivateTags } from '$lib/lazarus/private-items';
  import { fitsNip46Request } from '$lib/lazarus/nip46';
  import { decrypt as decryptWithAppKey } from '$lib/encryptionService';
  import {
    getLazarusKindProfile,
    getLazarusKindProfiles,
    type LazarusKindProfile
  } from '$lib/lazarus/registry';
  import { zapLazarusRelaySource, closeLazarusScanPool, retryLazarusRelays } from '$lib/lazarus/source';
  import { publishLazarusRecovery, LazarusPublishError } from '$lib/lazarus/lazarusPublish';
  import LazarusDeltaPanel from './LazarusDeltaPanel.svelte';
  import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwise';
  import WarningIcon from 'phosphor-svelte/lib/Warning';
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';

  /**
   * Lazarus data recovery — a settings screen per the spec's UI contract:
   * scan on click, show every version found, recommend only after a clobber,
   * show the delta before any publish, restore through the user's own signer
   * on an explicit click. Never automatic.
   */
  export let initialKind = 3;

  type Stage = 'idle' | 'scanning' | 'results' | 'publishing' | 'published' | 'error';

  const kinds: LazarusKindProfile[] = getLazarusKindProfiles().filter((p) => p.tier <= 2);

  /**
   * Pill labels for the kind picker. The registry's names are the semantic
   * source of truth; these are display shortenings so the picker wraps
   * evenly (the full name rides along as the tooltip) — the one offender
   * was "Encryption key list (NIP-4e)", wide enough to strand itself on a
   * second row and leave the picker lopsided.
   */
  const KIND_LABELS: Record<number, string> = {
    3: 'Follows',
    10000: 'Mutes',
    0: 'Profile',
    10003: 'Bookmarks',
    10044: 'Encryption keys'
  };

  function kindLabel(k: LazarusKindProfile): string {
    return KIND_LABELS[k.kind] ?? k.name;
  }

  let selectedKind = initialKind;
  let stage: Stage = 'idle';
  let scan: LazarusScanResult | undefined;
  let profile: LazarusKindProfile | undefined;
  let error = '';
  let publishError = '';
  let publishedNote = '';
  let sortOrder: LazarusSortOrder = 'date';
  let showPastEmpty = false;
  let expandedGroups = new Set<string>();
  let selected: LazarusCandidate | undefined;
  /** The current version the reviewed delta was computed against. */
  let reviewedCurrentId: string | undefined;
  /** A version newer than the scan's current, found by the pre-sign re-check. */
  let changedLatestEvent: Event | undefined;
  let loadingOlder = false;
  let expandedRelays: string | undefined;
  let showRelayOutcomes = false;
  /** Error code of the last failed publish attempt, for the panel's
   * retry-and-override handling of an unreachable re-read. */
  let publishErrorCode: string | undefined;
  /** Failed re-read attempts; the override only appears after a retry failed. */
  let unconfirmedAttempts = 0;
  let retryingRelays = false;

  $: answeredRelays = scan?.relayOutcomes
    ? Object.values(scan.relayOutcomes).filter((outcome) => outcome === 'answered').length
    : 0;
  $: failedRelayUrls = Object.entries(scan?.relayOutcomes ?? {})
    .filter(([, outcome]) => outcome !== 'answered')
    .map(([url]) => url);

  function outcomeLabel(outcome: LazarusRelayOutcome | undefined): string {
    if (outcome === 'answered') return 'answered';
    return outcome === 'timed-out' ? 'timed out' : 'failed';
  }

  /**
   * Private items decrypted for open reviews (NIP-51), keyed by event id, so
   * the reviewed delta covers them; versions that couldn't be decrypted keep
   * their size estimate and the panel's encrypted-items warning.
   */
  let privateTags: LazarusPrivateTags = new Map();
  /** Event ids a decryption was already attempted for, prompt-free retries. */
  let privateAttempted = new Set<string>();
  let decryptingPrivate = false;

  /**
   * How deep an archival relay's history can run: hundreds of versions on
   * one list. Every row carries per-row work (labels, NIP-46 size checks),
   * and the whole list re-renders on each state change, so the rendered
   * row count is windowed: bounded DOM and bounded per-render cost however
   * far back the user pages, with the rest one "Show more" away.
   */
  const ROW_WINDOW = 60;
  let visibleRows = ROW_WINDOW;

  $: pubkey = $userPublickey;
  $: currentProfile = getLazarusKindProfile(selectedKind);
  $: canSign = !!get(ndk).signer && !!pubkey;
  $: isRemoteSigner = get(ndk).signer instanceof NDKNip46Signer;

  $: listItems =
    scan && currentProfile
      ? groupLazarusCandidates(scan, currentProfile, { hidePastEmpty: !showPastEmpty })
      : [];
  $: hasPastEmpty =
    scan && currentProfile
      ? scan.candidates.some((c) => isPastEmptyVersion(c, currentProfile))
      : false;
  $: canLoadOlder = !!scan && Object.keys(scan.olderCursors ?? {}).length > 0;

  /**
   * Per-row data computed once per scan, not per render: date labels and
   * (only under a remote signer, where it matters) the NIP-46 size check,
   * which stringifies the whole event — unaffordable per row per render on
   * a list with hundreds of versions.
   */
  $: rowMeta = buildRowMeta(scan, isRemoteSigner, pubkey);
  $: items = buildItems(listItems, scan, currentProfile, sortOrder, visibleRows);

  // The delta is computed against the newest version known: one found by the
  // pre-sign re-check if it changed, otherwise the scan's current. The panel
  // under the selected row receives it.
  $: deltaCurrentEvent = changedLatestEvent || scan?.current?.event;

  interface RowMeta {
    label: string;
    oversize?: boolean;
  }

  function buildRowMeta(
    result: LazarusScanResult | undefined,
    remote: boolean,
    pk: string
  ): Map<string, RowMeta> {
    const meta = new Map<string, RowMeta>();
    if (!result) return meta;
    for (const candidate of result.candidates) {
      meta.set(candidate.event.id, {
        label: new Date(candidate.event.created_at * 1000).toLocaleString(),
        oversize: remote && pk ? !fitsLazarusRemoteRestore(candidate.event, pk) : undefined
      });
    }
    return meta;
  }

  function buildItems(
    grouped: LazarusListItem[],
    result: LazarusScanResult | undefined,
    kindProfile: LazarusKindProfile | undefined,
    order: LazarusSortOrder,
    limit: number
  ): LazarusListItem[] {
    let all: LazarusListItem[];
    if (order === 'size' && result) {
      // Optional size order (spec): flat, largest first, newest on ties.
      all = sortLazarusCandidates(result.candidates, 'size').map((candidate): LazarusListItem => ({
        type: 'version',
        candidate
      }));
    } else {
      all = grouped;
    }
    return all.slice(0, limit);
  }

  function resetResults() {
    scan = undefined;
    selected = undefined;
    reviewedCurrentId = undefined;
    changedLatestEvent = undefined;
    expandedGroups = new Set();
    expandedRelays = undefined;
    showRelayOutcomes = false;
    showPastEmpty = false;
    sortOrder = 'date';
    visibleRows = ROW_WINDOW;
    privateTags = new Map();
    privateAttempted = new Set();
    publishErrorCode = undefined;
    unconfirmedAttempts = 0;
  }

  async function scanKind(kind = selectedKind) {
    if (!pubkey || stage === 'scanning') return;
    selectedKind = kind;
    profile = getLazarusKindProfile(kind);
    if (!profile) return;
    stage = 'scanning';
    error = '';
    publishError = '';
    resetResults();
    try {
      scan = await scanLazarusKind(kind, pubkey, zapLazarusRelaySource);
      reviewedCurrentId = scan.current?.event.id;
      stage = 'results';
    } catch (e) {
      error = e instanceof Error ? e.message : 'The scan failed. Please try again.';
      stage = 'error';
    }
  }

  async function loadOlder() {
    if (!scan || !profile || loadingOlder) return;
    loadingOlder = true;
    try {
      scan = await loadOlderLazarusVersions(profile, scan, pubkey, zapLazarusRelaySource);
    } catch {
      /* paging is best effort; the scan so far stays */
    } finally {
      loadingOlder = false;
    }
  }

  /**
   * Decrypt the reviewed versions' private items (NIP-51) with the app's
   * decryption service, so the delta the user approves covers them. Runs
   * when a review opens and when the pre-sign check surfaces a newer
   * current version — the two moments a delta is computed against
   * encrypted content. Versions that can't be decrypted (no signer, a
   * remote signer over its request cap, a declined prompt) stay estimated
   * and the panel says so; restoring them is still allowed — the spec's
   * flagged tier — since the encrypted content restores verbatim either way.
   */
  async function ensureReviewDecrypted(events: (Event | undefined)[]) {
    if (!canSign) return;
    const pending = events.filter(
      (event): event is Event =>
        !!event &&
        !!getContentEncryption(event.content) &&
        !privateTags.has(event.id) &&
        !privateAttempted.has(event.id)
    );
    if (pending.length === 0) return;
    for (const event of pending) privateAttempted.add(event.id);
    decryptingPrivate = true;
    try {
      for (const event of pending) {
        const encryption = getContentEncryption(event.content);
        if (!encryption) continue;
        if (
          isRemoteSigner &&
          !fitsNip46Request(encryption === 'nip04' ? 'nip04_decrypt' : 'nip44_decrypt', [
            event.pubkey,
            event.content
          ])
        ) {
          continue;
        }
        try {
          const plainText = await decryptWithAppKey(event.pubkey, event.content, encryption);
          const tags = parsePrivateTags(plainText);
          if (tags) privateTags = new Map(privateTags).set(event.id, tags);
        } catch {
          /* stays estimated; the panel discloses the encrypted remainder */
        }
      }
      // Re-rank so decrypted counts turn exact, and keep the selected row
      // pointing at its re-ranked candidate.
      if (scan && profile && privateTags.size > 0) {
        scan = applyLazarusPrivateTags(profile, scan, privateTags);
        const selectedId = selected?.event.id;
        if (selectedId) {
          selected = scan.candidates.find((c) => c.event.id === selectedId) ?? selected;
        }
      }
    } finally {
      decryptingPrivate = false;
    }
  }

  function selectCandidate(candidate: LazarusCandidate) {
    selected = candidate;
    publishErrorCode = undefined;
    unconfirmedAttempts = 0;
    if (currentProfile?.privateItemTypes) {
      void ensureReviewDecrypted([candidate.event, deltaCurrentEvent]);
    }
  }

  function itemRangeLabel(candidate: LazarusCandidate): string {
    const range = getLazarusItemRange(candidate.itemCount);
    const estimate = range.min !== range.max;
    const partial = candidate.itemCount.partial && !candidate.itemCount.privateCount;
    if (range.max === 0) return profile?.meaningfulEmpty ? 'empty (defined state)' : 'empty';
    const base = estimate ? `${range.min}–${range.max} items (est.)` : `${range.min} item${range.min === 1 ? '' : 's'}`;
    return partial ? `${base} + private unknown` : base;
  }

  async function restore(allowUnconfirmed = false) {
    if (!selected || !pubkey || stage === 'publishing') return;
    stage = 'publishing';
    publishError = '';
    publishErrorCode = undefined;
    try {
      const result = await publishLazarusRecovery({
        chosen: selected.event,
        // What the panel computed the delta against. After a 'changed' result
        // that's the newer version, which isn't among the scan's candidates.
        reviewedCurrent: deltaCurrentEvent,
        pubkey,
        ndk: get(ndk),
        respondingRelays: scan?.respondingRelays ?? [],
        allowUnconfirmed
      });
      if (result.status === 'changed') {
        // The list moved since the review: show the change, recompute the
        // delta against the newer version, and ask again. reviewedCurrentId
        // is the panel's reset key, so its confirmations un-arm too.
        changedLatestEvent = result.latest;
        reviewedCurrentId = result.latest.id;
        if (currentProfile?.privateItemTypes) {
          void ensureReviewDecrypted([selected?.event, result.latest]);
        }
        stage = 'results';
        return;
      }
      const accepted = result.publishedRelays.length;
      const relays = accepted === 1 ? 'write relay' : 'write relays';
      publishedNote = `Recovered and republished on ${accepted} ${relays}.`;
      stage = 'published';
    } catch (e) {
      publishError =
        e instanceof LazarusPublishError ? e.message : 'The restore failed. Please try again.';
      publishErrorCode = e instanceof LazarusPublishError ? e.code : undefined;
      if (publishErrorCode === 'current-unreadable') unconfirmedAttempts += 1;
      stage = 'results';
    }
  }

  /**
   * Re-ask just the relays that failed or timed out, and merge what they
   * give into the existing scan (spec 0.6.0 "Relay outcomes" → Retry). A
   * write relay answering here confirms current, which can lift the
   * withheld recommendation.
   */
  async function retryFailedRelays() {
    if (!scan || !currentProfile || !pubkey || retryingRelays || failedRelayUrls.length === 0) return;
    retryingRelays = true;
    try {
      const { tagged, outcomes, currentConfirmed } = await retryLazarusRelays(
        scan.kind,
        pubkey,
        failedRelayUrls
      );
      const existingTagged = scan.candidates.flatMap((candidate) =>
        candidate.foundOn.map((relayUrl) => ({ event: candidate.event, relayUrl }))
      );
      const mergedOutcomes = { ...(scan.relayOutcomes ?? {}), ...outcomes };
      const responding = Array.from(
        new Set([...scan.respondingRelays, ...Object.keys(outcomes).filter((u) => outcomes[u] === 'answered' && tagged.some((x) => x.relayUrl === u))])
      );
      scan = {
        ...rankLazarusCandidates(
          currentProfile,
          [...existingTagged, ...tagged],
          Array.from(new Set([...scan.queriedRelays, ...failedRelayUrls])),
          responding,
          privateTags,
          scan.currentConfirmed || currentConfirmed
        ),
        olderCursors: scan.olderCursors,
        relayOutcomes: mergedOutcomes,
        relayList: scan.relayList
      };
      reviewedCurrentId = scan.current?.event.id;
    } catch {
      /* a failed retry leaves the scan as it was */
    } finally {
      retryingRelays = false;
    }
  }

  onDestroy(() => {
    closeLazarusScanPool();
  });
</script>

<div class="lazarus" data-testid="lazarus-recovery">
  <p class="lz-intro">
    Restore a clobbered follow list, mute list, profile, or bookmarks from relay history.
    Scanning asks your relays — and relays known to keep old versions — for every surviving
    version of a list. Nothing is ever restored without your click, and every restore is signed
    by your own account.
  </p>

  {#if !pubkey}
    <p class="lz-note">Sign in to scan your relay history.</p>
  {:else}
    <!-- Kind picker: Tier 1 + 2 from the registry -->
    <div class="lz-kinds" role="group" aria-label="Recoverable data">
      {#each kinds as k (k.kind)}
        <button
          type="button"
          class="lz-kind"
          class:selected={k.kind === selectedKind}
          title={k.name}
          disabled={stage === 'scanning' || stage === 'publishing'}
          on:click={() => scanKind(k.kind)}
        >{kindLabel(k)}</button>
      {/each}
    </div>

    {#if !scan && stage !== 'scanning'}
      <button type="button" class="lz-scan" on:click={() => scanKind()} disabled={stage === 'publishing'}>
        <ArrowClockwiseIcon size={16} />
        Scan relay history
      </button>
    {/if}

    {#if stage === 'scanning'}
      <p class="lz-note">Scanning relays…</p>
    {/if}

    {#if stage === 'error'}
      <p class="lz-error">{error}</p>
    {/if}

    {#if stage === 'published'}
      <div class="lz-published">
        <CheckCircleIcon size={18} weight="fill" />
        <div>
          <p class="lz-published-title">{publishedNote}</p>
          <p class="lz-note">The app's local copy was refreshed — your next edit builds on the recovered version.</p>
        </div>
      </div>
    {/if}

    {#if scan && (stage === 'results' || stage === 'publishing')}
      <p class="lz-scanmeta">
        {scan.candidates.length} version{scan.candidates.length === 1 ? '' : 's'} found.
        {#if scan.relayOutcomes}
          <button
            type="button"
            class="lz-relays"
            on:click={() => (showRelayOutcomes = !showRelayOutcomes)}
          >
            {answeredRelays} of {scan.queriedRelays.length} relays answered
          </button>
        {/if}
        {#if !scan.recommended && !scan.requiresIntentConfirmation && currentProfile?.ranking === 'count' && scan.currentConfirmed && scan.candidates.length > 0}
          No recoverable improvement found — your current version looks healthy.
        {/if}
        {#if scan.recommended}
          A clobber was detected: the highlighted version is the fullest one from before the damage.
        {/if}
      </p>

      {#if showRelayOutcomes && scan.relayOutcomes}
        <ul class="lz-relay-list">
          {#each scan.queriedRelays as relay (relay)}
            <li>{relay} — {outcomeLabel(scan.relayOutcomes[relay])}</li>
          {/each}
        </ul>
      {/if}

      {#if failedRelayUrls.length > 0 && stage !== 'publishing'}
        <button
          type="button"
          class="lz-scan"
          on:click={retryFailedRelays}
          disabled={retryingRelays}
        >
          <ArrowClockwiseIcon size={14} />
          {retryingRelays ? 'Retrying…' : `Retry ${failedRelayUrls.length} unreachable relay${failedRelayUrls.length === 1 ? '' : 's'}`}
        </button>
      {/if}

      {#if lazarusScanReachedNoRelay(scan)}
        <div class="lz-notice" role="alert">
          <WarningIcon size={16} weight="fill" />
          No relay finished answering, so these versions may be incomplete. Scan again to retry.
        </div>
      {:else if !scan.currentConfirmed}
        <div class="lz-notice" role="alert">
          <WarningIcon size={16} weight="fill" />
          {scan.relayList === 'unknown'
            ? "Couldn't fetch your relay list, so the newest version found may not be current and nothing is recommended. Scan again to retry."
            : 'None of your write relays answered, so the newest version found may not be current and nothing is recommended. Scan again to retry.'}
        </div>
      {/if}
      {#if scan.relayList === 'missing'}
        <div class="lz-notice">
          <WarningIcon size={16} weight="fill" />
          No relay list found for this account, so the app's relays stand in as its write relays.
        </div>
      {/if}

      {#if currentProfile?.ranking === 'count' && scan.candidates.length > 1}
        <div class="lz-toolbar">
          <button
            type="button"
            class="lz-sort"
            class:active={sortOrder === 'date'}
            on:click={() => (sortOrder = 'date')}
          >Newest first</button>
          <button
            type="button"
            class="lz-sort"
            class:active={sortOrder === 'size'}
            on:click={() => (sortOrder = 'size')}
          >Largest first</button>
          {#if hasPastEmpty}
            <label class="lz-empty-toggle">
              <input type="checkbox" bind:checked={showPastEmpty} />
              Show empty versions
            </label>
          {/if}
        </div>
      {/if}

      {#if changedLatestEvent}
        <div class="lz-changed" role="alert">
          <WarningIcon size={16} weight="fill" />
          The list changed after this scan (another device or client edited it). The delta below
          was recalculated against the newer version — review it and confirm again.
        </div>
      {/if}

      <div class="lz-list">
        {#each items as item (item.type === 'group' ? 'g:' + item.candidates[0].event.id : item.candidate.event.id)}
          {#if item.type === 'version'}
            {@const candidate = item.candidate}
            {@const meta = rowMeta.get(candidate.event.id)}
            <div
              class="lz-version"
              class:is-current={candidate.isCurrent}
              class:is-recommended={candidate.isRecommended}
              class:is-selected={selected?.event.id === candidate.event.id}
            >
              <div class="lz-version-main">
                <div class="lz-version-head">
                  <span class="lz-version-date">{meta?.label ?? candidate.event.created_at}</span>
                  <span class="lz-version-count">{itemRangeLabel(candidate)}</span>
                  {#if candidate.isCurrent}<span class="lz-badge lz-badge--current">Current</span>{/if}
                  {#if candidate.isRecommended}<span class="lz-badge lz-badge--recommended">Recommended</span>{/if}
                  {#if meta?.oversize}
                    <span class="lz-badge lz-badge--warn" title="NIP-46 requests are capped at 65,535 bytes">Too large for remote signer</span>
                  {/if}
                </div>
                <button
                  type="button"
                  class="lz-relays"
                  on:click={() => (expandedRelays = expandedRelays === candidate.event.id ? undefined : candidate.event.id)}
                >
                  on {candidate.foundOn.length} relay{candidate.foundOn.length === 1 ? '' : 's'}
                </button>
                {#if expandedRelays === candidate.event.id}
                  <ul class="lz-relay-list">
                    {#each candidate.foundOn as relay (relay)}<li>{relay}</li>{/each}
                  </ul>
                {/if}
              </div>
              <div class="lz-version-actions">
                {#if !candidate.isCurrent && currentProfile && !isPastEmptyVersion(candidate, currentProfile)}
                  <button
                    type="button"
                    class="lz-restore"
                    on:click={() => selectCandidate(candidate)}
                    disabled={stage === 'publishing'}
                  >Review</button>
                {/if}
              </div>
            </div>
            {#if selected?.event.id === candidate.event.id}
              <!-- The review opens under the row the user clicked — where
                   they are looking — not at the end of the list. -->
              <LazarusDeltaPanel
                candidate={selected}
                currentEvent={deltaCurrentEvent}
                profile={currentProfile}
                label={meta?.label ?? ''}
                {pubkey}
                canSign={canSign}
                remoteSigner={isRemoteSigner}
                publishing={stage === 'publishing'}
                publishError={publishError}
                privateTags={privateTags}
                decryptingPrivate={decryptingPrivate}
                resetKey={reviewedCurrentId ?? 0}
                publishErrorCode={publishErrorCode}
                showOverride={unconfirmedAttempts >= 2}
                on:restore={() => restore()}
                on:restore-override={() => restore(true)}
                on:close={() => (selected = undefined)}
              />
            {/if}
          {:else}
            {@const groupKey = item.candidates[0].event.id}
            <button
              type="button"
              class="lz-group"
              class:is-clobber={item.clobbered}
              on:click={() => {
                const next = new Set(expandedGroups);
                if (next.has(groupKey)) next.delete(groupKey);
                else next.add(groupKey);
                expandedGroups = next;
                // An expanded group renders all of its versions; keep the
                // window from hiding the ones it just revealed.
                if (next.has(groupKey)) visibleRows = Math.max(visibleRows, ROW_WINDOW + item.candidates.length);
              }}
            >
              {item.clobbered ? 'Clobber episode' : 'Run of edits'} — {item.candidates.length} versions
              <span class="lz-group-hint">{expandedGroups.has(groupKey) ? 'hide' : 'show'}</span>
            </button>
            {#if expandedGroups.has(groupKey)}
              {#each item.candidates as candidate (candidate.event.id)}
                {@const meta = rowMeta.get(candidate.event.id)}
                <div
                  class="lz-version lz-version--grouped"
                  class:is-recommended={candidate.isRecommended}
                  class:is-selected={selected?.event.id === candidate.event.id}
                >
                  <div class="lz-version-main">
                    <span class="lz-version-date">{meta?.label ?? candidate.event.created_at}</span>
                    <span class="lz-version-count">{itemRangeLabel(candidate)}</span>
                    <button
                      type="button"
                      class="lz-restore"
                      on:click={() => selectCandidate(candidate)}
                      disabled={stage === 'publishing'}
                    >Review</button>
                  </div>
                </div>
                {#if selected?.event.id === candidate.event.id}
                  <LazarusDeltaPanel
                    candidate={selected}
                    currentEvent={deltaCurrentEvent}
                    profile={currentProfile}
                    label={meta?.label ?? ''}
                    {pubkey}
                    canSign={canSign}
                    remoteSigner={isRemoteSigner}
                    publishing={stage === 'publishing'}
                    publishError={publishError}
                    privateTags={privateTags}
                    decryptingPrivate={decryptingPrivate}
                    resetKey={reviewedCurrentId ?? 0}
                    publishErrorCode={publishErrorCode}
                    showOverride={unconfirmedAttempts >= 2}
                    on:restore={() => restore()}
                    on:restore-override={() => restore(true)}
                    on:close={() => (selected = undefined)}
                  />
                {/if}
              {/each}
            {/if}
          {/if}
        {/each}
      </div>

      {#if listItems.length > visibleRows && sortOrder === 'date'}
        <button
          type="button"
          class="lz-scan"
          on:click={() => (visibleRows += ROW_WINDOW)}
          disabled={stage === 'publishing'}
        >
          Show more ({listItems.length - visibleRows} rows hidden)
        </button>
      {:else if sortOrder === 'size' && scan && scan.candidates.length > visibleRows}
        <button
          type="button"
          class="lz-scan"
          on:click={() => (visibleRows += ROW_WINDOW)}
          disabled={stage === 'publishing'}
        >
          Show more ({scan.candidates.length - visibleRows} versions hidden)
        </button>
      {/if}

      {#if canLoadOlder}
        <button type="button" class="lz-scan" on:click={loadOlder} disabled={loadingOlder || stage === 'publishing'}>
          {loadingOlder ? 'Loading…' : 'Load older versions'}
        </button>
      {/if}

    {/if}
  {/if}
</div>

<style>
  .lazarus {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    font-size: 0.875rem;
  }

  .lz-intro,
  .lz-note {
    color: var(--color-caption);
    line-height: 1.6;
    margin: 0;
    font-size: 0.875rem;
  }

  .lz-kinds {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .lz-kind {
    padding: 0.45rem 0.9rem;
    border-radius: 9999px;
    border: 1px solid var(--color-input-border);
    color: var(--color-caption);
    font-size: 0.875rem;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }

  .lz-kind:hover:not(:disabled) {
    color: var(--color-text-primary);
  }

  .lz-kind.selected {
    color: var(--color-primary, #f97316);
    border-color: var(--color-primary, #f97316);
    background: color-mix(in srgb, var(--color-primary, #f97316) 12%, transparent);
  }

  .lz-kind:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .lz-scan {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 1.25rem;
    border-radius: 9999px;
    border: 1px solid var(--color-input-border);
    background: var(--color-bg-secondary);
    color: var(--color-text-primary);
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
    align-self: flex-start;
  }

  .lz-scan:hover:not(:disabled) {
    border-color: var(--color-primary, #f97316);
  }

  .lz-scan:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .lz-scanmeta {
    color: var(--color-text-secondary);
    font-size: 0.875rem;
    line-height: 1.6;
    margin: 0;
  }

  .lz-error {
    color: #ef4444;
    font-size: 0.875rem;
    margin: 0;
  }

  .lz-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.625rem;
    margin-top: -0.25rem;
  }

  .lz-sort {
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    border: 1px solid transparent;
    color: var(--color-caption);
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .lz-sort.active {
    color: var(--color-text-primary);
    border-color: var(--color-input-border);
    background: var(--color-accent-gray);
  }

  .lz-empty-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    margin-left: auto;
    color: var(--color-caption);
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .lz-changed,
  .lz-notice {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    padding: 0.625rem 0.875rem;
    border-radius: 0.5rem;
    background: color-mix(in srgb, #f59e0b 12%, transparent);
    border: 1px solid color-mix(in srgb, #f59e0b 45%, transparent);
    color: var(--color-text-primary);
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .lz-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .lz-version {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.625rem;
    padding: 0.75rem 0.875rem;
    border-radius: 0.625rem;
    border: 1px solid var(--color-input-border);
    background: var(--color-bg-secondary);
  }

  .lz-version.is-recommended {
    border-color: var(--color-primary, #f97316);
    background: color-mix(in srgb, var(--color-primary, #f97316) 8%, transparent);
  }

  .lz-version.is-selected {
    outline: 2px solid var(--color-primary, #f97316);
    outline-offset: 1px;
  }

  .lz-version--grouped {
    margin-left: 1rem;
    padding: 0.5rem 0.625rem;
  }

  .lz-version-main {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .lz-version-head {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    flex-wrap: wrap;
  }

  .lz-version-date {
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
  }

  .lz-version-count {
    color: var(--color-caption);
  }

  .lz-badge {
    padding: 0.1rem 0.55rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .lz-badge--current {
    background: var(--color-accent-gray);
    color: var(--color-text-secondary);
  }

  .lz-badge--recommended {
    background: var(--color-primary, #f97316);
    color: #fff;
  }

  .lz-badge--warn {
    background: color-mix(in srgb, #f59e0b 18%, transparent);
    color: #b45309;
  }

  .lz-relays {
    align-self: flex-start;
    padding: 0;
    border: none;
    background: none;
    color: var(--color-primary, #f97316);
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .lz-relay-list {
    margin: 0;
    padding-left: 1rem;
    color: var(--color-caption);
    font-size: 0.75rem;
    line-height: 1.6;
    word-break: break-all;
  }

  .lz-restore {
    padding: 0.35rem 1rem;
    border-radius: 9999px;
    border: 1px solid var(--color-input-border);
    background: transparent;
    color: var(--color-text-primary);
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
  }

  .lz-restore:hover:not(:disabled) {
    border-color: var(--color-primary, #f97316);
    color: var(--color-primary, #f97316);
  }

  .lz-restore:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .lz-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.75rem;
    border-radius: 0.625rem;
    border: 1px dashed var(--color-input-border);
    background: none;
    color: var(--color-caption);
    font-size: 0.875rem;
    cursor: pointer;
    text-align: left;
  }

  .lz-group.is-clobber {
    border-color: color-mix(in srgb, #ef4444 45%, transparent);
    color: #b91c1c;
  }

  .lz-group-hint {
    margin-left: auto;
    font-size: 0.75rem;
  }

  .lz-published {
    display: flex;
    gap: 0.625rem;
    align-items: flex-start;
    padding: 0.75rem 0.875rem;
    border-radius: 0.625rem;
    background: color-mix(in srgb, #16a34a 10%, transparent);
    border: 1px solid color-mix(in srgb, #16a34a 35%, transparent);
    color: #15803d;
  }

  .lz-published-title {
    margin: 0;
    font-weight: 600;
    font-size: 0.9375rem;
  }
</style>
