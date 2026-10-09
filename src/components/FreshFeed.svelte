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
   * Every reader reaches "You're all caught up" at the end of the last 14
   * days ($lib/freshFeed/finishLine). "Keep exploring" opens an opt-in
   * section of archive moments; members then page on into history with
   * "Older posts" (logging in to the relay once; see memberLogin.ts).
   * Non-members get the membership card there.
   */
  import { onMount, onDestroy, tick } from 'svelte';
  import { browser } from '$app/environment';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { ndk, userPublickey } from '$lib/nostr';
  import type { LiveTail } from '$lib/freshFeed/relay';
  import { getAuthManager } from '$lib/authManager';
  import { batchFetchEngagement, cleanupEngagement, fetchEngagement } from '$lib/engagementCache';
  import { prefetchReplyContexts } from '$lib/replyContext';
  import { noteImage, saveImage, engagementFor } from '$lib/freshFeed/shareImage';
  import type { EngagementData as ShareEngagementData } from '$lib/shareNoteImage';
  import { muteListStore } from '$lib/muteListStore';
  import { isHellthread } from '$lib/notificationUtils';
  import {
    membershipStatusMap,
    queueMembershipLookup,
    refreshMembership
  } from '$lib/stores/membershipStatus';
  import { freshSession } from '$lib/freshFeed/session';
  import { takeFirstPage } from '$lib/freshFeed/firstPage';
  import { floorPrompt } from '$lib/freshFeed/floorPrompt';
  import { PAGE_SIZE, type PageEnd, type PageResult, type RelayEvent } from '$lib/freshFeed/relay';
  import { passesFreshFilters, passesReaderFilters } from '$lib/freshFeed/posts';
  import { RECIPE_TAGS } from '$lib/consts';
  import {
    buildPool,
    loadSeen,
    markSeen,
    pickRandom,
    recipeAddress
  } from '$lib/freshFeed/recipeBox';
  import { topTopics } from '$lib/freshFeed/recipeBoxCard';
  import { beginVisit, recordNewest, withDivider } from '$lib/freshFeed/lastVisit';
  import { spaceAuthors, StreamSpacer } from '$lib/freshFeed/spacing';
  import { recipePool } from '$lib/freshFeed/recipePool';
  import { needsFullReload } from '$lib/freshFeed/refreshTop';
  import {
    Slots,
    capsFor,
    placeSpecials,
    type PlacedSlot,
    type Special
  } from '$lib/freshFeed/specials';
  import type { SpecialType } from '$lib/freshFeed/specialsConfig';
  import {
    SpecialsLoader,
    specialsTabSession,
    type ExploreContent
  } from '$lib/freshFeed/specialsLoader';
  import { SpecialsFlow } from '$lib/freshFeed/specialsFlow';
  import { declinedNow, topicGate } from '$lib/freshFeed/topicGate';
  import {
    hideTopic,
    loadShown,
    loadTopicHistory,
    markShown,
    markTopicShown,
    showFewer,
    specialsPrefs
  } from '$lib/freshFeed/specialsPrefs';
  import FreshSpecialCard from './FreshSpecialCard.svelte';
  import FreshMemberPitch from './FreshMemberPitch.svelte';
  import FreshFinishLine from './FreshFinishLine.svelte';
  import { finishLine, type ExploreState } from '$lib/freshFeed/finishLine';
  import { SPECIALS } from '$lib/freshFeed/specialsConfig';
  import FreshPostCard from './FreshPostCard.svelte';
  import FreshReportModal from './FreshReportModal.svelte';
  import ZapModal from './ZapModal.svelte';
  import ShareModal from './ShareModal.svelte';
  import MediaLightbox from './MediaLightbox.svelte';
  import FeedErrorBoundary from './FeedErrorBoundary.svelte';
  import FeedPostSkeleton from './FeedPostSkeleton.svelte';
  import LoadingState from './LoadingState.svelte';
  import FreshFloorCard from './FreshFloorCard.svelte';
  import FreshTopicsSheet from './FreshTopicsSheet.svelte';
  import FreshTopicChips from './FreshTopicChips.svelte';
  import { loadTopics, type Topic, type TopicCatalog } from '$lib/freshFeed/topicList';
  import { buildTopicChips, type TopicChip } from '$lib/freshFeed/topicChips';
  import {
    archiveMonths,
    dropEmptyHeaders,
    isEarlyDays,
    yearsAgoLabel,
    type Month
  } from '$lib/freshFeed/archive';
  import { loadOnThisDay, MonthPager, type ArchiveState } from '$lib/freshFeed/archiveLoader';
  import FreshOnThisDayCard from './FreshOnThisDayCard.svelte';

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
  // The finish line: drawn after the last post of the free window, so older
  // posts (members, "Older posts") follow below it instead of moving it.
  let finishAfter: string | null = null;
  // Reached the end of the window, with or without a visible post to anchor
  // the finish line (every post muted: it goes at the end of the list).
  let reachedFloor = false;
  let exploreState: ExploreState = 'closed';
  let exploreContent: ExploreContent | null = null;
  let stopLive: (() => void) | null = null;
  let liveTail: LiveTail | null = null;
  let destroyed = false;

  // Engagement mounts as a post nears the screen (OnlyFood's pattern).
  let visibleNotes = new Set<string>();
  let expanded = new Set<string>();
  const batched = new Set<string>();
  let batchTimer: ReturnType<typeof setTimeout> | null = null;
  // Posts reported this session: hidden at once.
  let hidden = new Set<string>();

  // Special cards ($lib/freshFeed/specials): the recipe box (older recipes,
  // random from those this device hasn't shown), topic spotlights and
  // memories, in jittered slots that are decided after the first page.
  // The first page renders as its posts arrive (firstStreaming), before the
  // relay's EOSE; firstGen drops a stream a refresh has replaced.
  let firstStreaming = false;
  let firstGen = 0;
  let boxPool: RelayEvent[] = [];
  let poolRequested = false;
  let boxSeen = loadSeen(Math.floor(Date.now() / 1000));
  const boxTaken = new Set<string>();
  const boxAddress = new Map<string, string>();
  // Topic chips on recipe-box cards: the relay's labels, members only.
  let boxTopicLabels: RelayEvent[] = [];
  $: boxTopics = topTopics(boxTopicLabels, catalog.groups);

  // The reader's choices and this device's "already shown" memory never
  // leave the device ($lib/freshFeed/specialsPrefs).
  const prefs = specialsPrefs();
  const specialsSession = specialsTabSession();
  let slots = new Slots();
  // Decided slots by anchor post id (special: null = skipped).
  let placed = new Map<string, PlacedSlot & { key: string }>();
  let decided = 0;
  let slotSeq = 0;
  let specialsStarted = false;
  let shownPosts = loadShown(Math.floor(Date.now() / 1000));
  let topicHistory = loadTopicHistory();
  const wrapped = new Map<string, Post>();

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

  // Topic feeds (members): the picker, and the open topic's own list.
  let topicsOpen = false;
  let catalog: TopicCatalog = { groups: [], featured: null };
  let topicsLoading = false;
  let topic: Topic | null = null;
  let topicPosts: Post[] = [];
  let topicSeen = new Set<string>();
  let topicUntil: number | undefined;
  let topicEnd: PageEnd | 'locked' | 'unavailable' = 'more';
  let topicLoading = false;

  // Archive views (members): "On this day" and the time machine
  // ($lib/freshFeed/archive). Labeled posts only. The full views behind the
  // preview cards: a non-member who opens one gets the membership pitch.
  let pitch: { what: 'topic' | 'day' | 'archive'; name?: string } | null = null;
  let pitchOpen = false;
  const TIME_MACHINE = '@time-machine';
  let archiveView: 'day' | 'month' | null = null;
  let archiveState: ArchiveState | 'loading' = 'loading';
  let archiveRows: { key: string; header?: string; post?: Post }[] = [];
  let archiveGen = 0;
  const months = archiveMonths(new Date());
  let month: Month = months[0];
  let monthKey = month.key;
  let pager: MonthPager | null = null;
  let monthLoading = false;
  let monthDone = false;
  let monthLabeled = 0;
  // The caught-up card's counts: loaded once, only on an already logged-in
  // connection (null = not loaded).
  let dayCounts: { yearsBack: number; count: number }[] | null = null;
  let dayCardTried = false;

  $: pk = $userPublickey ? $userPublickey.toLowerCase() : '';
  $: member = !!pk && $membershipStatusMap[pk]?.active === true;
  // Until the app's membership lookup answers, a member would briefly see
  // the membership pitch: hold the card back until then.
  // A failed lookup (`unresolved`) is unknown too, not "not a member": the
  // archive offers a retry instead of the membership pitch.
  $: membershipUnresolved = !!pk && $membershipStatusMap[pk]?.unresolved === true;
  $: membershipKnown = !pk || (pk in $membershipStatusMap && !membershipUnresolved);
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

  /**
   * A page's posts into the feed. The first page streams (`firstPage`): its
   * posts were placed as they arrived and stay where they are; the page's
   * end only adds what is still missing. Later pages are spaced after what
   * is on screen.
   */
  function apply(r: PageResult, firstPage?: StreamSpacer<Post>) {
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
    let added: Post[];
    if (firstPage) {
      added = firstPage.finish(r.events.filter((e) => !firstPage.has(e.id)).map(wrap));
      posts = firstPage.placed;
    } else {
      added = spaceAuthors(posts, r.events.map(wrap));
      posts = [...posts, ...added];
    }
    decideSlots();
    if (posts[0]) recordNewest(posts[0].raw.created_at);
    if (added.length)
      prefetchReplyContexts(
        $ndk,
        added.map((p) => p.event)
      ).catch(() => {});
    if (r.nextUntil !== undefined) nextUntil = r.nextUntil;
    end = r.end ?? 'more';
    // A page that ended early (relay silence, dropped connection) is shown
    // as it is, and the rest is asked for once on its own; after that the
    // usual Load More / Retry is there.
    if (r.partial) {
      if (!partialRetryTimer && !partialRetried) {
        partialRetried = true;
        partialRetryTimer = setTimeout(() => {
          partialRetryTimer = null;
          if (!destroyed && !loading) loadMore();
        }, PARTIAL_RETRY_MS);
      }
    } else {
      partialRetried = false;
    }
    void reviveLive();
  }

  /** One automatic continuation after a partial page, then manual. */
  const PARTIAL_RETRY_MS = 1000;
  let partialRetried = false;
  let partialRetryTimer: ReturnType<typeof setTimeout> | null = null;

  let poolLoad: Promise<void> | null = null;
  /**
   * The recipe-box pool, when a card first needs it (a slot within a few
   * screens, or Keep exploring), from the tab's cache when it has it
   * ($lib/freshFeed/recipePool). Not on load: it is the biggest download of
   * a /feed visit and most readers never reach the first card.
   */
  function ensurePool(): Promise<void> {
    if (!poolLoad) {
      poolRequested = true;
      poolLoad = loadPool();
    }
    return poolLoad;
  }
  async function loadPool() {
    const r = await recipePool(client, RECIPE_TAGS);
    if (destroyed) return;
    if (r.state !== 'ok') {
      poolRequested = false; // the next need tries again
      poolLoad = null;
      return;
    }
    boxPool = buildPool(r.events, Math.floor(Date.now() / 1000));
    decideSlots();
  }

  // A card whose recipe was reported, whose author was muted, or whose topic
  // was hidden drops out; with special cards off, none show.
  $: visibleSlots = visiblePlaced(placed, $prefs, hidden, $muteListStore.muteList);
  $: rendered = placeSpecials(shown, visibleSlots);

  // "New since your last visit": the previous visit's mark, fixed for this
  // session (device-local; $lib/freshFeed/lastVisit).
  const visitMark = beginVisit();
  $: rows = withDivider(rendered, visitMark);
  $: caughtUp = visitMark !== null && shown.length > 0 && shown[0].raw.created_at <= visitMark;

  function postFor(raw: RelayEvent): Post {
    let p = wrapped.get(raw.id);
    if (!p) wrapped.set(raw.id, (p = wrap(raw)));
    return p;
  }

  function accepted(e: RelayEvent): boolean {
    return passesReaderFilters(e, {
      muteList: pk ? $muteListStore.muteList : null,
      isHellthread: () => isHellthread(postFor(e).event)
    });
  }

  function cardPosts(sp: Special): RelayEvent[] {
    return sp.type === 'recipe' ? [sp.post] : sp.posts;
  }

  /** Posts on screen in the feed or a card: no card repeats them. */
  function onScreenIds(): Set<string> {
    const ids = new Set(posts.map((p) => p.raw.id));
    for (const slot of placed.values())
      if (slot.special) for (const e of cardPosts(slot.special)) ids.add(e.id);
    return ids;
  }

  const loader = new SpecialsLoader(
    client,
    {
      member: () => member,
      groups: () => catalog.groups,
      hiddenTopics: () => $prefs.hiddenTopics,
      shown: () => shownPosts,
      exclude: onScreenIds,
      accept: accepted,
      topicHistory: () => topicHistory
    },
    specialsSession
  );

  // One spotlight and one memory kept ready, with retries (empty, or the
  // relay refusing previews) ($lib/freshFeed/specialsFlow). Spotlights are
  // previews for everyone; memories are members-only and load only on a
  // logged-in feed connection. Nothing here logs in or asks the signer.
  const flow = new SpecialsFlow({ loader, onReady: () => void decideSlots() });

  // A member whose key signs silently (nsec in the app, passkey vault) is
  // logged in to the feed on load — no prompt, same as the pantry relay's
  // NIP-42 policy — so opening a topic or the archive is immediate. Members
  // with a prompting signer (extension, Amber, bunker) are never asked on
  // their own: the one prompt comes when they open a full view (a topic,
  // "on this day", the time machine), once per session; a decline anywhere
  // holds for the session (the view's button asks again, by hand).
  let autoLoginTried = false;
  // The signer is restored asynchronously after the pubkey is known; the
  // auth manager's store says when it is there (login.silent reads it).
  let signerReady = false;
  $: if (
    member &&
    !loading &&
    signerReady &&
    !autoLoginTried &&
    login.silent &&
    $loginState === 'idle'
  ) {
    autoLoginTried = true;
    void autoLogin();
  }
  async function autoLogin() {
    try {
      const relay = await client.connection();
      if (destroyed) return;
      await login.access(relay);
    } catch {
      // Connection failed: the feed already shows its unavailable state.
    }
  }

  function visiblePlaced(
    all: typeof placed,
    p: typeof $prefs,
    hiddenIds: Set<string>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _mutes: unknown
  ): typeof placed {
    if (p.off) return new Map();
    const out: typeof placed = new Map();
    for (const [id, slot] of all) {
      const sp = slot.special;
      if (!sp || id === finishAfter) continue;
      if (sp.type === 'recipe' && (hiddenIds.has(sp.post.id) || !accepted(sp.post))) continue;
      if (sp.type === 'spotlight' && p.hiddenTopics.includes(sp.slug)) continue;
      out.set(id, slot);
    }
    return out;
  }

  /** A random recipe-box recipe for the next slot (none until the pool loads). */
  function nextRecipe(): RelayEvent | null {
    if (boxPool.length === 0) return null;
    // Recipes already in the feed (members paging history) aren't picked.
    const inFeed = new Set(
      posts
        .filter((p) => p.raw.kind === 30023 || p.raw.kind === 35000)
        .map((p) => recipeAddress(p.raw))
    );
    const usable = boxPool.filter((e) => !inFeed.has(recipeAddress(e)) && accepted(e));
    return pickRandom(usable, boxSeen, boxTaken);
  }

  function takeSpecial(type: SpecialType, recipe: RelayEvent | null): Special | null {
    if (type === 'recipe') {
      if (!recipe) return null;
      const address = recipeAddress(recipe);
      boxTaken.add(address);
      boxAddress.set(recipe.id, address);
      loadBoxTopics([recipe.id]);
      return { type: 'recipe', post: recipe };
    }
    if (type === 'spotlight') {
      const sp = loader.takeSpotlight();
      prepare('spotlight');
      return sp;
    }
    const m = loader.takeMemory();
    prepare('memory');
    return m;
  }

  /**
   * Decide the slots the feed has reached, in order: a slot gets the
   * rotation's next ready card while its place is still below the screen;
   * once the reader is at or past it, it is skipped, so nothing is ever
   * inserted above (or into) what they're reading. A slot with nothing
   * ready waits. Never while the first page loads.
   */
  async function decideSlots() {
    await tick();
    if (destroyed || loading || firstStreaming || $prefs.off) return;
    const anchors = slots.upTo(shown.length);
    const caps = capsFor($prefs);
    const screenBottom = window.innerHeight;
    let changed = false;
    while (decided < anchors.length) {
      const anchor = shown[anchors[decided] - 1];
      const el =
        anchor && document.querySelector(`[data-fresh-row="${CSS.escape(anchor.raw.id)}"]`);
      if (!anchor || !el) break;
      const id = anchor.raw.id;
      const bottom = el.getBoundingClientRect().bottom;
      // The first card is a few screens down: ask for the recipe pool once
      // the reader is within reach of it, not on load.
      if (!poolRequested && bottom <= screenBottom * 3) void ensurePool();
      if (bottom <= screenBottom) {
        placed.set(id, { anchorId: id, key: `sp:${slotSeq++}`, special: null });
        decided++;
        changed = true;
        continue;
      }
      const recipe = nextRecipe();
      // Spotlights: the preview the loader has ready (the same for
      // everyone); while the relay refuses previews the type is not
      // available at all, so recipe cards keep coming instead of waiting on
      // it (the rotation never repeats a type while another is available).
      // Memories: members only, and only once the feed login
      // counts (a local key on load; a prompting signer after it opened a
      // topic or the archive) — until then the type isn't available and the
      // rotation skips it (an "available but never ready" type would stop
      // the others from repeating). A type out of unshown content is
      // skipped too.
      const ready = (t: SpecialType) =>
        t === 'recipe'
          ? recipe !== null
          : (t === 'spotlight' ? loader.spotlight : loader.memory) !== null;
      const available = (t: SpecialType) =>
        t === 'recipe'
          ? true
          : t === 'spotlight'
            ? !loader.isOut('spotlight') && loader.previewHoldLeftMs() === 0
            : member && client.authedNow() && loader.memberAccess() && !loader.isOut('memory');
      if (!(['recipe', 'spotlight', 'memory'] as SpecialType[]).some(ready)) break;
      // More than a screen away: wait for the rotation's own type.
      const strict = bottom > screenBottom * 2;
      const type = specialsSession.rotation.choose(ready, caps, $prefs, strict, available);
      const special = type ? takeSpecial(type, recipe) : null;
      if (!type || !special) break;
      specialsSession.rotation.record(type);
      placed.set(id, { anchorId: id, key: `sp:${slotSeq++}`, special });
      decided++;
      changed = true;
    }
    if (changed) placed = placed;
  }

  /** Keep one of each ready; an empty or refused try is retried (specialsFlow). */
  function prepare(kind: 'spotlight' | 'memory') {
    flow.prepare(kind);
  }

  // Spotlights (previews, for everyone) start loading after the first page,
  // once the topic catalog is there to pick from; no login is involved.
  // Memories (members) start when the feed login counts: at once for a
  // local key logged in on load, otherwise after the login a topic or
  // archive open made (reloadExploreAfterLogin). Never a prompt for a card.
  let spotlightsStarted = false;
  $: if (!loading && posts.length && !$prefs.off && !specialsStarted) {
    specialsStarted = true;
    if (member && client.authedNow()) prepare('memory');
  }
  $: if (specialsStarted && catalog.groups.length && !spotlightsStarted) {
    spotlightsStarted = true;
    prepare('spotlight');
  }

  function cardSeen(sp: Special) {
    const now = Math.floor(Date.now() / 1000);
    const ids = cardPosts(sp).map((e) => e.id);
    if (ids.length) shownPosts = markShown(shownPosts, ids, now);
    if (sp.type === 'spotlight') topicHistory = markTopicShown(topicHistory, sp.slug, now);
  }

  function fewer(type: SpecialType) {
    showFewer(type);
    notice = "Got it: you'll see fewer of these. Settings → Fresh undoes it.";
  }

  function hideSpotlightTopic(slug: string) {
    hideTopic(slug);
    notice = 'Topic hidden from spotlights. Settings → Fresh shows it again.';
  }

  function openTopicSlug(slug: string) {
    for (const g of catalog.groups) {
      const t = g.topics.find((x) => x.slug === slug);
      if (t) return openTopic(t);
    }
  }

  /** The gate on the full views: a non-member (or signed out) gets the pitch instead. */
  function gated(what: 'topic' | 'day' | 'archive', name?: string): boolean {
    if (topicGate({ signedIn: !!pk, member, membershipKnown }) === 'open') return false;
    pitch = { what, name };
    pitchOpen = true;
    return true;
  }

  /** A memory card's link: the full "on this day", or the time machine at its month. */
  function openMemory(sp: Extract<Special, { type: 'memory' }>) {
    if (sp.variant === 'day') openOnThisDay();
    else openTimeMachine(sp.monthKey ?? monthKey);
  }

  /**
   * Members' topic labels for new picks; nothing is asked for anyone else.
   * Picks made before the connection was a member's wait in
   * `topicsPending` and are asked for once the feed login succeeds.
   */
  const topicsPending = new Set<string>();
  async function loadBoxTopics(ids: string[]) {
    const labels = await client.topicLabels(ids);
    if (destroyed) return;
    if (labels === null) {
      for (const id of ids) topicsPending.add(id);
      return;
    }
    if (labels.length) boxTopicLabels = [...boxTopicLabels, ...labels];
  }
  $: if ($loginState === 'authed' && topicsPending.size > 0) {
    const ids = [...topicsPending];
    topicsPending.clear();
    loadBoxTopics(ids);
  }

  async function loadFirst() {
    // Picks never seen go back in the pool; seen ones are remembered. The
    // session's caps and rotation carry on (specialsTabSession).
    boxTaken.clear();
    slots = new Slots();
    placed = new Map();
    decided = 0;
    loading = true;
    unavailable = false;
    moreFailed = false;
    finishAfter = null;
    reachedFloor = false;
    exploreState = 'closed';
    exploreContent = null;
    end = 'more';
    nextUntil = undefined;
    pending = [];
    stopLive?.();
    stopLive = null;
    posts = [];
    // The live tail overlaps the first page a little (duplicates are
    // skipped), so nothing posted while it loaded (or since /feed started
    // it early) is missed.
    const since = Math.floor(Date.now() / 1000) - 60;
    const gen = ++firstGen;
    firstStreaming = true;
    // Posts are placed as they arrive, authors spaced on the way; nothing
    // placed moves when the page ends (no row jump at EOSE).
    const spacer = new StreamSpacer<Post>();
    const onEvent = (raw: RelayEvent) => {
      if (destroyed || gen !== firstGen) return;
      posts = spacer.push(wrap(raw));
      // Keep the skeleton until a post survives the display filters (mutes,
      // hellthreads, old edits); otherwise the feed would sit blank.
      if (loading && filterPosts(posts, $muteListStore.muteList, hidden).length) loading = false;
    };
    const r = await takeFirstPage(client, onEvent).result;
    if (destroyed || gen !== firstGen) return;
    firstStreaming = false;
    // The page's end adds what didn't stream (and any held post) after what
    // is on screen; the streamed rows stay exactly where the reader saw them.
    apply(r, spacer);
    loading = false;
    decideSlots();
    if (!unavailable) startLive(since);
  }

  async function loadMore() {
    // Not while the first page is still streaming in: its `until` isn't known yet.
    if (loading || loadingMore || firstStreaming || end !== 'more') return;
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

  // The end of the free window: nothing older loads on its own (no
  // automatic archive); the finish line offers "Keep exploring", then
  // "Older posts".
  $: if (end === 'floor' && !loading) reachedFloor = true;
  $: if (reachedFloor && !finishAfter && shown.length) finishAfter = shown[shown.length - 1].raw.id;
  $: finishAnchored = !!finishAfter && shown.some((p) => p.raw.id === finishAfter);
  $: finish = finishLine({
    reached: reachedFloor,
    atFloor: end === 'floor',
    membershipKnown,
    prompt,
    explore: exploreState
  });

  async function openExplore() {
    if (exploreState !== 'closed') return;
    exploreState = 'loading';
    // Tapped before the recipe pool arrived: wait for it (or ask again
    // after a failed load) so the recipe row isn't empty.
    if (boxPool.length === 0) await ensurePool();
    if (destroyed) return;
    const content = await loader.explore(pickRecipes(SPECIALS.explore.recipes));
    if (destroyed) return;
    exploreContent = content;
    exploreState = 'open';
  }

  // A member who logs in to the feed after a decline: archive requests may
  // go again, and an explore section opened without them is reloaded.
  $: if ($loginState === 'authed') reloadExploreAfterLogin();
  async function reloadExploreAfterLogin() {
    loader.loggedIn();
    if (member) {
      // Memory cards can load now (no prompt: the connection is logged in).
      if (specialsStarted) prepare('memory');
      // The caught-up card's counts were asked for on a connection that
      // wasn't logged in (auth-required is not "no posts"): ask again.
      if (dayCounts === null) dayCardTried = false;
    }
    const c = exploreContent;
    if (exploreState !== 'open' || !c || !member || c.day || c.spotlights.length) return;
    exploreState = 'loading';
    const content = await loader.explore(c.recipes);
    if (destroyed) return;
    exploreContent = content;
    exploreState = 'open';
  }

  function postsSeen(events: RelayEvent[]) {
    const now = Math.floor(Date.now() / 1000);
    shownPosts = markShown(
      shownPosts,
      events.map((e) => e.id),
      now
    );
  }

  function recipesSeen(events: RelayEvent[]) {
    const now = Math.floor(Date.now() / 1000);
    for (const e of events) boxSeen = markSeen(boxSeen, recipeAddress(e), now);
  }

  /** Recipes for the explore row: random, unshown, not already on screen. */
  function pickRecipes(n: number): RelayEvent[] {
    const out: RelayEvent[] = [];
    for (let i = 0; i < n; i++) {
      const r = nextRecipe();
      if (!r) break;
      const address = recipeAddress(r);
      boxTaken.add(address);
      boxAddress.set(r.id, address);
      out.push(r);
    }
    return out;
  }

  /** The finish line's log-in button (a member who declined earlier). */
  async function manualLogin() {
    let relay;
    try {
      relay = await client.connection();
    } catch {
      moreFailed = true;
      return;
    }
    await login.access(relay, true);
  }

  function startLive(since: number) {
    client
      .liveTail(since, (raw) => {
        pending = [wrap(raw), ...pending];
      })
      .then((tail) => {
        if (destroyed) tail.stop();
        else {
          liveTail = tail;
          stopLive = () => tail.stop();
        }
      });
  }

  /**
   * The socket under the live tail closed (iOS suspends sockets in the
   * background; idle drops): subscribe again from the newest post seen when
   * the tab comes back, the network returns, or any page request succeeds
   * (which already opened a fresh connection).
   */
  async function reviveLive() {
    if (destroyed || !liveTail?.lost) return;
    await liveTail.revive();
  }

  function showPending() {
    posts = [...spaceAuthors([], pending), ...posts];
    pending = [];
    decideSlots();
    if (posts[0]) recordNewest(posts[0].raw.created_at);
    document.getElementById('app-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * Pull-to-refresh on /feed: newer posts go on top (with any waiting behind
   * "N new posts"); what's loaded stays put. A full reload only when the
   * newer posts would leave a hole, or nothing has loaded yet.
   */
  export async function refresh(): Promise<void> {
    // Not while the first page streams in: a second page on the same client
    // would mark its posts seen and empty the first page's result.
    if (loading || firstStreaming) return;
    const top = posts.length ? Math.max(...posts.map((p) => p.raw.created_at)) : null;
    if (top === null || unavailable) return loadFirst();
    const r = await client.page();
    if (destroyed) return;
    if (r.state !== 'ok') {
      moreFailed = true;
      return;
    }
    if (needsFullReload(r.events, PAGE_SIZE, top)) return loadFirst();
    const pendingIds = new Set(pending.map((p) => p.raw.id));
    pending = [...r.events.filter((e) => !pendingIds.has(e.id)).map(wrap), ...pending];
    if (pending.length) showPending();
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

  // --- Topic feeds ---

  $: topicShown = topicPosts.filter(
    (p) =>
      !hidden.has(p.raw.id) &&
      passesReaderFilters(p.raw, {
        muteList: pk ? $muteListStore.muteList : null,
        isHellthread: () => isHellthread(p.event)
      })
  );

  // The chip row (All · featured · busy groups · More). A topic opened
  // from the full sheet that isn't a chip gets a chip of its own, after All.
  // The time machine sits right after All.
  $: chips = [
    ...buildTopicChips(catalog.groups, catalog.featured).slice(0, 1),
    { slug: TIME_MACHINE, label: 'Time machine', name: 'Time machine', kind: 'archive' as const },
    ...buildTopicChips(catalog.groups, catalog.featured).slice(1)
  ];
  $: chipRow =
    topic && !chips.some((c) => c.slug === topic?.slug)
      ? [
          chips[0],
          { slug: topic.slug, label: topic.name, name: topic.name, kind: 'featured' as const },
          ...chips.slice(1)
        ]
      : chips;
  $: activeChip =
    archiveView === 'month' ? TIME_MACHINE : archiveView === 'day' ? '@day' : (topic?.slug ?? '');
  // Topic feeds are for members: everyone else sees a lock on the chips.
  // (A relay `restricted:` is not a lock: the app's membership answer decides,
  // and the topic view offers a retry.)
  $: topicsLocked = !pk || (membershipKnown && !member);

  async function refreshCatalog() {
    topicsLoading = true;
    catalog = await loadTopics();
    topicsLoading = false;
  }

  async function openTopics() {
    topicsOpen = true;
    if (!catalog.groups.length) await refreshCatalog();
  }

  function pickChip(chip: TopicChip) {
    if (chip.kind === 'archive') return openTimeMachine();
    closeArchive();
    if (chip.kind === 'all') closeTopic();
    else openTopic({ slug: chip.slug, name: chip.name, count14d: 0 });
  }

  // --- Archive views ---

  // Members only, the same rule as topic feeds: opening a view as a
  // non-member is the membership pitch (gated), and no request is sent.
  $: archiveLocked = topicsLocked;

  function wrapAll(list: RelayEvent[]): Post[] {
    return list.map(wrap);
  }

  function closeArchive() {
    archiveGen++;
    archiveView = null;
    archiveRows = [];
    pager = null;
  }

  function startArchive(view: 'day' | 'month') {
    if (gated(view === 'day' ? 'day' : 'archive')) return false;
    closeTopic();
    archiveGen++;
    archiveView = view;
    archiveRows = [];
    archiveState = archiveLocked ? 'auth-required' : 'loading';
    document.getElementById('app-scroll')?.scrollTo({ top: 0 });
    return !archiveLocked;
  }

  async function openOnThisDay() {
    if (!startArchive('day')) return;
    const gen = archiveGen;
    // A prompting signer is asked here, once per session (loadOnThisDay →
    // history → the feed login); a decline goes back to the feed.
    const loginBefore = $loginState;
    const r = await loadOnThisDay(client, new Date());
    if (destroyed || gen !== archiveGen) return;
    if (r.state === 'auth-required' && declinedNow(loginBefore, $loginState)) return backToFeed();
    archiveState = r.state;
    const fmt = (s: number) =>
      new Date(s * 1000).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    archiveRows = r.sections.flatMap((sec) => [
      {
        key: 'h' + sec.yearsBack,
        header: `${yearsAgoLabel(sec.yearsBack)} · ${fmt(sec.window.since)}`
      },
      ...wrapAll(sec.posts).map((post) => ({ key: post.raw.id, post }))
    ]);
    if (r.state === 'ok')
      dayCounts = r.sections.map((x) => ({ yearsBack: x.yearsBack, count: x.posts.length }));
  }

  function openTimeMachine(key = monthKey) {
    if (!startArchive('month')) return;
    month = months.find((m) => m.key === key) ?? months[0];
    monthKey = month.key;
    pager = new MonthPager(client, month);
    // The new pager owns the flag; a page still in flight for the old one
    // returns without touching it.
    monthLoading = false;
    monthDone = false;
    monthLabeled = 0;
    loadMonthPage();
  }

  async function loadMonthPage() {
    const p = pager;
    if (!p || monthLoading || p.done) return;
    const gen = archiveGen;
    monthLoading = true;
    const loginBefore = $loginState;
    const r = await p.next();
    if (destroyed || gen !== archiveGen || p !== pager) return;
    monthLoading = false;
    if (r.state === 'auth-required' && declinedNow(loginBefore, $loginState)) return backToFeed();
    archiveState = r.state;
    archiveRows = [...archiveRows, ...wrapAll(r.posts).map((post) => ({ key: post.raw.id, post }))];
    monthDone = p.done;
    monthLabeled = p.labeled;
  }

  function stepMonth(delta: number) {
    const i = months.findIndex((m) => m.key === monthKey) + delta;
    if (i >= 0 && i < months.length) openTimeMachine(months[i].key);
  }

  /** A member who declined the relay login: one prompt, on this click. */
  async function archiveLogin() {
    // The login can wait on the signer for a while: if the reader closes or
    // changes the view meanwhile, its outcome no longer applies.
    const gen = archiveGen;
    const view = archiveView;
    const key = monthKey;
    let relay;
    try {
      relay = await client.connection();
    } catch {
      if (gen === archiveGen) archiveState = 'unavailable';
      return;
    }
    const ok = await login.access(relay, true);
    if (destroyed || gen !== archiveGen || !ok) return;
    if (view === 'day') openOnThisDay();
    else if (view === 'month') openTimeMachine(key);
  }

  /** A membership lookup that failed: try it again, then reopen the view. */
  async function retryMembership() {
    const gen = archiveGen;
    const view = archiveView;
    const key = monthKey;
    await refreshMembership(pk);
    if (destroyed || gen !== archiveGen) return;
    if (view === 'day') openOnThisDay();
    else if (view === 'month') openTimeMachine(key);
  }

  // Reader filters (mutes, reports, hellthreads), then drop a year heading
  // whose posts were all filtered out.
  $: archiveShown = dropEmptyHeaders(
    archiveRows.filter(
      (r) =>
        !r.post ||
        (!hidden.has(r.post.raw.id) &&
          passesReaderFilters(r.post.raw, {
            muteList: pk ? $muteListStore.muteList : null,
            isHellthread: () => isHellthread(r.post!.event)
          }))
    )
  );

  // The caught-up card: counts only on a connection that's already logged
  // in (authedOnly: it never prompts the signer); otherwise an Open button.
  async function loadDayCard() {
    dayCardTried = true;
    const r = await loadOnThisDay(client, new Date(), { authedOnly: true });
    if (destroyed || r.state !== 'ok') return;
    dayCounts = r.sections.map((x) => ({ yearsBack: x.yearsBack, count: x.posts.length }));
  }
  $: atCaughtUp = caughtUp || rows.some((r) => r.divider);
  $: dayCardMode = (
    !membershipKnown
      ? null
      : archiveLocked
        ? 'teaser'
        : dayCounts === null
          ? 'invite'
          : dayCounts.length
            ? 'ready'
            : null
  ) as 'teaser' | 'invite' | 'ready' | null;
  // (loadDayCard only sets dayCardTried synchronously, which nothing above
  // depends on: no Svelte stale-statement trap.)
  $: if (atCaughtUp && !archiveLocked && membershipKnown && !dayCardTried) loadDayCard();

  // Each selection (a chip, the sheet, All) gets a new generation: a page
  // still in flight for an earlier one is dropped when it lands, and the new
  // selection's first page starts at once instead of waiting on it.
  let topicGen = 0;

  /**
   * The signer prompt was declined just now: back to the feed and its
   * previews, with a word. The next open shows the view's own "Log in to
   * the feed" button instead of prompting again (a decline holds for the
   * session); nothing retries on its own.
   */
  function backToFeed() {
    closeArchive();
    closeTopic();
    notice = 'No problem — the previews stay. Open a topic again whenever you want to log in.';
  }

  function openTopic(t: Topic) {
    if (gated('topic', t.name)) return;
    if (archiveView) closeArchive();
    topicGen++;
    topicLoading = false;
    topic = t;
    topicPosts = [];
    topicSeen = new Set();
    topicUntil = undefined;
    topicEnd = 'more';
    document.getElementById('app-scroll')?.scrollTo({ top: 0 });
    loadTopicPage();
  }

  function closeTopic() {
    topicGen++;
    topicLoading = false;
    topic = null;
    topicPosts = [];
  }

  async function loadTopicPage() {
    if (!topic || topicLoading || topicEnd !== 'more') return;
    const gen = topicGen;
    topicLoading = true;
    // A prompting signer is asked here, once per session (client.topic →
    // the feed login); a decline goes back to the feed.
    const loginBefore = $loginState;
    const r = await client.topic(topic.slug, topicSeen, topicUntil);
    // A newer selection owns topicLoading and the list now.
    if (gen !== topicGen) return;
    topicLoading = false;
    if (destroyed) return;
    if (r.state === 'auth-required' && declinedNow(loginBefore, $loginState)) return backToFeed();
    if (r.state === 'ok') {
      topicPosts = [...topicPosts, ...spaceAuthors(topicPosts, r.events.map(wrap))];
      topicUntil = r.nextUntil;
      topicEnd = r.end ?? 'exhausted';
    } else if (r.state === 'unavailable') {
      topicEnd = 'unavailable';
    } else {
      // auth-required / restricted: the membership card or the login button.
      topicEnd = 'locked';
    }
  }

  async function topicLogin() {
    let relay;
    try {
      relay = await client.connection();
    } catch {
      topicEnd = 'unavailable';
      return;
    }
    if (await login.access(relay, true)) {
      topicEnd = 'more';
      loadTopicPage();
    }
  }

  function retryTopic() {
    topicEnd = 'more';
    loadTopicPage();
  }

  /** Infinite scroll: load the next page as the sentinel nears the view. */
  function nearView(node: HTMLElement, load: () => void = loadMore) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((x) => x.isIntersecting)) load();
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
    // The signer is restored by the auth manager, which the layout creates
    // in its own onMount — after this feed's (children mount first). Attach
    // once it exists: read its state (it notifies on changes only) and
    // follow changes from then on.
    const ready = (s: { isAuthenticated: boolean; isLoading: boolean } | undefined) =>
      !!s && s.isAuthenticated && !s.isLoading;
    let unsubAuth: (() => void) | undefined;
    let attachTimer: ReturnType<typeof setTimeout> | undefined;
    const attachAuth = (tries = 40) => {
      if (destroyed) return;
      const auth = getAuthManager();
      if (!auth) {
        if (tries > 0) attachTimer = setTimeout(() => attachAuth(tries - 1), 250);
        return;
      }
      signerReady = ready(auth.getState());
      unsubAuth = auth.subscribe((s) => {
        signerReady = ready(s);
      });
    };
    attachAuth();
    loadFirst();
    // The chip catalog is a small HTTP GET (NIP-11), not on the socket.
    refreshCatalog();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reviveLive();
    };
    const onOnline = () => void reviveLive();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('pageshow', onOnline);
    // A slot waiting for its card is decided as the reader nears it.
    const scroller = document.getElementById('app-scroll');
    let frame = 0;
    const onScroll = () => {
      if (frame || decided >= slots.upTo(shown.length).length) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        decideSlots();
      });
    };
    scroller?.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pageshow', onOnline);
      unsubAuth?.();
      if (attachTimer) clearTimeout(attachTimer);
      scroller?.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  });

  onDestroy(() => {
    destroyed = true;
    flow.dispose();
    if (partialRetryTimer) clearTimeout(partialRetryTimer);
    stopLive?.();
    lazyObserver?.disconnect();
    if (batchTimer) clearTimeout(batchTimer);
    // Release the engagement subscriptions this feed opened.
    batched.forEach((id) => cleanupEngagement(id));
  });
</script>

<FeedErrorBoundary>
  <div class="max-w-2xl mx-auto">
    {#if newCount > 0 && !topic && !archiveView}
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

    <FreshTopicChips
      chips={chipRow}
      active={activeChip}
      locked={topicsLocked}
      on:pick={(e) => pickChip(e.detail)}
      on:more={openTopics}
    />
    {#if archiveView}
      {#if archiveView === 'month'}
        <div class="flex items-center gap-2 mb-4">
          <button
            type="button"
            class="w-10 h-10 text-2xl leading-none rounded-lg hover:bg-accent-gray disabled:opacity-40"
            style="color: var(--color-text-primary)"
            aria-label="Older month"
            disabled={monthKey === months[months.length - 1].key}
            on:click={() => stepMonth(1)}>‹</button
          >
          <select
            class="flex-1 rounded-lg px-3 py-1.5 text-sm"
            style="color: var(--color-text-primary); background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
            aria-label="Month"
            bind:value={monthKey}
            on:change={() => openTimeMachine(monthKey)}
          >
            {#each months as m (m.key)}
              <option value={m.key}>{m.label}</option>
            {/each}
          </select>
          <button
            type="button"
            class="w-10 h-10 text-2xl leading-none rounded-lg hover:bg-accent-gray disabled:opacity-40"
            style="color: var(--color-text-primary)"
            aria-label="Newer month"
            disabled={monthKey === months[0].key}
            on:click={() => stepMonth(-1)}>›</button
          >
        </div>
        {#if archiveState === 'ok' && isEarlyDays(monthLabeled, monthDone)}
          <p class="text-xs mb-4 text-center" style="color: var(--color-caption)">
            Early days: the archive is thin this far back.
          </p>
        {/if}
      {:else}
        <div class="flex items-center justify-between mb-4">
          <h2 class="font-semibold" style="color: var(--color-text-primary)">On this day</h2>
          {#if !archiveLocked}
            <button
              type="button"
              class="text-sm underline"
              style="color: var(--color-caption)"
              on:click={() => openTimeMachine()}
            >
              Browse by month
            </button>
          {/if}
        </div>
      {/if}

      {#if archiveState === 'auth-required' || archiveState === 'restricted'}
        {#if membershipUnresolved}
          <div class="py-8 text-center">
            <p class="text-sm mb-3" style="color: var(--color-caption)">
              Couldn't check your membership.
            </p>
            <button
              type="button"
              class="px-4 py-2 rounded-full text-sm font-medium bg-primary text-white"
              on:click={retryMembership}
            >
              Retry
            </button>
          </div>
        {:else if archiveLocked}
          {#if membershipKnown}
            <FreshOnThisDayCard mode="teaser" signedIn={!!pk} />
          {/if}
        {:else}
          <div class="py-8 text-center">
            <p class="text-sm mb-3" style="color: var(--color-caption)">
              The archive is for members. Log in to the feed relay: it only checks your membership;
              nothing is logged.
            </p>
            <button
              type="button"
              class="px-4 py-2 rounded-full text-sm font-medium bg-primary text-white"
              on:click={archiveLogin}
            >
              Log in to the feed
            </button>
          </div>
        {/if}
      {:else if archiveState === 'unavailable'}
        <div class="py-8 text-center">
          <p class="text-sm mb-3" style="color: var(--color-caption)">
            Couldn't reach the feed relay.
          </p>
          <button
            on:click={() => (archiveView === 'day' ? openOnThisDay() : openTimeMachine(monthKey))}
            class="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            Retry
          </button>
        </div>
      {:else}
        <div class="space-y-6">
          {#each archiveShown as row (row.key)}
            {#if row.header}
              <h3 class="text-sm font-medium pt-2" style="color: var(--color-caption)">
                {row.header}
              </h3>
            {:else if row.post}
              <FreshPostCard
                raw={row.post.raw}
                event={row.post.event}
                visible={visibleNotes.has(row.post.raw.id)}
                expanded={expanded.has(row.post.raw.id)}
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
        {#if archiveState === 'loading' || (archiveView === 'month' && monthLoading)}
          <div class="py-4">
            <LoadingState type="spinner" size="lg" text="Loading the archive..." showText={true} />
          </div>
        {:else if archiveView === 'month' && !monthDone}
          <div use:nearView={loadMonthPage} class="py-4 text-center">
            <button
              on:click={loadMonthPage}
              class="px-4 py-2 bg-input rounded-lg hover:bg-accent-gray transition-colors"
              style="color: var(--color-text-primary)"
            >
              Load More
            </button>
          </div>
        {:else if archiveShown.length === 0}
          <p class="py-8 text-center text-sm" style="color: var(--color-caption)">
            {archiveView === 'day'
              ? 'Nothing from this date in past years yet.'
              : 'No posts in the archive for this month.'}
          </p>
        {:else}
          <p class="py-6 text-center text-sm" style="color: var(--color-caption)">
            {archiveView === 'day'
              ? "That's this day in past years."
              : `That's all of ${month.label}.`}
          </p>
        {/if}
      {/if}
    {:else if topic}
      <div class="space-y-6">
        {#each topicShown as post (post.raw.id)}
          <FreshPostCard
            raw={post.raw}
            event={post.event}
            visible={visibleNotes.has(post.raw.id)}
            expanded={expanded.has(post.raw.id)}
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
        {/each}
      </div>
      {#if topicEnd === 'more'}
        <div use:nearView={loadTopicPage} class="py-4 text-center">
          {#if topicLoading}
            <LoadingState type="spinner" size="lg" text="Loading posts..." showText={true} />
          {:else}
            <button
              on:click={loadTopicPage}
              class="px-4 py-2 bg-input rounded-lg hover:bg-accent-gray transition-colors"
              style="color: var(--color-text-primary)"
            >
              Load More
            </button>
          {/if}
        </div>
      {:else if topicEnd === 'locked'}
        {#if membershipKnown}
          <FreshFloorCard {prompt} context="topic" on:login={topicLogin} />
        {/if}
      {:else if topicEnd === 'unavailable'}
        <div class="py-8 text-center">
          <p class="text-sm mb-3" style="color: var(--color-caption)">
            Couldn't reach the feed relay.
          </p>
          <button
            on:click={retryTopic}
            class="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            Retry
          </button>
        </div>
      {:else if topicShown.length === 0}
        <p class="py-8 text-center text-sm" style="color: var(--color-caption)">
          No posts on this topic yet.
        </p>
      {:else}
        <p class="py-6 text-center text-sm" style="color: var(--color-caption)">
          That's everything on {topic.name}.
        </p>
      {/if}
    {:else if loading}
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
      {#if shown.length === 0 && end !== 'more' && !reachedFloor}
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
        {#if dayCardMode}
          <FreshOnThisDayCard
            mode={dayCardMode}
            signedIn={!!pk}
            counts={dayCounts ?? []}
            on:open={openOnThisDay}
          />
        {/if}
      {/if}
      <div class="space-y-6">
        {#each rows as row, rowIndex (row.key)}
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
            {#if !caughtUp && dayCardMode}
              <FreshOnThisDayCard
                mode={dayCardMode}
                signedIn={!!pk}
                counts={dayCounts ?? []}
                on:open={openOnThisDay}
              />
            {/if}
          {:else if row.box}
            {#if row.special.type === 'recipe'}
              {@const p = postFor(row.special.post)}
              <FreshPostCard
                priority={rowIndex === 0}
                box={true}
                topic={boxTopics.get(p.raw.id) ?? null}
                raw={p.raw}
                event={p.event}
                visible={visibleNotes.has(p.raw.id)}
                expanded={expanded.has(p.raw.id)}
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
                on:fewer={() => fewer('recipe')}
              />
            {:else}
              {@const sp = row.special}
              <FreshSpecialCard
                special={sp}
                toEvent={(raw) => postFor(raw).event}
                locked={topicsLocked}
                on:seen={() => cardSeen(sp)}
                on:fewer={(e) => fewer(e.detail)}
                on:hideTopic={(e) => hideSpotlightTopic(e.detail)}
                on:openTopic={(e) => openTopicSlug(e.detail)}
                on:openMemory={(e) => openMemory(e.detail)}
              />
            {/if}
          {:else}
            <div data-fresh-row={row.item.raw.id}>
              <FreshPostCard
                priority={rowIndex === 0}
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
            </div>
            {#if row.item.raw.id === finishAfter}
              <FreshFinishLine
                state={finish}
                {prompt}
                locked={topicsLocked}
                content={exploreContent}
                toEvent={(raw) => postFor(raw).event}
                on:explore={openExplore}
                on:older={goDeeper}
                on:login={manualLogin}
                on:seen={(e) => cardSeen(e.detail)}
                on:seenPosts={(e) => postsSeen(e.detail)}
                on:seenRecipes={(e) => recipesSeen(e.detail)}
                on:fewer={(e) => fewer(e.detail)}
                on:hideTopic={(e) => hideSpotlightTopic(e.detail)}
                on:openTopic={(e) => openTopicSlug(e.detail)}
              />
            {/if}
          {/if}
        {/each}
        {#if reachedFloor && !finishAnchored}
          <FreshFinishLine
            state={finish}
            {prompt}
            locked={topicsLocked}
            content={exploreContent}
            toEvent={(raw) => postFor(raw).event}
            on:explore={openExplore}
            on:older={goDeeper}
            on:login={manualLogin}
            on:seen={(e) => cardSeen(e.detail)}
            on:seenPosts={(e) => postsSeen(e.detail)}
            on:seenRecipes={(e) => recipesSeen(e.detail)}
            on:fewer={(e) => fewer(e.detail)}
            on:hideTopic={(e) => hideSpotlightTopic(e.detail)}
            on:openTopic={(e) => openTopicSlug(e.detail)}
          />
        {/if}
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

<FreshTopicsSheet
  bind:open={topicsOpen}
  groups={catalog.groups}
  loading={topicsLoading}
  on:pick={(e) => openTopic(e.detail)}
/>

{#if pitch}
  <FreshMemberPitch
    bind:open={pitchOpen}
    what={pitch.what}
    name={pitch.name ?? ''}
    signedIn={!!pk}
  />
{/if}

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
