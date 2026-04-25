<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { get } from 'svelte/store';
  import { onMount } from 'svelte';
  import type { PageData } from './$types';

  // SSR-resolved OG metadata. Always present; falls back to safe
  // branded defaults when the pack can't be loaded server-side.
  // Used to populate <meta> tags so social/Nostr share previews
  // render before client-side data arrives.
  export let data: PageData = {
    ogMeta: {
      title: 'Recipe Pack on Zap Cooking',
      description: 'A zappable recipe collection curated on Zap Cooking.',
      image: 'https://zap.cooking/social-share.png',
      url: ''
    },
    naddr: ''
  } as unknown as PageData;

  import PanLoader from '../../../components/PanLoader.svelte';
  import NoteActionBar from '../../../components/NoteActionBar.svelte';
  import Avatar from '../../../components/Avatar.svelte';
  import CustomName from '../../../components/CustomName.svelte';
  import ShareModal from '../../../components/ShareModal.svelte';
  import { showToast } from '$lib/toast';
  import { lazyLoad } from '$lib/lazyLoad';
  import { getImageOrPlaceholder } from '$lib/placeholderImages';
  import { offlineStorage } from '$lib/offlineStorage';
  import { isOnline } from '$lib/connectionMonitor';
  import { cookbookStore, cookbookLists } from '$lib/stores/cookbookStore';
  import { buildPackUrl } from '$lib/recipePack';

  import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeft';
  import BookmarkIcon from 'phosphor-svelte/lib/BookmarkSimple';
  import BookmarkSimpleIcon from 'phosphor-svelte/lib/BookmarkSimple';
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';
  import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotch';
  import ChatTeardropTextIcon from 'phosphor-svelte/lib/ChatTeardropText';
  import LinkIcon from 'phosphor-svelte/lib/LinkSimple';
  import WarningIcon from 'phosphor-svelte/lib/Warning';

  let loaded = false;
  let notFound = false;
  let packEvent: NDKEvent | null = null;
  let recipeEvents: NDKEvent[] = [];
  let isImporting = false;
  let importProgress = { current: 0, total: 0 };
  let lastSlug: string | null = null;

  // Derived metadata
  $: title = packEvent?.tags.find((t) => t[0] === 'title')?.[1] || 'Recipe Pack';
  $: description = packEvent?.tags.find((t) => t[0] === 'description')?.[1] || '';
  $: image = packEvent?.tags.find((t) => t[0] === 'image')?.[1];
  $: creatorPubkey = packEvent?.pubkey || '';
  $: aTags = packEvent?.tags.filter((t) => t[0] === 'a').map((t) => t[1]) || [];
  $: recipeCount = aTags.length;
  $: viewUrl = $page.params.naddr ? buildPackUrl($page.params.naddr) : '';

  // SSR data already provides safe-fallback ogMeta. Once the client
  // resolves the pack we may have a richer title/description, so
  // prefer the fresh values when available, falling back to the SSR
  // defaults (which is what scrapers will see).
  $: ogMeta = packEvent
    ? {
        title: `${title} — Recipe Pack on Zap Cooking`,
        description:
          description ||
          `A curated Recipe Pack with ${recipeCount} ${recipeCount === 1 ? 'recipe' : 'recipes'}.`,
        image: data?.ogMeta?.image || 'https://zap.cooking/social-share.png',
        url: data?.ogMeta?.url || ''
      }
    : data?.ogMeta || null;

  $: if (browser && $page.params.naddr && $page.params.naddr !== lastSlug) {
    lastSlug = $page.params.naddr;
    loadPack();
  }

  async function loadPack() {
    loaded = false;
    notFound = false;
    packEvent = null;
    recipeEvents = [];

    const slug = $page.params.naddr;
    if (!slug?.startsWith('naddr1')) {
      notFound = true;
      loaded = true;
      return;
    }

    let pointer: nip19.AddressPointer;
    try {
      const decoded = nip19.decode(slug);
      if (decoded.type !== 'naddr') throw new Error('not naddr');
      pointer = decoded.data as nip19.AddressPointer;
    } catch {
      notFound = true;
      loaded = true;
      return;
    }

    try {
      const fetchPromise = $ndk.fetchEvent({
        kinds: [pointer.kind],
        authors: [pointer.pubkey],
        '#d': [pointer.identifier]
      });
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 12000));
      const found = (await Promise.race([fetchPromise, timeout])) as NDKEvent | null;

      if (!found) {
        notFound = true;
        loaded = true;
        return;
      }
      packEvent = found;
      const tags = found.tags.filter((t) => t[0] === 'a').map((t) => t[1]);
      loaded = true; // header can render now
      await resolveRecipes(tags);
    } catch (err) {
      console.error('[pack] load failed', err);
      notFound = true;
      loaded = true;
    }
  }

  async function resolveRecipes(aTags: string[]) {
    if (aTags.length === 0) return;
    // Cache-first
    try {
      const cached = await offlineStorage.getRecipes(aTags);
      const cachedById = new Map(cached.map((c) => [c.id, c]));
      const found: NDKEvent[] = [];
      for (const aTag of aTags) {
        const c = cachedById.get(aTag);
        if (!c) continue;
        const fake = new NDKEvent($ndk);
        fake.kind = c.eventKind;
        fake.pubkey = c.authorPubkey;
        fake.created_at = c.createdAt;
        fake.content = c.content;
        fake.tags = c.eventTags;
        fake.id = c.id;
        found.push(fake);
      }
      recipeEvents = found;
    } catch {
      /* empty cache is fine */
    }

    if (!$isOnline) return;

    // Fetch any missing
    const haveIds = new Set(recipeEvents.map((e) => e.id));
    const missing = aTags.filter((a) => !haveIds.has(a));
    if (missing.length === 0) return;

    await Promise.all(
      missing.map(async (aTag) => {
        const parts = aTag.split(':');
        if (parts.length !== 3) return;
        const [kind, pubkey, identifier] = parts;
        try {
          const e = await $ndk.fetchEvent({
            kinds: [Number(kind)],
            authors: [pubkey],
            '#d': [identifier]
          });
          if (e) {
            recipeEvents = [...recipeEvents, e];
            try {
              await offlineStorage.saveRecipeFromEvent(e);
            } catch {}
          }
        } catch (err) {
          console.warn('[pack] failed to fetch recipe', aTag, err);
        }
      })
    );
  }

  function feedCardData(e: NDKEvent) {
    const dTag = e.tags?.find((t) => t[0] === 'd')?.[1] || '';
    const t = e.tags?.find((t) => t[0] === 'title')?.[1] || dTag || 'Untitled';
    const summary = e.tags?.find((t) => t[0] === 'summary')?.[1] || '';
    const rawImage = e.tags?.find((t) => t[0] === 'image')?.[1] || '';
    const img = getImageOrPlaceholder(rawImage, e.id || dTag);
    let link = '';
    if (dTag && (e.author?.pubkey || e.pubkey)) {
      try {
        link = `/recipe/${nip19.naddrEncode({
          identifier: dTag,
          kind: e.kind || 30023,
          pubkey: e.author?.pubkey || e.pubkey
        })}`;
      } catch {}
    }
    return { title: t, summary, image: img, link };
  }

  // ===== Import flow =====
  async function importPack() {
    if (isImporting) return;
    if (!$userPublickey) {
      showToast('info', 'Sign in to save this Recipe Pack to your cookbook.');
      goto('/login');
      return;
    }
    if (recipeEvents.length === 0) {
      showToast('error', 'No recipes resolved yet — try again in a moment.');
      return;
    }

    isImporting = true;
    importProgress = { current: 0, total: recipeEvents.length };

    try {
      // Make sure we have the cookbook + default list ready
      const state = get(cookbookStore);
      if (!state.initialized) {
        await cookbookStore.load();
      }
      const defaultList = await cookbookStore.ensureDefaultList();
      if (!defaultList) {
        showToast('error', 'Could not access your cookbook. Try again.');
        return;
      }

      // Cache recipes for offline use as we go.
      // Reassign importProgress (don't mutate in place) so Svelte re-renders the label.
      for (let i = 0; i < recipeEvents.length; i++) {
        importProgress = { current: i + 1, total: recipeEvents.length };
        try {
          await offlineStorage.saveRecipeFromEvent(recipeEvents[i]);
        } catch {}
      }

      const result = await cookbookStore.bulkAddRecipesToList(defaultList.id, recipeEvents);
      const { added, skipped, failed } = result;

      if (added === 0 && skipped > 0) {
        showToast('info', 'Already in your cookbook.');
      } else if (added > 0 && skipped === 0) {
        showToast('success', `Added ${added} ${added === 1 ? 'recipe' : 'recipes'} to your cookbook.`);
      } else if (added > 0 && skipped > 0) {
        showToast('success', `Added ${added}, skipped ${skipped} already saved.`);
      } else if (failed > 0) {
        showToast('error', 'Could not save the pack. Try again.');
      }
    } catch (err) {
      console.error('[pack] import failed', err);
      showToast('error', 'Failed to save Recipe Pack.');
    } finally {
      isImporting = false;
      importProgress = { current: 0, total: 0 };
    }
  }

  // Subscribe to the store so we know when it's been hydrated from
  // Nostr/IndexedDB. Without this, `allSaved` would compute against an
  // empty list and the "Save Pack" CTA could mislead users who already
  // have these recipes.
  $: cookbookInitialized = $cookbookStore.initialized;

  // Trigger a load on mount when logged in so allSaved reflects reality
  // before the user has to click anything.
  onMount(() => {
    if (browser && $userPublickey && !get(cookbookStore).initialized) {
      cookbookStore.load();
    }
  });

  // Re-check if the user logs in after the page is already mounted.
  $: if (browser && $userPublickey && !cookbookInitialized) {
    cookbookStore.load();
  }

  // Did the user already save every recipe in this pack?
  $: allSaved = (() => {
    if (!$userPublickey || aTags.length === 0) return false;
    if (!cookbookInitialized) return false;
    const allTags = new Set<string>();
    for (const list of $cookbookLists) {
      for (const r of list.recipes) allTags.add(r);
    }
    return aTags.every((a) => allTags.has(a));
  })();

  $: isOwnPack = !!$userPublickey && creatorPubkey === $userPublickey;

  // Share modal (short link + social share + QR), reused from recipe page.
  let shareModalOpen = false;
</script>

<svelte:head>
  <title>{ogMeta?.title || 'Recipe Pack — Zap Cooking'}</title>
  {#if ogMeta}
    <meta name="description" content={ogMeta.description} />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Zap Cooking" />
    <meta property="og:title" content={ogMeta.title} />
    <meta property="og:description" content={ogMeta.description} />
    <meta property="og:image" content={ogMeta.image} />
    <meta property="og:image:secure_url" content={ogMeta.image} />
    <meta property="og:image:alt" content={ogMeta.title} />
    <meta
      property="og:url"
      content={ogMeta.url || `https://zap.cooking/pack/${$page.params.naddr}`}
    />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:domain" content="zap.cooking" />
    <meta name="twitter:title" content={ogMeta.title} />
    <meta name="twitter:description" content={ogMeta.description} />
    <meta name="twitter:image" content={ogMeta.image} />
    <meta name="twitter:image:alt" content={ogMeta.title} />
  {/if}
</svelte:head>

<!-- Share modal (short link / native / social / QR) — same one recipes use -->
<ShareModal
  bind:open={shareModalOpen}
  url={viewUrl}
  title={title || 'Recipe Pack'}
  imageUrl={image || ''}
/>

{#if !loaded}
  <div class="flex justify-center items-center page-loader">
    <PanLoader />
  </div>
{:else if notFound || !packEvent}
  <div class="flex flex-col items-center justify-center py-16 px-4">
    <div
      class="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-4"
    >
      <WarningIcon size={32} class="text-amber-600 dark:text-amber-400" />
    </div>
    <h1 class="text-xl font-semibold mb-2" style="color: var(--color-text-primary)">
      Recipe Pack not found
    </h1>
    <p class="text-caption text-center max-w-md mb-4">
      This pack may have been deleted, or your relays don't have it yet. Try again later, or browse
      your cookbook.
    </p>
    <a
      href="/cookbook"
      class="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-full font-medium transition-all"
    >
      <ArrowLeftIcon size={18} />
      Go to Cookbook
    </a>
  </div>
{:else}
  {@const naviewUrl = `/${$page.params.naddr}`}
  {@const stillLoadingRecipes = recipeEvents.length < recipeCount}
  <div class="flex flex-col gap-4">
    <!-- Back link -->
    <div>
      <a
        href="/cookbook"
        class="inline-flex items-center gap-1.5 text-sm text-caption hover:text-primary transition-colors"
      >
        <ArrowLeftIcon size={16} />
        <span>Cookbook</span>
      </a>
    </div>

    <!-- Compact pack header -->
    <header
      class="relative rounded-2xl overflow-hidden"
      style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
    >
      <!-- Banner -->
      <div class="relative w-full h-[140px] sm:h-[200px] pack-banner">
        {#if image}
          <div use:lazyLoad={{ url: getImageOrPlaceholder(image, packEvent.id || title) }} class="absolute inset-0 pack-banner-img"></div>
        {:else}
          <div
            class="absolute inset-0"
            style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #f97316 100%);"
          ></div>
        {/if}
        <div class="absolute inset-0 bg-gradient-to-t from-black/55 via-black/15 to-transparent"></div>
        <div class="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/55 text-white text-xs font-medium backdrop-blur-sm">
          <BookmarkSimpleIcon size={12} weight="fill" />
          <span>Recipe Pack</span>
        </div>
        {#if isOwnPack}
          <div class="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-white/15 text-white text-xs font-semibold backdrop-blur-sm">
            This is your pack
          </div>
        {/if}
      </div>

      <!-- Metadata -->
      <div class="p-4 sm:p-5 flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <h1
            class="text-xl sm:text-2xl font-bold leading-tight"
            style="color: var(--color-text-primary)"
          >
            {title}
          </h1>
          {#if description}
            <p class="text-sm text-caption whitespace-pre-line line-clamp-3">{description}</p>
          {/if}
        </div>

        <!-- Creator + count line -->
        <div class="flex items-center gap-2 flex-wrap text-sm">
          {#if creatorPubkey}
            <a
              href={`/user/${nip19.npubEncode(creatorPubkey)}`}
              class="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity"
            >
              <Avatar pubkey={creatorPubkey} size={24} showRing={false} />
              <span class="truncate" style="color: var(--color-text-secondary)">
                <CustomName pubkey={creatorPubkey} />
              </span>
            </a>
            <span class="text-caption">·</span>
          {/if}
          <span class="text-caption">
            {recipeCount} {recipeCount === 1 ? 'recipe' : 'recipes'}
          </span>
          {#if stillLoadingRecipes}
            <span class="text-caption">·</span>
            <span class="text-caption flex items-center gap-1">
              <CircleNotchIcon size={12} class="animate-spin" />
              Loading {recipeCount - recipeEvents.length} more
            </span>
          {/if}
        </div>

        <!-- Subtle social action row -->
        <div class="flex items-center justify-between gap-3 pt-1 border-t" style="border-color: var(--color-input-border);">
          <div class="pt-2 flex items-center gap-2">
            <!--
              showRepost={false}: NoteRepost publishes a NIP-18 kind:6 wrapping
              the inner event. The food feed renders kind:6 reposts only when
              the inner kind is 1 or 1068 (see FoodstrFeedOptimized.expandRepostEvent),
              so reposting a kind:30004 pack would silently drop in feeds.
              TODO: when we persist a back-reference to the kind:1 announcement,
              route repost to that event instead so it surfaces in feeds.
            -->
            <NoteActionBar
              event={packEvent}
              variant="default"
              showComments={false}
              showRepost={false}
            />
            <!-- Comments link → generic event viewer (supports NIP-22 comments) -->
            <a
              href={naviewUrl}
              class="flex items-center gap-1.5 px-1.5 py-1 rounded text-caption hover:bg-accent-gray transition-colors"
              title="Open comments"
              aria-label="Open comments"
            >
              <ChatTeardropTextIcon size={20} />
            </a>
            <!-- Share (short link, social, QR) -->
            <button
              type="button"
              on:click={() => (shareModalOpen = true)}
              class="flex items-center gap-1.5 px-1.5 py-1 rounded text-caption hover:bg-accent-gray transition-colors"
              title="Share"
              aria-label="Share"
            >
              <LinkIcon size={20} />
            </button>
          </div>
        </div>
      </div>
    </header>

    <!-- Primary CTA -->
    <div class="flex flex-wrap gap-2 items-center">
      {#if isOwnPack}
        <a
          href="/cookbook"
          class="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors"
          style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
        >
          <BookmarkIcon size={16} />
          Open your cookbook
        </a>
      {:else if allSaved}
        <span
          class="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium"
          style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
        >
          <CheckCircleIcon size={16} weight="fill" class="text-green-500" />
          Saved in your cookbook
        </span>
      {:else}
        <button
          on:click={importPack}
          disabled={isImporting || recipeEvents.length === 0}
          class="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-full font-semibold transition-all shadow-md shadow-orange-500/25 disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none"
        >
          {#if isImporting}
            <CircleNotchIcon size={16} class="animate-spin" />
            <span>Saving {importProgress.current}/{importProgress.total}…</span>
          {:else}
            <BookmarkIcon size={16} weight="fill" />
            <span>Save Pack to Cookbook</span>
          {/if}
        </button>
      {/if}
    </div>

    <!-- Recipe grid (matches cookbook feed view) -->
    {#if recipeCount === 0}
      <div class="text-caption text-sm text-center py-8">This pack has no recipes.</div>
    {:else}
      <div class="flex items-center justify-between gap-2 pt-1">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-caption">
          {recipeCount} {recipeCount === 1 ? 'recipe' : 'recipes'} included
        </h2>
        {#if recipeEvents.length > 0 && recipeEvents.length < recipeCount}
          <span class="text-xs text-caption">
            Showing {recipeEvents.length} so far — some recipes are still loading from relays.
          </span>
        {/if}
      </div>
      <div class="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {#each recipeEvents as e (e.id || feedCardData(e).link)}
          {@const card = feedCardData(e)}
          {#if card.link}
            <a
              href={card.link}
              class="group flex flex-col rounded-2xl overflow-hidden transition-transform duration-200 hover:scale-[1.01] hover:shadow-xl"
              style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
            >
              <div class="relative w-full aspect-[4/3] overflow-hidden pack-recipe-image-wrap">
                <div
                  use:lazyLoad={{ url: card.image }}
                  class="absolute inset-0 pack-recipe-image group-hover:scale-105 transition-transform duration-700 ease-in-out"
                ></div>
              </div>
              <div class="p-3 sm:p-4 flex flex-col gap-1">
                <h3
                  class="text-base sm:text-lg font-semibold leading-snug line-clamp-2"
                  style="color: var(--color-text-primary);"
                >
                  {card.title}
                </h3>
                {#if card.summary}
                  <p class="text-sm text-caption line-clamp-2">{card.summary}</p>
                {/if}
              </div>
            </a>
          {/if}
        {/each}

        <!-- Skeletons for unresolved recipes -->
        {#if recipeEvents.length < recipeCount}
          {#each Array(Math.min(3, recipeCount - recipeEvents.length)) as _}
            <div
              class="rounded-2xl overflow-hidden animate-pulse"
              style="background-color: var(--color-input-bg);"
            >
              <div
                class="w-full aspect-[4/3]"
                style="background-color: var(--color-accent-gray);"
              ></div>
              <div class="p-3 sm:p-4 flex flex-col gap-2">
                <div class="h-4 w-3/4 rounded" style="background-color: var(--color-accent-gray);"></div>
                <div class="h-3 w-1/2 rounded" style="background-color: var(--color-accent-gray);"></div>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .pack-banner {
    background-color: var(--color-accent-gray);
  }
  .pack-banner-img {
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    opacity: 0;
    transition: opacity 0.3s ease-in;
  }
  .pack-banner-img:global(.image-loaded) {
    opacity: 1;
  }

  .pack-recipe-image-wrap {
    background-color: var(--color-accent-gray);
  }
  .pack-recipe-image {
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    opacity: 0;
    transition: opacity 0.3s ease-in;
  }
  .pack-recipe-image:global(.image-loaded) {
    opacity: 1;
  }
</style>
