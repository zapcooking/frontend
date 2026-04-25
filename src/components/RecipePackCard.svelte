<script lang="ts">
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import Avatar from './Avatar.svelte';
  import CustomName from './CustomName.svelte';
  import ZapButton from './ZapButton.svelte';
  import BookmarkIcon from 'phosphor-svelte/lib/BookmarkSimple';
  import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRight';
  import { lazyLoad } from '$lib/lazyLoad';
  import { getImageOrPlaceholder } from '$lib/placeholderImages';

  /**
   * Pack metadata. Either pass a full NDKEvent (after publish) so the
   * Zap button can target it, or pass plain props for a preview before
   * publish.
   */
  export let event: NDKEvent | null = null;
  export let title: string;
  export let description: string = '';
  export let image: string | undefined = undefined;
  export let creatorPubkey: string = '';
  export let recipeCount: number = 0;
  export let viewUrl: string = '';
  export let preview: boolean = false; // true → hide Zap/View, show "Preview" badge

  $: resolvedImage = getImageOrPlaceholder(image || '', `${creatorPubkey}:${title}`);
</script>

<article
  class="rounded-2xl overflow-hidden flex flex-col"
  style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
>
  <div class="relative w-full aspect-[16/9] pack-image-wrap">
    <div
      use:lazyLoad={{ url: resolvedImage }}
      class="absolute inset-0 pack-image"
    ></div>
    <div class="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/55 text-white text-xs font-medium backdrop-blur-sm">
      <BookmarkIcon size={12} weight="fill" />
      <span>Recipe Pack</span>
    </div>
    {#if preview}
      <div class="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-amber-500/90 text-white text-xs font-semibold shadow">
        Preview
      </div>
    {/if}
  </div>

  <div class="p-4 flex flex-col gap-3">
    <div>
      <h3
        class="text-lg sm:text-xl font-bold leading-snug line-clamp-2"
        style="color: var(--color-text-primary)"
      >
        {title || 'Untitled pack'}
      </h3>
      {#if description}
        <p class="text-sm text-caption mt-1 line-clamp-3 whitespace-pre-line">{description}</p>
      {/if}
    </div>

    <div class="flex items-center gap-2 flex-wrap">
      {#if creatorPubkey}
        <div class="flex items-center gap-2 min-w-0">
          <Avatar pubkey={creatorPubkey} size={28} showRing={false} />
          <span class="text-sm truncate" style="color: var(--color-text-secondary)">
            <CustomName pubkey={creatorPubkey} />
          </span>
        </div>
        <span class="text-caption text-xs">·</span>
      {/if}
      <span class="text-sm text-caption">
        {recipeCount} {recipeCount === 1 ? 'recipe' : 'recipes'}
      </span>
    </div>

    {#if !preview}
      <div class="flex items-center gap-2 pt-1">
        {#if event}
          <ZapButton {event} variant="default" size="sm" />
        {/if}
        {#if viewUrl}
          <a
            href={viewUrl}
            class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
            style="background-color: var(--color-bg-secondary); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
          >
            <span>View</span>
            <ArrowRightIcon size={14} weight="bold" />
          </a>
        {/if}
      </div>
    {/if}
  </div>
</article>

<style>
  .pack-image-wrap {
    background-color: var(--color-accent-gray);
  }
  .pack-image {
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    opacity: 0;
    transition: opacity 0.3s ease-in;
  }
  .pack-image:global(.image-loaded) {
    opacity: 1;
  }
</style>
