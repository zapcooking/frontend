<script lang="ts">
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import NoteTotalLikes from './NoteTotalLikes.svelte';
  import NoteTotalComments from './NoteTotalComments.svelte';
  import NoteBookmark from './NoteBookmark.svelte';
  import NoteRepost from './NoteRepost.svelte';
  import NoteTotalZaps from './NoteTotalZaps.svelte';
  import CheffyNoteReviewTrigger from './CheffyNoteReviewTrigger.svelte';
  import PostEngagementDrawer from './PostEngagementDrawer.svelte';
  import PostEngagementToggle from './PostEngagementToggle.svelte';
  import ZapModal from './ZapModal.svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { fetchEngagement, optimisticZapUpdate, markSelfZapCompleted } from '$lib/engagementCache';

  export let event: NDKEvent;

  /**
   * 'full'    — feed-style: all actions, hover wrappers, zap pills support
   * 'compact' — thread parent/nested reply: smaller, tighter spacing
   * 'default' — standard detail view
   */
  export let variant: 'full' | 'compact' | 'default' = 'default';

  /** Show the zap pills row above the action icons (feed-style) */
  export let showZapPills: boolean = false;

  /** Show the comment count/toggle button */
  export let showComments: boolean = true;

  /** Show the repost/quote button */
  export let showRepost: boolean = true;

  /** Show the "Ask Cheffy about this photo" trigger (image-bearing notes only) */
  export let showCheffy: boolean = true;

  /** Override compact mode's default of hiding the engagement details drawer. */
  export let showEngagementDetails: boolean | undefined = undefined;

  /** When set, the comment button invokes this (opens the reply modal)
   *  instead of the NoteTotalComments default (toggle inline thread /
   *  navigate to the thread page). */
  export let onCommentClick: (() => void) | null = null;

  let zapModalOpen = false;
  let engagementOpen = false;
  let engagementEventId = event.id;

  $: if (event.id !== engagementEventId) {
    engagementEventId = event.id;
    engagementOpen = false;
  }

  // Called as the `onZapClick` callback from NoteTotalZaps when its
  // internal one-tap path isn't applicable (no in-app wallet, toggle off,
  // or signed out). NoteTotalZaps already handles the one-tap path
  // itself, so this is purely the modal-fallback handler.
  function openZapModal() {
    // Signed out, the zap sheet itself offers sign-in or an anonymous zap.
    zapModalOpen = true;
  }

  function handleZapComplete(e: CustomEvent<{ amount: number; comment?: string }>) {
    if (event) {
      optimisticZapUpdate(
        event.id,
        (e.detail.amount || 0) * 1000,
        $userPublickey,
        e.detail.comment
      );
      // Modal zap is fully paid by the time this fires (it's dispatched
      // from ZapModal's success branch / Bitcoin Connect onPaid). Fire
      // the completion marker so the sparkle burst runs exactly once.
      markSelfZapCompleted(event.id);
      fetchEngagement($ndk, event, $userPublickey);
    }
  }

  let isCompact: boolean;
  let isFull: boolean;
  let canShowEngagementDetails: boolean;
  let iconWrapClass: string;
  let zapWrapClass: string;

  $: isCompact = variant === 'compact';
  $: isFull = variant === 'full';
  $: canShowEngagementDetails = showEngagementDetails ?? !isCompact;
  $: iconWrapClass = isFull
    ? 'hover:bg-accent-gray rounded-full p-1.5 transition-colors'
    : isCompact
      ? 'rounded p-0.5 transition-colors'
      : 'hover:bg-accent-gray rounded px-1 py-0.5 transition-colors';
  $: zapWrapClass = isFull
    ? 'hover:bg-amber-50/50 rounded-full p-1 transition-colors'
    : iconWrapClass;
</script>

<div class="note-action-bar" class:compact={isCompact} class:full={isFull}>
  {#if showZapPills}
    <div class="zap-pills-row">
      <NoteTotalZaps
        {event}
        onZapClick={openZapModal}
        showPills={true}
        onlyPills={true}
        maxPills={10}
      />
    </div>
  {/if}

  <div class="action-row">
    <!-- Order mirrors the iOS client's PostCardView actionBar:
         reply · heart · repost · zap, then bookmark + cheffy + details
         chevron pinned to the far right. -->
    {#if showComments}
      <div class={iconWrapClass}>
        <NoteTotalComments {event} onComment={onCommentClick} />
      </div>
    {/if}

    <div class={iconWrapClass}>
      <NoteTotalLikes {event} />
    </div>

    {#if showRepost}
      <div class={iconWrapClass}>
        <NoteRepost {event} />
      </div>
    {/if}

    <div class={zapWrapClass}>
      <NoteTotalZaps {event} onZapClick={openZapModal} />
    </div>

    <!-- Bookmark + (cheffy) + details chevron pin to the far right. -->
    <div class="trailing-actions">
      <div class={iconWrapClass}>
        <NoteBookmark {event} />
      </div>
      {#if !isCompact && showCheffy}
        <CheffyNoteReviewTrigger {event} wrapClass={iconWrapClass} />
      {/if}
      {#if canShowEngagementDetails}
        <PostEngagementToggle
          expanded={engagementOpen}
          on:toggle={() => (engagementOpen = !engagementOpen)}
        />
      {/if}
    </div>
  </div>

  {#if canShowEngagementDetails}
    <PostEngagementDrawer {event} open={engagementOpen} />
  {/if}
</div>

{#if zapModalOpen}
  <ZapModal bind:open={zapModalOpen} {event} on:zap-complete={handleZapComplete} />
{/if}

<style>
  .note-action-bar {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .action-row {
    display: flex;
    align-items: center;
    /* iOS spaces the row with a fixed gap between controls (their targets
       carry the 44pt spacing internally). The gap flexes down on narrow
       cards — five controls plus multi-digit counts must not overflow a
       phone-width column. */
    gap: clamp(0.75rem, 4vw, 2.25rem);
    color: var(--color-text-secondary);
  }

  .compact .action-row {
    gap: clamp(0.625rem, 3vw, 1.25rem);
  }

  .trailing-actions {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    margin-left: auto;
  }

  .zap-pills-row {
    padding: 0 0.5rem;
  }

  .full .zap-pills-row {
    padding: 0;
  }
</style>
