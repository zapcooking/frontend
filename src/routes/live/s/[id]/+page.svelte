<script lang="ts">
  /**
   * Stream page for a Go live session: the same page as a NIP-53 stream
   * (StreamView), fed from Zap Cooking's server instead of relays. The
   * session is re-read every 5 seconds while the tab is visible, so "ended"
   * reaches the player within seconds; the player itself plays the
   * broadcast through our relay (StreamEngine's WebRTC path).
   */
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import type { SimplePool } from 'nostr-tools/pool';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import StreamView from '../../../../components/streams/StreamView.svelte';
  import StreamPageSkeleton from '../../../../components/streams/StreamPageSkeleton.svelte';
  import { ndk } from '$lib/nostr';
  import { createStreamPool } from '$lib/streams/relayPage';
  import { fetchSession, sessionToStreamItem, type GoLiveSession } from '$lib/streams/goLive';
  import { fetchRecipeEventWithRetry, recipeCardOf } from '$lib/streams/recipeCard';
  import type { StreamItem } from '$lib/streams/types';
  import { fetchProfile } from '$lib/streams/fetch';
  import { DISCOVERY_RELAYS } from '$lib/streams/relays';
  import {
    fetchStreamZapTally,
    scanStreamZapHistory,
    type StreamZapTally
  } from '$lib/streams/streamZaps';
  import { keepHigherTally } from '$lib/streams/tallyDisplay';
  import { zapReceiptRelayUrls } from '$lib/nip65Routing';
  import { userPublickey } from '$lib/nostr';

  const POLL_MS = 5000;
  const TALLY_RESCAN_MS = 60000;

  let session: GoLiveSession | null = null;
  let item: StreamItem | null = null;
  let recipe: NDKEvent | null = null;
  let recipeLoading = false;
  let loading = true;
  let notFound = false;
  let pool: SimplePool | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let currentId: string | null = null;
  // Zap total from the "Live now" note's receipts (same rules as a NIP-53
  // stream's: provider-signed receipts only; the total never moves down).
  let tally: StreamZapTally | null = null;
  let tallyLoading = false;
  let tallyKey: string | null = null;
  let scanAbort: AbortController | null = null;
  let tallyTimer: ReturnType<typeof setInterval> | null = null;
  $: topZappers = tally
    ? [...tally.satsByZapper]
        .map(([pubkey, sats]) => ({ pubkey, sats }))
        .sort((a, b) => b.sats - a.sats)
        .slice(0, 10)
    : [];

  async function tallyLoad(noteId: string, host: string) {
    scanAbort?.abort();
    scanAbort = new AbortController();
    const signal = scanAbort.signal;
    tallyLoading = true;
    // Fresh receipts for our own zaps land on the zap request's relays.
    const extraRelays = await zapReceiptRelayUrls(get(userPublickey) || undefined, host).catch(
      () => []
    );
    if (tallyKey !== noteId) tally = null;
    tallyKey = noteId;
    tally = keepHigherTally(tally, await fetchStreamZapTally(noteId, extraRelays));
    if (signal.aborted) return;
    const scan = await scanStreamZapHistory(noteId, host, {
      extraRelays,
      signal,
      onPartial: (t) => {
        if (!signal.aborted) tally = keepHigherTally(tally, t);
      }
    });
    if (signal.aborted) return;
    tally = keepHigherTally(tally, scan.tally);
    tallyLoading = false;
  }

  /** The host's real name, for "<host> is cooking <recipe>". */
  let hostName: string | null = null;
  let hostNameFor: string | null = null;

  function rebuild() {
    if (!session) return;
    item = sessionToStreamItem(session, recipeCardOf(recipe), hostName);
  }

  async function loadHostName(pubkey: string) {
    if (hostNameFor === pubkey || !pool) return;
    hostNameFor = pubkey;
    try {
      const profile = await fetchProfile(pool, DISCOVERY_RELAYS, pubkey);
      if (hostNameFor !== pubkey) return;
      hostName = profile?.displayName || profile?.name || null;
      rebuild();
    } catch {
      /* the name is optional: "Cooking <recipe>" until it is known */
    }
  }

  async function loadRecipe(a: string | null) {
    if (!a) return;
    recipeLoading = true;
    const found = await fetchRecipeEventWithRetry(
      () => get(ndk),
      a,
      () => session?.recipe_a === a
    );
    if (session?.recipe_a !== a) return;
    recipe = found;
    recipeLoading = false;
    rebuild();
  }

  async function refresh(id: string) {
    const next = await fetchSession(id);
    if (id !== currentId) return;
    // Could not tell: keep what is shown. Before the first answer that is
    // the loading state, and the poll below keeps asking.
    if (next === undefined) return;
    if (next === null) {
      // Gone. Ended sessions are kept for 30 days, so this is an unknown id,
      // or one the admin removed with the host's account.
      if (session) {
        session = { ...session, status: 'ended', ended_at: Math.floor(Date.now() / 1000) };
        rebuild();
        stopPolling();
      } else {
        notFound = true;
        loading = false;
        stopPolling();
      }
      return;
    }
    const recipeChanged = next.recipe_a !== session?.recipe_a;
    session = next;
    loading = false;
    rebuild();
    void loadHostName(next.host_pubkey);
    if (next.note_id && tallyKey !== next.note_id) void tallyLoad(next.note_id, next.host_pubkey);
    if (recipeChanged) void loadRecipe(next.recipe_a);
    if (next.status === 'ended') stopPolling();
  }

  function stopPolling() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  async function start(id: string) {
    stopPolling();
    currentId = id;
    session = null;
    item = null;
    recipe = null;
    hostName = null;
    hostNameFor = null;
    scanAbort?.abort();
    tally = null;
    tallyKey = null;
    tallyLoading = false;
    notFound = false;
    loading = true;
    if (!pool) pool = createStreamPool();
    await refresh(id);
    // Left the page, or moved to another stream, while that was pending.
    if (id !== currentId) return;
    // `refresh` set these; TypeScript cannot see that across the await.
    const loaded = session as GoLiveSession | null;
    // Poll while live, and also while the first read has not been answered
    // (the page stays on its loading state rather than saying "ended").
    if (!notFound && (!loaded || loaded.status !== 'ended')) {
      timer = setInterval(() => {
        if (!document.hidden) void refresh(id);
      }, POLL_MS);
    }
  }

  $: if (browser) void start($page.params.id ?? '');

  function onVisible() {
    if (!document.hidden && currentId && timer) void refresh(currentId);
  }
  if (browser) document.addEventListener('visibilitychange', onVisible);

  // Other viewers' zaps reach the total and the top-zappers strip.
  if (browser) {
    tallyTimer = setInterval(() => {
      if (session?.note_id && !tallyLoading && !document.hidden) {
        void tallyLoad(session.note_id, session.host_pubkey);
      }
    }, TALLY_RESCAN_MS);
  }

  onDestroy(() => {
    // Invalidate any read still in flight, so its continuation cannot start
    // a poll after this page is gone.
    currentId = null;
    stopPolling();
    if (tallyTimer) clearInterval(tallyTimer);
    scanAbort?.abort();
    if (browser) document.removeEventListener('visibilitychange', onVisible);
    pool?.destroy();
    pool = null;
  });
</script>

<svelte:head>
  <title>{item ? `${item.title} — zap.cooking Live` : 'Live — zap.cooking'}</title>
</svelte:head>

<div class="mx-auto w-full max-w-3xl py-4 sm:px-4 sm:py-6">
  {#if loading}
    <StreamPageSkeleton />
  {:else if notFound || !item || !pool}
    <!-- Not on record: ended sessions are removed after 30 days. A shared
         link says the stream has ended rather than showing an error. -->
    <div class="flex h-64 flex-col items-center justify-center gap-3 text-center">
      <p class="text-base font-semibold" style="color: var(--color-text-primary);">
        This live stream has ended
      </p>
      <a href="/live" class="text-sm font-medium underline" style="color: var(--color-primary);">
        See who's live now
      </a>
    </div>
  {:else}
    <StreamView
      {item}
      {pool}
      {recipe}
      {recipeLoading}
      {tally}
      {tallyLoading}
      {topZappers}
      on:zapComplete={() => session?.note_id && tallyLoad(session.note_id, session.host_pubkey)}
    />
  {/if}
</div>
