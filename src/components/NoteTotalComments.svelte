<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ndk } from '$lib/nostr';
  import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';
  import CommentIcon from 'phosphor-svelte/lib/ChatTeardropText';

  export let event: NDKEvent;
  let loading = true;
  let totalCommentAmount: number = 0;
  let subscription: NDKSubscription | null = null;
  let processedIds = new Set<string>();

  function loadComments() {
    if (!event?.id) {
      loading = false;
      return;
    }

    subscription = $ndk.subscribe({
      kinds: [1],
      '#e': [event.id]
    });

    subscription.on('event', (e: NDKEvent) => {
      if (e.id && !processedIds.has(e.id)) {
        processedIds.add(e.id);
        totalCommentAmount++;
      }
    });

    subscription.on('eose', () => {
      loading = false;
    });
  }

  onMount(() => {
    loadComments();
  });

  onDestroy(() => {
    if (subscription) {
      subscription.stop();
    }
  });
</script>

<button
  class="flex gap-1.5 hover:bg-input rounded px-0.5 transition duration-300 cursor-pointer"
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
  {#if loading}...{:else}{totalCommentAmount}{/if}
</button>
