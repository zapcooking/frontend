<script lang="ts">
  /**
   * The embedded player surface for /live/[naddr] and /live/s/[id]: the
   * video engine, the host row with Save/About, and the About panel. The
   * zap strip, goal and top zappers live under the video in StreamView;
   * comments (NIP-22) are not rendered on stream pages.
   */
  import TextAlignLeftIcon from 'phosphor-svelte/lib/TextAlignLeft';
  import BookmarkIcon from 'phosphor-svelte/lib/BookmarkSimple';
  import LiveAvatar from './LiveAvatar.svelte';
  import { pseudonym } from '$lib/streams/parse';
  import { loadSaved, toggleSavedItem } from '$lib/streams/saved';
  import { selectStream, streamPlayer, updateStreamItem } from '$lib/stores/streamPlayer';
  import { streamSlot } from '$lib/stores/streamSlot';
  import { openProfilePreview } from '$lib/stores/profilePreview';
  import StreamAbout from './StreamAbout.svelte';
  import { fetchProfile } from '$lib/streams/fetch';
  import { DISCOVERY_RELAYS } from '$lib/streams/relays';
  import { onMount, onDestroy, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { browser } from '$app/environment';
  import type { SimplePool } from 'nostr-tools/pool';
  import { isGoLiveItem, streamPath } from '$lib/streams/goLive';
  import { getSiteOrigin } from '$lib/utils/share';
  import LiveShareButton from './LiveShareButton.svelte';
  import type { StreamItem } from '$lib/streams/types';

  export let item: StreamItem;
  /** The shared nostr-tools pool from the route page (announcement + profile reads). */
  export let pool: SimplePool;

  let showAbout = false;
  let hostName: string | null = null;
  let hostPicture: string | null = null;

  // Saved streams (localStorage). NIP-53 streams only: a Go live session has
  // neither a 30311 address nor a media URL to save.
  let savedList: ReturnType<typeof loadSaved> = [];
  onMount(() => {
    savedList = loadSaved();
  });
  function toggleSave() {
    savedList = toggleSavedItem(item, savedList).items;
  }
  $: savedNow = savedList.some((row) => row.key === item.key);

  // Browser-only: the player store is a client singleton; SSR must not touch it.
  if (browser) selectStream(item);
  // Announcement refreshes (status/viewers/media URL) reach the running
  // player; updateStreamItem's key guard preserves an explicitly stopped one.
  $: if (browser && item) updateStreamItem(item);

  // The layout-level dock renders the video INTO this slot while it exists —
  // the element itself never remounts, so playback and picture-in-picture
  // survive navigation.
  let slotEl: HTMLElement | null = null;
  /**
   * The chat section, owned by the page, docks the video early: once the
   * chat reaches the upper part of the viewport the user is reading it, so
   * the video docks; when they scroll back so the chat sinks to the lower
   * half, the video returns. Docking collapses the slot and moves the chat
   * further UP — the same direction as the engagement — so this pair of
   * thresholds cannot oscillate, and the page keeps no empty gap where the
   * video used to be.
   *
   * The video's own position is the guarantee underneath that: layouts
   * without a chat marker (wide landscape has no recipe below the video)
   * never docked at all and let the video scroll half-hidden under the
   * header. Whatever the marker does, the slot touching the header bottom
   * always docks, and clearing the header always restores.
   */
  export let chatMarker: HTMLElement | null = null;
  /**
   * Docking may only engage after the user has actually scrolled: a scroll
   * position the browser restored on reload (or the pre-layout probe below)
   * must not yank the video out of the page at load.
   */
  let userScrolled = false;
  let shrunk = false;
  let scrollTick = false;
  let lastPageScrollTop = -1;
  let wheelUpAccum = 0;
  let wheelDownAccum = 0;
  let touchStartY: number | null = null;
  /**
   * After the video returns inline it only lands in the slot a tick later.
   * A scroll/resize event in that gap still sees the page as it was while
   * docked — chat near the top — and would dock the video again at once,
   * which reads as a restore (Expand, or a swipe down) doing nothing. So
   * docking is ignored for a moment after every restore.
   */
  const RESTORE_GRACE_MS = 900;
  let restoredAt = -Infinity;
  /**
   * Docking also shrinks the layout: the browser clamps the scroll
   * position down and fires a scroll event on the page scroller. That
   * event must not restore the video it just docked (a scroll-end dock is
   * within 4px of the clamp, so it would bounce ~once a second), and its
   * stale position must not poison the movement direction. Dock checks
   * pause for this window and the recorded position re-reads once layout
   * settles.
   */
  const DOCK_GRACE_MS = 900;
  let dockedAt = -Infinity;

  /**
   * The clip line: the painted bottom of the fixed header. The video must
   * never slide behind it.
   */
  function headerClip(): number {
    const blur = document.querySelector('.header-blur');
    return blur ? blur.getBoundingClientRect().bottom : 75;
  }

  function restoreInline() {
    if (!shrunk || !slotEl) return;
    shrunk = false;
    restoredAt = performance.now();
    streamSlot.set(slotEl);
  }

  function updateShrink(prevTop: number | null = null) {
    if (!slotEl || !browser) return;
    if (!get(streamPlayer).item) return;
    if (!userScrolled) return;
    if (performance.now() - restoredAt < RESTORE_GRACE_MS) return;
    if (performance.now() - dockedAt < DOCK_GRACE_MS) return;

    const vh = window.innerHeight;
    const markerTop = chatMarker ? chatMarker.getBoundingClientRect().top : null;
    // Guaranteed trigger: the slot's own position. The chat marker does not
    // exist on every layout (wide landscape has no recipe below the video),
    // and without it the video used to scroll under the header half-clipped.
    const slotRect = slotEl.getBoundingClientRect();
    const slotTop = slotRect.top;
    const clipLine = headerClip();
    // With a header the video may slide beneath it, so the slot's top edge
    // triggers the dock. At xl the header is gone (the strip nests in the
    // sidebar) — nothing hides the video, so it docks once the video's
    // bottom edge climbs into the top quarter of the viewport. And because
    // two-column pages have a short scroll range, reaching the scroll END
    // with the video mostly above the fold docks it too: "scrolled past
    // the video" is the user's intent even when the page cannot scroll it
    // all the way out.
    const headerGone = clipLine <= 0;
    const scroller = pageScroller();
    const atScrollEnd = scroller
      ? scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 4
      : false;
    const slotCrossed = headerGone
      ? slotRect.bottom <= vh * 0.25 || (atScrollEnd && slotRect.bottom < vh * 0.6)
      : slotTop < clipLine;

    if (!shrunk) {
      const markerLow = markerTop != null && markerTop < vh * 0.25;
      const slotClipped = slotCrossed;
      if (markerLow || slotClipped) dockNow();
    } else {
      const markerClear = markerTop != null && markerTop > vh * 0.5;
      // Collapsing the slot can clamp the scroll position to the top on
      // pages that barely overflow; the slot then sits below the header
      // with no way to scroll, so only trust this restore while real
      // upward scroll range is left. A clip-docked video otherwise comes
      // back through wheel-up, swipe-down or Expand. On headerless pages
      // the slot is an empty, zero-height div pinned near the page top
      // while docked — its rect can never re-enter view — so upward page
      // movement itself restores: the reader scrolling back up IS the
      // intent. The 50%-line keeps a scroll-end dock from instantly
      // un-docking at the same position.
      const canScrollUp = scroller ? scroller.scrollTop > 8 : true;
      const pageTop = scroller ? scroller.scrollTop : 0;
      const movingUp = prevTop != null && pageTop < prevTop - 8;
      const slotClear = headerGone
        ? movingUp || slotRect.bottom > vh * 0.5
        : (slotTop > clipLine + 8) && canScrollUp;
      if (markerClear || slotClear) restoreInline();
    }
  }

  function dockNow() {
    if (shrunk || !slotEl) return;
    shrunk = true;
    dockedAt = performance.now();
    streamSlot.set(null);
    // Once the clamp settles, record where the page actually ended up: the
    // next movement comparison reads the settled position, not the stale
    // pre-dock one.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const scroller = pageScroller();
        if (scroller) lastPageScrollTop = scroller.scrollTop;
      })
    );
  }

  /** The element the app scrolls in (a container, not the window). */
  function pageScroller(): HTMLElement | null {
    return (
      (document.querySelector('#app-scroll') as HTMLElement | null) ??
      (document.scrollingElement as HTMLElement | null)
    );
  }

  /**
   * Docking can collapse the page below the viewport, leaving nothing to
   * scroll — so the scroll-position restore alone can strand the video in
   * the corner. Raw upward wheel/touch intent always returns it, scrollable
   * or not.
   */
  /**
   * True when this wheel event is driving the page scroller itself: walk
   * up from the target to the nearest scrollable ancestor — if that is
   * the page scroller, the wheel is page intent; if it is an inner
   * surface (the live chat, the drawer, a modal, the notifications list),
   * the wheel belongs to it and must never dock or restore the video.
   */
  function isPageWheel(e: WheelEvent): boolean {
    let el = e.target instanceof Element ? e.target : null;
    while (el && el !== document.body && el !== document.documentElement) {
      if (el.id === 'app-scroll') return true;
      if (el.scrollHeight > el.clientHeight + 1) {
        const style = getComputedStyle(el);
        if (/(auto|scroll)/.test(style.overflowY)) return false;
      }
      el = el.parentElement;
    }
    return true;
  }

  function onWheel(e: WheelEvent) {
    if (!isPageWheel(e)) {
      wheelDownAccum = 0;
      wheelUpAccum = 0;
      return;
    }
    if (shrunk) {
      if (e.deltaY < 0) {
        wheelUpAccum += -e.deltaY;
        if (wheelUpAccum >= 160) {
          wheelUpAccum = 0;
          restoreInline();
        }
      } else {
        wheelUpAccum = 0;
      }
      return;
    }
    // Not docked yet: sustained downward wheel intent over the PAGE
    // scroller docks the video once it sits above the viewport's midline.
    if (e.deltaY <= 0) {
      wheelDownAccum = 0;
      return;
    }
    if (performance.now() - dockedAt < DOCK_GRACE_MS) return;
    wheelDownAccum += e.deltaY;
    if (wheelDownAccum >= 160 && userScrolled && slotEl) {
      const r = slotEl.getBoundingClientRect();
      if (r.bottom < window.innerHeight * 0.5) {
        wheelDownAccum = 0;
        dockNow();
      }
    }
  }

  function onTouchStart(e: TouchEvent) {
    touchStartY = shrunk ? (e.touches[0]?.clientY ?? null) : null;
  }

  function onTouchMove(e: TouchEvent) {
    if (!shrunk || touchStartY == null) return;
    const y = e.touches[0]?.clientY;
    if (y != null && y - touchStartY > 70) {
      touchStartY = null;
      restoreInline();
    }
  }

  function onScrollShrink(e?: Event) {
    // Only the PAGE's own scrolling may dock the video. The capture-phase
    // document listener sees every inner scroller too — the live chat,
    // the drawer, the user panel — and scrolling the chat to read it must
    // never dock the video (even when the page itself sits at its scroll
    // end).
    if (e && e.type === 'scroll') {
      const t = e.target;
      if (
        !(t instanceof HTMLElement) ||
        (t.id !== 'app-scroll' &&
          t !== document.documentElement &&
          t !== document.body)
      ) {
        return;
      }
    }
    userScrolled = true;
    // Remember the position BEFORE this frame's check: the movement
    // direction (page scrolling up while the video is docked) is what
    // restores it on headerless pages.
    const prevTop = lastPageScrollTop;
    if (scrollTick) return;
    scrollTick = true;
    requestAnimationFrame(() => {
      scrollTick = false;
      updateShrink(prevTop);
      const scroller = document.getElementById('app-scroll');
      if (scroller) lastPageScrollTop = scroller.scrollTop;
    });
  }

  onMount(() => {
    streamSlot.set(slotEl);
    // Scroll events do not bubble, but capture on the document catches every
    // inner scroller (the app scrolls in a container, not the window).
    document.addEventListener('scroll', onScrollShrink, { capture: true, passive: true });
    window.addEventListener('resize', onScrollShrink);
    window.addEventListener('wheel', onWheel, { passive: true });
    document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    document.addEventListener('touchmove', onTouchMove, { capture: true, passive: true });
    window.addEventListener('stream-player-restore', onRestoreRequest);
    updateShrink();
  });

  // The chat marker binds after mount; re-check once it exists.
  $: (chatMarker, updateShrink());

  /**
   * Expand-click while already on this page: take the video back inline.
   * The reader is usually scrolled down at the chat when they tap it, so
   * the video also has to be scrolled into view — otherwise it lands above
   * the fold and the same scroll position docks it again at once, which
   * looks like the button did nothing.
   */
  async function onRestoreRequest() {
    if (!slotEl) return;
    shrunk = false;
    userScrolled = false; // no re-dock until the reader scrolls again
    restoredAt = performance.now();
    streamSlot.set(slotEl);
    await tick();
    slotEl?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    });
  }
  onDestroy(() => {
    document.removeEventListener('scroll', onScrollShrink, { capture: true } as never);
    window.removeEventListener('resize', onScrollShrink);
    window.removeEventListener('wheel', onWheel);
    document.removeEventListener('touchstart', onTouchStart, { capture: true } as never);
    document.removeEventListener('touchmove', onTouchMove, { capture: true } as never);
    window.removeEventListener('stream-player-restore', onRestoreRequest);
    if (get(streamSlot) === slotEl) streamSlot.set(null);
  });

  // Derived from the current item: announcement refreshes can change the
  // host `p` tag, and the displayed identity must follow.
  $: host = item.host;

  // Host identity read straight from relays (newest kind 0 wins). The
  // announcement's author is often a service account, and the app's NDK
  // profile resolver has been observed returning unrelated profiles here,
  // so no resolver — just the newest self-published profile.
  $: (item.updated, hostProfile());
  async function hostProfile() {
    if (!pool || !host) return;
    try {
      const profile = await fetchProfile(
        pool,
        [...DISCOVERY_RELAYS, ...(item.relays || []), 'wss://purplepag.es'],
        host
      );
      if (profile) {
        hostName = profile.displayName || profile.name || null;
        hostPicture = profile.picture || null;
      }
    } catch {
      // A profile miss just leaves the pseudonym.
    }
  }
  /** The stream's own page (Go live: /live/s/<id>; Nostr: /live/<naddr>). */
  $: sharePath = streamPath(item);
</script>

<div class="flex flex-col gap-4">
  <!-- The layout-level dock moves its (persistent) video container into this
       slot while the page is mounted. -->
  <div bind:this={slotEl} class="stream-slot w-full scroll-mt-20 xl:scroll-mt-0"></div>

  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="flex min-w-0 items-center gap-2">
      <LiveAvatar
        pubkey={host}
        src={hostPicture}
        size={36}
        alt={hostName || 'Host avatar'}
        linked={false}
        on:click={() => openProfilePreview(host)}
      />
      <div class="min-w-0">
        <p class="truncate text-sm font-semibold" title={hostName || undefined}>
          {hostName || pseudonym(host)}
        </p>
        <p class="text-xs text-zinc-500">Host</p>
      </div>
    </div>
    <div class="flex items-center gap-3">
      {#if !isGoLiveItem(item)}
        <button
          type="button"
          class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors
            {savedNow
            ? 'text-amber-500'
            : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'}"
          aria-pressed={savedNow}
          aria-label={savedNow ? 'Remove from saved' : 'Save stream'}
          title={savedNow ? 'Saved' : 'Save stream'}
          on:click={toggleSave}
        >
          <BookmarkIcon class="h-4 w-4" weight={savedNow ? 'fill' : 'regular'} />
          {savedNow ? 'Saved' : 'Save'}
        </button>
      {/if}
      {#if sharePath}
        <LiveShareButton url={getSiteOrigin() + sharePath} title={item.title} />
      {/if}
      <!-- Labelled: an icon alone read as "open chat". It shows the
           stream's details (title, summary, tags). -->
      <button
        type="button"
        class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        aria-expanded={showAbout}
        title="About this stream"
        on:click={() => (showAbout = !showAbout)}
      >
        <TextAlignLeftIcon class="h-4 w-4" />
        About
      </button>
    </div>
  </div>

  {#if showAbout}
    <StreamAbout {item} />
  {/if}
</div>

<style>
  /* Phones: the page player runs edge to edge (the layout pads the page
     by 1rem on each side). */
  @media (max-width: 640px) {
    .stream-slot {
      width: calc(100% + 2rem);
      margin-inline: -1rem;
    }
  }
</style>
