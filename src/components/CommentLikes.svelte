<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import HeartIcon from 'phosphor-svelte/lib/Heart';

  export let event: NDKEvent;
  let loading = true;
  let totalLikeAmount: number = 0;
  let liked = false;

  let processedEvents = new Set();
  
  (async () => {
    const sub = $ndk.subscribe({
      kinds: [7],
      '#e': [event.id] // For comment likes, use the comment event ID
    });

    sub.on('event', (e) => {
      // Prevent counting the same event multiple times
      if (processedEvents.has(e.id)) return;
      processedEvents.add(e.id);
      
      if (e.pubkey == $userPublickey) liked = true;
      totalLikeAmount++;
      loading = false;
    });

    sub.on('eose', () => {
      loading = false;
    });
  })();

  async function likeComment() {
    if (liked) return;
    
    // Check if user is authenticated
    if (!$userPublickey) {
      console.log('User not authenticated - redirecting to login');
      window.location.href = '/login';
      return;
    }
    
    // Check if NDK has a signer
    if (!$ndk.signer) {
      console.log('No signer available - redirecting to login');
      window.location.href = '/login';
      return;
    }
    
    try {
      console.log('Attempting to like comment:', event.id);
      
      // Create a reaction event manually
      const reactionEvent = new NDKEvent($ndk);
      reactionEvent.kind = 7; // Reaction kind
      reactionEvent.content = '+'; // Reaction content
      reactionEvent.tags = [
        ['e', event.id, '', 'reply'], // Reference the comment event
        ['p', event.pubkey] // Reference the comment author
      ];
      
      console.log('Publishing reaction:', reactionEvent);
      await reactionEvent.publish();
      console.log('Successfully liked comment');
      
      // Update local state immediately for better UX (only liked, not count)
      liked = true;
      
    } catch (error) {
      console.error('Error liking comment:', error);
      // You could show a toast notification here
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

