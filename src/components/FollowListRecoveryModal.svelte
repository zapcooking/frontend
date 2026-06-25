<script lang="ts">
  import Modal from './Modal.svelte';
  import { get } from 'svelte/store';
  import { ndk, userPublickey } from '$lib/nostr';
  import ArrowCounterClockwiseIcon from 'phosphor-svelte/lib/ArrowCounterClockwise';
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';
  import SpinnerGapIcon from 'phosphor-svelte/lib/SpinnerGap';
  import WarningIcon from 'phosphor-svelte/lib/Warning';
  import {
    scanFollowListHistory,
    recoverFollowList,
    type FollowListCandidate,
    type FollowRecoveryScanResult
  } from '$lib/followRecovery';

  export let open = false;
  export let pubkey: string;

  type Stage = 'intro' | 'scanning' | 'results' | 'confirming' | 'restoring' | 'done' | 'error';

  let stage: Stage = 'intro';
  let progressMessage = '';
  let scanResult: FollowRecoveryScanResult | null = null;
  let selectedCandidate: FollowListCandidate | null = null;
  let restoreResult: { eventId: string; accepted: string[]; rejected: { relay: string; reason: string }[] } | null = null;
  let errorMessage = '';
  let showAllCandidates = false;

  function reset() {
    stage = 'intro';
    progressMessage = '';
    scanResult = null;
    selectedCandidate = null;
    restoreResult = null;
    errorMessage = '';
    showAllCandidates = false;
  }

  function handleClose() {
    open = false;
    reset();
  }

  function getUserRelays(): string[] {
    const ndkInstance = get(ndk);
    if (!ndkInstance?.pool?.relays) return [];
    return Array.from(ndkInstance.pool.relays.keys()).filter((r) => r.startsWith('wss://'));
  }

  async function startScan() {
    stage = 'scanning';
    progressMessage = 'Connecting to relays…';
    try {
      const userRelays = getUserRelays();
      scanResult = await scanFollowListHistory(pubkey, userRelays, {
        onProgress: (msg) => (progressMessage = msg)
      });
      stage = 'results';
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Scan failed';
      stage = 'error';
    }
  }

  function selectCandidate(candidate: FollowListCandidate) {
    selectedCandidate = candidate;
    stage = 'confirming';
  }

  async function confirmRestore() {
    if (!selectedCandidate) return;
    stage = 'restoring';
    try {
      const userRelays = getUserRelays();
      restoreResult = await recoverFollowList(selectedCandidate, userRelays);
      stage = 'done';
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Restore failed';
      stage = 'error';
    }
  }

  function formatDate(unixSecs: number): string {
    return new Date(unixSecs * 1000).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  }

  function relativeAge(unixSecs: number): string {
    const diffMs = Date.now() - unixSecs * 1000;
    const days = Math.floor(diffMs / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} month${months > 1 ? 's' : ''} ago`;
    const years = Math.floor(months / 12);
    return `${years} year${years > 1 ? 's' : ''} ago`;
  }

  $: displayedCandidates = scanResult
    ? showAllCandidates
      ? scanResult.candidates
      : scanResult.candidates.slice(0, 5)
    : [];
</script>

<Modal bind:open on:close={handleClose}>
  <div slot="title">Restore Follow List</div>

  <div class="flex flex-col gap-4">

    {#if stage === 'intro'}
      <p class="text-sm" style="color: var(--color-text-secondary)">
        If another Nostr client accidentally overwrote your follow list, this tool scans
        relays for older versions and lets you restore one. It queries your connected relays
        plus a broad set of archival relays using the technique from
        <a href="https://github.com/dmnyc/mutable" target="_blank" rel="noopener"
           class="underline hover:opacity-80" style="color: var(--color-accent-orange)">Mutable</a>.
      </p>
      <p class="text-sm" style="color: var(--color-text-secondary)">
        Restoring publishes a fresh kind:3 event with the chosen version's follow set,
        replacing your current list on all relays.
      </p>
      <button
        on:click={startScan}
        class="w-full py-2.5 rounded-lg font-medium text-sm transition-colors"
        style="background: var(--color-accent-orange); color: white;"
      >
        Scan Relays
      </button>

    {:else if stage === 'scanning'}
      <div class="flex flex-col items-center gap-3 py-4">
        <SpinnerGapIcon size={32} class="animate-spin" style="color: var(--color-accent-orange)" />
        <p class="text-sm text-center" style="color: var(--color-text-secondary)">{progressMessage}</p>
      </div>

    {:else if stage === 'results' && scanResult}
      <p class="text-sm" style="color: var(--color-text-secondary)">
        {scanResult.candidates.length} version{scanResult.candidates.length === 1 ? '' : 's'} found
        across {scanResult.respondingRelays.length}/{scanResult.queriedRelays.length} relays.
      </p>

      {#if scanResult.candidates.length === 0}
        <div class="py-4 text-center text-sm" style="color: var(--color-text-secondary)">
          No follow list versions found on any relay.
        </div>
      {:else}
        <div class="flex flex-col gap-2">
          {#each displayedCandidates as candidate (candidate.eventId)}
            <div
              class="rounded-xl p-3 flex flex-col gap-1.5"
              style="background: var(--color-bg-secondary); border: 1px solid {candidate.isRecommended ? 'var(--color-accent-orange)' : 'transparent'};"
            >
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-medium text-sm" style="color: var(--color-text-primary)">
                  {candidate.followCount.toLocaleString()} following
                </span>
                {#if candidate.isRecommended}
                  <span class="text-xs px-1.5 py-0.5 rounded font-medium"
                    style="background: rgba(249,115,22,0.15); color: var(--color-accent-orange)">
                    Recommended
                  </span>
                {/if}
                {#if candidate.isCurrent}
                  <span class="text-xs px-1.5 py-0.5 rounded font-medium"
                    style="background: rgba(59,130,246,0.15); color: #60a5fa">
                    Current
                  </span>
                {/if}
                {#if candidate.followCount === 0}
                  <span class="text-xs px-1.5 py-0.5 rounded font-medium"
                    style="background: rgba(107,114,128,0.2); color: var(--color-text-secondary)">
                    Empty
                  </span>
                {/if}
              </div>
              <div class="text-xs" style="color: var(--color-text-secondary)">
                {formatDate(candidate.createdAt)} · {relativeAge(candidate.createdAt)}
              </div>
              <div class="text-xs" style="color: var(--color-text-secondary)">
                Found on {candidate.foundOnRelays.length} relay{candidate.foundOnRelays.length === 1 ? '' : 's'}
              </div>
              {#if !candidate.isCurrent && candidate.followCount > 0}
                <button
                  on:click={() => selectCandidate(candidate)}
                  class="mt-1 self-start px-3 py-1 rounded-lg text-xs font-medium transition-colors"
                  style="background: var(--color-accent-orange); color: white;"
                >
                  Restore this version
                </button>
              {/if}
            </div>
          {/each}

          {#if scanResult.candidates.length > 5 && !showAllCandidates}
            <button
              on:click={() => (showAllCandidates = true)}
              class="text-sm underline hover:opacity-80 self-start"
              style="color: var(--color-text-secondary)"
            >
              Show {scanResult.candidates.length - 5} more
            </button>
          {/if}
        </div>
      {/if}

      <button
        on:click={reset}
        class="text-xs underline hover:opacity-80 self-start"
        style="color: var(--color-text-secondary)"
      >
        Scan again
      </button>

    {:else if stage === 'confirming' && selectedCandidate}
      <div class="rounded-xl p-4 flex flex-col gap-2"
        style="background: var(--color-bg-secondary);">
        <p class="text-sm font-medium" style="color: var(--color-text-primary)">
          Restore {selectedCandidate.followCount.toLocaleString()} follows?
        </p>
        <p class="text-xs" style="color: var(--color-text-secondary)">
          From {formatDate(selectedCandidate.createdAt)} · {relativeAge(selectedCandidate.createdAt)}
        </p>
      </div>
      <p class="text-sm" style="color: var(--color-text-secondary)">
        This will publish a new kind:3 event replacing your current follow list on all relays.
        This cannot be undone automatically — make sure you want to restore this version.
      </p>
      <div class="flex gap-2">
        <button
          on:click={confirmRestore}
          class="flex-1 py-2.5 rounded-lg font-medium text-sm transition-colors"
          style="background: var(--color-accent-orange); color: white;"
        >
          Confirm Restore
        </button>
        <button
          on:click={() => (stage = 'results')}
          class="flex-1 py-2.5 rounded-lg font-medium text-sm transition-colors"
          style="background: var(--color-bg-secondary); color: var(--color-text-primary);"
        >
          Cancel
        </button>
      </div>

    {:else if stage === 'restoring'}
      <div class="flex flex-col items-center gap-3 py-4">
        <SpinnerGapIcon size={32} class="animate-spin" style="color: var(--color-accent-orange)" />
        <p class="text-sm" style="color: var(--color-text-secondary)">Publishing restored follow list…</p>
      </div>

    {:else if stage === 'done' && restoreResult}
      <div class="flex flex-col items-center gap-3 py-2">
        <CheckCircleIcon size={36} style="color: #4ade80" />
        <p class="text-sm font-medium" style="color: var(--color-text-primary)">Follow list restored</p>
        <p class="text-sm" style="color: var(--color-text-secondary)">
          Accepted by {restoreResult.accepted.length} relay{restoreResult.accepted.length === 1 ? '' : 's'}.
          {#if restoreResult.rejected.length > 0}
            {restoreResult.rejected.length} relay{restoreResult.rejected.length === 1 ? '' : 's'} rejected.
          {/if}
        </p>
      </div>
      <button
        on:click={handleClose}
        class="w-full py-2.5 rounded-lg font-medium text-sm"
        style="background: var(--color-bg-secondary); color: var(--color-text-primary);"
      >
        Close
      </button>

    {:else if stage === 'error'}
      <div class="flex flex-col items-center gap-3 py-2">
        <WarningIcon size={36} style="color: #f87171" />
        <p class="text-sm font-medium" style="color: var(--color-text-primary)">Something went wrong</p>
        <p class="text-sm text-center" style="color: var(--color-text-secondary)">{errorMessage}</p>
      </div>
      <div class="flex gap-2">
        <button
          on:click={reset}
          class="flex-1 py-2.5 rounded-lg font-medium text-sm"
          style="background: var(--color-accent-orange); color: white;"
        >
          Try again
        </button>
        <button
          on:click={handleClose}
          class="flex-1 py-2.5 rounded-lg font-medium text-sm"
          style="background: var(--color-bg-secondary); color: var(--color-text-primary);"
        >
          Close
        </button>
      </div>
    {/if}

  </div>
</Modal>
