<script lang="ts">
  import { slide } from 'svelte/transition';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwise';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import { ndk } from '$lib/nostr';
  import { formatCompactTime, formatSats } from '$lib/utils';
  import {
    loadPostEngagementDetails,
    type PostEngagementDetails
  } from '$lib/postEngagementDetails';
  import PostEngagementPerson from './PostEngagementPerson.svelte';

  export let event: NDKEvent;
  export let open = false;

  const emptyDetails = (): PostEngagementDetails => ({
    reactions: [],
    zaps: [],
    reposts: [],
    relays: []
  });

  let details = emptyDetails();
  let loading = false;
  let attempted = false;
  let failed = false;
  let activeEventId = '';
  let requestToken = 0;

  function reset(nextEventId: string) {
    activeEventId = nextEventId;
    details = emptyDetails();
    loading = false;
    attempted = false;
    failed = false;
    requestToken += 1;
  }

  async function loadDetails() {
    const token = ++requestToken;
    const eventId = event.id;
    loading = true;
    failed = false;

    try {
      details = await loadPostEngagementDetails($ndk, event, (update) => {
        if (token === requestToken && eventId === activeEventId) details = update;
      });
    } catch (error) {
      if (token === requestToken) {
        console.error('[PostEngagementDrawer] Failed to load post activity:', error);
        failed = true;
      }
    } finally {
      if (token === requestToken) loading = false;
    }
  }

  function relayLabel(url: string): string {
    return url.replace(/^wss?:\/\//, '').replace(/\/$/, '');
  }

  $: hasDetails =
    details.reactions.length > 0 ||
    details.zaps.length > 0 ||
    details.reposts.length > 0 ||
    details.relays.length > 0;
  $: if (event.id !== activeEventId) reset(event.id);
  $: if (open && !attempted && event.id) {
    attempted = true;
    void loadDetails();
  }
</script>

{#if open}
  <div
    class="drawer"
    transition:slide={{ duration: 180 }}
    data-stop-card-navigation
    aria-live="polite"
  >
    {#if loading && !hasDetails}
      <div class="skeleton-list" aria-label="Loading post activity">
        {#each [1, 2, 3] as _}
          <div class="skeleton-row">
            <span class="skeleton-avatar"></span>
            <span class="skeleton-name"></span>
          </div>
        {/each}
      </div>
    {:else if failed && !hasDetails}
      <p class="empty-state">Post activity could not be loaded.</p>
    {:else if !loading && !hasDetails}
      <p class="empty-state">No post activity found on connected relays.</p>
    {:else}
      <div class="drawer-scroll">
        {#if details.zaps.length > 0}
          <section class="detail-section" aria-labelledby={`zaps-${event.id}`}>
            <h3 id={`zaps-${event.id}`} class="section-heading zap-heading">
              <LightningIcon size={18} weight="fill" />
              <span>Zaps</span>
              <span class="section-count">{details.zaps.length}</span>
            </h3>
            <div class="detail-list">
              {#each details.zaps as zap (zap.id)}
                <PostEngagementPerson pubkey={zap.pubkey} size={32}>
                  <span class="zap-meta">
                    <strong>{formatSats(zap.amount)} sats</strong>
                    {#if zap.timestamp > 0}
                      <span>{formatCompactTime(zap.timestamp)}</span>
                    {/if}
                  </span>
                </PostEngagementPerson>
                {#if zap.comment}
                  <p class="zap-comment">{zap.comment}</p>
                {/if}
              {/each}
            </div>
          </section>
        {/if}

        {#if details.reposts.length > 0}
          <section class="detail-section" aria-labelledby={`reposts-${event.id}`}>
            <h3 id={`reposts-${event.id}`} class="section-heading repost-heading">
              <ArrowsClockwiseIcon size={18} weight="bold" />
              <span>Reposts</span>
              <span class="section-count">{details.reposts.length}</span>
            </h3>
            <div class="people-grid">
              {#each details.reposts as pubkey (pubkey)}
                <PostEngagementPerson {pubkey} />
              {/each}
            </div>
          </section>
        {/if}

        {#if details.reactions.length > 0}
          <section class="detail-section" aria-labelledby={`reactions-${event.id}`}>
            <h3 id={`reactions-${event.id}`} class="section-heading">
              <span>Reactions</span>
              <span class="section-count">
                {details.reactions.reduce((total, group) => total + group.pubkeys.length, 0)}
              </span>
            </h3>
            <div class="reaction-list">
              {#each details.reactions as group (group.emoji)}
                <div class="reaction-group">
                  <span class="reaction-emoji" title={`${group.pubkeys.length} reactions`}>
                    {group.emoji}
                  </span>
                  <div class="people-grid">
                    {#each group.pubkeys as pubkey (pubkey)}
                      <PostEngagementPerson {pubkey} />
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          </section>
        {/if}

        {#if details.relays.length > 0}
          <section class="detail-section relay-section" aria-labelledby={`relays-${event.id}`}>
            <h3 id={`relays-${event.id}`} class="section-heading">
              <span>Seen on</span>
              <span class="section-count">{details.relays.length}</span>
            </h3>
            <div class="relay-list">
              {#each details.relays as relay (relay)}
                <span class="relay-pill" title={relay}>{relayLabel(relay)}</span>
              {/each}
            </div>
          </section>
        {/if}
      </div>

      {#if loading}
        <div class="loading-line" aria-label="Refreshing post activity"></div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .drawer {
    position: relative;
    margin-top: 0.25rem;
    border-top: 1px solid color-mix(in srgb, var(--color-input-border) 75%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--color-input-border) 55%, transparent);
    background: var(--color-card-sunken);
    color: var(--color-text-primary);
    overflow: hidden;
  }

  .drawer-scroll {
    max-height: min(30rem, 60vh);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0.5rem 0.75rem;
    scrollbar-width: thin;
    scrollbar-color: var(--color-input-border) transparent;
  }

  .detail-section {
    padding: 0.625rem 0;
  }

  .detail-section + .detail-section {
    border-top: 1px solid color-mix(in srgb, var(--color-input-border) 65%, transparent);
  }

  .section-heading {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin: 0 0 0.375rem;
    color: var(--color-text-secondary);
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1.25rem;
    text-transform: uppercase;
  }

  .section-count {
    color: var(--color-caption);
    font-variant-numeric: tabular-nums;
  }

  .zap-heading {
    color: #f97316;
  }

  .repost-heading {
    color: #22c55e;
  }

  .detail-list,
  .reaction-list {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .people-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    gap: 0.125rem 0.5rem;
    min-width: 0;
  }

  .reaction-group {
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr);
    align-items: start;
    gap: 0.375rem;
    padding: 0.125rem 0;
  }

  .reaction-emoji {
    display: flex;
    min-height: 2.625rem;
    align-items: center;
    justify-content: center;
    font-size: 1.125rem;
  }

  .zap-meta {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    align-items: flex-end;
    color: var(--color-caption);
    font-size: 0.6875rem;
    font-variant-numeric: tabular-nums;
  }

  .zap-meta strong {
    color: #f97316;
    font-size: 0.8125rem;
  }

  .zap-comment {
    margin: -0.125rem 0 0.375rem 3rem;
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
    line-height: 1.25rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .relay-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  .relay-pill {
    display: inline-flex;
    max-width: 100%;
    padding: 0.25rem 0.625rem;
    border: 1px solid var(--color-input-border);
    border-radius: 9999px;
    background: var(--color-input-bg);
    color: var(--color-text-secondary);
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1.125rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .skeleton-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
  }

  .skeleton-row {
    display: flex;
    align-items: center;
    gap: 0.625rem;
  }

  .skeleton-avatar,
  .skeleton-name {
    display: block;
    background: var(--color-skeleton-base);
    animation: pulse 1.2s ease-in-out infinite alternate;
  }

  .skeleton-avatar {
    width: 2rem;
    height: 2rem;
    border-radius: 9999px;
  }

  .skeleton-name {
    width: min(11rem, 55%);
    height: 0.75rem;
    border-radius: 4px;
  }

  .empty-state {
    margin: 0;
    padding: 1rem;
    color: var(--color-text-secondary);
    font-size: 0.875rem;
    text-align: center;
  }

  .loading-line {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 2px;
    background: var(--color-primary);
    transform-origin: left;
    animation: loading 1s ease-in-out infinite;
  }

  @keyframes loading {
    0% {
      transform: scaleX(0);
      opacity: 0.4;
    }
    50% {
      transform: scaleX(0.7);
      opacity: 1;
    }
    100% {
      transform: scaleX(1);
      opacity: 0;
    }
  }

  @keyframes pulse {
    from {
      opacity: 0.45;
    }
    to {
      opacity: 0.9;
    }
  }

  @media (max-width: 639px) {
    .drawer-scroll {
      max-height: 55vh;
      padding-right: 0.5rem;
      padding-left: 0.5rem;
    }

    .people-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton-avatar,
    .skeleton-name,
    .loading-line {
      animation: none;
    }
  }
</style>
