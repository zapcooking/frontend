<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import CommentIcon from 'phosphor-svelte/lib/ChatTeardropText';
  import { onMount, onDestroy } from 'svelte';
  import { createCommentFilter } from '$lib/commentFilters';
  import { getAddressableCommentCount, fetchCount } from '$lib/countQuery';

  export let event: NDKEvent;
  let loading = true;
  let totalCommentAmount: number = 0;
  let subscription: any = null;
  let countFetched = false;
  let eoseReceived = false;

  onMount(async () => {
    // FAST PATH: Try NIP-45 COUNT query first
    try {
      let fastCount: number | null = null;
      
      if (event.kind === 30023) {
        // For recipes, use addressable comment count
        const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
        const pubkey = event.author?.pubkey || event.author?.hexpubkey || event.pubkey;
        if (dTag && pubkey) {
          fastCount = await getAddressableCommentCount(event.kind, pubkey, dTag, { timeout: 2000 });
        }
      } else {
        // For regular notes, use event ID
        const result = await fetchCount({ kinds: [1], '#e': [event.id] }, { timeout: 2000 });
        fastCount = result?.count ?? null;
      }
      
      if (fastCount !== null) {
        totalCommentAmount = fastCount;
        loading = false;
        countFetched = true;
      }
    } catch {
      // Fast count failed, will fall back to subscription
    }

    // FULL PATH: Subscribe for accurate count + real-time updates
    const filter = createCommentFilter(event);
    subscription = $ndk.subscribe(filter, { closeOnEose: true });

    let eventCount = 0;
    subscription.on('event', () => {
      eventCount++;
      // Only update if:
      // - We didn't get a fast count, OR
      // - EOSE has been received (subscription is authoritative), OR
      // - Subscription count is higher than fast count
      if (!countFetched || eoseReceived || eventCount > totalCommentAmount) {
        totalCommentAmount = eventCount;
      }
      loading = false;
    });

    subscription.on('eose', () => {
      eoseReceived = true;
      loading = false;
      // Subscription count is authoritative after EOSE
      totalCommentAmount = eventCount;
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
