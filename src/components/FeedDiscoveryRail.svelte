<script lang="ts">
  /**
   * The desktop discovery column beside Fresh on /feed (from 1440px; hidden
   * below, where nothing here loads). Two panels, each with its own job:
   *
   * - Find your people: the first suggested topics (NIP-11
   *   `topics.suggested`, in its order), then "Browse all topics" (the topic
   *   sheet). A row opens that topic in Fresh, exactly like its chip
   *   (members the full feed, everyone else its preview). Hidden when the
   *   list is missing.
   * - Around the table: one real conversation from the Fresh posts on this
   *   page ($lib/freshFeed/discovery pickConversation). Never a post in the
   *   first rows, in a special card or on screen in the feed: when its row
   *   scrolls into view another one takes its place, or the panel goes.
   * - Cooks to follow: three cooks from the org's `feed-foodies` list (the
   *   /explore cooks, /api/landing/cooks), never the reader, someone they
   *   follow, or anyone already on screen; Follow for signed-in readers.
   * - Fresh reads: the newest curated articles with a cover, filtered as
   *   /reads filters them, plus its spam rules; one per author.
   *
   * The lower two load only when they are about to scroll into view, and
   * fade in; a panel with nothing good to show is not shown at all. The
   * column scrolls with the feed and stays pinned once its bottom reaches
   * the bottom of the window (RightRail `wide`).
   */
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import type { Unsubscriber } from 'svelte/store';
  import { ndk, userPublickey } from '$lib/nostr';
  import { batchFetchEngagement, getEngagementStore } from '$lib/engagementCache';
  import { optimizeImageUrl, getOptimalFormat } from '$lib/imageOptimizer';
  import { retryOriginal } from '$lib/imageRetry';
  import { loadTopics, type Topic } from '$lib/freshFeed/topicList';
  import {
    conversationPool,
    firstImage,
    pickConversation,
    suggestedRows,
    type FreshDiscovery,
    type SuggestedRow
  } from '$lib/freshFeed/discovery';
  import { contentWithoutMedia, formatTimeAgo, noteHref } from '$lib/freshFeed/posts';
  import { prefersReducedMotion } from '$lib/motion';
  import {
    loadCooks,
    loadFreshReads,
    readerFollowing,
    type FreshReads
  } from '$lib/freshFeed/columnData';
  import { feedAuthors, pickCooks, pickReads } from '$lib/freshFeed/columnPicks';
  import type { Cook } from '$lib/landing/content';
  import FollowButton from './FollowButton.svelte';
  import RightRail from './RightRail.svelte';
  import RailCard from './RailCard.svelte';
  import Avatar from './Avatar.svelte';
  import AuthorName from './AuthorName.svelte';

  export let discovery: FreshDiscovery;

  const dispatch = createEventDispatcher<{ topic: Topic; browse: void }>();

  /** Matches RightRail's `wide` breakpoint: below it nothing is loaded. */
  const WIDE = '(min-width: 1440px)';
  let active = false;
  let mq: MediaQueryList | null = null;
  const onMq = () => (active = !!mq?.matches);

  let rows: SuggestedRow[] = [];
  let topicsDecided = false;
  let topicsAsked = false;
  $: if (active && !topicsAsked) {
    topicsAsked = true;
    loadTopics().then((c) => {
      rows = suggestedRows(c.suggested);
      topicsDecided = true;
    });
  }

  // --- Pictures: through the image pipeline, one retry on the original,
  // then a picture is dropped (the thumbnail falls back to the neutral tile).

  let original = new Set<string>();
  let failed = new Set<string>();
  function src(url: string, width: number, onOriginal: Set<string>): string {
    return onOriginal.has(url)
      ? url
      : optimizeImageUrl(url, { width, quality: 80, format: getOptimalFormat() });
  }
  function imageError(url: string, current: string) {
    if (retryOriginal(original, current, url)) original = original;
    else {
      failed.add(url);
      failed = failed;
    }
  }

  // --- Around the table ---

  /**
   * The panel fades in when a conversation first qualifies (reply counts
   * arrive a moment after the feed) and when another one takes its place,
   * instead of popping in. It is the column's last panel, so nothing above
   * it moves; the photo frame has a fixed height, so nothing inside does.
   */
  const FADE_MS = 280;
  const fadeIn = { duration: prefersReducedMotion() ? 0 : FADE_MS };

  const now = () => Math.floor(Date.now() / 1000);
  /** Real reply counts, from the shared engagement cache (the cards' own numbers). */
  let replies = new Map<string, number>();
  const watched = new Map<string, Unsubscriber>();
  const asked = new Set<string>();

  function watch(ids: string[]) {
    for (const id of ids) {
      if (watched.has(id)) continue;
      watched.set(
        id,
        getEngagementStore(id).subscribe((d) => {
          // Known once fetched (by this column or by the post's card);
          // before that the count is unknown, not 0.
          if (d.loading || !d.lastFetched) return;
          replies.set(id, d.comments.count);
          replies = replies;
        })
      );
    }
    const fresh = ids.filter((id) => !asked.has(id));
    fresh.forEach((id) => asked.add(id));
    for (let i = 0; i < fresh.length; i += 20) {
      batchFetchEngagement($ndk, fresh.slice(i, i + 20), $userPublickey).catch(() => {});
    }
  }

  $: candidates = discovery.posts.map((e) => ({
    id: e.id,
    kind: e.kind,
    createdAt: e.created_at,
    content: e.content,
    replies: replies.get(e.id) ?? null
  }));
  $: if (active && !discovery.viewOpen) watch(conversationPool(candidates, now()));

  /** Posts whose feed row has been on screen while featured here: never featured again. */
  let onScreen = new Set<string>();
  $: exclude = new Set([...discovery.specialIds, ...onScreen]);
  $: pickedId = active && !discovery.viewOpen ? pickConversation(candidates, exclude, now()) : null;
  $: picked = pickedId ? (discovery.posts.find((e) => e.id === pickedId) ?? null) : null;
  $: pickedEvent = picked ? new NDKEvent($ndk, picked) : null;
  $: pickedText = picked ? snippet(picked.content) : '';
  $: pickedImage = picked ? firstImage(picked) : '';
  $: pickedPhoto = pickedImage && !failed.has(pickedImage) ? src(pickedImage, 640, original) : '';
  $: pickedReplies = pickedId ? (replies.get(pickedId) ?? 0) : 0;

  function snippet(content: string): string {
    return contentWithoutMedia(content)
      .replace(/nostr:(npub|nprofile|note|nevent|naddr)1[0-9a-z]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Watch the featured post's own row in the feed: the moment it's on
  // screen, it leaves this column.
  let rowObserver: IntersectionObserver | null = null;
  $: observeRow(pickedId);
  function observeRow(id: string | null) {
    rowObserver?.disconnect();
    rowObserver = null;
    if (!id || typeof IntersectionObserver === 'undefined') return;
    const el = document.querySelector(`[data-fresh-row="${CSS.escape(id)}"]`);
    if (!el) return;
    rowObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          onScreen.add(id);
          onScreen = onScreen;
        }
      },
      { root: document.getElementById('app-scroll') }
    );
    rowObserver.observe(el);
  }

  // --- Cooks to follow, Fresh reads: loaded when about to scroll into view ---

  /**
   * The panels above have settled: the topics are decided, the feed's
   * first page is in, and "Around the table" has picked or had a few
   * seconds to. Until then every marker sits near the top of a short
   * column and would load at once.
   */
  const SETTLE_MS = 4000;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let waited = false;
  $: if (active && discovery.posts.length && !settleTimer)
    settleTimer = setTimeout(() => (waited = true), SETTLE_MS);
  $: settled = topicsDecided && discovery.posts.length > 0 && (!!picked || waited);

  /**
   * Calls `go` once, when the node comes within 150px of the window — and
   * only once the column has settled (`armed`), so its position is real.
   */
  function near(node: HTMLElement, o: { go: () => void; armed: boolean }) {
    let io: IntersectionObserver | null = null;
    const arm = (armed: boolean) => {
      if (!armed || io) return;
      if (typeof IntersectionObserver === 'undefined') return o.go();
      io = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          io?.disconnect();
          o.go();
        },
        { root: document.getElementById('app-scroll'), rootMargin: '150px 0px' }
      );
      io.observe(node);
    };
    arm(o.armed);
    return {
      update: (next: { go: () => void; armed: boolean }) => {
        o = next;
        arm(next.armed);
      },
      destroy: () => io?.disconnect()
    };
  }

  let cookList: Cook[] | null = null;
  let following: Set<string> | null | undefined = undefined;
  let cooksAsked = false;
  function wantCooks() {
    if (cooksAsked) return;
    cooksAsked = true;
    const me = $userPublickey;
    Promise.all([loadCooks(), readerFollowing($ndk, me)]).then(([list, f]) => {
      following = f;
      cookList = list;
    });
  }

  // Fresh reads' marker waits for Cooks to follow to be decided (its
  // panel, or none), so it is measured where it will actually sit.
  let reads: FreshReads | null | undefined = undefined;
  let readsAsked = false;
  function wantReads() {
    if (readsAsked) return;
    readsAsked = true;
    loadFreshReads($ndk).then((r) => (reads = r));
  }

  // Nobody twice on screen: the feed's first authors and the conversation's
  // author aren't suggested as cooks; neither they nor the cooks shown are
  // picked for Fresh reads.
  $: onScreenPeople = new Set([
    ...feedAuthors(discovery.posts),
    ...(picked ? [picked.pubkey.toLowerCase()] : [])
  ]);
  $: cooksShown =
    cookList && following !== undefined
      ? pickCooks(cookList, { viewer: $userPublickey, following, exclude: onScreenPeople })
      : [];
  $: readsShown = reads
    ? pickReads(reads.articles, {
        keep: reads.keep,
        spam: reads.spam,
        exclude: new Set([...onScreenPeople, ...cooksShown.map((c) => c.pubkey.toLowerCase())])
      })
    : [];

  function openTopic(row: SuggestedRow) {
    dispatch('topic', { slug: row.slug, name: row.name, count14d: 0 });
  }

  onMount(() => {
    mq = window.matchMedia(WIDE);
    onMq();
    mq.addEventListener('change', onMq);
  });

  onDestroy(() => {
    mq?.removeEventListener('change', onMq);
    rowObserver?.disconnect();
    clearTimeout(settleTimer);
    watched.forEach((u) => u());
  });
</script>

<RightRail wide>
  {#if active}
    {#if rows.length}
      <RailCard panel title="Find your people">
        <p class="lead">Start with something you love</p>
        <ul class="list">
          {#each rows as row (row.slug)}
            {@const thumb = row.image && !failed.has(row.image) ? src(row.image, 96, original) : ''}
            <li>
              <button type="button" class="row" on:click={() => openTopic(row)}>
                <span class="thumb" aria-hidden="true">
                  {#if thumb}
                    <img
                      src={thumb}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      on:error={() => imageError(row.image, thumb)}
                    />
                  {/if}
                </span>
                <span class="row-text">
                  <span class="row-name">{row.name}</span>
                  {#if row.blurb}<span class="row-blurb">{row.blurb}</span>{/if}
                </span>
                {#if row.pill}
                  <span class="pill" title="{row.pill.split(' ')[0]} posts in the last 2 weeks"
                    >{row.pill}</span
                  >
                {/if}
              </button>
            </li>
          {/each}
        </ul>
        <button type="button" class="browse" on:click={() => dispatch('browse')}>
          Browse all topics
        </button>
      </RailCard>
    {/if}

    {#if picked && pickedEvent}
      <div in:fade={fadeIn}>
        <RailCard panel title="Around the table">
          <!-- Keyed: AuthorName and Avatar load their profile once, on mount,
             so a new pick needs fresh ones. -->
          {#key picked.id}
            <a class="talk" href={noteHref(picked.id)} in:fade={fadeIn}>
              {#if pickedPhoto}
                <span class="talk-photo">
                  <img
                    src={pickedPhoto}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    on:error={() => imageError(pickedImage, pickedPhoto)}
                  />
                </span>
              {/if}
              {#if pickedText}<span class="talk-text">{pickedText}</span>{/if}
              <span class="talk-by">
                <Avatar pubkey={picked.pubkey} size={24} showRing={false} interactive={false} />
                <AuthorName event={pickedEvent} className="talk-author" interactive={false} />
                <span class="talk-age">· {formatTimeAgo(picked.created_at)}</span>
              </span>
              <span class="talk-replies">
                {pickedReplies}
                {pickedReplies === 1 ? 'reply' : 'replies'} · Join the conversation
              </span>
            </a>
          {/key}
        </RailCard>
      </div>
    {/if}

    <div class="lazy" use:near={{ go: wantCooks, armed: settled }} aria-hidden="true"></div>
    {#if cooksShown.length}
      <div in:fade={fadeIn}>
        <RailCard panel title="Cooks to follow">
          <ul class="list">
            {#each cooksShown as c (c.pubkey)}
              <li>
                <a class="row" href={c.href}>
                  <Avatar
                    pubkey={c.pubkey}
                    imageUrl={c.picture ?? null}
                    size={40}
                    showRing={false}
                    interactive={false}
                  />
                  <span class="row-text">
                    <span class="row-name">{c.name}</span>
                    {#if c.about}<span class="row-blurb one-line">{c.about}</span>{/if}
                  </span>
                  {#if $userPublickey}
                    <FollowButton pubkey={c.pubkey} size="sm" />
                  {/if}
                </a>
              </li>
            {/each}
          </ul>
        </RailCard>
      </div>
    {/if}

    <div class="lazy" use:near={{ go: wantReads, armed: settled && cookList !== null }} aria-hidden="true"></div>
    {#if readsShown.length}
      <div in:fade={fadeIn}>
        <RailCard panel title="Fresh reads">
          <ul class="list reads">
            {#each readsShown as a (a.id)}
              {@const cover =
                a.imageUrl && !failed.has(a.imageUrl) ? src(a.imageUrl, 160, original) : ''}
              <li>
                <a class="row read" href={a.articleUrl}>
                  <span class="read-cover" aria-hidden="true">
                    {#if cover}
                      <img
                        src={cover}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        on:error={() => a.imageUrl && imageError(a.imageUrl, cover)}
                      />
                    {/if}
                  </span>
                  <span class="row-text">
                    <span class="read-title">{a.title}</span>
                    <AuthorName event={a.event} className="read-author" interactive={false} />
                  </span>
                </a>
              </li>
            {/each}
          </ul>
        </RailCard>
      </div>
    {/if}
  {/if}
</RightRail>

<style>
  .lead {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
    margin-top: -0.375rem;
  }
  .list {
    display: flex;
    flex-direction: column;
    margin: 0 -0.5rem;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.375rem 0.5rem;
    border-radius: 0.75rem;
    text-align: left;
    color: var(--color-text-primary);
    transition: background-color 0.15s;
  }
  .row:hover {
    background-color: var(--color-input-bg);
  }
  .row:focus-visible,
  .browse:focus-visible,
  .talk:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  /* 48px, rounded; a neutral tile until the relay sends pictures. */
  .thumb {
    position: relative;
    flex: none;
    width: 3rem;
    height: 3rem;
    border-radius: 0.75rem;
    overflow: hidden;
    background-color: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
  }
  .thumb img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .row-text {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
  .row-name {
    font-size: 0.9375rem;
    font-weight: 600;
    line-height: 1.3;
  }
  /* Lazy-load markers: no height, so a hidden panel leaves no gap. */
  .lazy {
    height: 0;
    margin: -0.75rem 0;
  }
  .row-blurb.one-line {
    -webkit-line-clamp: 1;
    line-clamp: 1;
  }
  .read {
    align-items: flex-start;
  }
  /* A 4:3 cover thumbnail beside the title. */
  .read-cover {
    position: relative;
    flex: none;
    width: 4.5rem;
    height: 3.375rem;
    border-radius: 0.625rem;
    overflow: hidden;
    background-color: var(--color-input-bg);
  }
  .read-cover img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .read-title {
    font-size: 0.9375rem;
    font-weight: 600;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .row :global(.read-author) {
    font-size: 0.8125rem;
    color: var(--color-caption);
    margin-top: 0.125rem;
  }
  .row-blurb {
    font-size: 0.8125rem;
    line-height: 1.35;
    color: var(--color-caption);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .pill {
    flex: none;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
    color: var(--color-text-secondary);
    background-color: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
  }
  .browse {
    align-self: flex-start;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-primary);
    border-radius: 0.375rem;
  }
  .browse:hover {
    text-decoration: underline;
  }
  .talk {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    color: var(--color-text-primary);
  }
  /* The post's first picture: ~120px, cropped. */
  .talk-photo {
    position: relative;
    display: block;
    height: 7.5rem;
    border-radius: 0.75rem;
    overflow: hidden;
    background-color: var(--color-input-bg);
  }
  .talk-photo img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .talk-text {
    font-size: 1.0625rem;
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .talk-by {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
    font-size: 0.8125rem;
  }
  .talk-by :global(.talk-author) {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .talk-age {
    color: var(--color-caption);
    white-space: nowrap;
  }
  .talk-replies {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-primary);
  }
</style>
