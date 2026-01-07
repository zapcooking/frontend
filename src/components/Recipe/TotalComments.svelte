<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import CommentIcon from 'phosphor-svelte/lib/ChatTeardropText';
  import { onMount, onDestroy } from 'svelte';

  export let event: NDKEvent;
  let loading = true;
  let totalCommentAmount: number = 0;
  let subscription: any = null;

  onMount(() => {
    // For longform (kind 30023), use NIP-22 #A filter
    // For kind 1, use NIP-10 #e filter
    if (event.kind === 30023) {
      const dTag = event.tags.find((e) => e[0] == 'd')?.[1];
      if (dTag) {
        const addressTag = `${event.kind}:${event.author.hexpubkey}:${dTag}`;
        subscription = $ndk.subscribe(
          {
            kinds: [1111],
            '#A': [addressTag]  // NIP-22: filter by root address
          },
          { closeOnEose: true }
        );
      } else {
        subscription = $ndk.subscribe(
          {
            kinds: [1, 1111],
            '#e': [event.id]
          },
          { closeOnEose: true }
        );
      }
    } else {
      // NIP-10 for kind 1 notes
      subscription = $ndk.subscribe(
        {
          kinds: [1],
          '#e': [event.id]
        },
        { closeOnEose: true }
      );
    }

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
