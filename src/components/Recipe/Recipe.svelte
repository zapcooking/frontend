<script lang="ts">
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import TagLinks from './TagLinks.svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import DotsIcon from 'phosphor-svelte/lib/DotsThree';
  import PencilIcon from 'phosphor-svelte/lib/Pencil';
  import BookmarkIcon from 'phosphor-svelte/lib/BookmarkSimple';
  import PrinterIcon from 'phosphor-svelte/lib/Printer';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import Button from '../Button.svelte';
  import { translateOption } from '$lib/state';
  import { translate } from '$lib/translation';
  import { parseMarkdown } from '$lib/pharser';
  import TotalZaps from './TotalZaps.svelte';
  import TotalLikes from './TotalLikes.svelte';
  import TotalComments from './TotalComments.svelte';
  import Comments from '../Comments.svelte';
  import ZapModal from '../ZapModal.svelte';
  import { requestProvider } from 'webln';
  import { nip19 } from 'nostr-tools';
  import Modal from '../Modal.svelte';
  import { clickOutside } from '$lib/clickOutside';
  import AuthorProfile from '../AuthorProfile.svelte';
  import { fade } from 'svelte/transition';
  import { recipeTags, type recipeTagSimple } from '$lib/consts';

  export let event: NDKEvent;
  const naddr = nip19.naddrEncode({
    identifier: event.replaceableDTag(),
    pubkey: event.pubkey,
    kind: 30023
  });
  let zapModal = false;
  let bookmarkModal = false;
  let dropdownActive = false;

  // Image modal state
  let imageModalOpen = false;
  let selectedImageUrl = '';
  let selectedEventImages: string[] = [];
  let selectedImageIndex = 0;

  // Touch handling for swipe
  let touchStartX = 0;
  let touchEndX = 0;

let listsArr: NDKEvent[] = [];
async function getLists(): Promise<NDKEvent[]> {
  return new Promise((resolve) => {
    const sub = $ndk.subscribe([
      {
        authors: [$userPublickey],
        limit: 256,
        kinds: [30001],
        '#t': ['nostrcooking']
      },
      {
        '#d': ['nostrcooking-bookmarks'],
        authors: [$userPublickey],
        kinds: [30001]
      }
    ]);

    sub.on('event', (event: NDKEvent) => {
      listsArr.push(event);
    });

    sub.on('eose', () => {
      listsArr.sort((a, b) => {
        if (a.replaceableDTag() == 'nostrcooking-bookmarks') return -1;
        if (b.replaceableDTag() == 'nostrcooking-bookmarks') return 1;
        return a.replaceableDTag().localeCompare(b.replaceableDTag());
      });
      resolve(listsArr);
    });
  });
}

  // If a list's d id is found here, then modifyLists will make the inverse change to what's there currently.
  let toggleLists: Set<string> = new Set();
  let eventsToPublish: NDKEvent[] = [];
  async function modifyLists() {
    const toggleListArr = Array.from(toggleLists);
    for (let i = 0; i < toggleListArr.length; i++) {
      const currentList = listsArr.find((e) => e.replaceableDTag() === toggleListArr[i]);
      if (!currentList) break;
      let newEvents = currentList.getMatchingTags('a');
      const nevent = new NDKEvent($ndk);
      nevent.kind = 30001;
      if (toggleListArr[i] !== 'nostrcooking-bookmarks') nevent.tags.push(['t', 'nostrcooking']);
      nevent.tags.push(['d', toggleListArr[i]]);
      nevent.tags.push(['title', currentList.getMatchingTags('title')[0][1]]);
      const summary = currentList.getMatchingTags('summary');
      if (summary.length > 0) {
        nevent.tags.push(['summary', summary[0][1]]);
      }
      const image = currentList.getMatchingTags('image');
      if (image.length > 0) {
        nevent.tags.push(['image', image[0][1]]);
      }
      if (
        newEvents.find(
          (t) => t[1] === `${event.kind}:${event.author.pubkey}:${event.replaceableDTag()}`
        )
      ) {
        newEvents.forEach((e) => {
          if (e[1] === `${event.kind}:${event.author.pubkey}:${event.replaceableDTag()}`) return;
          nevent.tags.push(['a', e[1]]);
        });
      } else {
        nevent.tags.push(['a', `${event.kind}:${event.author.pubkey}:${event.replaceableDTag()}`]);
        newEvents.forEach((e) => {
          nevent.tags.push(['a', e[1]]);
        });
      }
      eventsToPublish.push(nevent);
    }

    for (let i = 0; i < eventsToPublish.length; i++) {
      await eventsToPublish[i].publish();
    }
    // clear for next time
    cleanUpBookmarksModal();
  }

  function cleanUpBookmarksModal() {
    listsArr = [];
    toggleLists.clear();
    eventsToPublish = [];
    bookmarkModal = false;
  }
  function toggleList(id: string) {
    if (toggleLists.has(id)) toggleLists.delete(id);
    else toggleLists.add(id);
  }

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
</script>

<svelte:window on:keydown={handleImageModalKeydown} />

<ZapModal bind:open={zapModal} event={event} />

<Modal cleanup={cleanUpBookmarksModal} open={bookmarkModal}>
  <h1 slot="title">Save Recipe</h1>
  <div class="print:hidden">
    {#if $userPublickey}
      {#await getLists()}
        Loading your Lists...
      {:then lists}
        <div class="flex flex-col gap-2">
          {#each lists as list, index}
            <div class="flex gap-14 w-full">
              <p class="font-semibold">{list.getMatchingTags('title')[0][1]}</p>
              <input
                class="self-center"
                type="checkbox"
                on:change={() => toggleList(list.replaceableDTag())}
                checked={list
                  .getMatchingTags('a')
                  .find(
                    (t) =>
                      t[1] === `${event.kind}:${event.author.pubkey}:${event.replaceableDTag()}`
                  )
                  ? true
                  : false}
              />
            </div>
            {#if index === 0}
              <hr />
            {/if}
          {/each}
        </div>
      {:catch error}
        An error occurred {error.messsage}
      {/await}
    {:else}
      <a class="underline" href="/login">You must login to add to your bookmarks.</a>
    {/if}
  </div>
  <div class="flex">
    <a href="/list/create" target="_blank" class="text-sm underline grow self-center"
      >Create a New List</a
    >
    <Button
      class="flex"
      on:click={async () => {
        await modifyLists();
        bookmarkModal = false;
      }}>Save</Button
    >
  </div>
</Modal>

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

          <!-- Right: Icon-only Zap/Save buttons -->
          <div class="flex gap-2">
            <button
              on:click={() => (zapModal = true)}
              class="w-10 h-10 flex items-center justify-center rounded-full bg-yellow-500 hover:bg-yellow-600 text-white transition duration-200"
              aria-label="Zap recipe"
            >
              <LightningIcon size={20} weight="fill" />
            </button>

            <button
              on:click={() => (bookmarkModal = true)}
              class="w-10 h-10 flex items-center justify-center rounded-full bg-primary hover:bg-primary/90 text-white transition duration-200"
              aria-label="Save recipe"
            >
              <BookmarkIcon size={20} weight="fill" />
            </button>
          </div>
        </div>
      </div>
      {#each event.tags.filter((e) => e[0] === 'image') as image, i}
        {#if i === 0}
          <!-- First image with hover overlay + click to open modal -->
          <div class="relative group rounded-3xl overflow-hidden">
            <button
              on:click={() => openImageModal(
                image[1],
                event.tags.filter((e) => e[0] === 'image').map(img => img[1]),
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

            <!-- Image overlay buttons (hover only on desktop) -->
            <div class="absolute inset-0 transition-all duration-300 pointer-events-none">
              <button
                class="absolute top-4 left-4 bg-yellow-500 text-white font-semibold px-4 py-2 rounded-full shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 opacity-0 lg:group-hover:opacity-100 pointer-events-auto flex items-center gap-2"
                on:click|stopPropagation={() => (zapModal = true)}
                aria-label="Zap recipe"
              >
                <LightningIcon size={18} weight="fill" />
                <span>Zap</span>
              </button>

              <button
                class="absolute top-4 right-4 bg-primary text-white font-semibold px-4 py-2 rounded-full shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 opacity-0 lg:group-hover:opacity-100 pointer-events-auto flex items-center gap-2"
                on:click|stopPropagation={() => (bookmarkModal = true)}
                aria-label="Save recipe to list"
              >
                <BookmarkIcon size={18} weight="fill" />
                <span>Save</span>
              </button>
            </div>
          </div>
        {:else}
          <!-- Other images - clickable to open modal -->
          <button
            on:click={() => openImageModal(
              image[1],
              event.tags.filter((e) => e[0] === 'image').map(img => img[1]),
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
      <div class="flex print:hidden">
        <div class="flex gap-6 grow">
          <TotalLikes {event} />
          <TotalComments {event} />
          <button class="cursor-pointer" on:click={() => (zapModal = true)}>
            <TotalZaps {event} />
          </button>
        </div>
        <button
          class="cursor-pointer hover:bg-input rounded p-0.5 transition duration-300"
          on:click={() => (dropdownActive = !dropdownActive)}
        >
          <DotsIcon size={28} weight="bold" />
        </button>
        {#if dropdownActive}
          <div class="relative" tabindex="-1" transition:fade={{ delay: 0, duration: 150 }}>
            <div
              role="menu"
              use:clickOutside
              on:click_outside={() => (dropdownActive = false)}
              class="flex flex-col right-0 gap-4 absolute z-20 bg-white rounded-3xl drop-shadow px-5 py-6 my-6"
            >
              {#if event.author?.pubkey === $userPublickey}
                <a class="flex gap-2 cursor-pointer" href="/fork/{naddr}">
                  <PencilIcon size={24} />
                  Edit
                </a>
              {/if}
              <button class="flex gap-2 cursor-pointer" on:click={() => window.print()}>
                <PrinterIcon size={24} />
                Print
              </button>
            </div>
          </div>
        {/if}
      </div>
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
      <div class="flex flex-col items-center gap-4 bg-input py-6 rounded-3xl print:hidden">
        <h2>Enjoy this recipe?</h2>
        <Button on:click={() => (zapModal = true)}>Zap it</Button>
      </div>
      <!--
      <div class="flex flex-col gap-4">
        {firstTag}
        <h2>More {firstTag[1].split("nostrcooking-")[1]}</h2>
      </div>
      -->
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
