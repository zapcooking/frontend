<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { addClientTagToEvent } from '$lib/nip89';
  import { publishQueue } from '$lib/publishQueue';
  import NoteContent from './NoteContent.svelte';
  import CustomAvatar from './CustomAvatar.svelte';
  import CustomName from './CustomName.svelte';
  import { formatDistanceToNow } from 'date-fns';
  import {
    parsePollFromEvent,
    isPollExpired,
    buildVoteTags,
    type PollData,
    type PollResults
  } from '$lib/polls';
  import { getVoteResults, type VoteHandle } from '$lib/voteCache';

  export let event: NDKEvent;

  let pollData: PollData | null = null;
  let results: PollResults = {
    counts: new Map(),
    totalVoters: 0,
    voters: new Set(),
    votesByPubkey: new Map()
  };
  let selectedOptions: Set<string> = new Set();
  let showResults = false;
  let voting = false;
  let voted = false;
  let voteError = '';
  let voteHandle: VoteHandle | null = null;
  let unsubResults: (() => void) | null = null;
  let expandedOption: string | null = null;

  function getVotersForOption(optionId: string): string[] {
    const pubkeys: string[] = [];
    for (const [pubkey, optionIds] of results.votesByPubkey) {
      if (optionIds.includes(optionId)) pubkeys.push(pubkey);
    }
    return pubkeys;
  }

  function toggleVoterList(optionId: string) {
    expandedOption = expandedOption === optionId ? null : optionId;
  }

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
  $: endDateText = pollData?.endsAt
    ? expired
      ? `Ended ${formatDistanceToNow(new Date(pollData.endsAt * 1000), { addSuffix: true })}`
      : `Ends ${formatDistanceToNow(new Date(pollData.endsAt * 1000), { addSuffix: true })}`
    : '';

  onMount(() => {
    pollData = parsePollFromEvent(event);
    if (pollData) {
      voteHandle = getVoteResults(event.id, pollData.pollType);
      unsubResults = voteHandle.results.subscribe((r) => {
        results = r;
      });
    }
  });

  onDestroy(() => {
    if (unsubResults) unsubResults();
    if (voteHandle) voteHandle.cleanup();
  });

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
      voteHandle?.addLocalVote(voteEvent);
    } catch (err) {
      console.error('[PollDisplay] Failed to vote:', err);
      voteError = 'Failed to submit vote. Please try again.';
    } finally {
      voting = false;
    }
  }
</script>

{#if pollData}
  <!-- Question -->
  {#if pollData.question}
    <div class="poll-question">
      <NoteContent content={pollData.question} />
    </div>
  {/if}

  <!-- ═══ IMAGE POLL ═══ -->
  {#if hasImages}
    <div class="poll-grid">
      {#each pollData.options as option, i (option.id)}
        {@const voteCount = results.counts.get(option.id) || 0}
        {@const pct = results.totalVoters === 0 ? 0 : Math.round((voteCount / results.totalVoters) * 100)}
        {@const isUserChoice = userSelectedOptions.includes(option.id)}
        {@const isSelected = selectedOptions.has(option.id)}
        {@const isWinner = displayResults && voteCount > 0 && voteCount === maxVoteCount}

        {#if displayResults}
          {@const voters = getVotersForOption(option.id)}
          {@const isExpanded = expandedOption === option.id}
          <div class="poll-card-wrapper" class:poll-card-expanded={isExpanded}>
            <button
              class="poll-card"
              class:poll-card-winner={isWinner}
              class:poll-card-user={isUserChoice}
              on:click={() => voters.length > 0 && toggleVoterList(option.id)}
              disabled={voters.length === 0}
            >
              <div class="poll-card-img-wrap">
                {#if option.image}
                  <img src={option.image} alt={option.label || `Option ${i + 1}`} class="poll-card-img" />
                {:else}
                  <div class="poll-card-img-placeholder"></div>
                {/if}
                <div class="poll-card-overlay">
                  <span class="poll-card-pct">{pct}%</span>
                  {#if option.label}
                    <span class="poll-card-label">{option.label}</span>
                  {/if}
                  <div class="poll-card-bar">
                    <div class="poll-card-bar-fill" style="width: {pct}%"></div>
                  </div>
                </div>
                {#if isUserChoice}
                  <span class="poll-check-badge">
                    <svg viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6L5 8.5L9.5 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </span>
                {/if}
              </div>
            </button>
            {#if isExpanded && voters.length > 0}
              <div class="poll-voters poll-voters-card">
                {#each voters as pubkey (pubkey)}
                  <a href="/user/{pubkey}" class="poll-voter">
                    <CustomAvatar pubkey={pubkey} size={24} />
                    <CustomName {pubkey} className="poll-voter-name" />
                  </a>
                {/each}
              </div>
            {/if}
          </div>
        {:else}
          <button
            class="poll-card"
            class:poll-card-selected={isSelected}
            on:click={() => toggleOption(option.id)}
            disabled={expired || voting}
            aria-label={option.label || `Option ${i + 1}`}
          >
            <div class="poll-card-img-wrap">
              {#if option.image}
                <img src={option.image} alt={option.label || `Option ${i + 1}`} class="poll-card-img" />
              {:else}
                <div class="poll-card-img-placeholder"></div>
              {/if}
              <div class="poll-card-overlay">
                {#if option.label}
                  <span class="poll-card-label">{option.label}</span>
                {/if}
              </div>
              {#if isSelected}
                <span class="poll-check-badge">
                  <svg viewBox="0 0 12 12" fill="none">
                    <path d="M2.5 6L5 8.5L9.5 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </span>
              {/if}
            </div>
          </button>
        {/if}
      {/each}
    </div>

  <!-- ═══ TEXT POLL ═══ -->
  {:else}
    <div class="poll-list">
      {#each pollData.options as option, i (option.id)}
        {@const voteCount = results.counts.get(option.id) || 0}
        {@const pct = results.totalVoters === 0 ? 0 : Math.round((voteCount / results.totalVoters) * 100)}
        {@const isUserChoice = userSelectedOptions.includes(option.id)}
        {@const isSelected = selectedOptions.has(option.id)}

        {#if displayResults}
          {@const voters = getVotersForOption(option.id)}
          {@const isExpanded = expandedOption === option.id}
          <div>
            <button
              class="poll-row poll-row-result"
              class:poll-row-user={isUserChoice}
              class:poll-row-expanded={isExpanded}
              on:click={() => voters.length > 0 && toggleVoterList(option.id)}
              disabled={voters.length === 0}
            >
              <div class="poll-row-fill" style="width: {pct}%"></div>
              <span class="poll-row-label">
                {option.label}
                {#if isUserChoice}
                  <svg class="poll-row-check" viewBox="0 0 12 12" fill="none">
                    <path d="M2.5 6L5 8.5L9.5 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                {/if}
              </span>
              <span class="poll-row-pct">{pct}%</span>
            </button>
            {#if isExpanded && voters.length > 0}
              <div class="poll-voters">
                {#each voters as pubkey (pubkey)}
                  <a href="/user/{pubkey}" class="poll-voter">
                    <CustomAvatar pubkey={pubkey} size={24} />
                    <CustomName {pubkey} className="poll-voter-name" />
                  </a>
                {/each}
              </div>
            {/if}
          </div>
        {:else}
          <button
            class="poll-row"
            class:poll-row-selected={isSelected}
            on:click={() => toggleOption(option.id)}
            disabled={expired || voting}
          >
            <span class="poll-row-label">{option.label}</span>
            {#if isSelected}
              <svg class="poll-row-check" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 6L5 8.5L9.5 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            {/if}
          </button>
        {/if}
      {/each}
    </div>
  {/if}

  <!-- Error -->
  {#if voteError}
    <p class="poll-error">{voteError}</p>
  {/if}

  <!-- Footer -->
  <div class="poll-footer">
    <span class="poll-meta">
      {results.totalVoters} vote{results.totalVoters !== 1 ? 's' : ''}
      {#if endDateText}
        <span class="poll-meta-dot">&middot;</span>
        <span class:poll-meta-expired={expired}>{endDateText}</span>
      {/if}
      <span class="poll-meta-dot">&middot;</span>
      {pollData.pollType === 'multiplechoice' ? 'Multiple choice' : 'Single choice'}
    </span>
    <div class="poll-footer-actions">
      {#if !displayResults && !expired}
        <button class="poll-results-link" on:click={() => (showResults = true)}>
          Results
        </button>
        {#if $userPublickey && selectedOptions.size > 0}
          <button class="poll-vote-btn" disabled={voting} on:click={submitVote}>
            {voting ? 'Voting...' : 'Vote'}
          </button>
        {/if}
      {:else if displayResults && $userPublickey && !userVoted && !expired && !voted}
        <button class="poll-results-link" on:click={() => { showResults = false; expandedOption = null; }}>
          Back to vote
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* ═══════════════════════════════════════════
     QUESTION
     ═══════════════════════════════════════════ */

  .poll-question {
    font-size: 0.9375rem;
    font-weight: 500;
    line-height: 1.5;
    color: var(--color-text-primary);
    margin-bottom: 0.75rem;
  }

  /* ═══════════════════════════════════════════
     IMAGE GRID
     ═══════════════════════════════════════════ */

  .poll-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  /* Center last odd image card at half width */
  .poll-grid > :last-child:nth-child(odd) {
    grid-column: 1 / -1;
    max-width: 50%;
    justify-self: center;
  }

  .poll-card {
    position: relative;
    border-radius: 0.75rem;
    overflow: hidden;
    border: 2px solid transparent;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
    background: none;
    padding: 0;
    margin: 0;
    text-align: left;
    width: 100%;
    color: inherit;
    font: inherit;
    cursor: default;
  }

  button.poll-card {
    cursor: pointer;
  }

  button.poll-card:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  button.poll-card:hover:not(:disabled) {
    border-color: var(--color-primary);
  }

  .poll-card-selected {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 1px var(--color-primary), 0 0 12px rgba(249, 115, 22, 0.15);
  }

  .poll-card-user {
    border-color: var(--color-primary);
  }

  .poll-card-winner {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 1px var(--color-primary);
  }

  .poll-card-img-wrap {
    position: relative;
    aspect-ratio: 1;
    overflow: hidden;
    background: var(--color-accent-gray);
  }

  .poll-card-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .poll-card-img-placeholder {
    width: 100%;
    height: 100%;
    background: var(--color-accent-gray);
  }

  /* Bottom gradient overlay with label + results */
  .poll-card-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 1.5rem 0.625rem 0.5rem;
    background: linear-gradient(to bottom, transparent 0%, rgba(0, 0, 0, 0.6) 100%);
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .poll-card-pct {
    font-size: 1.125rem;
    font-weight: 700;
    color: white;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
    line-height: 1.2;
  }

  .poll-card-label {
    font-size: 0.75rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.92);
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .poll-card-bar {
    height: 2px;
    border-radius: 1px;
    background: rgba(255, 255, 255, 0.2);
    margin-top: 0.1875rem;
  }

  .poll-card-bar-fill {
    height: 100%;
    border-radius: 1px;
    background: var(--color-primary);
    animation: fillGrow 0.4s ease;
    transition: width 0.3s ease;
  }

  /* Check badge (top-right corner) */
  .poll-check-badge {
    position: absolute;
    top: 0.375rem;
    right: 0.375rem;
    width: 1.375rem;
    height: 1.375rem;
    border-radius: 50%;
    background: var(--color-primary);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }

  .poll-check-badge svg {
    width: 10px;
    height: 10px;
  }

  @media (max-width: 360px) {
    .poll-grid {
      grid-template-columns: 1fr;
    }
    .poll-grid > :last-child:nth-child(odd) {
      max-width: 100%;
    }
  }

  /* ═══════════════════════════════════════════
     TEXT LIST
     ═══════════════════════════════════════════ */

  .poll-list {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .poll-row {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    width: 100%;
    padding: 0.625rem 0.75rem;
    min-height: 2.75rem;
    border: 1px solid var(--color-input-border);
    border-radius: 0.625rem;
    background: transparent;
    color: var(--color-text-primary);
    font-size: 0.875rem;
    line-height: 1.4;
    cursor: pointer;
    transition: border-color 0.15s ease, background-color 0.15s ease;
    overflow: hidden;
    text-align: left;
    font: inherit;
  }

  button.poll-row:hover:not(:disabled) {
    border-color: var(--color-primary);
    background: rgba(249, 115, 22, 0.03);
  }

  :global(.dark) button.poll-row:hover:not(:disabled) {
    background: rgba(255, 122, 61, 0.05);
  }

  button.poll-row:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .poll-row-selected {
    border-color: var(--color-primary);
    background: rgba(249, 115, 22, 0.06);
  }

  :global(.dark) .poll-row-selected {
    background: rgba(255, 122, 61, 0.08);
  }

  .poll-row-result:not(:disabled) {
    cursor: pointer;
  }

  .poll-row-result:disabled {
    opacity: 1;
    cursor: default;
  }

  .poll-row-user {
    border-color: var(--color-primary);
  }

  /* Animated fill bar behind content */
  .poll-row-fill {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    background: rgba(249, 115, 22, 0.08);
    animation: fillGrow 0.4s ease;
    transition: width 0.3s ease;
    pointer-events: none;
  }

  :global(.dark) .poll-row-fill {
    background: rgba(255, 122, 61, 0.12);
  }

  .poll-row-label {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-width: 0;
    word-break: break-word;
  }

  .poll-row-check {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    color: var(--color-primary);
  }

  .poll-row-pct {
    position: relative;
    flex-shrink: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-caption);
  }

  /* ═══════════════════════════════════════════
     FOOTER
     ═══════════════════════════════════════════ */

  .poll-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 0.625rem;
    gap: 0.5rem;
  }

  .poll-meta {
    font-size: 0.75rem;
    color: var(--color-caption);
    line-height: 1.4;
  }

  .poll-meta-dot {
    margin: 0 0.125rem;
    opacity: 0.5;
  }

  .poll-meta-expired {
    color: var(--color-danger);
  }

  .poll-footer-actions {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    flex-shrink: 0;
  }

  .poll-results-link {
    font-size: 0.75rem;
    color: var(--color-caption);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    transition: color 0.15s;
    font: inherit;
  }

  .poll-results-link:hover {
    color: var(--color-text-primary);
  }

  .poll-vote-btn {
    padding: 0.3125rem 0.875rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: white;
    background: linear-gradient(135deg, #f97316, #f59e0b);
    border: none;
    border-radius: 9999px;
    cursor: pointer;
    transition: opacity 0.15s;
    font-family: inherit;
  }

  .poll-vote-btn:hover:not(:disabled) {
    opacity: 0.9;
  }

  .poll-vote-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ═══════════════════════════════════════════
     ERROR
     ═══════════════════════════════════════════ */

  .poll-error {
    font-size: 0.75rem;
    color: var(--color-danger);
    margin-top: 0.25rem;
  }

  /* ═══════════════════════════════════════════
     ANIMATIONS
     ═══════════════════════════════════════════ */

  @keyframes fillGrow {
    from { width: 0; }
  }

  /* ═══════════════════════════════════════════
     VOTER LIST
     ═══════════════════════════════════════════ */

  .poll-row-expanded {
    border-color: var(--color-primary);
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }

  .poll-voters {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--color-primary);
    border-top: none;
    border-radius: 0 0 0.625rem 0.625rem;
    background: rgba(249, 115, 22, 0.03);
    max-height: 11rem;
    overflow-y: auto;
  }

  :global(.dark) .poll-voters {
    background: rgba(255, 122, 61, 0.05);
  }

  .poll-voters-card {
    border-radius: 0 0 0.75rem 0.75rem;
  }

  .poll-voter {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
    text-decoration: none;
    color: var(--color-text-primary);
    transition: opacity 0.15s;
  }

  .poll-voter:hover {
    opacity: 0.8;
  }

  :global(.poll-voter-name) {
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .poll-card-wrapper {
    display: contents;
  }

  .poll-card-wrapper.poll-card-expanded {
    display: flex;
    flex-direction: column;
    grid-column: 1 / -1;
  }

  .poll-card-wrapper.poll-card-expanded .poll-card {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }

  .poll-card-wrapper button.poll-card:disabled {
    opacity: 1;
    cursor: default;
  }
</style>
