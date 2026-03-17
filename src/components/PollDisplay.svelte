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
  $: displayResults = showResults || userVoted || expired || voted || !$userPublickey;
  $: userSelectedOptions = $userPublickey
    ? results.votesByPubkey.get($userPublickey) || []
    : [];
  $: hasImages = pollData ? pollData.options.some((o) => o.image) : false;
  $: maxVoteCount = pollData
    ? Math.max(...pollData.options.map((o) => results.counts.get(o.id) || 0), 0)
    : 0;

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

      voteEvent.pubkey = $userPublickey;
      voteEvent.created_at = Math.floor(Date.now() / 1000);

      await publishQueue.publishWithRetry(voteEvent, 'all');

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

    <!-- Options: Image grid or text list -->
    {#if hasImages}
      <!-- ═══ IMAGE GRID LAYOUT ═══ -->
      <div class="poll-img-grid" class:poll-img-grid-odd={pollData.options.length % 2 !== 0}>
        {#each pollData.options as option, i (option.id)}
          {@const voteCount = results.counts.get(option.id) || 0}
          {@const pct = results.totalVoters === 0 ? 0 : Math.round((voteCount / results.totalVoters) * 100)}
          {@const isUserChoice = userSelectedOptions.includes(option.id)}
          {@const isSelected = selectedOptions.has(option.id)}
          {@const isWinner = displayResults && voteCount > 0 && voteCount === maxVoteCount}
          {@const isLast = i === pollData.options.length - 1 && pollData.options.length % 2 !== 0}

          {#if displayResults}
            <!-- Results card -->
            <div
              class="poll-img-card poll-img-card-results"
              class:poll-img-card-winner={isWinner}
              class:poll-img-card-user={isUserChoice}
              class:poll-img-card-last-odd={isLast}
            >
              <div class="poll-img-area">
                {#if option.image}
                  <img src={option.image} alt={option.label} class="poll-img" />
                {:else}
                  <div class="poll-img-placeholder"></div>
                {/if}
                <!-- Indicator overlay -->
                <span class="poll-img-indicator" class:poll-indicator-checked={isUserChoice}>
                  {#if pollData.pollType === 'singlechoice'}
                    <span class="poll-radio poll-radio-img" class:poll-radio-checked={isUserChoice}></span>
                  {:else}
                    <span class="poll-checkbox poll-checkbox-img" class:poll-checkbox-checked={isUserChoice}></span>
                  {/if}
                </span>
                <!-- Results overlay bar -->
                <div class="poll-img-results-overlay">
                  <div class="poll-img-results-fill" style="width: {pct}%"></div>
                  <span class="poll-img-results-text">{pct}% ({voteCount})</span>
                </div>
              </div>
              {#if option.label}
                <div class="poll-img-label">{option.label}</div>
              {/if}
            </div>
          {:else}
            <!-- Vote card -->
            <button
              class="poll-img-card poll-img-card-vote"
              class:poll-img-card-selected={isSelected}
              class:poll-img-card-last-odd={isLast}
              on:click={() => toggleOption(option.id)}
              disabled={expired || voting}
            >
              <div class="poll-img-area">
                {#if option.image}
                  <img src={option.image} alt={option.label} class="poll-img" />
                {:else}
                  <div class="poll-img-placeholder"></div>
                {/if}
                <!-- Indicator overlay -->
                <span class="poll-img-indicator" class:poll-indicator-checked={isSelected}>
                  {#if pollData.pollType === 'singlechoice'}
                    <span class="poll-radio poll-radio-img" class:poll-radio-checked={isSelected}></span>
                  {:else}
                    <span class="poll-checkbox poll-checkbox-img" class:poll-checkbox-checked={isSelected}></span>
                  {/if}
                </span>
              </div>
              {#if option.label}
                <div class="poll-img-label">{option.label}</div>
              {/if}
            </button>
          {/if}
        {/each}
      </div>
    {:else}
      <!-- ═══ TEXT-ONLY LIST LAYOUT (unchanged) ═══ -->
      <div class="space-y-2">
        {#each pollData.options as option (option.id)}
          {@const voteCount = results.counts.get(option.id) || 0}
          {@const pct = results.totalVoters === 0 ? 0 : Math.round((voteCount / results.totalVoters) * 100)}
          {@const isUserChoice = userSelectedOptions.includes(option.id)}
          {@const isSelected = selectedOptions.has(option.id)}

          {#if displayResults}
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
    {/if}

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

  /* ═══════════════════════════════════════════
     IMAGE GRID LAYOUT
     ═══════════════════════════════════════════ */

  .poll-img-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  /* Odd last item: centered at half width */
  .poll-img-card-last-odd {
    grid-column: 1 / -1;
    max-width: 50%;
    justify-self: center;
  }

  /* Card base */
  .poll-img-card {
    border: 2px solid var(--color-input-border);
    border-radius: 0.625rem;
    overflow: hidden;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  /* Vote card (button) */
  .poll-img-card-vote {
    cursor: pointer;
    background: transparent;
    padding: 0;
    text-align: left;
    width: 100%;
    color: var(--color-text-primary);
    font-size: inherit;
  }

  .poll-img-card-vote:hover:not(:disabled) {
    border-color: var(--color-primary, #f97316);
  }

  .poll-img-card-vote:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .poll-img-card-selected {
    border-color: var(--color-primary, #f97316);
    box-shadow: 0 0 0 1px var(--color-primary, #f97316);
  }

  /* Results card */
  .poll-img-card-results {
    background: transparent;
  }

  .poll-img-card-user {
    border-color: var(--color-primary, #f97316);
  }

  .poll-img-card-winner {
    border-color: var(--color-primary, #f97316);
    box-shadow: 0 0 0 1px var(--color-primary, #f97316);
  }

  /* Image area */
  .poll-img-area {
    position: relative;
    aspect-ratio: 1;
    overflow: hidden;
    background: var(--color-accent-gray, #e5e7eb);
  }

  .poll-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .poll-img-placeholder {
    width: 100%;
    height: 100%;
    background: var(--color-accent-gray, #e5e7eb);
  }

  /* Radio/checkbox indicator overlay — top right */
  .poll-img-indicator {
    position: absolute;
    top: 0.375rem;
    right: 0.375rem;
    width: 1.5rem;
    height: 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(4px);
    transition: background 0.15s;
  }

  .poll-indicator-checked {
    background: var(--color-primary, #f97316);
  }

  .poll-radio-img,
  .poll-checkbox-img {
    width: 12px;
    height: 12px;
    border-color: white;
  }

  .poll-radio-img.poll-radio-checked {
    border-color: white;
    background: white;
    box-shadow: inset 0 0 0 2px var(--color-primary, #f97316);
  }

  .poll-checkbox-img.poll-checkbox-checked {
    border-color: white;
    background: white;
  }

  /* Results overlay bar at bottom of image */
  .poll-img-results-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 1.75rem;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .poll-img-results-fill {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    background: rgba(249, 115, 22, 0.5);
    transition: width 0.3s ease;
  }

  .poll-img-results-text {
    position: relative;
    font-size: 0.6875rem;
    font-weight: 600;
    color: white;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }

  /* Label below image */
  .poll-img-label {
    padding: 0.375rem 0.5rem;
    font-size: 0.8125rem;
    text-align: center;
    color: var(--color-text-primary);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Responsive: single column on very narrow screens */
  @media (max-width: 360px) {
    .poll-img-grid {
      grid-template-columns: 1fr;
    }

    .poll-img-card-last-odd {
      max-width: 100%;
    }
  }

  /* ═══════════════════════════════════════════
     TEXT-ONLY LIST LAYOUT
     ═══════════════════════════════════════════ */

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
