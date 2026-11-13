<script lang="ts">
  /**
   * The embedded player surface for /live/[naddr]: video engine, host row,
   * zap bolt + total, and the About panel. Comments (NIP-22) live on the
   * page, not in the player.
   */
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { browser } from '$app/environment';
  import type { SimplePool } from 'nostr-tools/pool';
  import TextAlignLeftIcon from 'phosphor-svelte/lib/TextAlignLeft';
  import LiveAvatar from './LiveAvatar.svelte';
  import { pseudonym } from '$lib/streams/parse';
  import { selectStream, streamPlayer } from '$lib/stores/streamPlayer';
  import { streamSlot } from '$lib/stores/streamSlot';
  import { openProfilePreview } from '$lib/stores/profilePreview';
  import StreamZapTotal from './StreamZapTotal.svelte';
  import StreamAbout from './StreamAbout.svelte';
  import { fetchProfile } from '$lib/streams/fetch';
  import { DISCOVERY_RELAYS } from '$lib/streams/relays';
  import {
    fetchStreamZapTally,
    scanStreamZapHistory,
    type StreamZapTally
  } from '$lib/streams/streamZaps';
  import type { StreamItem } from '$lib/streams/types';

  export let item: StreamItem;
  /** The shared nostr-tools pool from the route page (announcement + profile reads). */
  export let pool: SimplePool;

  let showAbout = false;
  let hostName: string | null = null;
  let hostPicture: string | null = null;
  let tally: StreamZapTally | null = null;
  let scanAbort: AbortController | null = null;
  let loadingTally = false;

  // Browser-only: the player store is a client singleton; SSR must not touch it.
  if (browser) selectStream(item);

  // The layout-level dock renders the video INTO this slot while it exists —
  // the element itself never remounts, so playback and picture-in-picture
  // survive navigation.
  let slotEl: HTMLElement | null = null;
  /**
   * The chat section, owned by the page. It drives dock/restore: once the
   * chat reaches the upper part of the viewport the user is reading it, so
   * the video docks; when they scroll back so the chat sinks to the lower
   * half, the video returns. Docking collapses the slot and moves the chat
   * further UP — the same direction as the engagement — so this pair of
   * thresholds cannot oscillate, and the page keeps no empty gap where the
   * video used to be.
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
  let wheelUpAccum = 0;
  let touchStartY: number | null = null;

  function restoreInline() {
    if (!shrunk || !slotEl) return;
    shrunk = false;
    streamSlot.set(slotEl);
  }

  function updateShrink() {
    if (!chatMarker || !browser) return;
    if (!get(streamPlayer).item) return;
    if (!userScrolled) return;
    const top = chatMarker.getBoundingClientRect().top;
    const vh = window.innerHeight;
    if (!shrunk && top < vh * 0.25) {
      shrunk = true;
      streamSlot.set(null);
    } else if (shrunk && top > vh * 0.5) {
      restoreInline();
    }
  }

  /**
   * Docking can collapse the page below the viewport, leaving nothing to
   * scroll — so the scroll-position restore alone can strand the video in
   * the corner. Raw upward wheel/touch intent always returns it, scrollable
   * or not.
   */
  function onWheel(e: WheelEvent) {
    if (!shrunk) {
      wheelUpAccum = 0;
      return;
    }
    if (e.deltaY < 0) {
      wheelUpAccum += -e.deltaY;
      if (wheelUpAccum >= 160) {
        wheelUpAccum = 0;
        restoreInline();
      }
    } else {
      wheelUpAccum = 0;
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

  function onScrollShrink() {
    userScrolled = true;
    if (scrollTick) return;
    scrollTick = true;
    requestAnimationFrame(() => {
      scrollTick = false;
      updateShrink();
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

  // The chat marker binds after mount; re-check once it exists.
  $: (chatMarker, updateShrink());

  /** Expand-click while already on this page: take the video back inline. */
  function onRestoreRequest() {
    if (!slotEl) return;
    shrunk = false;
    streamSlot.set(slotEl);
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

  // Plain declarations, not reactive statements: tallyLoad() runs during
  // init, before `$:` assignments would have fired.
  let host = item.host;
  let address = item.key;

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

  tallyLoad();
  // Quick tally paints immediately; the deep history scan (backward paged,
  // provider-verified when the host's LNURL resolves) then grows the total
  // toward what Sidecar shows.
  async function tallyLoad() {
    scanAbort?.abort();
    scanAbort = new AbortController();
    const signal = scanAbort.signal;
    tally = await fetchStreamZapTally(address);
    if (signal.aborted) return;
    loadingTally = true;
    const scan = await scanStreamZapHistory(address, host, {
      hostRelays: item.relays || [],
      signal,
      onPartial: (t) => {
        if (!signal.aborted) tally = t;
      }
    });
    if (signal.aborted) return;
    // A verified scan can legitimately read lower than the quick pass only
    // when the provider rejects receipts; never regress the display.
    if (scan.tally.zapCount > (tally?.zapCount ?? 0)) tally = scan.tally;
    loadingTally = false;
  }

  function onZapComplete() {
    tallyLoad();
  }
</script>

<div class="flex flex-col gap-4">
  <!-- The layout-level dock moves its (persistent) video container into this
       slot while the page is mounted. -->
  <div bind:this={slotEl} class="w-full"></div>

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
      <StreamZapTotal
        {address}
        hostPubkey={host}
        sats={tally?.totalSats ?? 0}
        count={tally?.zapCount ?? 0}
        loading={loadingTally}
        on:zapComplete={onZapComplete}
      />
      <button
        type="button"
        class="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        aria-expanded={showAbout}
        aria-label="About this stream"
        title="About this stream"
        on:click={() => (showAbout = !showAbout)}
      >
        <TextAlignLeftIcon class="h-5 w-5" />
      </button>
    </div>
  </div>

  {#if showAbout}
    <StreamAbout {item} />
  {/if}
</div>
