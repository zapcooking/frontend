<script lang="ts">
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import TagLinks from './TagLinks.svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import BookmarkIcon from 'phosphor-svelte/lib/BookmarkSimple';
  import PrinterIcon from 'phosphor-svelte/lib/Printer';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import ShareIcon from 'phosphor-svelte/lib/Share';
  import DotsThreeIcon from 'phosphor-svelte/lib/DotsThree';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import TrashIcon from 'phosphor-svelte/lib/Trash';
  import ShoppingCartIcon from 'phosphor-svelte/lib/ShoppingCart';
  import Button from '../Button.svelte';
  import ShareModal from '../ShareModal.svelte';
  import SaveButton from '../SaveButton.svelte';
  import { translateOption } from '$lib/state';
  import { translate } from '$lib/translation';
  import {
    parseMarkdown,
    extractAndGroupDirections,
    extractRecipeDetails,
    parseMarkdownForEditing
  } from '$lib/parser';
  import { goto } from '$app/navigation';
  import { saveDraft } from '$lib/draftStore';
  import { clickOutside } from '$lib/clickOutside';
  import TotalZaps from './TotalZaps.svelte';
  import OverviewCard from './OverviewCard.svelte';
  import TotalLikes from './TotalLikes.svelte';
  import TotalComments from './TotalComments.svelte';
  import { getPlaceholderImage } from '$lib/placeholderImages';
  import NoteRepost from '../NoteRepost.svelte';
  import Comments from '../Comments.svelte';
  import RecipeReactionPills from './RecipeReactionPills.svelte';
  import TopZappers from './TopZappers.svelte';
  import ZapModal from '../ZapModal.svelte';
  import { requestProvider } from 'webln';
  import { canOneTapZap, sendOneTapZap } from '$lib/oneTapZap';
  import { nip19 } from 'nostr-tools';
  import Modal from '../Modal.svelte';
  import AuthorProfile from '../AuthorProfile.svelte';
  import {
    recipeTags,
    type recipeTagSimple,
    RECIPE_TAGS,
    RECIPE_TAG_PREFIX_NEW
  } from '$lib/consts';
  import { onMount } from 'svelte';
  import { resolveProfileByPubkey } from '$lib/profileResolver';
  import { buildCanonicalRecipeShareUrl } from '$lib/utils/share';
  import DirectionsPhases from './DirectionsPhases.svelte';
  import AddToListModal from '../grocery/AddToListModal.svelte';
  import GatedRecipePayment from '../GatedRecipePayment.svelte';
  import { checkIfGated } from '$lib/nip108/client';
  import type { GatedRecipeMetadata } from '$lib/nip108/types';

  export let event: NDKEvent;
  export let isPremium = false;
  export let naddr: string = '';

  // Compute naddr if not provided
  $: computedNaddr =
    naddr ||
    nip19.naddrEncode({
      identifier: event.replaceableDTag(),
      pubkey: event.pubkey,
      kind: event.kind || 30023
    });
  let zapModal = false;
  let zapRefreshKey = 0;
  let isZapping = false;
  let zapSuccess = false;
  let zapSuccessAmount = 0;
  let shareModal = false;
  let groceryModal = false;
  let menuOpen = false;
  let deleteConfirmOpen = false;
  let isDeleting = false;

  // Check if current user owns this recipe
  $: isOwner = $userPublickey && $userPublickey === event.author.pubkey;

  // Check if this is an actual recipe (has recipe-related tags) vs a general longform article
  // Only recipes should show "Add to Grocery List"
  $: isActualRecipe =
    event &&
    event.tags.some((tag) => tag[0] === 't' && RECIPE_TAGS.includes(tag[1]?.toLowerCase() || ''));

  // Gated recipe state
  let gatedMetadata: GatedRecipeMetadata | null = null;
  let unlockedRecipe: NDKEvent | null = null;
  let checkingGated = true;

  // Track if author has a lightning address (can receive zaps)
  let authorCanReceiveZaps = true; // Default to true while loading
  let authorLightningCheckComplete = false;

  // Construct the canonical recipe URL for sharing (uses short /r/ format)
  $: shareUrl = buildCanonicalRecipeShareUrl(computedNaddr);

  // Get recipe title and image for sharing
  $: recipeTitle =
    event.tags.find((t) => t[0] === 'title')?.[1] ||
    event.tags.find((t) => t[0] === 'd')?.[1] ||
    'Recipe';
  $: recipeImage = event.tags.find((t) => t[0] === 'image')?.[1] || getPlaceholderImage(event.id);

  onMount(async () => {
    // Check if author has a lightning address
    try {
      const profile = await resolveProfileByPubkey(event.author.pubkey, $ndk);
      authorCanReceiveZaps = !!profile?.lud16;
    } catch (error) {
      console.warn('Failed to check author lightning address:', error);
      authorCanReceiveZaps = false;
    }
    authorLightningCheckComplete = true;

    // Check if recipe is gated
    try {
      checkingGated = true;
      const metadata = await checkIfGated(event, $ndk);
      if (metadata) {
        gatedMetadata = metadata;
      }
    } catch (error) {
      console.warn('Failed to check if recipe is gated:', error);
    } finally {
      checkingGated = false;
    }
  });

  function handleUnlocked(recipe: NDKEvent) {
    unlockedRecipe = recipe;
    // Replace the event with unlocked recipe
    event = recipe;
  }

  function handleZapComplete() {
    // Increment key to force TotalZaps to remount and refetch
    zapRefreshKey++;
  }

  async function handleZapClick() {
    if (!authorCanReceiveZaps) return;

    if (canOneTapZap()) {
      isZapping = true;
      try {
        console.log('[Recipe] Sending one-tap zap...');
        const result = await sendOneTapZap(event);
        console.log('[Recipe] One-tap zap result:', result);
        if (result.success) {
          // Show success feedback
          zapSuccessAmount = result.amount || 0;
          zapSuccess = true;
          setTimeout(() => {
            zapSuccess = false;
            handleZapComplete();
          }, 1500);
        } else {
          console.log('[Recipe] One-tap zap failed, opening modal. Error:', result.error);
          zapModal = true;
        }
      } catch (e) {
        console.error('[Recipe] One-tap zap exception:', e);
        zapModal = true;
      } finally {
        isZapping = false;
      }
    } else {
      zapModal = true;
    }
  }

  function handleEdit() {
    menuOpen = false;

    // Extract recipe data from event tags
    const title = event.tagValue('title') || event.tagValue('d') || '';
    const images = event.getMatchingTags('image').map((t) => t[1]) || [];
    const summary = event.tagValue('summary') || '';

    // Extract tags using same approach as TagLinks component
    const dTag = event.tags.find((a) => a[0] === 'd')?.[1];
    const tags: Array<{ title: string; emoji?: string }> = [];
    let nameTagFound = false;

    event.tags.forEach((t) => {
      if (t[0] === 't' && t[1]) {
        const tagValue = t[1];
        const isLegacyPrefix = tagValue.startsWith('nostrcooking-');
        const isNewPrefix = tagValue.startsWith(`${RECIPE_TAG_PREFIX_NEW}-`);

        if ((isLegacyPrefix || isNewPrefix) && !nameTagFound) {
          // First prefixed tag is the name tag - skip it
          const tagName = isNewPrefix
            ? tagValue.slice(RECIPE_TAG_PREFIX_NEW.length + 1)
            : tagValue.slice('nostrcooking-'.length);
          if (tagName === dTag) {
            nameTagFound = true;
          }
        } else if (isLegacyPrefix || isNewPrefix) {
          // Extract actual category tags
          const tagName = isNewPrefix
            ? tagValue.slice(RECIPE_TAG_PREFIX_NEW.length + 1)
            : tagValue.slice('nostrcooking-'.length);

          const matchingTag = recipeTags.find(
            (rt) => rt.title.toLowerCase().replaceAll(' ', '-') === tagName
          );
          if (matchingTag) {
            tags.push(matchingTag);
          } else {
            tags.push({ title: tagName.replaceAll('-', ' ') });
          }
        }
      }
    });

    // Parse markdown content to extract structured data (use lenient parser for editing)
    const info = parseMarkdownForEditing(event.content);

    const draftData = {
      title,
      images,
      tags,
      summary,
      chefsnotes: info.chefNotes || '',
      preptime: info.information?.prepTime || '',
      cooktime: info.information?.cookTime || '',
      servings: info.information?.servings || '',
      ingredients: info.ingredients,
      directions: info.directions,
      additionalMarkdown: info.additionalMarkdown || ''
    };

    const draftId = saveDraft(draftData);
    goto(`/create?draft=${draftId}`);
  }

  async function handleDelete() {
    if (isDeleting) return;
    isDeleting = true;

    try {
      // For addressable events (kind 30023), the most reliable deletion method
      // is to publish a replacement event with the same 'd' tag but marked as deleted.
      // This overwrites the original on relays.
      const deleteEvent = new NDKEvent($ndk);
      deleteEvent.kind = 30023;
      deleteEvent.content = ''; // Empty content

      // Must use the same 'd' tag to replace the original
      const dTag = event.replaceableDTag();
      if (dTag) {
        deleteEvent.tags.push(['d', dTag]);
      }

      // Mark as deleted so clients know to hide it
      deleteEvent.tags.push(['deleted', 'true']);
      deleteEvent.tags.push(['title', '[Deleted]']);

      await deleteEvent.publish();

      // Also publish a kind 5 deletion request for clients that support it
      const deletionRequest = new NDKEvent($ndk);
      deletionRequest.kind = 5;
      deletionRequest.content = 'Recipe deleted by author';
      deletionRequest.tags.push(['e', event.id]);
      if (dTag) {
        deletionRequest.tags.push(['a', `30023:${event.pubkey}:${dTag}`]);
      }
      deletionRequest.tags.push(['k', '30023']);

      await deletionRequest.publish();

      // Navigate away after successful deletion
      goto('/');
    } catch (error) {
      console.error('Failed to delete recipe:', error);
      alert('Failed to delete recipe. Please try again.');
    } finally {
      isDeleting = false;
      deleteConfirmOpen = false;
    }
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
    selectedImageIndex =
      selectedImageIndex === 0 ? selectedEventImages.length - 1 : selectedImageIndex - 1;
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

  // Deduplicate image tags by URL, use placeholder if no images or all images are empty
  $: uniqueImages = (() => {
    const images = event.tags
      .filter((e) => e[0] === 'image' && e[1] && e[1].trim() !== '')
      .filter((img, index, arr) => arr.findIndex((t) => t[1] === img[1]) === index);
    // If no valid images, return a placeholder
    if (images.length === 0) {
      return [['image', getPlaceholderImage(event.id)]];
    }
    return images;
  })();

  // Extract and group directions
  $: directionsData = extractAndGroupDirections(event.content);
  $: directionsPhases = directionsData.directions;
  $: markdownWithoutDirections = directionsData.markdownWithoutDirections;

  // Extract recipe details for Quick Overview
  $: recipeDetails = extractRecipeDetails(event.content);

  // Split markdown into parts: before Directions and after Directions
  // Also remove the Details section since it's now shown in the OverviewCard
  $: {
    const content = event.content;
    const directionsIndex = content.indexOf('## Directions');
    let beforeDirections = '';

    if (directionsIndex === -1) {
      beforeDirections = content;
      markdownAfterDirections = '';
    } else {
      // Find the end of Directions section (next ## heading or end of content)
      const afterDirections = content.slice(directionsIndex);
      // Look for next section heading (## followed by space and non-#)
      const nextSectionMatch = afterDirections.match(/\n## [A-Za-z]/);
      if (nextSectionMatch && nextSectionMatch.index !== undefined) {
        const nextSectionIndex = directionsIndex + nextSectionMatch.index;
        beforeDirections = content.slice(0, directionsIndex);
        markdownAfterDirections = content.slice(nextSectionIndex);
      } else {
        // Directions is the last section
        beforeDirections = content.slice(0, directionsIndex);
        markdownAfterDirections = '';
      }
    }

    // Remove the Details section from the rendered markdown (it's shown in OverviewCard)
    // Match "## Details" followed by content until next "##" heading or end
    const detailsSectionRegex = /## Details\s*\n[\s\S]*?(?=\n## |$)/i;
    if (detailsSectionRegex.test(beforeDirections)) {
      markdownBeforeDirections = beforeDirections.replace(detailsSectionRegex, '').trim();
    } else {
      markdownBeforeDirections = beforeDirections;
    }
  }

  let markdownBeforeDirections = '';
  let markdownAfterDirections = '';
</script>

<svelte:window on:keydown={handleImageModalKeydown} />

<ZapModal bind:open={zapModal} {event} on:zap-complete={handleZapComplete} />

<ShareModal bind:open={shareModal} url={shareUrl} title={recipeTitle} imageUrl={recipeImage} />

<!-- Add to Grocery List Modal -->
<AddToListModal bind:open={groceryModal} recipeEvent={event} />

<!-- Delete Confirmation Modal -->
<Modal bind:open={deleteConfirmOpen} noHeader>
  <div class="flex flex-col gap-3">
    <h2 class="text-xl font-semibold" style="color: var(--color-text-primary);">Delete Recipe?</h2>
    <p class="text-sm" style="color: var(--color-text-secondary);">
      Are you sure you want to delete this recipe? This action cannot be undone.
    </p>
    <div class="flex gap-3 justify-end">
      <Button primary={false} on:click={() => (deleteConfirmOpen = false)}>Cancel</Button>
      <button
        class="text-white rounded-full whitespace-nowrap flex items-center justify-center gap-2 px-4 py-2.5 font-semibold transition duration-300 bg-red-600 hover:bg-red-700 disabled:bg-red-600/50"
        on:click={handleDelete}
        disabled={isDeleting}
      >
        {isDeleting ? 'Deleting...' : 'Delete'}
      </button>
    </div>
  </div>
</Modal>

<article class="max-w-[760px] mx-auto">
  {#if checkingGated}
    <div class="flex items-center justify-center p-8">
      <div class="text-caption">Loading recipe...</div>
    </div>
  {:else if gatedMetadata && !unlockedRecipe}
    <!-- Show gated payment UI -->
    <GatedRecipePayment
      {gatedMetadata}
      gatedNoteId={gatedMetadata.gatedNoteId}
      onUnlocked={handleUnlocked}
    />
  {:else if event}
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
          <!-- First image - clickable to open modal -->
          <div class="rounded-3xl overflow-hidden">
            <button
              on:click={() =>
                openImageModal(
                  image[1],
                  uniqueImages.map((img) => img[1]),
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
          </div>
        {:else}
          <!-- Other images - clickable to open modal -->
          <button
            on:click={() =>
              openImageModal(
                image[1],
                uniqueImages.map((img) => img[1]),
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
        <TopZappers {event} refreshKey={zapRefreshKey} />
        <div class="flex items-center justify-between">
          <div class="flex gap-6">
            <TotalLikes {event} />
            <TotalComments {event} />
            <NoteRepost {event} />
            <button
              class="{authorCanReceiveZaps
                ? 'cursor-pointer'
                : 'cursor-not-allowed opacity-50'} {isZapping ? 'cursor-wait' : ''}"
              on:click={handleZapClick}
              disabled={!authorCanReceiveZaps || isZapping || zapSuccess}
              title={authorCanReceiveZaps ? 'Zap this recipe' : 'Author has no lightning address'}
            >
              {#if isZapping}
                <div class="flex gap-1.5 items-center text-orange-500">
                  <LightningIcon size={24} weight="fill" class="animate-spin" />
                </div>
              {:else if zapSuccess}
                <div class="flex gap-1.5 items-center text-yellow-500 font-medium">
                  <LightningIcon size={24} weight="fill" class="animate-pulse" />
                  +{zapSuccessAmount}
                </div>
              {:else}
                {#key zapRefreshKey}
                  <TotalZaps {event} />
                {/key}
              {/if}
            </button>
          </div>
          <!-- 3-dot menu for recipe actions -->
          <div class="relative">
            <button
              class="cursor-pointer hover:bg-input rounded p-1 transition duration-300"
              on:click={() => (menuOpen = !menuOpen)}
              aria-label="Recipe options"
              title="Options"
            >
              <DotsThreeIcon size={24} weight="bold" class="text-caption" />
            </button>

            {#if menuOpen}
              <div
                use:clickOutside
                on:click_outside={() => (menuOpen = false)}
                class="absolute right-0 top-full mt-2 z-20 rounded-xl shadow-lg py-2 min-w-[200px]"
                style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
              >
                {#if isOwner}
                  <button
                    class="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-accent-gray transition-colors"
                    style="color: var(--color-text-primary);"
                    on:click={handleEdit}
                  >
                    <PencilSimpleIcon size={18} />
                    Edit Recipe
                  </button>
                {/if}
                <button
                  class="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-accent-gray transition-colors"
                  style="color: var(--color-text-primary);"
                  on:click={() => {
                    shareModal = true;
                    menuOpen = false;
                  }}
                >
                  <ShareIcon size={18} />
                  Share
                </button>
                {#if $userPublickey && isActualRecipe}
                  <button
                    class="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-accent-gray transition-colors"
                    style="color: var(--color-text-primary);"
                    on:click={() => {
                      groceryModal = true;
                      menuOpen = false;
                    }}
                  >
                    <ShoppingCartIcon size={20} />
                    Add to Grocery List
                  </button>
                {/if}
                <button
                  class="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-accent-gray transition-colors"
                  style="color: var(--color-text-primary);"
                  on:click={() => {
                    window.print();
                    menuOpen = false;
                  }}
                >
                  <PrinterIcon size={18} />
                  Print
                </button>
                {#if isOwner}
                  <hr class="my-1 border-t" style="border-color: var(--color-input-border);" />
                  <button
                    class="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-red-50 dark:hover:bg-red-950 transition-colors text-red-600 dark:text-red-400"
                    on:click={() => {
                      deleteConfirmOpen = true;
                      menuOpen = false;
                    }}
                  >
                    <TrashIcon size={18} />
                    Delete Recipe
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      </div>

      <!-- Quick Overview Card -->
      <OverviewCard
        prepTime={recipeDetails.prepTime}
        cookTime={recipeDetails.cookTime}
        servings={recipeDetails.servings}
        scrollToDetails={() => {
          // Try to find Details section and scroll to it
          const detailsSection = markdownBeforeDirections.match(/## Details/i);
          if (detailsSection) {
            // Find the element in the rendered markdown (after prose processing)
            setTimeout(() => {
              const headings = document.querySelectorAll('article .prose h2');
              for (const heading of headings) {
                const text = heading.textContent?.trim().toLowerCase();
                if (text === 'details') {
                  heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  break;
                }
              }
            }, 100);
          }
        }}
        scrollToIngredients={() => {
          // Try to find Ingredients section and scroll to it
          setTimeout(() => {
            const headings = document.querySelectorAll('article .prose h2');
            for (const heading of headings) {
              const text = heading.textContent?.trim().toLowerCase();
              if (text === 'ingredients') {
                heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
                break;
              }
            }
          }, 100);
        }}
      />

      <!-- Recipe Summary -->
      {#if event.tags.find((e) => e[0] === 'summary')?.[1]}
        <p class="text-lg text-caption leading-relaxed">
          {event.tags.find((e) => e[0] === 'summary')?.[1]}
        </p>
      {/if}

      <!-- Content before Directions -->
      {#if markdownBeforeDirections}
        <div class="prose">
          {#if $translateOption.lang}
            {#await translate($translateOption, parseMarkdown(markdownBeforeDirections))}
              ...
            {:then result}
              {#if result !== ''}
                {#if result.from.language.iso === $translateOption.lang}
                  {@html parseMarkdown(markdownBeforeDirections)}
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
            {@html parseMarkdown(markdownBeforeDirections)}
          {/if}
        </div>
      {/if}

      <!-- Collapsible Directions -->
      {#if directionsPhases.length > 0}
        <DirectionsPhases phases={directionsPhases} />
      {/if}

      <!-- Content after Directions -->
      {#if markdownAfterDirections}
        <div class="prose">
          {#if $translateOption.lang}
            {#await translate($translateOption, parseMarkdown(markdownAfterDirections))}
              ...
            {:then result}
              {#if result !== ''}
                {#if result.from.language.iso === $translateOption.lang}
                  {@html parseMarkdown(markdownAfterDirections)}
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
            {@html parseMarkdown(markdownAfterDirections)}
          {/if}
        </div>
      {/if}
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
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>

          <!-- Image counter (if multiple images) -->
          {#if selectedEventImages.length > 1}
            <div
              class="absolute top-4 left-4 bg-black/70 text-white text-sm px-4 py-2 rounded-full z-20"
            >
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
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>

            <button
              on:click|stopPropagation={nextModalImage}
              class="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 bg-white/90 hover:bg-white text-gray-800 rounded-full p-3 shadow-md transition z-20 items-center justify-center"
              aria-label="Next image"
            >
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          {/if}

          <!-- Swipe indicator for mobile -->
          {#if selectedEventImages.length > 1}
            <div
              class="md:hidden absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/70 text-white text-xs px-4 py-2 rounded-full z-20"
            >
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
