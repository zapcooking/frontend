<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import CommentIcon from 'phosphor-svelte/lib/ChatTeardropText';
  import { getEngagementStore, fetchEngagement } from '$lib/engagementCache';

  export let event: NDKEvent;
  
  const store = getEngagementStore(event.id);

  onMount(() => {
    // Always fetch engagement data - fetchEngagement will check cache freshness
    // Batch fetch may be in progress, but individual fetch ensures counts load
    fetchEngagement($ndk, event.id, $userPublickey);
  });
</script>

<button
  class="flex items-center gap-1.5 hover:bg-input rounded px-0.5 transition duration-300 cursor-pointer"
  style="color: var(--color-text-primary)"
  on:click={() => {
    // Find the InlineComments component for this event and trigger toggleComments
    const inlineCommentsComponent = document.querySelector(`[data-event-id="${event.id}"]`)?.closest('.inline-comments');
    if (inlineCommentsComponent) {
      // Dispatch a custom event to trigger the toggleComments function
      inlineCommentsComponent.dispatchEvent(new CustomEvent('toggleComments'));
    }
  }}
  title="View comments"
>
  <CommentIcon size={24} class="text-caption" />
  <span class="text-caption">
    {#if $store.loading}–{:else}{$store.comments.count}{/if}
  </span>
</button>
