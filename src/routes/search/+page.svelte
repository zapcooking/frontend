<script lang="ts">
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import { onDestroy } from 'svelte';
  import { nip19 } from 'nostr-tools';
  import { ndk } from '$lib/nostr';
  import { mutedPubkeys } from '$lib/muteListStore';
  import { NDKRelaySet, type NDKEvent, type NDKSubscription } from '@nostr-dev-kit/ndk';
  import { isHiddenRecipeEvent } from '$lib/consts';
  import Avatar from '../../components/Avatar.svelte';
  import CustomName from '../../components/CustomName.svelte';
  import NoteContent from '../../components/NoteContent.svelte';
  import PollDisplay from '../../components/PollDisplay.svelte';
  import NoteActionBar from '../../components/NoteActionBar.svelte';
  import PostActionsMenu from '../../components/PostActionsMenu.svelte';
  import PanLoader from '../../components/PanLoader.svelte';
  import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeft';

  // NIP-50 full-text search relays (same pair the header dropdown uses;
  // both verified answering {kinds:[1], search} REQs).
  const SEARCH_RELAYS = ['wss://search.nos.today', 'wss://search.nostrarchives.com'];
  const RESULT_LIMIT = 100;
  const SEARCH_TIMEOUT_MS = 6000;

  $: query = ($page.url.searchParams.get('q') || '').trim();

  let results: NDKEvent[] = [];
  let loading = false;
  let searchedFor = '';
  let sub: NDKSubscription | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const seen = new Set<string>();

  // Batch arrivals into one store update per frame-ish window — a relay
  // can dump dozens of events in one burst.
  let pending: NDKEvent[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function flushPending() {
    flushTimer = null;
    if (pending.length === 0) return;
    // Two relays fanned in answer out of order — keep the feed newest-first.
    results = [...results, ...pending].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    pending = [];
  }

  function stopSearch() {
    if (sub) {
      try {
        sub.stop();
      } catch {
        /* repeated stop can throw */
      }
      sub = null;
    }
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    pending = [];
  }

  async function runSearch(q: string) {
    stopSearch();
    seen.clear();
    results = [];
    pending = [];
    if (!q || !$ndk) return;

    searchedFor = q;
    loading = true;

    // Pre-connect so the initial REQ doesn't miss the relays.
    await Promise.all(
      SEARCH_RELAYS.map(async (url) => {
        try {
          const relay = $ndk.pool.getRelay(url, true, true);
          if (relay.connectivity?.status !== 1) await relay.connect();
        } catch {
          /* one relay being down shouldn't kill the search */
        }
      })
    );
    if (searchedFor !== q) return; // superseded by a newer query

    try {
      const relaySet = NDKRelaySet.fromRelayUrls(SEARCH_RELAYS, $ndk, false);
      sub = $ndk.subscribe(
        { kinds: [1, 1068] as any, search: q, limit: RESULT_LIMIT },
        { closeOnEose: true, groupable: false },
        relaySet
      );

      sub.on('event', (event: NDKEvent) => {
        if (searchedFor !== q) return;
        if (!event.id || seen.has(event.id)) return;
        if (isHiddenRecipeEvent(event)) return;
        seen.add(event.id);
        pending.push(event);
        if (flushTimer === null) {
          flushTimer = setTimeout(flushPending, 150);
        }
      });

      const finish = () => {
        if (searchedFor !== q) return;
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        flushPending();
        loading = false;
      };
      sub.on('eose', finish);
      timeoutHandle = setTimeout(finish, SEARCH_TIMEOUT_MS);
    } catch {
      loading = false;
    }
  }

  // Re-run when the query changes (URL-driven — back/forward works).
  $: if (browser && query !== undefined) {
    runSearch(query);
  }

  onDestroy(stopSearch);

  function formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor(Date.now() / 1000 - timestamp);
    if (seconds < 60) return 'now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d`;
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  $: visibleResults = results.filter((e) => !$mutedPubkeys.has(e.author?.hexpubkey || e.pubkey));
</script>

<svelte:head>
  <title>{query ? `"${query}" — search` : 'Search'} - zap.cooking</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="max-w-2xl w-full mx-auto sm:mx-0 px-4 lg:px-0">
  <a
    href="/"
    class="inline-flex items-center gap-1.5 text-sm font-medium mt-4 mb-2 hover:opacity-80"
    style="color: var(--color-text-secondary);"
  >
    <ArrowLeftIcon size={16} weight="bold" />
    <span>Back</span>
  </a>

  <h1 class="text-xl font-bold mb-1" style="color: var(--color-text-primary);">
    Posts{query ? ` matching “${query}”` : ''}
  </h1>
  <p class="text-sm mb-4" style="color: var(--color-text-caption);">
    {#if loading}
      Searching…
    {:else}
      {visibleResults.length} {visibleResults.length === 1 ? 'result' : 'results'}
    {/if}
  </p>

  {#if loading && visibleResults.length === 0}
    <div class="flex justify-center items-center page-loader">
      <PanLoader />
    </div>
  {:else if visibleResults.length === 0}
    <div class="flex flex-col items-center py-16 gap-2">
      <p class="text-sm font-medium" style="color: var(--color-text-primary);">
        No posts found{query ? ` for “${query}”` : ''}
      </p>
      <p class="text-xs" style="color: var(--color-text-caption);">
        Try a different keyword, or browse tags from the search bar.
      </p>
    </div>
  {:else}
    <div class="flex flex-col gap-4 pb-16">
      {#each visibleResults as post (post.id)}
        <article
          class="rounded-2xl border p-4 transition-colors"
          style="border-color: var(--color-input-border); background-color: var(--color-bg-secondary);"
        >
          <div class="flex items-center justify-between gap-3 mb-2">
            <div class="flex items-center gap-3 min-w-0">
              <a
                href="/user/{nip19.npubEncode(post.author?.hexpubkey || post.pubkey)}"
                class="flex-shrink-0"
              >
                <Avatar pubkey={post.author?.hexpubkey || post.pubkey} size={32} />
              </a>
              <div class="flex flex-col min-w-0">
                <a
                  href="/user/{nip19.npubEncode(post.author?.hexpubkey || post.pubkey)}"
                  class="font-semibold text-[15px] transition-colors username-link truncate min-w-0"
                  style="color: var(--color-text-primary)"
                >
                  <CustomName pubkey={post.author?.hexpubkey || post.pubkey} />
                </a>
                <span class="text-xs" style="color: var(--color-caption)">
                  {post.created_at ? formatTimeAgo(post.created_at) : ''}
                </span>
              </div>
            </div>
            <PostActionsMenu event={post} />
          </div>
          <a href="/{nip19.noteEncode(post.id)}" class="block">
            <div class="text-[14px] leading-normal" style="color: var(--color-text-primary);">
              {#if post.kind === 1068}
                <PollDisplay event={post} />
              {:else}
                <NoteContent content={post.content} event={post} showNostrEmbeds={false} />
              {/if}
            </div>
          </a>
          <div class="mt-2">
            <NoteActionBar event={post} showCheffy={false} />
          </div>
        </article>
      {/each}
    </div>
  {/if}
</div>
