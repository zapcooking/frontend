<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import HeartIcon from 'phosphor-svelte/lib/Heart';
  import { addClientTagToEvent } from '$lib/nip89';

  export let event: NDKEvent;
  let loading = true;
  let totalLikeAmount: number = 0;
  let liked = false;
  let subscription: any = null;

  let processedEvents = new Set();
  let seenPubkeys = new Set<string>();

  onMount(() => {
    subscription = $ndk.subscribe({
      kinds: [7],
      '#e': [event.id] // For comment likes, use the comment event ID
    }, { closeOnEose: true });

    subscription.on('event', (e: NDKEvent) => {
      // Prevent counting the same event multiple times
      if (processedEvents.has(e.id)) return;
      processedEvents.add(e.id);

      // Only count one reaction per user
      if (seenPubkeys.has(e.pubkey)) return;
      seenPubkeys.add(e.pubkey);

      if (e.pubkey == $userPublickey) liked = true;
      totalLikeAmount++;
      loading = false;
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

  async function likeComment() {
    if (liked) return;
    
    // Check if user is authenticated
    if (!$userPublickey) {
      console.log('User not authenticated - redirecting to login');
      window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
      return;
    }
    
    // Check if NDK has a signer
    if (!$ndk.signer) {
      console.log('No signer available - redirecting to login');
      window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
      return;
    }
    
    // Optimistic update — show immediately
    liked = true;
    totalLikeAmount++;
    seenPubkeys.add($userPublickey);

    try {
      const reactionEvent = new NDKEvent($ndk);
      reactionEvent.kind = 7;
      reactionEvent.content = '+';
      reactionEvent.tags = [
        ['e', event.id, '', 'reply'],
        ['p', event.pubkey]
      ];

      addClientTagToEvent(reactionEvent);
      await reactionEvent.publish();
    } catch (error) {
      // Revert on failure
      liked = false;
      totalLikeAmount--;
      seenPubkeys.delete($userPublickey);
      console.error('Error liking comment:', error);
    }
  }
</script>

<button
  on:click={likeComment}
  class="flex gap-1 items-center hover:bg-input rounded px-1.5 py-0.5 transition duration-300 cursor-pointer text-sm print:hidden"
  style="color: var(--color-text-primary)"
  class:opacity-50={!$userPublickey}
  class:hover:opacity-75={!$userPublickey}
  title={!$userPublickey ? 'Login to like comments' : liked ? 'You liked this comment' : 'Like this comment'}
>
  <HeartIcon
    size={16}
    weight={liked ? 'fill' : 'regular'}
    class={liked ? 'text-red-500' : ''}
  />
  {#if loading}
    <span class="text-caption text-xs">...</span>
  {:else if totalLikeAmount > 0}
    <span class="text-sm" style="color: var(--color-text-secondary)">{totalLikeAmount}</span>
  {/if}
</button>

