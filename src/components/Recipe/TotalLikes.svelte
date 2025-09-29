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
      '#a': [
        `${event.kind}:${event.author.hexpubkey}:${event.tags.find((e) => e[0] == 'd')?.[1]}`
      ]
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
      console.log('Attempting to like recipe:', event.id);
      
      // Create a reaction event manually
      const reactionEvent = new NDKEvent($ndk);
      reactionEvent.kind = 7; // Reaction kind
      reactionEvent.content = '+'; // Reaction content
      reactionEvent.tags = [
        ['a', `${event.kind}:${event.author?.hexpubkey || event.pubkey}:${event.tags.find((e: any) => e[0] == 'd')?.[1]}`], // Reference the recipe
        ['p', event.author?.hexpubkey || event.pubkey] // Reference the original author
      ];
      
      console.log('Publishing reaction:', reactionEvent);
      await reactionEvent.publish();
      console.log('Successfully liked recipe');
      
      // Update local state immediately for better UX (only liked, not count)
      liked = true;
      
    } catch (error) {
      console.error('Error liking recipe:', error);
      // You could show a toast notification here
    }
  }
</script>

<button
  on:click={likePost}
  class="flex gap-1.5 hover:bg-input rounded px-0.5 transition duration-300 cursor-pointer self-center"
  class:opacity-50={!$userPublickey}
  class:hover:opacity-75={!$userPublickey}
  title={!$userPublickey ? 'Login to like recipes' : liked ? 'You liked this recipe' : 'Like this recipe'}
>
  <HeartIcon 
    size={24} 
    weight={liked ? 'fill' : 'regular'} 
    class={liked ? 'text-red-500' : ''}
  />
  {#if loading}...{:else}{totalLikeAmount}{/if}
</button>
