<script lang="ts">
  /**
   * Fresh (beta): the /feed tab that reads only wss://feed.zap.cooking.
   *
   * Posts come from the isolated client in $lib/freshFeed (its own
   * connection, never $ndk's pool, never the local event cache). Raw events
   * are wrapped as NDKEvents for rendering only, so the shared post
   * components (FreshPostCard) work as they do in OnlyFood. Engagement,
   * replies, zaps and every other action read and write through $ndk, the
   * reader's own relays.
   *
   * Non-members read the last 14 days, then get the end-of-window card.
   * A signed-in member who reaches that point is asked to log in to the
   * relay once (lazily; see memberLogin.ts) and keeps scrolling into history.
   */
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { ndk, userPublickey } from '$lib/nostr';
  import { batchFetchEngagement, cleanupEngagement, fetchEngagement } from '$lib/engagementCache';
  import { prefetchReplyContexts } from '$lib/replyContext';
  import { noteImage, saveImage, engagementFor } from '$lib/freshFeed/shareImage';
  import type { EngagementData as ShareEngagementData } from '$lib/shareNoteImage';
  import { muteListStore } from '$lib/muteListStore';
  import { isHellthread } from '$lib/notificationUtils';
  import { membershipStatusMap, queueMembershipLookup } from '$lib/stores/membershipStatus';
  import { freshSession } from '$lib/freshFeed/session';
  import { floorPrompt } from '$lib/freshFeed/floorPrompt';
  import type { PageEnd, PageResult, RelayEvent } from '$lib/freshFeed/relay';
  import { passesFreshFilters, passesReaderFilters } from '$lib/freshFeed/posts';
  import { RECIPE_TAGS } from '$lib/consts';
  import {
    boxSlots,
    interleave,
    buildPool,
    loadSeen,
    markSeen,
    pickRandom,
    recipeAddress
  } from '$lib/freshFeed/recipeBox';
  import { beginVisit, recordNewest, withDivider } from '$lib/freshFeed/lastVisit';
  import { spaceAuthors } from '$lib/freshFeed/spacing';
  import FreshPostCard from './FreshPostCard.svelte';
  import FreshReportModal from './FreshReportModal.svelte';
  import ZapModal from './ZapModal.svelte';
  import ShareModal from './ShareModal.svelte';
  import MediaLightbox from './MediaLightbox.svelte';
  import FeedErrorBoundary from './FeedErrorBoundary.svelte';
  import FeedPostSkeleton from './FeedPostSkeleton.svelte';
  import LoadingState from './LoadingState.svelte';
  import FreshFloorCard from './FreshFloorCard.svelte';

  const { client, login } = freshSession();
  const loginState = login.state;

  interface Post {
    raw: RelayEvent;
    event: NDKEvent;
  }

  let posts: Post[] = [];
  let pending: Post[] = [];
  let loading = true;
  let loadingMore = false;
  let unavailable = false;
  let moreFailed = false;
  let end: PageEnd = 'more';
  let nextUntil: number | undefined;
  let autoDeeperTried = false;
  let stopLive: (() => void) | null = null;
  let destroyed = false;

  // Engagement mounts as a post nears the screen (OnlyFood's pattern).
  let visibleNotes = new Set<string>();
  let expanded = new Set<string>();
  const batched = new Set<string>();
  let batchTimer: ReturnType<typeof setTimeout> | null = null;
  // Posts reported this session: hidden at once.
  let hidden = new Set<string>();

  // "From the recipe box": older recipes, one after every eight posts,
  // random from those this device hasn't shown ($lib/freshFeed/recipeBox).
  let boxPool: RelayEvent[] = [];
  let boxSeen = loadSeen(Math.floor(Date.now() / 1000));
  let boxPicks: Post[] = [];
  const boxTaken = new Set<string>();
  const boxAddress = new Map<string, string>();

  // Dialogs
  let zapOpen = false;
  let zapEvent: NDKEvent | null = null;
  let shareOpen = false;
  let shareUrl = '';
  let shareEvent: NDKEvent | null = null;
  let shareBlob: Blob | null = null;
  let shareName = 'zap-cooking-note.png';
  let generatingShare = false;
  let savingImage = false;
  let notice: string | null = null;
  let lightboxImages: { url: string; alt: string }[] = [];
  let lightboxIndex = 0;
  let lightboxOpen = false;
  let reportOpen = false;
  let reportPost: RelayEvent | null = null;

  $: pk = $userPublickey ? $userPublickey.toLowerCase() : '';
  $: member = !!pk && $membershipStatusMap[pk]?.active === true;
  // Until the app's membership lookup answers, a member would briefly see
  // the membership pitch: hold the card back until then.
  $: membershipKnown = !pk || pk in $membershipStatusMap;
  $: prompt = floorPrompt({ signedIn: !!pk, member, login: $loginState });

  // Mutes and the hellthread rule re-apply when the mute list loads or changes.
  $: shown = filterPosts(posts, $muteListStore.muteList, hidden);
  $: newCount = filterPosts(pending, $muteListStore.muteList, hidden).length;

  function filterPosts(
    list: Post[],
    muteList: typeof $muteListStore.muteList,
    hiddenIds: Set<string>
  ): Post[] {
    const now = Math.floor(Date.now() / 1000);
    return list.filter(
      (p) =>
        !hiddenIds.has(p.raw.id) &&
        passesFreshFilters(p.raw, {
          muteList: pk ? muteList : null,
          isHellthread: () => isHellthread(p.event),
          now
        })
    );
  }

  function wrap(raw: RelayEvent): Post {
    return { raw, event: new NDKEvent($ndk, raw) };
  }

  function apply(r: PageResult) {
    if (r.state === 'unavailable') {
      if (posts.length === 0) unavailable = true;
      else moreFailed = true;
      return;
    }
    if (r.state !== 'ok') {
      // auth-required / restricted: the end of what this reader can see.
      end = 'floor';
      return;
    }
    // Each new page is spaced by author; posts already on screen stay put.
    const added = spaceAuthors(posts, r.events.map(wrap));
    posts = [...posts, ...added];
    fillBox();
    if (posts[0]) recordNewest(posts[0].raw.created_at);
    if (added.length)
      prefetchReplyContexts(
        $ndk,
        added.map((p) => p.event)
      ).catch(() => {});
    if (r.nextUntil !== undefined) nextUntil = r.nextUntil;
    end = r.end ?? 'more';
  }

  async function loadPool() {
    const r = await client.recipes(RECIPE_TAGS);
    if (destroyed || r.state !== 'ok') return;
    boxPool = buildPool(r.events, Math.floor(Date.now() / 1000));
    fillBox();
  }

  // A pick that was reported, or whose author was muted, leaves its slot empty.
  $: boxShown = boxPicks.map((p) =>
    hidden.has(p.raw.id) ||
    !passesReaderFilters(p.raw, {
      muteList: pk ? $muteListStore.muteList : null,
      isHellthread: () => isHellthread(p.event)
    })
      ? null
      : p
  );

  $: rendered = interleave(shown, boxShown);

  // "New since your last visit": the previous visit's mark, fixed for this
  // session (device-local; $lib/freshFeed/lastVisit).
  const visitMark = beginVisit();
  $: rows = withDivider(rendered, visitMark);
  $: caughtUp = visitMark !== null && shown.length > 0 && shown[0].raw.created_at <= visitMark;

  /**
   * One pick per slot as the feed grows; a pick, once made, stays put.
   * Called after every change to the posts or the pool — not from a `$:`
   * statement: it assigns boxPicks, and a reactive call would leave the
   * `boxShown` statement above it stale for that update.
   */
  function fillBox() {
    const muteList = $muteListStore.muteList;
    const slots = boxSlots(filterPosts(posts, muteList, hidden).length);
    const pool = boxPool;
    if (boxPicks.length >= slots || pool.length === 0) return;
    // Recipes already in the feed (members paging history) aren't picked.
    const inFeed = new Set(
      posts
        .filter((p) => p.raw.kind === 30023 || p.raw.kind === 35000)
        .map((p) => recipeAddress(p.raw))
    );
    const usable = pool.filter(
      (e) =>
        !inFeed.has(recipeAddress(e)) &&
        passesReaderFilters(e, {
          muteList: pk ? muteList : null,
          isHellthread: () => isHellthread(new NDKEvent($ndk, e))
        })
    );
    const added: Post[] = [];
    while (boxPicks.length + added.length < slots) {
      const pick = pickRandom(usable, boxSeen, boxTaken);
      if (!pick) break;
      const address = recipeAddress(pick);
      boxTaken.add(address);
      boxAddress.set(pick.id, address);
      added.push(wrap(pick));
    }
    if (added.length) boxPicks = [...boxPicks, ...added];
  }

  async function loadFirst() {
    // Picks never seen go back in the pool; seen ones are remembered.
    boxPicks = [];
    boxTaken.clear();
    loading = true;
    unavailable = false;
    moreFailed = false;
    autoDeeperTried = false;
    end = 'more';
    nextUntil = undefined;
    pending = [];
    stopLive?.();
    stopLive = null;
    client.reset();
    const since = Math.floor(Date.now() / 1000);
    const r = await client.page();
    if (destroyed) return;
    posts = [];
    apply(r);
    loading = false;
    if (!unavailable) startLive(since);
  }

  async function loadMore() {
    if (loading || loadingMore || end !== 'more') return;
    loadingMore = true;
    moreFailed = false;
    apply(await client.page(nextUntil));
    loadingMore = false;
  }

  /** Past the free window: the client logs a member in (once) on the way. */
  async function goDeeper() {
    if (loadingMore) return;
    loadingMore = true;
    moreFailed = false;
    const floor = client.floor();
    apply(await client.page(Math.min(nextUntil ?? floor, floor - 1)));
    loadingMore = false;
  }

  // A member who reaches the end of the window goes on into history; the
  // login prompt appears here, and only once (a decline stops it).
  $: if (
    end === 'floor' &&
    !loading &&
    !loadingMore &&
    !autoDeeperTried &&
    member &&
    $loginState !== 'declined' &&
    $loginState !== 'not-member'
  ) {
    autoDeeperTried = true;
    goDeeper();
  }

  async function manualLogin() {
    let relay;
    try {
      relay = await client.connection();
    } catch {
      moreFailed = true;
      return;
    }
    if (await login.access(relay, true)) await goDeeper();
  }

  function startLive(since: number) {
    client
      .subscribeNew(since, (raw) => {
        pending = [wrap(raw), ...pending];
      })
      .then((stop) => {
        if (destroyed) stop();
        else stopLive = stop;
      });
  }

  function showPending() {
    posts = [...spaceAuthors([], pending), ...posts];
    pending = [];
    fillBox();
    if (posts[0]) recordNewest(posts[0].raw.created_at);
    document.getElementById('app-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Pull-to-refresh on /feed. */
  export async function refresh(): Promise<void> {
    await loadFirst();
  }

  // --- Engagement: one shared observer, batched fetches (as in OnlyFood) ---

  let lazyObserver: IntersectionObserver | null = null;
  const lazyTargets = new Map<Element, string>();

  function lazy(node: HTMLElement, id: string) {
    lazyObserver ??= new IntersectionObserver(
      (entries, observer) => {
        let changed = false;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const eid = lazyTargets.get(entry.target);
          if (eid === undefined) continue;
          lazyTargets.delete(entry.target);
          observer.unobserve(entry.target);
          visibleNotes.add(eid);
          changed = true;
          const address = boxAddress.get(eid);
          if (address) boxSeen = markSeen(boxSeen, address, Math.floor(Date.now() / 1000));
        }
        if (changed) {
          visibleNotes = visibleNotes;
          scheduleBatch();
        }
      },
      { root: document.getElementById('app-scroll'), rootMargin: '800px' }
    );
    lazyTargets.set(node, id);
    lazyObserver.observe(node);
    return {
      destroy() {
        lazyTargets.delete(node);
        lazyObserver?.unobserve(node);
      }
    };
  }

  function scheduleBatch() {
    if (batchTimer) clearTimeout(batchTimer);
    batchTimer = setTimeout(async () => {
      const ids = [...visibleNotes].filter((id) => !batched.has(id));
      if (ids.length === 0) return;
      ids.forEach((id) => batched.add(id));
      for (let i = 0; i < ids.length; i += 20) {
        try {
          await batchFetchEngagement($ndk, ids.slice(i, i + 20), $userPublickey);
        } catch (err) {
          console.error('[Fresh] engagement fetch failed:', err);
        }
      }
    }, 200);
  }

  function toggleEngagement(id: string) {
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    expanded = expanded;
  }

  // --- Dialogs ---

  function openZap(event: NDKEvent) {
    zapEvent = event;
    setTimeout(() => (zapOpen = true), 0);
  }

  function zapComplete(id: string) {
    if ($userPublickey) fetchEngagement($ndk, id, $userPublickey);
  }

  function openShare(url: string, event: NDKEvent) {
    shareUrl = url;
    shareEvent = event;
    shareBlob = null;
    generatingShare = false;
    shareOpen = true;
  }

  async function generateShareImage() {
    if (!shareEvent || !browser) return;
    generatingShare = true;
    try {
      const img = await noteImage($ndk, shareEvent, engagementFor(shareEvent.id));
      if (img) {
        shareBlob = img.blob;
        shareName = img.filename;
      } else notice = 'Failed to generate image. Please try again.';
    } catch (err) {
      notice = err instanceof Error ? err.message : 'Failed to generate image. Please try again.';
    } finally {
      generatingShare = false;
    }
  }

  async function downloadImage(detail: { event: NDKEvent; engagementData: ShareEngagementData }) {
    if (!browser) return;
    savingImage = true;
    try {
      const img = await noteImage($ndk, detail.event, detail.engagementData);
      if (!img) throw new Error('Failed to generate image');
      await saveImage(img.blob, img.filename);
    } catch (err) {
      notice = err instanceof Error ? err.message : 'Failed to generate image';
    } finally {
      savingImage = false;
    }
  }

  function openReport(post: RelayEvent) {
    reportPost = post;
    reportOpen = true;
  }

  /** Lightbox goes on <body> so no card's stacking context clips it. */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  /** Infinite scroll: load the next page as the sentinel nears the view. */
  function nearView(node: HTMLElement) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((x) => x.isIntersecting)) loadMore();
      },
      { root: document.getElementById('app-scroll'), rootMargin: '800px 0px' }
    );
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  onMount(() => {
    if (pk) {
      queueMembershipLookup(pk);
      muteListStore.load();
    }
    loadFirst();
    loadPool();
  });

  onDestroy(() => {
    destroyed = true;
    stopLive?.();
    lazyObserver?.disconnect();
    if (batchTimer) clearTimeout(batchTimer);
    // Release the engagement subscriptions this feed opened.
    batched.forEach((id) => cleanupEngagement(id));
  });
</script>

<FeedErrorBoundary>
  <div class="max-w-2xl mx-auto">
    {#if newCount > 0}
      <div class="fixed top-4 left-1/2 -translate-x-1/2 z-50">
        <button
          on:click={showPending}
          class="py-2 px-4 bg-primary text-white rounded-full shadow-lg hover:bg-primary/90 transition-all flex items-center gap-2"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 10l7-7m0 0l7 7m-7-7v18"
            />
          </svg>
          {newCount} new {newCount === 1 ? 'post' : 'posts'}
        </button>
      </div>
    {/if}

    {#if loading}
      <div class="space-y-6">
        {#each Array(3) as _}
          <FeedPostSkeleton />
        {/each}
      </div>
    {:else if unavailable}
      <div class="py-12 text-center">
        <div class="max-w-sm mx-auto space-y-6">
          <div style="color: var(--color-caption)">
            <p class="text-lg font-medium">The beta feed is temporarily unavailable</p>
            <p class="text-sm">Please check your connection and try again.</p>
          </div>
          <button
            on:click={loadFirst}
            class="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    {:else}
      {#if shown.length === 0 && end !== 'more'}
        <div class="py-12 text-center">
          <div class="max-w-sm mx-auto space-y-6" style="color: var(--color-caption)">
            <p class="text-lg font-medium">Nothing fresh yet</p>
            <p class="text-sm">New posts from the curated food relay will show up here.</p>
            <button
              on:click={loadFirst}
              class="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
      {/if}

      {#if caughtUp}
        <p class="text-sm text-center mb-4" style="color: var(--color-caption)">
          You're caught up: nothing new since your last visit.
        </p>
      {/if}
      <div class="space-y-6">
        {#each rows as row (row.key)}
          {#if row.divider}
            <div
              class="flex items-center gap-3 text-xs font-medium"
              style="color: var(--color-caption)"
              role="separator"
            >
              <span class="flex-1 h-px" style="background-color: var(--color-input-border)"></span>
              <span>
                You're caught up · {row.newCount} new {row.newCount === 1 ? 'post' : 'posts'} above
              </span>
              <span class="flex-1 h-px" style="background-color: var(--color-input-border)"></span>
            </div>
          {:else}
            <FreshPostCard
              label={row.box ? 'From the recipe box' : null}
              raw={row.item.raw}
              event={row.item.event}
              visible={visibleNotes.has(row.item.raw.id)}
              expanded={expanded.has(row.item.raw.id)}
              {lazy}
              on:zap={(e) => openZap(e.detail)}
              on:share={(e) => openShare(e.detail.url, e.detail.event)}
              on:downloadImage={(e) => downloadImage(e.detail)}
              on:openImage={(e) => {
                lightboxImages = e.detail.images;
                lightboxIndex = e.detail.index;
                lightboxOpen = true;
              }}
              on:toggleEngagement={(e) => toggleEngagement(e.detail)}
              on:report={(e) => openReport(e.detail)}
              on:error={(e) => (notice = e.detail)}
            />
          {/if}
        {/each}
      </div>

      {#if end === 'more'}
        <div use:nearView class="py-4 text-center">
          {#if loadingMore}
            <LoadingState type="spinner" size="lg" text="Loading more posts..." showText={true} />
          {:else if moreFailed}
            <button
              on:click={loadMore}
              class="px-4 py-2 bg-input rounded-lg hover:bg-accent-gray transition-colors"
              style="color: var(--color-text-primary)"
            >
              Couldn't load more. Retry
            </button>
          {:else}
            <button
              on:click={loadMore}
              class="px-4 py-2 bg-input rounded-lg hover:bg-accent-gray transition-colors"
              style="color: var(--color-text-primary)"
            >
              Load More
            </button>
          {/if}
        </div>
      {:else if end === 'floor'}
        {#if loadingMore}
          <div class="py-4 text-center">
            <LoadingState type="spinner" size="lg" text="Loading older posts..." showText={true} />
          </div>
        {/if}
        {#if membershipKnown}
          <FreshFloorCard {prompt} on:login={manualLogin} />
        {/if}
        {#if moreFailed}
          <p class="text-sm text-center py-2" style="color: var(--color-caption)">
            Couldn't reach the feed relay. Try again in a moment.
          </p>
        {/if}
      {:else if shown.length > 0}
        <p class="py-6 text-center text-sm" style="color: var(--color-caption)">
          You've reached the beginning of the Fresh feed.
        </p>
      {/if}
    {/if}
  </div>
</FeedErrorBoundary>

{#if zapEvent}
  <ZapModal
    bind:open={zapOpen}
    event={zapEvent}
    on:zap-complete={() => zapEvent && zapComplete(zapEvent.id)}
  />
{/if}

<ShareModal
  bind:open={shareOpen}
  url={shareUrl}
  title="Check out this post on Zap Cooking"
  imageBlob={shareBlob}
  imageName={shareName}
  isGeneratingImage={generatingShare}
  onGenerateImage={shareEvent ? generateShareImage : null}
  authorPubkey={shareEvent?.pubkey ?? ''}
/>

<FreshReportModal
  bind:open={reportOpen}
  post={reportPost}
  on:reported={(e) => {
    hidden.add(e.detail.id);
    hidden = hidden;
  }}
/>

{#if savingImage}
  <div
    class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    style="backdrop-filter: blur(4px);"
  >
    <div
      class="bg-input rounded-lg p-6 max-w-sm mx-4 text-center"
      style="border: 1px solid var(--color-input-border);"
      role="dialog"
    >
      <div
        class="animate-spin rounded-full h-10 w-10 border-b-2 border-yellow-500 mx-auto mb-3"
      ></div>
      <p class="text-base font-semibold mb-1" style="color: var(--color-text-primary);">
        Generating image...
      </p>
      <p class="text-xs" style="color: var(--color-text-secondary);">This may take a few seconds</p>
    </div>
  </div>
{/if}

{#if notice}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div
    class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    style="backdrop-filter: blur(4px);"
    on:click={() => (notice = null)}
  >
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div
      class="bg-input rounded-lg p-6 max-w-sm mx-4"
      style="border: 1px solid var(--color-input-border);"
      on:click|stopPropagation
    >
      <p class="text-sm mb-4" style="color: var(--color-text-primary);">{notice}</p>
      <button
        on:click={() => (notice = null)}
        class="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
      >
        Close
      </button>
    </div>
  </div>
{/if}

{#if lightboxOpen}
  <div use:portal>
    <MediaLightbox
      images={lightboxImages}
      bind:index={lightboxIndex}
      onClose={() => (lightboxOpen = false)}
    />
  </div>
{/if}
