<script lang="ts">
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import NoteTotalLikes from './NoteTotalLikes.svelte';
  import NoteTotalComments from './NoteTotalComments.svelte';
  import NoteRepost from './NoteRepost.svelte';
  import NoteTotalZaps from './NoteTotalZaps.svelte';
  import CheffyNoteReviewTrigger from './CheffyNoteReviewTrigger.svelte';
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

  /** Show the "Ask Cheffy about this dish" trigger (image-bearing notes only) */
  export let showCheffy: boolean = true;

  let zapModalOpen = false;

  // Called as the `onZapClick` callback from NoteTotalZaps when its
  // internal one-tap path isn't applicable (no in-app wallet, toggle off,
  // or signed out). NoteTotalZaps already handles the one-tap path
  // itself, so this is purely the modal-fallback handler.
  function openZapModal() {
    if (!$userPublickey) {
      window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
      return;
    }
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
      fetchEngagement($ndk, event.id, $userPublickey);
    }
  }

  let isCompact: boolean;
  let isFull: boolean;
  let iconWrapClass: string;
  let zapWrapClass: string;

  $: isCompact = variant === 'compact';
  $: isFull = variant === 'full';
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
    <div class={iconWrapClass}>
      <NoteTotalLikes {event} />
    </div>

    {#if showComments}
      <div class={iconWrapClass}>
        <NoteTotalComments {event} />
      </div>
    {/if}

    {#if showRepost}
      <div class={iconWrapClass}>
        <NoteRepost {event} />
      </div>
    {/if}

    <div class={zapWrapClass}>
      <NoteTotalZaps {event} onZapClick={openZapModal} />
    </div>

    {#if showCheffy}
      <!-- Bottom-right of the card (ml-auto). Renders nothing for
           imageless notes — the trigger owns detection. -->
      <CheffyNoteReviewTrigger {event} wrapClass={`${iconWrapClass} ml-auto`} />
    {/if}
  </div>
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
    gap: 0.25rem;
    color: var(--color-text-secondary);
  }

  .compact .action-row {
    gap: 0.125rem;
  }

  .zap-pills-row {
    padding: 0 0.5rem;
  }

  .full .zap-pills-row {
    padding: 0;
  }
</style>
