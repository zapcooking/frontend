<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import CommentIcon from 'phosphor-svelte/lib/ChatTeardropText';
  import { onMount, onDestroy } from 'svelte';
  import { createCommentFilter } from '$lib/commentFilters';

  export let event: NDKEvent;
  let loading = true;
  let totalCommentAmount: number = 0;
  let subscription: any = null;

  onMount(() => {
    const filter = createCommentFilter(event);
    subscription = $ndk.subscribe(filter, { closeOnEose: true });

    subscription.on('event', () => {
      loading = false;
      totalCommentAmount++;
    });

    subscription.on('eose', () => {
      loading = false;
    });
  });

  onDestroy(() => {
    if (subscription) {
      subscription.stop();
    }
  });
</script>

<button
  class="flex gap-1.5 hover:bg-input rounded px-0.5 transition duration-300 cursor-pointer self-center"
  on:click={() => {
    // Scroll to comments section
    const commentsSection = document.getElementById('comments-section');
    if (commentsSection) {
      commentsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

      // Auto-focus the comment input after scroll completes
      setTimeout(() => {
        const commentInput = document.getElementById('comment-input');
        if (commentInput) {
          commentInput.focus();
        }
      }, 500); // Wait for smooth scroll to complete
    }
  }}
  title="View comments"
>
  <CommentIcon size={24} class="text-caption" />
  {#if loading}...{:else}{totalCommentAmount}{/if}
</button>
