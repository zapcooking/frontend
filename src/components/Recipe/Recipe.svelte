<script lang="ts">
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import TagLinks from './TagLinks.svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import PencilIcon from 'phosphor-svelte/lib/Pencil';
  import BookmarkIcon from 'phosphor-svelte/lib/BookmarkSimple';
  import PrinterIcon from 'phosphor-svelte/lib/Printer';
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
  import AuthorProfile from '../AuthorProfile.svelte';
  import { recipeTags, type recipeTagSimple } from '$lib/consts';

  export let event: NDKEvent;
  const naddr = nip19.naddrEncode({
    identifier: event.replaceableDTag(),
    pubkey: event.pubkey,
    kind: 30023
  });
  let zapModal = false;
  let bookmarkModal = false;

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

  /*const firstTag = recipeTags.find(
    (e) => e.title.toLowerCase().replaceAll(' ', '-') == event.getMatchingTags("t").filter((t) => t[1].slice(13)[0])[0][1].slice(13)
  );*/
</script>

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
        <AuthorProfile pubkey={event.author.pubkey} />
      </div>
      {#each event.tags.filter((e) => e[0] === 'image') as image, i}
        {#if i === 0}
          <!-- First image with Pinterest-style hover Save button -->
          <div class="relative rounded-3xl overflow-hidden group w-full">
            <img
              class="aspect-video object-cover w-full block"
              src={image[1]}
              alt="Image {i + 1}"
            />
            <!-- Hover overlay with Save button -->
            <div class="absolute inset-0 transition-all duration-300 pointer-events-none">
              <button
                class="absolute top-4 right-4 bg-primary text-white font-semibold px-4 py-2 rounded-full shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 opacity-0 group-hover:opacity-100 pointer-events-auto flex items-center gap-2"
                on:click={() => (bookmarkModal = true)}
                aria-label="Save recipe to list"
              >
                <BookmarkIcon size={18} weight="fill" />
                <span>Save</span>
              </button>
            </div>
          </div>
        {:else}
          <!-- Other images without overlay -->
          <img
            class="rounded-3xl aspect-video object-cover"
            src={image[1]}
            alt="Image {i + 1}"
          />
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
        <div class="flex gap-2 sm:gap-4">
          {#if event.author?.pubkey === $userPublickey}
            <a
              href="/fork/{naddr}"
              class="hover:bg-input rounded p-1.5 transition duration-300 cursor-pointer"
              title="Edit recipe"
              aria-label="Edit recipe"
            >
              <PencilIcon size={24} />
            </a>
          {/if}
          <button
            class="hover:bg-input rounded p-1.5 transition duration-300 cursor-pointer"
            on:click={() => window.print()}
            title="Print recipe"
            aria-label="Print recipe"
          >
            <PrinterIcon size={24} />
          </button>
        </div>
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
  {:else}
    Loading...
  {/if}
</article>
