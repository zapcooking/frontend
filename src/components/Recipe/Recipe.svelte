<script lang="ts">
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import TagLinks from './TagLinks.svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import BookmarkIcon from 'phosphor-svelte/lib/BookmarkSimple';
  import PrinterIcon from 'phosphor-svelte/lib/Printer';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import ShareIcon from 'phosphor-svelte/lib/Share';
  import Button from '../Button.svelte';
  import ShareModal from '../ShareModal.svelte';
  import SaveButton from '../SaveButton.svelte';
  import { translateOption } from '$lib/state';
  import { translate } from '$lib/translation';
  import { parseMarkdown } from '$lib/parser';
  import TotalZaps from './TotalZaps.svelte';
  import TotalLikes from './TotalLikes.svelte';
  import TotalComments from './TotalComments.svelte';
  import NoteRepost from '../NoteRepost.svelte';
  import Comments from '../Comments.svelte';
  import RecipeReactionPills from './RecipeReactionPills.svelte';
  import TopZappers from './TopZappers.svelte';
  import ZapModal from '../ZapModal.svelte';
  import { requestProvider } from 'webln';
  import { nip19 } from 'nostr-tools';
  import Modal from '../Modal.svelte';
  import AuthorProfile from '../AuthorProfile.svelte';
  import { recipeTags, type recipeTagSimple, RECIPE_TAGS, RECIPE_TAG_PREFIX_NEW } from '$lib/consts';
  import { onMount } from 'svelte';
  import { resolveProfileByPubkey } from '$lib/profileResolver';
  import { buildCanonicalRecipeShareUrl } from '$lib/utils/share';

  export let event: NDKEvent;
  const naddr = nip19.naddrEncode({
    identifier: event.replaceableDTag(),
    pubkey: event.pubkey,
    kind: 30023
  });
  let zapModal = false;
  let zapRefreshKey = 0;
  let shareModal = false;

  // Track if author has a lightning address (can receive zaps)
  let authorCanReceiveZaps = true; // Default to true while loading
  let authorLightningCheckComplete = false;
  
  // Construct the canonical recipe URL for sharing (uses short /r/ format)
  $: shareUrl = buildCanonicalRecipeShareUrl(naddr);
  
  // Get recipe title and image for sharing
  $: recipeTitle = event.tags.find((t) => t[0] === 'title')?.[1] || 
                   event.tags.find((t) => t[0] === 'd')?.[1] || 
                   'Recipe';
  $: recipeImage = event.tags.find((t) => t[0] === 'image')?.[1] || '';

  onMount(async () => {
    // Check if author has a lightning address
    try {
      const profile = await resolveProfileByPubkey(event.author.pubkey, $ndk);
      authorCanReceiveZaps = !!(profile?.lud16);
    } catch (error) {
      console.warn('Failed to check author lightning address:', error);
      authorCanReceiveZaps = false;
    }
    authorLightningCheckComplete = true;
  });

  function handleZapComplete() {
    // Increment key to force TotalZaps to remount and refetch
    zapRefreshKey++;
  }

  // Image modal state
  let imageModalOpen = false;
  let selectedImageUrl = '';
  let selectedEventImages: string[] = [];
  let selectedImageIndex = 0;

  // Touch handling for swipe
  let touchStartX = 0;
  let touchEndX = 0;


  // Image modal functions
  function openImageModal(imageUrl: string, allImages: string[], index: number) {
    selectedImageUrl = imageUrl;
    selectedEventImages = allImages;
    selectedImageIndex = index;
    imageModalOpen = true;
  }

  function closeImageModal() {
    imageModalOpen = false;
    selectedImageUrl = '';
    selectedEventImages = [];
    selectedImageIndex = 0;
  }

  function nextModalImage() {
    if (selectedEventImages.length === 0) return;
    selectedImageIndex = (selectedImageIndex + 1) % selectedEventImages.length;
    selectedImageUrl = selectedEventImages[selectedImageIndex];
  }

  function prevModalImage() {
    if (selectedEventImages.length === 0) return;
    selectedImageIndex = selectedImageIndex === 0
      ? selectedEventImages.length - 1
      : selectedImageIndex - 1;
    selectedImageUrl = selectedEventImages[selectedImageIndex];
  }

  function handleImageModalKeydown(e: KeyboardEvent) {
    if (!imageModalOpen) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      closeImageModal();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      prevModalImage();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      nextModalImage();
    }
  }

  // Touch swipe handling
  function handleTouchStart(e: TouchEvent) {
    touchStartX = e.changedTouches[0].screenX;
  }

  function handleTouchEnd(e: TouchEvent) {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipe();
  }

  function handleSwipe() {
    const swipeThreshold = 50; // Minimum distance for swipe
    const diff = touchStartX - touchEndX;

    if (Math.abs(diff) < swipeThreshold) return;

    if (diff > 0) {
      // Swiped left -> next image
      nextModalImage();
    } else {
      // Swiped right -> previous image
      prevModalImage();
    }
  }

  /*const firstTag = recipeTags.find(
    (e) => e.title.toLowerCase().replaceAll(' ', '-') == event.getMatchingTags("t").filter((t) => t[1].slice(13)[0])[0][1].slice(13)
  );*/

  // Deduplicate image tags by URL
  $: uniqueImages = event.tags
    .filter((e) => e[0] === 'image')
    .filter((img, index, arr) => arr.findIndex((t) => t[1] === img[1]) === index);
</script>

<svelte:window on:keydown={handleImageModalKeydown} />

<ZapModal bind:open={zapModal} event={event} on:zap-complete={handleZapComplete} />

<ShareModal bind:open={shareModal} url={shareUrl} title={recipeTitle} imageUrl={recipeImage} />


<article class="max-w-[760px] mx-auto">
  {#if event}
    <div class="flex flex-col gap-6">
      <div class="flex flex-col gap-4">
        <h1>
          {event.tags.find((e) => e[0] === 'title')?.[1]
            ? event.tags.find((e) => e[0] === 'title')?.[1]
            : event.tags.find((e) => e[0] === 'd')?.[1]}
        </h1>
        <TagLinks {event} />

        <!-- Author + Action Buttons Row -->
        <div class="flex justify-between items-center gap-4">
          <!-- Left: Author Profile -->
          <AuthorProfile pubkey={event.author.pubkey} />

          <!-- Right: Save button -->
          <div class="flex gap-2">
            <SaveButton {event} size="md" variant="primary" />
          </div>
        </div>
      </div>
      {#each uniqueImages as image, i}
        {#if i === 0}
          <!-- First image with hover overlay + click to open modal -->
          <div class="relative group rounded-3xl overflow-hidden">
            <button
              on:click={() => openImageModal(
                image[1],
                uniqueImages.map(img => img[1]),
                i
              )}
              class="w-full cursor-pointer"
            >
              <img
                class="rounded-3xl aspect-video object-cover w-full"
                src={image[1]}
                alt="Recipe image {i + 1}"
              />
            </button>

            <!-- Image overlay button (hover only on desktop) -->
            <div class="absolute inset-0 transition-all duration-300 pointer-events-none">
              <div class="absolute top-4 right-4 opacity-0 lg:group-hover:opacity-100 pointer-events-auto">
                <SaveButton {event} size="md" variant="primary" showText={true} />
              </div>
            </div>
          </div>
        {:else}
          <!-- Other images - clickable to open modal -->
          <button
            on:click={() => openImageModal(
              image[1],
              uniqueImages.map(img => img[1]),
              i
            )}
            class="w-full cursor-pointer"
          >
            <img
              class="rounded-3xl aspect-video object-cover w-full"
              src={image[1]}
              alt="Recipe image {i + 1}"
            />
          </button>
        {/if}
      {/each}
      <!-- Reactions and actions -->
      <div class="flex flex-col gap-1 print:hidden -mt-2">
        <RecipeReactionPills {event} />
        <TopZappers {event} />
        <div class="flex items-center justify-between">
          <div class="flex gap-6">
            <TotalLikes {event} />
            <TotalComments {event} />
            <NoteRepost {event} />
            <button
              class={authorCanReceiveZaps ? "cursor-pointer" : "cursor-not-allowed opacity-50"}
              on:click={() => authorCanReceiveZaps && (zapModal = true)}
              disabled={!authorCanReceiveZaps}
              title={authorCanReceiveZaps ? "Zap this recipe" : "Author has no lightning address"}
            >
              {#key zapRefreshKey}
                <TotalZaps {event} />
              {/key}
            </button>
          </div>
          <div class="flex items-center gap-4">
            <button
              class="cursor-pointer hover:bg-input rounded p-0.5 transition duration-300"
              on:click={() => (shareModal = true)}
              aria-label="Share recipe"
              title="Share recipe"
            >
              <ShareIcon size={24} weight="bold" class="text-caption" />
            </button>
            <button
              class="cursor-pointer hover:bg-input rounded p-0.5 transition duration-300"
              on:click={() => window.print()}
              aria-label="Print recipe"
              title="Print recipe"
            >
              <PrinterIcon size={24} weight="bold" class="text-caption" />
            </button>
          </div>
        </div>
      </div>
      <!-- Recipe Summary -->
      {#if event.tags.find((e) => e[0] === 'summary')?.[1]}
        <p class="text-lg text-caption leading-relaxed">
          {event.tags.find((e) => e[0] === 'summary')?.[1]}
        </p>
      {/if}
      <div class="prose">
        {#if $translateOption.lang}
          {#await translate($translateOption, parseMarkdown(event.content))}
            ...
          {:then result}
            <!-- TODO: clean this up -->
            {#if result !== ''}
              {#if result.from.language.iso === $translateOption.lang}
                {@html parseMarkdown(event.content)}
              {:else}
                <hr />
                <p class="font-medium">
                  Warning: The contents below are translated from <code
                    >{result.from.language.iso}</code
                  >
                  to
                  <code>{$translateOption.lang}</code>
                  <a class="block" href="/settings">open translation setttings</a>
                </p>
                <hr />
                <!-- TODO: FIX SCRIPT INJECTION -->
                {@html result.text}
              {/if}
            {/if}
          {:catch err}
            <p class="font-medium">
              Error loading translation. Error Message: <code>{err}</code>

              <a class="block" href="/settings">open translation setttings</a>
            </p>
          {/await}
        {:else}
          {@html parseMarkdown(event.content)}
        {/if}
      </div>
      <Comments {event} />
    </div>

    <!-- Image Lightbox Modal -->
    {#if imageModalOpen}
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-90 p-4"
        on:click={closeImageModal}
        on:touchstart={handleTouchStart}
        on:touchend={handleTouchEnd}
        role="dialog"
        aria-modal="true"
      >
        <!-- Modal Container -->
        <div
          class="relative bg-black rounded-lg max-w-6xl max-h-[95vh] w-full overflow-hidden"
          on:click|stopPropagation
        >
          <!-- Close button -->
          <button
            class="absolute top-4 right-4 bg-white/90 hover:bg-white text-gray-800 rounded-full p-2 shadow-md transition z-20"
            on:click={closeImageModal}
            aria-label="Close image"
          >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <!-- Image counter (if multiple images) -->
          {#if selectedEventImages.length > 1}
            <div class="absolute top-4 left-4 bg-black/70 text-white text-sm px-4 py-2 rounded-full z-20">
              {selectedImageIndex + 1} / {selectedEventImages.length}
            </div>
          {/if}

          <!-- Navigation buttons (if multiple images) - Desktop -->
          {#if selectedEventImages.length > 1}
            <button
              on:click|stopPropagation={prevModalImage}
              class="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 bg-white/90 hover:bg-white text-gray-800 rounded-full p-3 shadow-md transition z-20 items-center justify-center"
              aria-label="Previous image"
            >
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <button
              on:click|stopPropagation={nextModalImage}
              class="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 bg-white/90 hover:bg-white text-gray-800 rounded-full p-3 shadow-md transition z-20 items-center justify-center"
              aria-label="Next image"
            >
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          {/if}

          <!-- Swipe indicator for mobile -->
          {#if selectedEventImages.length > 1}
            <div class="md:hidden absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/70 text-white text-xs px-4 py-2 rounded-full z-20">
              Swipe to navigate
            </div>
          {/if}

          <!-- Image -->
          <img
            src={selectedImageUrl}
            alt="Recipe image {selectedImageIndex + 1}"
            class="w-full h-auto max-h-[95vh] object-contain"
          />
        </div>
      </div>
    {/if}
  {:else}
    Loading...
  {/if}
</article>

<style>
  /* Dark mode support for prose content */
  :global(.prose) {
    color: var(--color-text-primary);
  }

  :global(.prose h1),
  :global(.prose h2),
  :global(.prose h3),
  :global(.prose h4),
  :global(.prose h5),
  :global(.prose h6) {
    color: var(--color-text-primary);
  }

  :global(.prose p),
  :global(.prose li),
  :global(.prose td),
  :global(.prose th) {
    color: var(--color-text-primary);
  }

  :global(.prose strong) {
    color: var(--color-text-primary);
  }

  :global(.prose code) {
    color: var(--color-text-primary);
    background-color: var(--color-input-bg);
  }

  :global(.prose pre) {
    background-color: var(--color-input-bg);
    color: var(--color-text-primary);
  }

  :global(.prose blockquote) {
    color: var(--color-text-secondary);
    border-left-color: var(--color-input-border);
  }

  :global(.prose hr) {
    border-color: var(--color-input-border);
  }

  :global(.prose a) {
    color: var(--color-primary);
  }

  :global(.prose table) {
    color: var(--color-text-primary);
  }

  :global(.prose thead) {
    border-bottom-color: var(--color-input-border);
  }

  :global(.prose tbody tr) {
    border-bottom-color: var(--color-input-border);
  }
</style>
