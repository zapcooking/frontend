<script lang="ts">
  /**
   * Fresh (beta): the /feed tab that reads only wss://feed.zap.cooking.
   *
   * Posts come from the isolated client in $lib/freshFeed (its own
   * connection, never $ndk's pool, never the local event cache). Raw events
   * are wrapped as NDKEvents for rendering only, so the shared post
   * components (author, content, polls, recipe and article cards) work as
   * they do in OnlyFood. Engagement, the post menu and the lightbox come in
   * the next PR.
   *
   * Non-members read the last 14 days, then get the end-of-window card.
   * A signed-in member who reaches that point is asked to log in to the
   * relay once (lazily; see memberLogin.ts) and keeps scrolling into history.
   */
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { ndk, userPublickey } from '$lib/nostr';
  import { muteListStore } from '$lib/muteListStore';
  import { isHellthread } from '$lib/notificationUtils';
  import { membershipStatusMap, queueMembershipLookup } from '$lib/stores/membershipStatus';
  import { eventToArticleData } from '$lib/articleUtils';
  import { optimizeImageUrl, getOptimalFormat } from '$lib/imageOptimizer';
  import { imetaAltByUrl } from '$lib/feed/imeta';
  import { freshSession } from '$lib/freshFeed/session';
  import { floorPrompt } from '$lib/freshFeed/floorPrompt';
  import type { PageEnd, PageResult, RelayEvent } from '$lib/freshFeed/relay';
  import {
    passesFreshFilters,
    postKind,
    formatTimeAgo,
    mediaUrls,
    contentWithoutMedia
  } from '$lib/freshFeed/posts';
  import Avatar from './Avatar.svelte';
  import AuthorName from './AuthorName.svelte';
  import ClientAttribution from './ClientAttribution.svelte';
  import PowBadge from './PowBadge.svelte';
  import NoteContent from './NoteContent.svelte';
  import MediaCarousel from './MediaCarousel.svelte';
  import PollDisplay from './PollDisplay.svelte';
  import RecipeCard from './RecipeCard.svelte';
  import ArticleCard from './ArticleCard.svelte';
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

  $: pk = $userPublickey ? $userPublickey.toLowerCase() : '';
  $: member = !!pk && $membershipStatusMap[pk]?.active === true;
  // Until the app's membership lookup answers, a member would briefly see
  // the membership pitch: hold the card back until then.
  $: membershipKnown = !pk || pk in $membershipStatusMap;
  $: prompt = floorPrompt({ signedIn: !!pk, member, login: $loginState });

  // Mutes and the hellthread rule re-apply when the mute list loads or changes.
  $: shown = filterPosts(posts, $muteListStore.muteList);
  $: newCount = filterPosts(pending, $muteListStore.muteList).length;

  function filterPosts(list: Post[], muteList: typeof $muteListStore.muteList): Post[] {
    const now = Math.floor(Date.now() / 1000);
    return list.filter((p) =>
      passesFreshFilters(p.raw, {
        muteList: pk ? muteList : null,
        isHellthread: (e) => isHellthread(p.event),
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
    posts = [...posts, ...r.events.map(wrap)];
    if (r.nextUntil !== undefined) nextUntil = r.nextUntil;
    end = r.end ?? 'more';
  }

  async function loadFirst() {
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
    posts = [...pending, ...posts];
    pending = [];
    document.getElementById('app-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Pull-to-refresh on /feed. */
  export async function refresh(): Promise<void> {
    await loadFirst();
  }

  // From FoodstrFeedOptimized: open the note unless a control was clicked
  // or text is being selected.
  function gotoNoteFromCard(e: MouseEvent, id: string) {
    if (
      e.target instanceof Element &&
      e.target.closest('a, button, input, textarea, [role="button"], [data-stop-card-navigation]')
    ) {
      return;
    }
    if (window.getSelection()?.toString()) return;
    goto(`/${nip19.noteEncode(id)}`);
  }

  function optimizedImage(url: string): string {
    return optimizeImageUrl(url, { width: 640, quality: 85, format: getOptimalFormat() });
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
  });

  onDestroy(() => {
    destroyed = true;
    stopLive?.();
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

      <div class="space-y-6">
        {#each shown as post (post.raw.id)}
          {@const kind = postKind(post.raw)}
          {#if kind === 'recipe'}
            <RecipeCard event={post.event} />
          {:else if kind === 'article'}
            {@const article = eventToArticleData(post.event, true)}
            {#if article}
              <ArticleCard
                event={post.event}
                imageUrl={article.imageUrl}
                title={article.title}
                preview={article.preview}
                readTime={article.readTimeMinutes}
                tags={article.tags}
                articleUrl={article.articleUrl}
              />
            {/if}
          {:else}
            {@const media = mediaUrls(post.raw.content)}
            {@const text = contentWithoutMedia(post.raw.content)}
            <!-- svelte-ignore a11y-no-noninteractive-element-to-interactive-role -->
            <article
              class="w-full cursor-pointer"
              on:click={(e) => gotoNoteFromCard(e, post.raw.id)}
              role="link"
              tabindex="0"
              on:keydown|self={(e) => {
                if (e.key === 'Enter') goto(`/${nip19.noteEncode(post.raw.id)}`);
              }}
            >
              <div class="flex items-center justify-between mb-3 px-2 sm:px-0">
                <div class="flex items-center space-x-3 flex-1 min-w-0">
                  <a href="/user/{nip19.npubEncode(post.raw.pubkey)}" class="flex-shrink-0">
                    <Avatar pubkey={post.raw.pubkey} size={40} />
                  </a>
                  <div class="flex items-center space-x-2 flex-wrap min-w-0">
                    <AuthorName
                      event={post.event}
                      className="font-semibold text-sm truncate min-w-0"
                    />
                    <span class="text-sm flex-shrink-0" style="color: var(--color-caption)">·</span>
                    <span
                      class="text-sm whitespace-nowrap flex-shrink-0"
                      style="color: var(--color-caption)"
                    >
                      {formatTimeAgo(post.raw.created_at)}
                    </span>
                    <ClientAttribution tags={post.raw.tags} enableEnrichment={false} />
                    <PowBadge id={post.raw.id} tags={post.raw.tags} />
                  </div>
                </div>
              </div>

              <div class="px-2 sm:px-0">
                {#if kind === 'poll'}
                  <PollDisplay event={post.event} />
                {:else if text}
                  <div
                    class="text-sm leading-relaxed mb-3"
                    style="color: var(--color-text-primary)"
                  >
                    <NoteContent content={text} />
                  </div>
                {/if}
                {#if media.length > 0}
                  <div class="mb-3">
                    <MediaCarousel
                      items={media}
                      optimizeUrl={optimizedImage}
                      altByUrl={imetaAltByUrl(post.event)}
                    />
                  </div>
                {/if}
              </div>
            </article>
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
