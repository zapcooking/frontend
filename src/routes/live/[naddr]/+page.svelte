<script lang="ts">
  /**
   * Stream page: embedded player, host, zaps, About, and the permanent
   * NIP-22 comment thread on the announcement. Announcement updates are
   * re-fetched on an interval while the page is mounted, so status changes
   * (live → ended) and viewer counts stay current.
   */
  import { onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import type { SimplePool } from 'nostr-tools/pool';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import StreamView from '../../../components/streams/StreamView.svelte';
  import StreamPageSkeleton from '../../../components/streams/StreamPageSkeleton.svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { get } from 'svelte/store';
  import { zapReceiptRelayUrls } from '$lib/nip65Routing';
  import { createStreamPool } from '$lib/streams/relayPage';
  import { fetchStreamByNaddr, type ResolvedStream } from '$lib/streams/fetch';
  import { parseStreamAddress } from '$lib/streams/parse';
  import { DISCOVERY_RELAYS } from '$lib/streams/relays';
  import {
    fetchStreamZapTally,
    scanStreamZapHistory,
    type StreamZapTally
  } from '$lib/streams/streamZaps';
  import { keepHigherTally } from '$lib/streams/tallyDisplay';

  const REFRESH_MS = 60000;
  const TALLY_RESCAN_MS = 60000;

  let stream: ResolvedStream | null = null;
  let loading = true;
  let notFound = false;
  let pool: SimplePool | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  // Zap tally, owned here so the player (bolt + total) and the chat (top
  // zappers strip) share one scan.
  let tally: StreamZapTally | null = null;
  let tallyLoading = false;
  /** The stream the shown tally belongs to. */
  let tallyKey: string | null = null;
  let scanAbort: AbortController | null = null;
  let tallyTimer: ReturnType<typeof setInterval> | null = null;

  $: topZappers = topZapperList(tally);

  function topZapperList(t: StreamZapTally | null): { pubkey: string; sats: number }[] {
    if (!t) return [];
    return [...t.satsByZapper]
      .map(([pubkey, sats]) => ({ pubkey, sats }))
      .sort((a, b) => b.sats - a.sats)
      .slice(0, 10);
  }

  async function tallyLoad(itemKey: string, host: string | null, hostRelays: string[]) {
    scanAbort?.abort();
    scanAbort = new AbortController();
    const signal = scanAbort.signal;
    tallyLoading = true;
    // The provider publishes a receipt to the zap request's `relays` tag
    // (the zapper's NIP-65 outbox) — fresh receipts for OUR zaps land
    // there first, so the scan must include that set.
    const extraRelays = host
      ? await zapReceiptRelayUrls(get(userPublickey) || undefined, host).catch(() => [])
      : [];
    // A different stream starts from nothing; the same stream's total only
    // moves up across re-scans (see keepHigherTally).
    if (tallyKey !== itemKey) tally = null;
    tallyKey = itemKey;
    tally = keepHigherTally(tally, await fetchStreamZapTally(itemKey, extraRelays));
    if (signal.aborted) return;
    if (!host) return;
    const scan = await scanStreamZapHistory(itemKey, host, {
      hostRelays,
      extraRelays,
      signal,
      onPartial: (t) => {
        if (!signal.aborted) tally = keepHigherTally(tally, t);
      }
    });
    if (signal.aborted) return;
    // Never regress the display: a scan that read lower than what is shown
    // (a slow relay, a partial pass) does not replace it.
    tally = keepHigherTally(tally, scan.tally);
    tallyLoading = false;
  }

  async function load(first = true) {
    if (!browser) return;
    const parsed = parseStreamAddress($page.params.naddr);
    if (!('naddr' in parsed)) {
      notFound = true;
      loading = false;
      return;
    }
    if (!pool) pool = createStreamPool();
    try {
      const resolved = await fetchStreamByNaddr(pool, DISCOVERY_RELAYS, parsed.naddr);
      if (resolved) {
        stream = resolved;
        notFound = false;
        if (first) {
          tallyLoad(resolved.item.key, resolved.item.host, resolved.item.relays || []);
        }
      } else if (first) {
        notFound = true;
      }
    } catch {
      if (first) notFound = true;
    } finally {
      if (first) loading = false;
    }
  }

  load();
  if (browser) {
    refreshTimer = setInterval(() => load(false), REFRESH_MS);
    // Other viewers' verified zaps reach the total + top-zappers strip.
    tallyTimer = setInterval(() => {
      if (stream && !tallyLoading && !document.hidden) {
        tallyLoad(stream.item.key, stream.item.host, stream.item.relays || []);
      }
    }, TALLY_RESCAN_MS);
  }
  // SvelteKit reuses this component when only the naddr changes — reload
  // reactively so following another stream link swaps content immediately
  // (with a fresh tally, not first=false's deferred one).
  $: ($page.params.naddr, load(true));
  onDestroy(() => {
    if (refreshTimer) clearInterval(refreshTimer);
    if (tallyTimer) clearInterval(tallyTimer);
    scanAbort?.abort();
    pool?.destroy();
    pool = null;
  });

  // The announcement as an NDKEvent, so zaps and comments ride the app's
  // existing NDK flows.
  $: ndkEvent = stream && $ndk ? new NDKEvent($ndk, stream.event as never) : null;
  $: item = stream?.item ?? null;
</script>

<svelte:head>
  <title>{item ? `${item.title} — zap.cooking Live` : 'Live — zap.cooking'}</title>
  {#if item?.image}
    <meta property="og:image" content={item.image} />
  {/if}
</svelte:head>

<div class="mx-auto w-full max-w-3xl py-4 sm:px-4 sm:py-6">
  {#if loading}
    <!-- Skeleton mirrors the player + host row while the announcement resolves. -->
    <StreamPageSkeleton />
  {:else if notFound || !item || !ndkEvent || !pool}
    <div class="flex h-64 flex-col items-center justify-center gap-2 text-center">
      <p class="text-sm text-zinc-500">
        This stream could not be found. It may have ended and been removed, or the link is wrong.
      </p>
    </div>
  {:else}
    <StreamView
      {item}
      {pool}
      {ndkEvent}
      {tally}
      {tallyLoading}
      {topZappers}
      on:zapComplete={() => item && tallyLoad(item.key, item.host, item.relays || [])}
    />
  {/if}
</div>
