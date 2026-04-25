<script lang="ts">
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import Avatar from './Avatar.svelte';
  import CustomName from './CustomName.svelte';
  import NoteActionBar from './NoteActionBar.svelte';
  import ShareModal from './ShareModal.svelte';
  import BookmarkSimpleIcon from 'phosphor-svelte/lib/BookmarkSimple';
  import ChatTeardropTextIcon from 'phosphor-svelte/lib/ChatTeardropText';
  import ShareIcon from 'phosphor-svelte/lib/Share';
  import { lazyLoad } from '$lib/lazyLoad';
  import { getImageOrPlaceholder } from '$lib/placeholderImages';
  import { savedPacksStore } from '$lib/savedPacksStore';
  import { userPublickey } from '$lib/nostr';
  import { showToast } from '$lib/toast';
  import { goto } from '$app/navigation';

  /**
   * Pack metadata. Either pass a full NDKEvent (after publish) so the
   * action row can target it, or pass plain props for a preview before
   * publish.
   */
  export let event: NDKEvent | null = null;
  export let title: string;
  export let description: string = '';
  export let image: string | undefined = undefined;
  export let creatorPubkey: string = '';
  export let recipeCount: number = 0;
  export let viewUrl: string = '';
  /** Hide the social action row + show a "Preview" badge instead. */
  export let preview: boolean = false;

  let shareModalOpen = false;
  let bookmarkBusy = false;

  $: resolvedImage = getImageOrPlaceholder(image || '', `${creatorPubkey}:${title}`);
  // Live bookmark state — re-evaluates whenever the saved-packs store updates.
  $: isBookmarked = event ? $savedPacksStore.saved.includes(packATag(event)) : false;

  function packATag(e: NDKEvent): string {
    const dTag = e.tags?.find((t) => t[0] === 'd')?.[1] || '';
    return `${e.kind}:${e.pubkey}:${dTag}`;
  }

  async function handleBookmark() {
    if (bookmarkBusy || !event) return;
    if (!$userPublickey) {
      goto('/login?redirect=' + encodeURIComponent(window.location.pathname));
      return;
    }
    bookmarkBusy = true;
    try {
      if (isBookmarked) {
        const ok = await savedPacksStore.unsave(event);
        if (ok) showToast('info', 'Removed from saved packs.');
        else showToast('error', 'Could not update saved packs.');
      } else {
        const ok = await savedPacksStore.save(event);
        if (ok) showToast('success', 'Pack saved.');
        else showToast('error', 'Could not save pack.');
      }
    } finally {
      bookmarkBusy = false;
    }
  }

  // Comments link target — the generic NIP-19 viewer at /<naddr>
  // already supports NIP-22 comments for any addressable kind. Handle
  // both relative ("/pack/<naddr>") and absolute ("https://…/pack/<naddr>")
  // viewUrls that callers may pass.
  $: commentsHref = (() => {
    if (!viewUrl) return '';
    try {
      // Absolute URL — derive the local path then swap /pack/ → /
      if (viewUrl.startsWith('http')) {
        const path = new URL(viewUrl).pathname;
        return path.replace(/^\/pack\//, '/');
      }
    } catch {
      /* fall through */
    }
    return viewUrl.replace(/^\/pack\//, '/');
  })();
</script>

<article
  class="rounded-2xl overflow-hidden flex flex-col"
  style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
>
  <!-- Image is the primary tap target into the pack -->
  <div class="relative w-full aspect-[16/9] pack-image-wrap">
    {#if viewUrl}
      <a href={viewUrl} class="absolute inset-0 group" aria-label={title || 'Open Recipe Pack'}>
        <div
          use:lazyLoad={{ url: resolvedImage }}
          class="absolute inset-0 pack-image group-hover:scale-[1.02] transition-transform duration-500 ease-in-out"
        ></div>
      </a>
    {:else}
      <div use:lazyLoad={{ url: resolvedImage }} class="absolute inset-0 pack-image"></div>
    {/if}

    <!-- Top-left: Recipe Pack badge — non-interactive, sits over the link -->
    <div
      class="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/55 text-white text-xs font-medium backdrop-blur-sm pointer-events-none"
    >
      <BookmarkSimpleIcon size={12} weight="fill" />
      <span>Recipe Pack</span>
    </div>

    <!-- Top-right: bookmark/save (matches recipe-card design language).
         Hidden in preview mode (the modal preview shows a "Preview"
         pill there instead). -->
    {#if preview}
      <div
        class="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-amber-500/90 text-white text-xs font-semibold shadow"
      >
        Preview
      </div>
    {:else if event}
      <button
        type="button"
        on:click|preventDefault|stopPropagation={handleBookmark}
        disabled={bookmarkBusy}
        class="absolute top-3 right-3 w-9 h-9 flex items-center justify-center rounded-full bg-black/55 hover:bg-black/70 backdrop-blur-sm transition-colors disabled:opacity-50"
        class:text-amber-400={isBookmarked}
        style={isBookmarked ? '' : 'color: white;'}
        title={isBookmarked ? 'Remove from saved' : 'Save pack'}
        aria-label={isBookmarked ? 'Remove from saved' : 'Save pack'}
        aria-pressed={isBookmarked}
      >
        <BookmarkSimpleIcon size={18} weight={isBookmarked ? 'fill' : 'regular'} />
      </button>
    {/if}
  </div>

  <div class="p-3 sm:p-4 flex flex-col gap-2">
    <!-- Title (also clickable into pack) -->
    <div>
      {#if viewUrl}
        <a href={viewUrl} class="block hover:opacity-90 transition-opacity">
          <h3
            class="text-base sm:text-lg font-bold leading-snug line-clamp-2"
            style="color: var(--color-text-primary)"
          >
            {title || 'Untitled pack'}
          </h3>
        </a>
      {:else}
        <h3
          class="text-base sm:text-lg font-bold leading-snug line-clamp-2"
          style="color: var(--color-text-primary)"
        >
          {title || 'Untitled pack'}
        </h3>
      {/if}
      {#if description}
        <p class="text-sm text-caption mt-1 line-clamp-2 whitespace-pre-line">{description}</p>
      {/if}
    </div>

    <!-- Creator + recipe count, single row -->
    <div class="flex items-center gap-2 flex-wrap text-sm">
      {#if creatorPubkey}
        <div class="flex items-center gap-2 min-w-0">
          <Avatar pubkey={creatorPubkey} size={22} showRing={false} />
          <span class="truncate text-xs sm:text-sm" style="color: var(--color-text-secondary)">
            <CustomName pubkey={creatorPubkey} />
          </span>
        </div>
        <span class="text-caption text-xs">·</span>
      {/if}
      <span class="text-xs sm:text-sm text-caption">
        {recipeCount} {recipeCount === 1 ? 'recipe' : 'recipes'}
      </span>
    </div>

    <!-- Social action row — only when we have a real published event.
         showComments={false} because NoteTotalComments toggles an inline
         <FeedComments> we don't render here; we surface a separate
         comment link to the generic NIP-19 viewer (which does support
         NIP-22 comments for kind 30004). -->
    {#if !preview && event}
      <!-- Social action row.
           Left:  reactions/repost/zap from NoteActionBar.
           Right: comments + share — these were "View Pack →" before but
           the image/title click already opens the pack, so the space is
           better used for actions. Bookmark lives in the cover top-right
           (matches recipe-card design). -->
      <div
        class="flex items-center justify-between gap-1 pt-1 border-t -mx-3 sm:-mx-4 px-3 sm:px-4 mt-1"
        style="border-color: var(--color-input-border);"
      >
        <div class="pt-2 flex items-center gap-1 flex-wrap">
          <NoteActionBar {event} variant="default" showComments={false} />
        </div>
        <div class="pt-2 flex items-center gap-1">
          {#if commentsHref}
            <a
              href={commentsHref}
              class="flex items-center gap-1 px-1.5 py-1 rounded text-caption hover:bg-accent-gray transition-colors"
              title="Open comments"
              aria-label="Open comments"
            >
              <ChatTeardropTextIcon size={20} />
            </a>
          {/if}
          <button
            type="button"
            on:click={() => (shareModalOpen = true)}
            class="flex items-center gap-1 px-1.5 py-1 rounded text-caption hover:bg-accent-gray transition-colors"
            title="Share"
            aria-label="Share"
          >
            <ShareIcon size={20} />
          </button>
        </div>
      </div>
    {/if}
  </div>
</article>

{#if event && shareModalOpen}
  <ShareModal
    bind:open={shareModalOpen}
    url={viewUrl
      ? viewUrl.startsWith('http')
        ? viewUrl
        : `https://zap.cooking${viewUrl}`
      : ''}
    title={title || 'Recipe Pack'}
    imageUrl={image || ''}
  />
{/if}

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
