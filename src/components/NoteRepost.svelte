<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent, type NDKSubscription } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { addClientTagToEvent } from '$lib/nip89';
  import ArrowsClockwise from 'phosphor-svelte/lib/ArrowsClockwise';
  import { clickOutside } from '$lib/clickOutside';

  export let event: NDKEvent;
  let loading = true;
  let totalReposts: number = 0;
  let reposted = false;
  let showMenu = false;

  let processedEvents = new Set<string>();
  let subscription: NDKSubscription | null = null;
  
  function loadReposts() {
    if (!event?.id) {
      loading = false;
      return;
    }

    subscription = $ndk.subscribe({
      kinds: [6],
      '#e': [event.id]
    });

    subscription.on('event', (e: NDKEvent) => {
      if (e.id && !processedEvents.has(e.id)) {
        processedEvents.add(e.id);
        if (e.pubkey === $userPublickey) reposted = true;
        totalReposts++;
      }
    });

    subscription.on('eose', () => {
      loading = false;
    });
  }

  onMount(() => {
    loadReposts();
  });

  onDestroy(() => {
    if (subscription) {
      subscription.stop();
    }
  });

  async function repost() {
    showMenu = false;
    
    if (reposted) {
      console.log('Already reposted');
      return;
    }

    if (!$userPublickey || !$ndk.signer) {
      window.location.href = '/login';
      return;
    }

    let repostEvent: NDKEvent | null = null;

    try {
      console.log('Creating repost for:', event.id);

      // Create kind 6 repost event
      repostEvent = new NDKEvent($ndk);
      repostEvent.kind = 6;
      repostEvent.content = JSON.stringify(event.rawEvent());
      repostEvent.tags = [
        ['e', event.id, '', 'mention'],
        ['p', event.pubkey]
      ];

      // Add NIP-89 client tag
      addClientTagToEvent(repostEvent);

      await repostEvent.sign();
      console.log('Repost event signed:', repostEvent.id);

      if (repostEvent.id) {
        processedEvents.add(repostEvent.id);
      }

      // Optimistic update
      reposted = true;
      totalReposts++;

      await repostEvent.publish();
      console.log('Successfully reposted');

    } catch (error) {
      console.error('Error reposting:', error);
      reposted = false;
      totalReposts--;
      if (repostEvent?.id) {
        processedEvents.delete(repostEvent.id);
      }
    }
  }

  function quote() {
    showMenu = false;
    
    if (!$userPublickey) {
      window.location.href = '/login';
      return;
    }

    // Create nevent identifier for the note
    const nevent = nip19.neventEncode({
      id: event.id,
      author: event.pubkey
    });
    
    // Dispatch event to open composer with quote
    window.dispatchEvent(new CustomEvent('quote-note', { 
      detail: { nevent, event } 
    }));
  }
</script>

<div class="relative">
  <button
    on:click={() => showMenu = !showMenu}
    class="flex gap-1.5 hover:bg-input rounded px-0.5 transition duration-300 cursor-pointer"
    class:opacity-50={!$userPublickey}
    title={!$userPublickey ? 'Login to repost' : reposted ? 'You reposted this' : 'Repost'}
  >
    <ArrowsClockwise
      size={24}
      weight={reposted ? 'fill' : 'regular'}
      class={reposted ? 'text-green-500' : 'text-caption'}
    />
    {#if loading}...{:else}{totalReposts}{/if}
  </button>

  {#if showMenu}
    <div
      class="absolute bottom-full left-0 mb-2 bg-input rounded-lg shadow-lg py-1 z-50 min-w-[120px]"
      style="border: 1px solid var(--color-input-border); color: var(--color-text-primary);"
      use:clickOutside
      on:click_outside={() => showMenu = false}
    >
      <button
        on:click={repost}
        class="w-full px-4 py-2 text-left text-sm hover:bg-accent-gray flex items-center gap-2"
      >
        <ArrowsClockwise size={16} class="text-caption" />
        Repost
      </button>
      <button
        on:click={quote}
        class="w-full px-4 py-2 text-left text-sm hover:bg-accent-gray flex items-center gap-2"
      >
        <span>💬</span>
        Quote
      </button>
    </div>
  {/if}
</div>

