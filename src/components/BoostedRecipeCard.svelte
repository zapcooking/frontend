<script lang="ts">
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import Avatar from './Avatar.svelte';
  import { goto } from '$app/navigation';
  import { getImageOrPlaceholder } from '$lib/placeholderImages';
  import { lazyLoad } from '$lib/lazyLoad';

  // Accept either an NDKEvent or pre-resolved props
  export let event: NDKEvent | null = null;
  export let naddr: string = '';
  export let title: string = '';
  export let imageUrl: string = '';
  export let authorPubkey: string = '';

  let resolvedImageUrl = '';
  let resolvedTitle = '';
  let resolvedLink = '';
  let resolvedAuthorPubkey: string | null = null;

  $: {
    if (event && event.tags) {
      // Derive from NDKEvent (same logic as TrendingRecipeCard)
      const d = event.tags.find((t) => Array.isArray(t) && t[0] == 'd')?.[1];
      if (d && event.author?.pubkey) {
        try {
          const encoded = nip19.naddrEncode({
            identifier: d,
            kind: event.kind || 30023,
            pubkey: event.author.pubkey
          });
          resolvedLink = `/recipe/${encoded}`;
        } catch (e) {
          console.warn('Failed to encode naddr:', e);
        }
      }

      const rawImage = event.tags.find((e) => Array.isArray(e) && e[0] == 'image')?.[1] || '';
      resolvedImageUrl = getImageOrPlaceholder(rawImage, event.id);
      resolvedTitle =
        event.tags.find((e) => Array.isArray(e) && e[0] == 'title')?.[1] ||
        event.tags.find((e) => Array.isArray(e) && e[0] == 'd')?.[1] ||
        'Untitled Recipe';
      resolvedAuthorPubkey = event.author?.pubkey || null;
    } else if (naddr) {
      // Use pre-resolved props
      resolvedLink = `/recipe/${naddr}`;
      resolvedImageUrl = getImageOrPlaceholder(imageUrl, naddr);
      resolvedTitle = title || 'Untitled Recipe';
      resolvedAuthorPubkey = authorPubkey || null;
    }
  }

  function handleClick() {
    if (resolvedLink) {
      goto(resolvedLink);
    }
  }
</script>

{#if resolvedLink}
  <button
    on:click={handleClick}
    type="button"
    class="flex-shrink-0 w-56 h-72 rounded-xl overflow-hidden relative group cursor-pointer transition-transform duration-200 hover:scale-[1.02]"
  >
    <!-- Recipe Image -->
    <div
      class="absolute inset-0 boosted-image"
      use:lazyLoad={{ url: resolvedImageUrl }}
    >
      <div class="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors"></div>
    </div>

    <!-- Boosted Badge -->
    <div class="absolute top-3 right-3 z-10">
      <span class="boosted-badge">Boosted</span>
    </div>

    <!-- Author Avatar Overlay -->
    {#if resolvedAuthorPubkey}
      <div class="absolute top-3 left-3">
        <Avatar pubkey={resolvedAuthorPubkey} size={32} className="ring-2 ring-white" />
      </div>
    {/if}

    <!-- Content -->
    <div
      class="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/80 via-black/60 to-transparent"
    >
      <h3 class="!text-white font-semibold text-sm line-clamp-2">{resolvedTitle}</h3>
    </div>
  </button>
{/if}

<style>
  .boosted-image {
    background-size: cover;
    background-position: center;
    opacity: 0;
    transition: opacity 0.3s ease-in;
  }
  .boosted-image:global(.image-loaded) {
    opacity: 1;
  }

  .boosted-badge {
    display: inline-flex;
    align-items: center;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 2px 8px;
    border-radius: 9999px;
    background: rgba(245, 158, 11, 0.9);
    color: white;
    backdrop-filter: blur(4px);
  }
</style>
