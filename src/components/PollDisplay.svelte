<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { addClientTagToEvent } from '$lib/nip89';
  import { publishQueue } from '$lib/publishQueue';
  import NoteContent from './NoteContent.svelte';
  import {
    parsePollFromEvent,
    isPollExpired,
    countVotes,
    buildVoteTags,
    type PollData,
    type PollResults
  } from '$lib/polls';

  export let event: NDKEvent;

  let pollData: PollData | null = null;
  let results: PollResults = {
    counts: new Map(),
    totalVoters: 0,
    voters: new Set(),
    votesByPubkey: new Map()
  };
  let voteEvents: NDKEvent[] = [];
  let selectedOptions: Set<string> = new Set();
  let showResults = false;
  let voting = false;
  let voted = false;
  let voteError = '';
  let voteSub: any = null;

  $: expired = pollData ? isPollExpired(pollData.endsAt) : false;
  $: userVoted = $userPublickey ? results.voters.has($userPublickey) : false;
  $: displayResults = showResults || userVoted || expired || voted;
  $: userSelectedOptions = $userPublickey
    ? results.votesByPubkey.get($userPublickey) || []
    : [];

  onMount(() => {
    pollData = parsePollFromEvent(event);
    if (pollData) {
      fetchVotes();
    }
  });

  onDestroy(() => {
    if (voteSub) {
      try {
        voteSub.stop();
      } catch {}
    }
  });

  function fetchVotes() {
    if (!$ndk || !event.id) return;

    const processedIds = new Set<string>();

    voteSub = $ndk.subscribe(
      { kinds: [1018 as number], '#e': [event.id] },
      { closeOnEose: false }
    );

    voteSub.on('event', (e: NDKEvent) => {
      if (processedIds.has(e.id)) return;
      processedIds.add(e.id);
      voteEvents = [...voteEvents, e];
      recountVotes();
    });
  }

  function recountVotes() {
    if (!pollData) return;
    results = countVotes(voteEvents, pollData.pollType);
  }

  function toggleOption(optionId: string) {
    if (displayResults || voting || expired) return;

    if (pollData?.pollType === 'singlechoice') {
      selectedOptions = new Set([optionId]);
    } else {
      const next = new Set(selectedOptions);
      if (next.has(optionId)) {
        next.delete(optionId);
      } else {
        next.add(optionId);
      }
      selectedOptions = next;
    }
  }

  async function submitVote() {
    if (!$userPublickey || !pollData || selectedOptions.size === 0 || voting) return;

    voting = true;
    voteError = '';
    try {
      const voteEvent = new NDKEvent($ndk);
      voteEvent.kind = 1018;
      voteEvent.content = '';
      voteEvent.tags = buildVoteTags(event.id, [...selectedOptions]);
      addClientTagToEvent(voteEvent);

      // Set pubkey and created_at for optimistic local update
      voteEvent.pubkey = $userPublickey;
      voteEvent.created_at = Math.floor(Date.now() / 1000);

      await publishQueue.publishWithRetry(voteEvent, 'all');

      // Optimistic update — event has pubkey/created_at set above
      voted = true;
      voteEvents = [...voteEvents, voteEvent];
      recountVotes();
    } catch (err) {
      console.error('[PollDisplay] Failed to vote:', err);
      voteError = 'Failed to submit vote. Please try again.';
    } finally {
      voting = false;
    }
  }
</script>

<div class="poll-display mb-3">
  {#if pollData}
    <!-- Question text -->
    {#if pollData.question}
      <div class="text-sm leading-relaxed mb-3" style="color: var(--color-text-primary)">
        <NoteContent content={pollData.question} />
      </div>
    {/if}

    <!-- Badges -->
    <div class="flex items-center gap-2 mb-2">
      <span class="poll-badge">
        {pollData.pollType === 'multiplechoice' ? 'Multiple choice' : 'Single choice'}
      </span>
      {#if pollData.endsAt}
        <span class="poll-badge" class:poll-badge-expired={expired}>
          {#if expired}
            Ended
          {:else}
            Ends {new Date(pollData.endsAt * 1000).toLocaleDateString()}
          {/if}
        </span>
      {/if}
    </div>

    <!-- Options -->
    <div class="space-y-2">
      {#each pollData.options as option (option.id)}
        {@const voteCount = results.counts.get(option.id) || 0}
        {@const pct = results.totalVoters === 0 ? 0 : Math.round((voteCount / results.totalVoters) * 100)}
        {@const isUserChoice = userSelectedOptions.includes(option.id)}
        {@const isSelected = selectedOptions.has(option.id)}

        {#if displayResults}
          <!-- Results mode -->
          <div class="poll-result-bar" class:poll-result-user={isUserChoice}>
            <div class="poll-result-fill" style="width: {pct}%"></div>
            <div class="poll-result-content">
              <span class="poll-result-label">
                {option.label}
                {#if isUserChoice}
                  <span class="poll-result-check">✓</span>
                {/if}
              </span>
              <span class="poll-result-pct">{pct}% ({voteCount})</span>
            </div>
          </div>
        {:else}
          <!-- Vote mode -->
          <button
            class="poll-option-btn"
            class:poll-option-selected={isSelected}
            on:click={() => toggleOption(option.id)}
            disabled={expired || voting}
          >
            <span class="poll-option-indicator">
              {#if pollData.pollType === 'singlechoice'}
                <span class="poll-radio" class:poll-radio-checked={isSelected}></span>
              {:else}
                <span class="poll-checkbox" class:poll-checkbox-checked={isSelected}></span>
              {/if}
            </span>
            <span>{option.label}</span>
          </button>
        {/if}
      {/each}
    </div>

    <!-- Vote error -->
    {#if voteError}
      <p class="text-red-500 text-xs mt-1">{voteError}</p>
    {/if}

    <!-- Footer -->
    <div class="flex items-center justify-between mt-2">
      <span class="text-xs text-caption">
        {results.totalVoters} vote{results.totalVoters !== 1 ? 's' : ''}
      </span>

      {#if !displayResults && !expired}
        <div class="flex items-center gap-2">
          <button
            class="text-xs text-caption hover:underline"
            on:click={() => (showResults = true)}
          >
            Show results
          </button>
          {#if $userPublickey && selectedOptions.size > 0}
            <button
              class="px-3 py-1 text-xs font-medium text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 rounded-full disabled:opacity-50 transition-all"
              disabled={voting}
              on:click={submitVote}
            >
              {voting ? 'Voting...' : 'Vote'}
            </button>
          {/if}
        </div>
      {:else if displayResults && !userVoted && !expired && !voted}
        <button
          class="text-xs text-caption hover:underline"
          on:click={() => (showResults = false)}
        >
          Hide results
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .poll-display {
    padding: 0.75rem;
    border: 1px solid var(--color-input-border);
    border-radius: 0.75rem;
    background: var(--color-bg-secondary);
  }

  .poll-badge {
    font-size: 0.6875rem;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    background: var(--color-accent-gray, #e5e7eb);
    color: var(--color-caption);
  }

  .poll-badge-expired {
    background: #fecaca;
    color: #dc2626;
  }

  :global(.dark) .poll-badge-expired {
    background: #7f1d1d;
    color: #fca5a5;
  }

  /* Vote mode buttons */
  .poll-option-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--color-input-border);
    border-radius: 0.5rem;
    background: transparent;
    color: var(--color-text-primary);
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.15s;
    text-align: left;
  }

  .poll-option-btn:hover:not(:disabled) {
    border-color: var(--color-primary, #f97316);
  }

  .poll-option-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .poll-option-selected {
    border-color: var(--color-primary, #f97316);
    background: rgba(249, 115, 22, 0.05);
  }

  .poll-option-indicator {
    flex-shrink: 0;
  }

  .poll-radio,
  .poll-checkbox {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 2px solid var(--color-caption);
    transition: all 0.15s;
  }

  .poll-radio {
    border-radius: 50%;
  }

  .poll-checkbox {
    border-radius: 3px;
  }

  .poll-radio-checked {
    border-color: var(--color-primary, #f97316);
    background: var(--color-primary, #f97316);
    box-shadow: inset 0 0 0 3px var(--color-bg-secondary);
  }

  .poll-checkbox-checked {
    border-color: var(--color-primary, #f97316);
    background: var(--color-primary, #f97316);
  }

  /* Results mode */
  .poll-result-bar {
    position: relative;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--color-input-border);
    border-radius: 0.5rem;
    overflow: hidden;
  }

  .poll-result-user {
    border-color: var(--color-primary, #f97316);
  }

  .poll-result-fill {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    background: rgba(249, 115, 22, 0.1);
    transition: width 0.3s ease;
  }

  .poll-result-content {
    position: relative;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.875rem;
  }

  .poll-result-label {
    color: var(--color-text-primary);
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .poll-result-check {
    color: var(--color-primary, #f97316);
    font-weight: 600;
  }

  .poll-result-pct {
    color: var(--color-caption);
    font-size: 0.8125rem;
    flex-shrink: 0;
  }
</style>
