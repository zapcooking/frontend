<script lang="ts">
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import RecipeErrorBoundary from './RecipeErrorBoundary.svelte';
  import RecipeCardSkeleton from './RecipeCardSkeleton.svelte';
  import { getImageOrPlaceholder } from '$lib/placeholderImages';
  import { lazyLoad } from '$lib/lazyLoad';
  import { hideImagelessRecipesSetting, hasRecipeImage } from '$lib/recipeImageFilterSettings';

  export let event: NDKEvent;
  export let list = false;

  let link = '';
  let imageUrl = '';
  let optimizedImageUrl = '';
  let isLoading = true;
  // Set when the cover image fails to load (or a nostr.build URL turns out to
  // be the CDN's 404 art). Combined with the "hide recipes without images"
  // setting this removes the card from the grid instead of showing a blank
  // tile; with the setting off the usual magnifier placeholder shows.
  let imageBroken = false;

  // With the setting on, cards with no usable image tag never render (Feed
  // filters them too — this keeps RecipeCard safe if reused elsewhere).
  $: hideForMissingImage = $hideImagelessRecipesSetting && !!event && !hasRecipeImage(event);

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

  // Simplified image URL computation with placeholder fallback
  $: {
    if (event) {
      const rawImageUrl = event.tags.find((e) => e[0] == 'image')?.[1] || '';
      // Use placeholder if no image, with event ID as seed for consistency
      imageUrl = getImageOrPlaceholder(rawImageUrl, event.id);

      // Use original image URL for faster loading (skip optimization for now)
      optimizedImageUrl = imageUrl;
    }
  }

  // Simple title computation
  $: title =
    event?.tags.find((e) => e[0] == 'title')?.[1] ||
    event?.tags.find((e) => e[0] == 'd')?.[1] ||
    '';

  // Set loading to false once we have the event data
  $: if (event && isLoading) {
    isLoading = false;
  }
</script>

<RecipeErrorBoundary>
  {#if isLoading}
    <RecipeCardSkeleton />
  {:else if hideForMissingImage || ($hideImagelessRecipesSetting && imageBroken)}
    <!-- Cover missing or failed to load and the member chose to hide
         imageless recipes — render nothing so the grid stays clean. -->
  {:else}
    <a
      href={link}
      class="flex flex-col gap-3 w-full max-w-[160px] min-h-[320px] justify-self-center hover:text-primary transition-colors duration-300"
    >
      <div class="relative image-container image-placeholder">
        <div
          use:lazyLoad={{
            url: optimizedImageUrl,
            onError: () => {
              imageBroken = true;
            }
          }}
          class="absolute inset-0 image hover:scale-105 transition-transform duration-700 ease-in-out"
        />
      </div>

      <h5
        class="text-md leading-tight line-clamp-2 min-h-[2.5rem] flex-shrink-0"
        style="color: var(--color-text-primary)"
      >
        {title}
      </h5>
    </a>
  {/if}
</RecipeErrorBoundary>

<style lang="postcss">
  @reference "../app.css";
  .image-container {
    @apply w-full aspect-[2/3] rounded-2xl overflow-hidden relative;
    min-height: 237px;
    max-height: 237px;
  }
  .image {
    @apply w-full h-full cursor-pointer object-cover bg-cover bg-center;
    opacity: 0;
    transition: opacity 0.3s ease-in;
  }
  .image:global(.image-loaded) {
    opacity: 1;
  }
</style>
