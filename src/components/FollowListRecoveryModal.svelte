<script lang="ts">
  import Modal from './Modal.svelte';
  import { get } from 'svelte/store';
  import { ndk } from '$lib/nostr';
  import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlass';
  import ArrowCounterClockwiseIcon from 'phosphor-svelte/lib/ArrowCounterClockwise';
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';
  import SpinnerGapIcon from 'phosphor-svelte/lib/SpinnerGap';
  import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircle';
  import WarningIcon from 'phosphor-svelte/lib/Warning';
  import UsersIcon from 'phosphor-svelte/lib/Users';
  import ClockCounterClockwiseIcon from 'phosphor-svelte/lib/ClockCounterClockwise';
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
  <div slot="title" class="flex items-center gap-2">
    <ClockCounterClockwiseIcon size={20} style="color: var(--color-accent-orange)" />
    Restore Follow List
  </div>

  <div class="flex flex-col gap-5">

    <!-- ── Intro ─────────────────────────────────── -->
    {#if stage === 'intro'}
      <p class="text-sm leading-relaxed" style="color: var(--color-text-secondary)">
        If another Nostr client accidentally clobbered your follow list, this tool scans
        relays for older versions so you can restore one.
      </p>

      <button
        on:click={startScan}
        class="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-opacity hover:opacity-90 active:opacity-80"
        style="background: linear-gradient(135deg, #f97316, #f59e0b); color: white; box-shadow: 0 2px 12px rgba(249,115,22,0.35);"
      >
        <MagnifyingGlassIcon size={18} weight="bold" />
        Scan Relays for Old Versions
      </button>

      <p class="text-xs leading-relaxed" style="color: var(--color-text-secondary)">
        Queries your connected relays plus a broad set of archival relays.
        Restoring publishes a fresh kind:3 event, replacing your current list everywhere.
      </p>

      <a
        href="https://github.com/dmnyc/mutable"
        target="_blank"
        rel="noopener"
        class="flex items-center gap-1.5 self-start text-xs hover:opacity-70 transition-opacity mt-1"
        style="color: var(--color-text-secondary)"
      >
        <img src="/mutable_logo.svg" alt="" class="w-3.5 h-3.5 rounded-sm" />
        <span>Powered by Mutable</span>
      </a>

    <!-- ── Scanning ───────────────────────────────── -->
    {:else if stage === 'scanning'}
      <div class="flex flex-col items-center gap-4 py-6">
        <div class="relative">
          <SpinnerGapIcon size={44} class="animate-spin" style="color: var(--color-accent-orange)" />
          <MagnifyingGlassIcon size={18} class="absolute inset-0 m-auto" style="color: var(--color-accent-orange)" />
        </div>
        <div class="text-center">
          <p class="text-sm font-medium" style="color: var(--color-text-primary)">Scanning relays…</p>
          <p class="text-xs mt-1" style="color: var(--color-text-secondary)">{progressMessage}</p>
        </div>
      </div>

    <!-- ── Results ────────────────────────────────── -->
    {:else if stage === 'results' && scanResult}

      <!-- Summary bar -->
      <div class="flex items-center justify-between rounded-lg px-3 py-2 text-xs"
        style="background: var(--color-bg-secondary);">
        <span style="color: var(--color-text-secondary)">
          {scanResult.candidates.length} version{scanResult.candidates.length === 1 ? '' : 's'} found
        </span>
        <span style="color: var(--color-text-secondary)">
          {scanResult.respondingRelays.length} / {scanResult.queriedRelays.length} relays responded
        </span>
      </div>

      {#if scanResult.candidates.length === 0}
        <div class="flex flex-col items-center gap-2 py-8 text-center">
          <UsersIcon size={36} class="opacity-30" />
          <p class="text-sm" style="color: var(--color-text-secondary)">No follow list versions found.</p>
        </div>
      {:else}
        <div class="flex flex-col gap-2">
          {#each displayedCandidates as candidate (candidate.eventId)}
            <div
              class="rounded-xl overflow-hidden"
              style="background: var(--color-bg-secondary); border: 1px solid {candidate.isRecommended ? 'var(--color-accent-orange)' : 'var(--color-input-border)'};"
            >
              <!-- Recommended banner -->
              {#if candidate.isRecommended}
                <div class="px-3 py-1 text-xs font-medium"
                  style="background: rgba(249,115,22,0.12); color: var(--color-accent-orange); border-bottom: 1px solid rgba(249,115,22,0.2)">
                  ★ Recommended recovery
                </div>
              {/if}

              <div class="p-3 flex items-start gap-3">
                <!-- Follow count -->
                <div class="flex flex-col items-center justify-center min-w-[52px] py-0.5">
                  <span class="text-xl font-bold leading-none" style="color: var(--color-text-primary)">
                    {candidate.followCount.toLocaleString()}
                  </span>
                  <span class="text-[10px] mt-0.5" style="color: var(--color-text-secondary)">following</span>
                </div>

                <!-- Divider -->
                <div class="w-px self-stretch" style="background: var(--color-input-border)"></div>

                <!-- Details -->
                <div class="flex-1 flex flex-col gap-1 min-w-0">
                  <div class="flex flex-wrap items-center gap-1.5">
                    {#if candidate.isCurrent}
                      <span class="text-[11px] px-1.5 py-0.5 rounded font-medium"
                        style="background: rgba(96,165,250,0.15); color: #60a5fa">Current</span>
                    {/if}
                    {#if candidate.followCount === 0}
                      <span class="text-[11px] px-1.5 py-0.5 rounded font-medium"
                        style="background: rgba(107,114,128,0.2); color: var(--color-text-secondary)">Empty</span>
                    {/if}
                  </div>
                  <p class="text-xs" style="color: var(--color-text-primary)">
                    {formatDate(candidate.createdAt)}
                  </p>
                  <p class="text-[11px]" style="color: var(--color-text-secondary)">
                    {relativeAge(candidate.createdAt)} · {candidate.foundOnRelays.length} relay{candidate.foundOnRelays.length === 1 ? '' : 's'}
                  </p>
                </div>

                <!-- Restore button -->
                {#if !candidate.isCurrent && candidate.followCount > 0}
                  <button
                    on:click={() => selectCandidate(candidate)}
                    class="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80 self-center"
                    style="{candidate.isRecommended
                      ? 'background: var(--color-accent-orange); color: white;'
                      : 'background: var(--color-bg-primary); color: var(--color-text-primary); border: 1px solid var(--color-input-border);'}"
                  >
                    <ArrowCounterClockwiseIcon size={12} />
                    Restore
                  </button>
                {/if}
              </div>
            </div>
          {/each}

          {#if scanResult.candidates.length > 5 && !showAllCandidates}
            <button
              on:click={() => (showAllCandidates = true)}
              class="text-xs py-1.5 rounded-lg transition-opacity hover:opacity-80"
              style="color: var(--color-text-secondary); background: var(--color-bg-secondary);"
            >
              Show {scanResult.candidates.length - 5} more version{scanResult.candidates.length - 5 === 1 ? '' : 's'}
            </button>
          {/if}
        </div>
      {/if}

      <button
        on:click={reset}
        class="flex items-center gap-1.5 text-xs self-start transition-opacity hover:opacity-70"
        style="color: var(--color-text-secondary)"
      >
        <MagnifyingGlassIcon size={12} />
        Scan again
      </button>

    <!-- ── Confirming ─────────────────────────────── -->
    {:else if stage === 'confirming' && selectedCandidate}
      <!-- Warning notice -->
      <div class="flex gap-2.5 rounded-xl p-3"
        style="background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.25);">
        <WarningIcon size={18} class="flex-shrink-0 mt-0.5" style="color: #fbbf24" />
        <p class="text-xs leading-relaxed" style="color: var(--color-text-secondary)">
          This replaces your current follow list everywhere. It cannot be undone automatically.
        </p>
      </div>

      <!-- Version summary -->
      <div class="rounded-xl p-4" style="background: var(--color-bg-secondary); border: 1px solid var(--color-input-border);">
        <div class="flex items-baseline gap-2 mb-1">
          <span class="text-2xl font-bold" style="color: var(--color-text-primary)">
            {selectedCandidate.followCount.toLocaleString()}
          </span>
          <span class="text-sm" style="color: var(--color-text-secondary)">accounts followed</span>
        </div>
        <p class="text-xs" style="color: var(--color-text-secondary)">
          {formatDate(selectedCandidate.createdAt)} · {relativeAge(selectedCandidate.createdAt)}
        </p>
        <p class="text-xs mt-0.5" style="color: var(--color-text-secondary)">
          Found on {selectedCandidate.foundOnRelays.length} relay{selectedCandidate.foundOnRelays.length === 1 ? '' : 's'}
        </p>
      </div>

      <div class="flex gap-2 pt-1">
        <button
          on:click={() => (stage = 'results')}
          class="flex-1 py-2.5 rounded-xl font-medium text-sm transition-opacity hover:opacity-80"
          style="background: var(--color-bg-secondary); color: var(--color-text-secondary); border: 1px solid var(--color-input-border);"
        >
          Cancel
        </button>
        <button
          on:click={confirmRestore}
          class="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-opacity hover:opacity-90"
          style="background: linear-gradient(135deg, #f97316, #f59e0b); color: white;"
        >
          <ArrowCounterClockwiseIcon size={16} weight="bold" />
          Restore
        </button>
      </div>

    <!-- ── Restoring ──────────────────────────────── -->
    {:else if stage === 'restoring'}
      <div class="flex flex-col items-center gap-4 py-6">
        <SpinnerGapIcon size={44} class="animate-spin" style="color: var(--color-accent-orange)" />
        <div class="text-center">
          <p class="text-sm font-medium" style="color: var(--color-text-primary)">Restoring follow list…</p>
          <p class="text-xs mt-1" style="color: var(--color-text-secondary)">Publishing to relays</p>
        </div>
      </div>

    <!-- ── Done ──────────────────────────────────── -->
    {:else if stage === 'done' && restoreResult}
      <div class="flex flex-col items-center gap-3 py-4 text-center">
        <CheckCircleIcon size={48} weight="fill" style="color: #4ade80" />
        <div>
          <p class="font-semibold" style="color: var(--color-text-primary)">Follow list restored</p>
          <p class="text-sm mt-1" style="color: var(--color-text-secondary)">
            Accepted by {restoreResult.accepted.length} relay{restoreResult.accepted.length === 1 ? '' : 's'}
            {#if restoreResult.rejected.length > 0}
              · {restoreResult.rejected.length} rejected
            {/if}
          </p>
        </div>
      </div>
      <button
        on:click={handleClose}
        class="w-full py-2.5 rounded-xl font-medium text-sm transition-opacity hover:opacity-80"
        style="background: var(--color-bg-secondary); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
      >
        Done
      </button>

    <!-- ── Error ──────────────────────────────────── -->
    {:else if stage === 'error'}
      <div class="flex flex-col items-center gap-3 py-4 text-center">
        <WarningCircleIcon size={48} weight="fill" style="color: #f87171" />
        <div>
          <p class="font-semibold" style="color: var(--color-text-primary)">Something went wrong</p>
          <p class="text-sm mt-1" style="color: var(--color-text-secondary)">{errorMessage}</p>
        </div>
      </div>
      <div class="flex gap-2">
        <button
          on:click={handleClose}
          class="flex-1 py-2.5 rounded-xl font-medium text-sm transition-opacity hover:opacity-80"
          style="background: var(--color-bg-secondary); color: var(--color-text-secondary); border: 1px solid var(--color-input-border);"
        >
          Close
        </button>
        <button
          on:click={reset}
          class="flex-1 py-2.5 rounded-xl font-medium text-sm transition-opacity hover:opacity-90"
          style="background: linear-gradient(135deg, #f97316, #f59e0b); color: white;"
        >
          Try again
        </button>
      </div>
    {/if}

  </div>
</Modal>
