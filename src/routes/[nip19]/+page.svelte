<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { nip19 } from 'nostr-tools';
  import { ndk } from '$lib/nostr';
  import { onMount } from 'svelte';
  import CustomAvatar from '../../components/CustomAvatar.svelte';
  import { formatDistanceToNow } from 'date-fns';
  import NoteContent from '../../components/NoteContent.svelte';
  import NoteTotalLikes from '../../components/NoteTotalLikes.svelte';
  import NoteTotalComments from '../../components/NoteTotalComments.svelte';
  import NoteTotalZaps from '../../components/NoteTotalZaps.svelte';
  import ZapModal from '../../components/ZapModal.svelte';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import type { PageData } from './$types';

  export const data: PageData = {} as PageData;

  let decoded: any = null;
  let event: NDKEvent | null = null;
  let loading = true;
  let error = false;
  let zapModal = false;

  onMount(async () => {
    const nip19Id = $page.params.nip19;
    
    if (!nip19Id) {
      error = true;
      loading = false;
      return;
    }

    // Validate NIP-19 identifier format
    if (nip19Id.length < 8 || !nip19Id.match(/^[a-z0-9]+$/)) {
      console.warn('Invalid NIP-19 identifier format:', nip19Id);
      error = true;
      loading = false;
      return;
    }

    try {
      // Decode the NIP-19 identifier
      decoded = nip19.decode(nip19Id);
      
      if (decoded.type === 'nevent' || decoded.type === 'note') {
        // Fetch the referenced event
        const eventId = decoded.data.id;
        const filter = {
          ids: [eventId]
        };
        
        const subscription = $ndk.subscribe(filter, { closeOnEose: true });
        
        subscription.on('event', (receivedEvent: NDKEvent) => {
          if (!event) {
            event = receivedEvent;
          }
        });
        
        subscription.on('eose', () => {
          if (!event) {
            error = true;
          }
          loading = false;
        });
        
        // Handle timeout
        setTimeout(() => {
          if (loading) {
            error = true;
            loading = false;
          }
        }, 5000);
      } else {
        error = true;
        loading = false;
      }
    } catch (err) {
      console.error('Error decoding NIP-19 identifier:', err);
      error = true;
      loading = false;
    }
  });

  function getDisplayName(event: NDKEvent): string {
    const metadata = event.author?.profile;
    const pubkey = event.author?.hexpubkey;
    if (metadata?.display_name) return String(metadata.display_name);
    if (metadata?.name) return String(metadata.name);
    if (pubkey) return pubkey.slice(0, 8);
    return 'Anonymous';
  }

  function formatTimeAgo(timestamp: number): string {
    return formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true });
  }

  function openZapModal() {
    zapModal = true;
  }
</script>

<svelte:head>
  <title>Referenced Note - zap.cooking</title>
</svelte:head>

<div class="max-w-2xl mx-auto">
  {#if loading}
    <div class="py-12 text-center">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
      <p class="mt-4 text-gray-600">Loading referenced note...</p>
    </div>
  {:else if error}
    <div class="py-12 text-center">
      <div class="max-w-sm mx-auto space-y-6">
        <div class="text-gray-500">
          <svg class="h-12 w-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <p class="text-lg font-medium">Note not found</p>
          <p class="text-sm">The referenced note could not be loaded.</p>
        </div>
        <button 
          on:click={() => goto('/feed')}
          class="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
        >
          Back to Feed
        </button>
      </div>
    </div>
  {:else if event}
    <article class="border-b border-gray-200 py-6">
      <div class="flex space-x-3">
        <!-- Avatar -->
        <div class="flex-shrink-0">
          <CustomAvatar
            className="cursor-pointer"
            pubkey={event.author.hexpubkey}
            size={40}
          />
        </div>

        <!-- Content -->
        <div class="flex-1 min-w-0">
          <!-- Header -->
          <div class="flex items-center space-x-2 mb-2">
            <span class="font-semibold text-sm text-gray-900">
              {getDisplayName(event)}
            </span>
            <span class="text-gray-500 text-sm">·</span>
            <span class="text-gray-500 text-sm">
              {event.created_at ? formatTimeAgo(event.created_at) : 'Unknown time'}
            </span>
          </div>

          <!-- Content -->
          <div class="text-sm leading-relaxed mb-3 text-gray-900">
            <NoteContent content={event.content} />
          </div>

          <!-- Actions: Likes, Comments, Zaps -->
          <div class="flex items-center space-x-4 text-sm text-gray-500">
            <NoteTotalLikes {event} />
            <NoteTotalComments {event} />
            <button 
              class="cursor-pointer hover:bg-input rounded px-0.5 transition duration-300"
              on:click={openZapModal}
            >
              <NoteTotalZaps {event} />
            </button>
          </div>
        </div>
      </div>
    </article>

    <!-- Back to Feed -->
    <div class="py-4 text-center">
      <button 
        on:click={() => goto('/feed')}
        class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
      >
        Back to Feed
      </button>
    </div>
  {/if}
</div>

<!-- Zap Modal -->
{#if zapModal && event}
  <ZapModal 
    event={event} 
    on:close={() => zapModal = false} 
  />
{/if}
