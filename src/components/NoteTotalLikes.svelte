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
      '#e': [event.id] // For regular notes, use the event ID instead of 'd' tag
    });

    sub.on('event', (e) => {
      // Prevent counting the same event multiple times
      if (processedEvents.has(e.id)) return;
      processedEvents.add(e.id);
      
      if (e.pubkey == $userPublickey) liked = true;
      totalLikeAmount++;
    });

    sub.on('eose', () => {
      loading = false;
    });
  })();

  async function likePost() {
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
      console.log('Attempting to like post:', event.id);
      
      // Create a reaction event manually
      const reactionEvent = new NDKEvent($ndk);
      reactionEvent.kind = 7; // Reaction kind
      reactionEvent.content = '+'; // Reaction content
      reactionEvent.tags = [
        ['e', event.id, '', 'reply'], // Reference the original event
        ['p', event.pubkey] // Reference the original author
      ];
      
      console.log('Publishing reaction:', reactionEvent);
      await reactionEvent.publish();
      console.log('Successfully liked post');
      
      // Update local state immediately for better UX (only liked, not count)
      liked = true;
      
    } catch (error) {
      console.error('Error liking post:', error);
      // You could show a toast notification here
    }
  }
</script>

<button
  on:click={likePost}
  class="flex gap-1.5 hover:bg-input rounded px-0.5 transition duration-300 cursor-pointer"
  class:opacity-50={!$userPublickey}
  class:hover:opacity-75={!$userPublickey}
  title={!$userPublickey ? 'Login to like posts' : liked ? 'You liked this post' : 'Like this post'}
>
  <HeartIcon 
    size={24} 
    weight={liked ? 'fill' : 'regular'} 
    class={liked ? 'text-red-500' : 'text-gray-500'}
  />
  {#if loading}...{:else}{totalLikeAmount}{/if}
</button>
