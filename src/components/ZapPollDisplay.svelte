<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import NoteContent from './NoteContent.svelte';
  import CustomAvatar from './CustomAvatar.svelte';
  import CustomName from './CustomName.svelte';
  import ZapModal from './ZapModal.svelte';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import { formatDistanceToNow } from 'date-fns';
  import {
    parseZapPollFromEvent,
    isPollExpired,
    type ZapPollData,
    type ZapPollResults
  } from '$lib/polls';
  import { getZapPollResults, type ZapPollHandle } from '$lib/zapPollCache';

  export let event: NDKEvent;

  let pollData: ZapPollData | null = null;
  let results: ZapPollResults = {
    satsByOption: new Map(),
    totalSats: 0,
    totalVoters: 0,
    voters: new Set(),
    votesByPubkey: new Map()
  };
  let zapPollHandle: ZapPollHandle | null = null;
  let unsubResults: (() => void) | null = null;
  let voted = false;
  let expandedOption: string | null = null;

  // Zap modal state
  let zapModalOpen = false;
  let zapVoteOptionId: string | null = null;
  let zapVoteOptionLabel: string | null = null;

  $: expired = pollData ? isPollExpired(pollData.closedAt) : false;
  $: userVoted = $userPublickey ? results.voters.has($userPublickey) : false;
  $: displayResults = userVoted || expired || voted || !$userPublickey;
  $: maxSats = pollData
    ? Math.max(...pollData.options.map(o => results.satsByOption.get(o.id) || 0), 0)
    : 0;
  $: endDateText = pollData?.closedAt
    ? expired
      ? `Ended ${formatDistanceToNow(new Date(pollData.closedAt * 1000), { addSuffix: true })}`
      : `Ends ${formatDistanceToNow(new Date(pollData.closedAt * 1000), { addSuffix: true })}`
    : '';

  onMount(() => {
    pollData = parseZapPollFromEvent(event);
    if (pollData) {
      zapPollHandle = getZapPollResults(event.id);
      unsubResults = zapPollHandle.results.subscribe(r => { results = r; });
    }
  });

  onDestroy(() => {
    if (unsubResults) unsubResults();
    if (zapPollHandle) zapPollHandle.cleanup();
  });

  function handleZapVote(option: { id: string; label: string }) {
    if (!$userPublickey || expired) return;
    zapVoteOptionId = option.id;
    zapVoteOptionLabel = option.label;
    zapModalOpen = true;
  }

  function handleZapComplete(e: CustomEvent<{ amount: number; pollOptionId?: string }>) {
    if (e.detail.pollOptionId && zapPollHandle && $userPublickey) {
      zapPollHandle.addLocalZap(e.detail.pollOptionId, e.detail.amount, $userPublickey);
    }
    voted = true;
    zapModalOpen = false;
  }

  function getVotersForOption(optionId: string): string[] {
    const pubkeys: string[] = [];
    for (const [pubkey, votes] of results.votesByPubkey) {
      if (votes.some(v => v.optionId === optionId)) pubkeys.push(pubkey);
    }
    return pubkeys;
  }

  function toggleVoterList(optionId: string) {
    expandedOption = expandedOption === optionId ? null : optionId;
  }

  function formatSats(sats: number): string {
    if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(1)}M`;
    if (sats >= 1_000) return `${(sats / 1_000).toFixed(sats >= 10_000 ? 0 : 1)}K`;
    return sats.toLocaleString();
  }
</script>

{#if pollData}
  {#if pollData.question}
    <div class="zp-question">
      <NoteContent content={pollData.question} />
    </div>
  {/if}

  <div class="zp-list">
    {#each pollData.options as option (option.id)}
      {@const sats = results.satsByOption.get(option.id) || 0}
      {@const pct = results.totalSats === 0 ? 0 : Math.round((sats / results.totalSats) * 100)}
      {@const isUserChoice = results.votesByPubkey.get($userPublickey || '')?.some(v => v.optionId === option.id) || false}
      {@const isWinner = displayResults && sats > 0 && sats === maxSats}

      {#if displayResults}
        {@const voters = getVotersForOption(option.id)}
        {@const isExpanded = expandedOption === option.id}
        <div>
          <button
            class="zp-row zp-row-result"
            class:zp-row-user={isUserChoice}
            class:zp-row-winner={isWinner}
            class:zp-row-expanded={isExpanded}
            on:click={() => voters.length > 0 && toggleVoterList(option.id)}
            disabled={voters.length === 0}
          >
            <div class="zp-row-fill" style="width: {pct}%"></div>
            <span class="zp-row-label">
              {option.label}
              {#if isUserChoice}
                <svg class="zp-row-check" viewBox="0 0 12 12" fill="none">
                  <path d="M2.5 6L5 8.5L9.5 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              {/if}
            </span>
            <span class="zp-row-sats">{formatSats(sats)} sats</span>
          </button>
          {#if isExpanded && voters.length > 0}
            <div class="zp-voters">
              {#each voters as pubkey (pubkey)}
                <a href="/user/{pubkey}" class="zp-voter">
                  <CustomAvatar pubkey={pubkey} size={24} />
                  <CustomName {pubkey} className="zp-voter-name" />
                </a>
              {/each}
            </div>
          {/if}
        </div>
      {:else}
        <button
          class="zp-row"
          on:click={() => handleZapVote(option)}
          disabled={expired}
        >
          <span class="zp-row-label">
            {option.label}
            <LightningIcon size={14} weight="fill" class="zp-zap-icon" />
          </span>
        </button>
      {/if}
    {/each}
  </div>

  <!-- Footer -->
  <div class="zp-footer">
    <span class="zp-meta">
      {formatSats(results.totalSats)} sats
      <span class="zp-meta-dot">&middot;</span>
      {results.totalVoters} voter{results.totalVoters !== 1 ? 's' : ''}
      {#if endDateText}
        <span class="zp-meta-dot">&middot;</span>
        <span class:zp-meta-expired={expired}>{endDateText}</span>
      {/if}
      <span class="zp-meta-dot">&middot;</span>
      <span class="zp-meta-zap">⚡ Zap Poll</span>
    </span>
    <div class="zp-footer-actions">
      {#if pollData.valueMinimum}
        <span class="zp-meta">min {pollData.valueMinimum} sats</span>
      {/if}
    </div>
  </div>

  {#if zapModalOpen && pollData}
    <ZapModal
      bind:open={zapModalOpen}
      event={event}
      pollOptionId={zapVoteOptionId ?? undefined}
      pollOptionLabel={zapVoteOptionLabel ?? undefined}
      pollMinSats={pollData.valueMinimum}
      pollMaxSats={pollData.valueMaximum}
      pollEventKind={6969}
      on:zap-complete={handleZapComplete}
    />
  {/if}
{/if}

<style>
  .zp-question {
    font-size: 0.9375rem;
    font-weight: 500;
    line-height: 1.5;
    color: var(--color-text-primary);
    margin-bottom: 0.75rem;
  }

  .zp-list {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .zp-row {
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

  button.zp-row:hover:not(:disabled) {
    border-color: #facc15;
    background: rgba(250, 204, 21, 0.04);
  }

  button.zp-row:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .zp-row-result:not(:disabled) {
    cursor: pointer;
  }

  .zp-row-result:disabled {
    opacity: 1;
    cursor: default;
  }

  .zp-row-user {
    border-color: #facc15;
  }

  .zp-row-winner {
    border-color: #facc15;
    box-shadow: 0 0 0 1px rgba(250, 204, 21, 0.5);
  }

  .zp-row-expanded {
    border-color: #facc15;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }

  .zp-row-fill {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    background: rgba(250, 204, 21, 0.08);
    animation: fillGrow 0.4s ease;
    transition: width 0.3s ease;
    pointer-events: none;
  }

  :global(.dark) .zp-row-fill {
    background: rgba(250, 204, 21, 0.12);
  }

  .zp-row-label {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-width: 0;
    word-break: break-word;
  }

  .zp-row-check {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    color: #facc15;
  }

  .zp-row-sats {
    position: relative;
    flex-shrink: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-caption);
  }

  :global(.zp-zap-icon) {
    color: #facc15;
    flex-shrink: 0;
  }

  /* Voter list */
  .zp-voters {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid #facc15;
    border-top: none;
    border-radius: 0 0 0.625rem 0.625rem;
    background: rgba(250, 204, 21, 0.03);
    max-height: 11rem;
    overflow-y: auto;
  }

  :global(.dark) .zp-voters {
    background: rgba(250, 204, 21, 0.05);
  }

  .zp-voter {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
    text-decoration: none;
    color: var(--color-text-primary);
    transition: opacity 0.15s;
  }

  .zp-voter:hover {
    opacity: 0.8;
  }

  :global(.zp-voter-name) {
    font-size: 0.8125rem;
    font-weight: 500;
  }

  /* Footer */
  .zp-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 0.625rem;
    gap: 0.5rem;
  }

  .zp-meta {
    font-size: 0.75rem;
    color: var(--color-caption);
    line-height: 1.4;
  }

  .zp-meta-dot {
    margin: 0 0.125rem;
    opacity: 0.5;
  }

  .zp-meta-expired {
    color: var(--color-danger);
  }

  .zp-meta-zap {
    color: #facc15;
    font-weight: 600;
  }

  .zp-footer-actions {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    flex-shrink: 0;
  }

  @keyframes fillGrow {
    from { width: 0; }
  }
</style>
