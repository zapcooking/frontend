<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { addClientTagToEvent } from '$lib/nip89';
  import ArrowsClockwise from 'phosphor-svelte/lib/ArrowsClockwise';
  import { clickOutside } from '$lib/clickOutside';
  import { getEngagementStore, fetchEngagement } from '$lib/engagementCache';
  import { openComposerWithQuote } from '$lib/postComposerStore';

  export let event: NDKEvent;
  
  const store = getEngagementStore(event.id);
  let showMenu = false;

  onMount(() => {
    // Always fetch engagement data - fetchEngagement will check cache freshness
    // Batch fetch may be in progress, but individual fetch ensures counts load
    fetchEngagement($ndk, event.id, $userPublickey);
  });

  async function repost() {
    showMenu = false;
    
    if ($store.reposts.userReposted) {
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

      // Optimistic update
      store.update(s => ({
        ...s,
        reposts: { count: s.reposts.count + 1, userReposted: true }
      }));

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

      await repostEvent.publish();
      console.log('Successfully reposted');

    } catch (error) {
      console.error('Error reposting:', error);
      // Revert optimistic update
      store.update(s => ({
        ...s,
        reposts: { count: s.reposts.count - 1, userReposted: false }
      }));
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
    
    // Open the post composer modal with the quoted note
    openComposerWithQuote(nevent, event);
    
    // Also dispatch event for inline composer compatibility
    window.dispatchEvent(new CustomEvent('quote-note', { 
      detail: { nevent, event } 
    }));
  }
</script>

<div class="relative">
  <button
    on:click={() => showMenu = !showMenu}
    class="flex items-center gap-1.5 hover:bg-input rounded px-0.5 transition duration-300 cursor-pointer"
    class:opacity-50={!$userPublickey}
    title={!$userPublickey ? 'Login to repost' : $store.reposts.userReposted ? 'You reposted this' : 'Repost'}
  >
    <ArrowsClockwise
      size={24}
      weight={$store.reposts.userReposted ? 'fill' : 'regular'}
      class={$store.reposts.userReposted ? 'text-green-500' : 'text-caption'}
    />
    <span class="text-caption">
      {#if $store.loading}–{:else}{$store.reposts.count}{/if}
    </span>
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
