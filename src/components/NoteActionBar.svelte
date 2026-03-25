<script lang="ts">
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import NoteTotalLikes from './NoteTotalLikes.svelte';
  import NoteTotalComments from './NoteTotalComments.svelte';
  import NoteRepost from './NoteRepost.svelte';
  import NoteTotalZaps from './NoteTotalZaps.svelte';
  import ZapModal from './ZapModal.svelte';
  import { userPublickey } from '$lib/nostr';

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

  let zapModalOpen = false;

  function openZapModal() {
    if (!$userPublickey) {
      window.location.href = '/login';
      return;
    }
    zapModalOpen = true;
  }

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
  </div>
</div>

{#if zapModalOpen}
  <ZapModal bind:open={zapModalOpen} {event} />
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
