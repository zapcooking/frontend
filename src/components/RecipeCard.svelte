<script lang="ts">
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  // Removed unused imports for better performance
  import RecipeErrorBoundary from './RecipeErrorBoundary.svelte';
  import RecipeCardSkeleton from './RecipeCardSkeleton.svelte';

  export let event: NDKEvent;
  export let list = false;

  // Removed debug logging for better performance

  let link = '';
  let imageUrl = '';
  let optimizedImageUrl = '';
  let imageLoaded = false;
  let imageError = false;
  let isLoading = true;

  // Simple reactive computations
  $: {
    if (event) {
      const d = event.tags.find((t) => t[0] == 'd')?.[1];
      if (d) {
        const naddr = nip19.naddrEncode({
          identifier: d,
          kind: event.kind || 0,
          pubkey: event.author?.pubkey || ''
        });
        link = `/${list ? 'list' : 'recipe'}/${naddr}`;
      }
    }
  }

  // Simplified image URL computation
  $: {
    if (event) {
      const rawImageUrl = event.tags.find((e) => e[0] == 'image')?.[1] || '';
      imageUrl = rawImageUrl;
      
      // Use original image URL for faster loading (skip optimization for now)
      optimizedImageUrl = rawImageUrl;
    }
  }

  // Simple title computation
  $: title = event?.tags.find((e) => e[0] == 'title')?.[1] || 
            event?.tags.find((e) => e[0] == 'd')?.[1] || '';

  let imageElement: HTMLElement | null = null;

  // Set loading to false once we have the event data
  $: if (event && isLoading) {
    isLoading = false;
  }

  // Simplified image loading - load immediately when element is available
  $: if (imageElement && optimizedImageUrl && !imageLoaded && !imageError) {
    imageElement.style.backgroundImage = `url('${optimizedImageUrl}')`;
    imageLoaded = true;
  }

  // Removed onMount cleanup since we're not using IntersectionObserver
</script>

<RecipeErrorBoundary>
  {#if isLoading}
    <RecipeCardSkeleton />
  {:else}
    <a
      href={link}
      class="flex flex-col gap-4 w-full max-w-[160px] justify-self-center hover:text-primary transition-colors duration-300"
    >
      <div class="relative image image-placeholder">
        <div
          bind:this={imageElement}
          class="absolute top-0 left-0 bottom-0 right-0 image hover:scale-105 transition-transform duration-700 ease-in-out"
        />
      </div>

      <h5 class="text-md leading-tight text-wrap" style="color: var(--color-text-primary)">
        {title}
      </h5>
    </a>
  {/if}
</RecipeErrorBoundary>

<style lang="postcss">
  @reference "../app.css";
  .image {
    @apply rounded-2xl w-[160px] h-[237px] cursor-pointer relative overflow-hidden object-cover bg-cover bg-center aspect-auto before:animate-pulse;
  }
</style>
