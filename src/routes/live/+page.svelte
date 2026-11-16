<script lang="ts">
  /**
   * Live directory (Phase 3): one discovery subscription plus a periodic
   * history fill feed the StreamDirectory; the three views (live /
   * upcoming / past) derive from it. Liveness follows the directory rule —
   * a `live` announcement under an hour old with a media URL — so the
   * grid stays cheap; the player probes playlists before you commit to
   * one. Click-through goes to /live/[naddr].
   *
   * Zap Cooking's own Go live sessions are read from /api/live (they are
   * not on relays) and lead the Live now tab, with the recipe's photo.
   * They open on /live/s/[id].
   */
  import { onDestroy, onMount } from 'svelte';
  import { browser } from '$app/environment';
  import type { SimplePool } from 'nostr-tools/pool';
  import type { Filter } from 'nostr-tools/filter';
  import Avatar from '../../components/Avatar.svelte';
  import StreamCardSkeleton from '../../components/streams/StreamCardSkeleton.svelte';
  import LiveFallbackArt from '../../components/streams/LiveFallbackArt.svelte';
  import LiveShareButton from '../../components/streams/LiveShareButton.svelte';
  import { getSiteOrigin } from '$lib/utils/share';
  import { StreamDirectory } from '$lib/streams/directory';
  import { pseudonym, runtime, streamAddress, naddrEncode } from '$lib/streams/parse';
  import { loadSaved, toggleSavedItem, isSaved } from '$lib/streams/saved';
  import { createStreamPool } from '$lib/streams/relayPage';
  import { fetchChatProfiles, type ChatProfile } from '$lib/streams/chat';
  import { DISCOVERY_RELAYS } from '$lib/streams/relays';
  import { pickThumb } from '$lib/streams/thumb';
  import ImageBrokenIcon from 'phosphor-svelte/lib/ImageBroken';
  import BookmarkIcon from 'phosphor-svelte/lib/BookmarkSimple';
  import TrashIcon from 'phosphor-svelte/lib/Trash';
  import type { NostrEventLike, StreamBookmark, StreamItem } from '$lib/streams/types';
  import { get } from 'svelte/store';
  import { ndk } from '$lib/nostr';
  import {
    fetchLiveSessions,
    holdWatching,
    isGoLiveItem,
    mergeLiveItems,
    sessionToStreamItem,
    streamPath,
    watchingCount,
    watchingLabel,
    type GoLiveSession,
    type RecipeCard
  } from '$lib/streams/goLive';
  import { fetchRecipeEventWithRetry, recipeCardOf } from '$lib/streams/recipeCard';

  type Tab = 'live' | 'upcoming' | 'past' | 'saved';
  const TABS: { id: Tab; label: string }[] = [
    { id: 'live', label: 'Live now' },
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'past', label: 'Past' },
    { id: 'saved', label: 'Saved' }
  ];

  let pool: SimplePool | null = null;
  let directory = new StreamDirectory(500);
  let tab: Tab = 'live';
  let loading = true;
  let items: StreamItem[] = [];
  let profiles = new Map<string, ChatProfile>();
  let sub: { close: () => void } | null = null;
  let fillTimer: ReturnType<typeof setInterval> | null = null;
  let viewTimer: ReturnType<typeof setInterval> | null = null;
  let goLiveTimer: ReturnType<typeof setInterval> | null = null;
  let goLiveSessions: GoLiveSession[] = [];
  let goLiveLoaded = false;
  /** Recipe title and photo per recipe address, filled as they resolve. */
  let recipeCards = new Map<string, RecipeCard | null>();
  let savedList: StreamBookmark[] = browser ? loadSaved() : [];

  const GO_LIVE_REFRESH_MS = 20000;
  /** Last known "watching" per session, held through a failed count read. */
  const lastWatching = new Map<string, number>();

  function link(item: StreamItem): string | null {
    return streamPath(item);
  }

  function save(item: StreamItem) {
    savedList = toggleSavedItem(item, savedList).items;
  }

  /** The naddr a saved addressable stream opens at; null for saved video links. */
  function savedHref(entry: StreamBookmark): string | null {
    const address = streamAddress(entry);
    return address ? '/live/' + naddrEncode(address) : null;
  }

  function goLiveItems(): StreamItem[] {
    return goLiveSessions.map((s) =>
      sessionToStreamItem(
        s,
        s.recipe_a ? recipeCards.get(s.recipe_a) : null,
        realName(s.host_pubkey)
      )
    );
  }

  /** The host's own display name, or null (never a pseudonym). */
  function realName(pubkey: string): string | null {
    return profiles.get(pubkey)?.displayName || profiles.get(pubkey)?.name || null;
  }

  /** Re-derive Go live card names once host names arrive ("<host> is cooking …"). */
  function renameGoLive() {
    if (!items.some(isGoLiveItem)) return;
    const named = new Map(goLiveItems().map((i) => [i.key, i]));
    items = items.map((i) => named.get(i.key) ?? i);
  }

  async function fillGoLive() {
    if (document.hidden && goLiveLoaded) return;
    goLiveSessions = holdWatching(await fetchLiveSessions(), lastWatching);
    goLiveLoaded = true;
    // Show what we have now; recipe photos fill in as they resolve.
    if (goLiveSessions.length) loading = false;
    repaint();
    const missing = [
      ...new Set(goLiveSessions.map((s) => s.recipe_a).filter((a): a is string => !!a))
    ].filter((a) => !recipeCards.has(a));
    for (const a of missing) {
      recipeCards.set(a, null);
      fetchRecipeEventWithRetry(() => get(ndk), a)
        .then((event) => {
          recipeCards = new Map(recipeCards).set(a, recipeCardOf(event));
          repaint();
        })
        .catch(() => {});
    }
  }

  // Image URLs that failed to load. Reassigned (not mutated) so the cards
  // re-render and move on to the next candidate or the placeholder tile.
  let failedThumbs = new Set<string>();
  function markThumbFailed(url: string | null) {
    if (!url || failedThumbs.has(url)) return;
    failedThumbs = new Set(failedThumbs).add(url);
  }

  function hostName(pubkey: string): string {
    return profiles.get(pubkey)?.displayName || profiles.get(pubkey)?.name || pseudonym(pubkey);
  }

  function repaint() {
    const now = Date.now() / 1000;
    items =
      tab === 'live'
        ? mergeLiveItems(goLiveItems(), directory.live(now))
        : tab === 'upcoming'
          ? directory.upcoming(now)
          : directory.past();
    // Host names batch through the shared chat-profile fetch.
    const keys = [...new Set(items.map((i) => i.host))];
    if (keys.length) {
      fetchChatProfiles({ pool: pool as SimplePool, sources: DISCOVERY_RELAYS, keys })
        .then((found) => {
          profiles = new Map([...profiles, ...found]);
          renameGoLive();
        })
        .catch(() => {});
    }
  }

  async function fill() {
    if (!pool) return;
    try {
      const events = (await pool.querySync(
        DISCOVERY_RELAYS,
        { kinds: [30311], limit: 500 } as Filter,
        { maxWait: 6000 }
      )) as unknown as NostrEventLike[];
      for (const event of events) directory.accept(event);
      repaint();
    } catch {
      // Discovery fill failure leaves whatever the live sub delivered.
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    if (!browser) return;
    pool = createStreamPool();
    fill();
    fillGoLive();
    fillTimer = setInterval(fill, 60000);
    goLiveTimer = setInterval(fillGoLive, GO_LIVE_REFRESH_MS);
    viewTimer = setInterval(repaint, 30000);
    const since = Math.floor(Date.now() / 1000) - 120;
    sub = pool.subscribeMany(
      DISCOVERY_RELAYS,
      { kinds: [30311], since } as Filter,
      {
        onevent: (event: unknown) => {
          if (directory.accept(event as NostrEventLike)) repaint();
        }
      } as never
    );
  });

  function setTab(next: Tab) {
    tab = next;
    repaint();
  }

  onDestroy(() => {
    sub?.close();
    sub = null;
    if (fillTimer) clearInterval(fillTimer);
    if (viewTimer) clearInterval(viewTimer);
    if (goLiveTimer) clearInterval(goLiveTimer);
    pool?.destroy();
    pool = null;
  });
</script>

<svelte:head>
  <title>Live — zap.cooking</title>
</svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-6">
  <div class="mb-4 flex flex-wrap items-center gap-2">
    {#each TABS as t (t.id)}
      <button
        type="button"
        class="rounded-full px-3 py-1.5 text-sm font-semibold transition-colors cursor-pointer
          {tab === t.id
          ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
          : 'border border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'}"
        aria-pressed={tab === t.id}
        on:click={() => setTab(t.id)}
      >
        {t.label}
      </button>
    {/each}
  </div>

  {#if tab === 'saved'}
    {#if savedList.length === 0}
      <div class="flex h-64 flex-col items-center justify-center gap-2 text-center">
        <p class="text-sm text-zinc-500">
          No saved streams yet. Tap the bookmark on a stream card to keep it here.
        </p>
      </div>
    {:else}
      <ul class="flex flex-col gap-2">
        {#each savedList as entry (entry.key)}
          {@const href = savedHref(entry)}
          <li
            class="flex items-center gap-3 rounded-xl border px-3 py-2.5"
            style="border-color: var(--color-input-border); background-color: var(--color-bg-primary);"
          >
            {#if href}
              <a
                href={href}
                class="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                style="color: var(--color-text-primary);"
                title={entry.title}
              >
                {entry.title}
              </a>
            {:else}
              <!-- A pasted video link has no stream page: open it directly. -->
              <a
                href={entry.url || '#'}
                target="_blank"
                rel="noreferrer"
                class="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                style="color: var(--color-text-primary);"
                title={entry.title}
              >
                {entry.title}
              </a>
            {/if}
            <button
              type="button"
              class="shrink-0 rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
              aria-label="Remove from saved"
              on:click={() => (savedList = toggleSavedItem(entry, savedList).items)}
            >
              <TrashIcon size={16} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {:else if loading}
    <!-- Skeleton grid mirrors the card layout while discovery fills. -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each [0, 1, 2, 3, 4, 5] as i (i)}
        <StreamCardSkeleton />
      {/each}
    </div>
  {:else if items.length === 0}
    <div class="flex h-64 flex-col items-center justify-center gap-2 text-center">
      <p class="text-sm text-zinc-500">
        {tab === 'live'
          ? 'No one is live right now. Check back soon!'
          : tab === 'upcoming'
            ? 'No scheduled streams yet.'
            : 'No past streams found.'}
      </p>
    </div>
  {:else}
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each items as item (item.key)}
        {@const href = link(item)}
        {@const thumb = pickThumb(item, failedThumbs)}
        <!-- The card's link is a stretched overlay (after:inset-0): the
             save and share buttons sit beside (not inside) it — a button
             inside a link is not valid and would follow the link. -->
        <div class="relative">
        <a
          href={href || '#'}
          class="group relative block overflow-hidden rounded-xl border transition-colors after:absolute after:inset-0 after:z-10 after:rounded-xl after:content-['']"
          style="border-color: var(--color-input-border); background-color: var(--color-bg-primary);"
        >
          <div class="relative aspect-video w-full overflow-hidden bg-zinc-200 dark:bg-zinc-800">
            {#if thumb.url}
              <img
                src={thumb.url}
                alt=""
                loading="lazy"
                class="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                on:error={() => markThumbFailed(thumb.url)}
              />
            {:else if isGoLiveItem(item)}
              <!-- No recipe photo (or it failed to load): the branded picture. -->
              <LiveFallbackArt />
            {:else if thumb.broken}
              <!-- Every image the announcement named failed to load. -->
              <div
                class="flex h-full w-full flex-col items-center justify-center gap-1.5"
                style="color: var(--color-caption);"
                role="img"
                aria-label="Image unavailable"
              >
                <ImageBrokenIcon size={28} />
                <span class="text-xs">Image unavailable</span>
              </div>
            {/if}
            <span
              class="absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide
                {item.status === 'ended'
                ? 'bg-zinc-700 text-zinc-200'
                : item.status === 'planned'
                  ? 'bg-zinc-900 text-white'
                  : 'bg-red-600 text-white'}"
            >
              {item.status === 'ended' ? 'Replay' : item.status === 'planned' ? 'Soon' : 'Live'}
            </span>
            <!-- "N watching" on every live card, Go live and Nostr alike, from 1 up. -->
            {#if watchingCount(item.viewers) != null && item.status === 'live'}
              <span
                class="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white"
              >
                {watchingLabel(item.viewers ?? 0)}
              </span>
            {/if}
          </div>
          <div class="p-3">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p
                  class="truncate text-sm font-semibold"
                  style="color: var(--color-text-primary);"
                  title={item.title}
                >
                  {item.title}
                </p>
                <p
                  class="mt-1 flex items-center gap-1.5 text-xs"
                  style="color: var(--color-caption);"
                >
                  <Avatar
                    pubkey={item.host}
                    size={16}
                    alt={hostName(item.host)}
                    interactive={false}
                  />
                  <span class="truncate">{hostName(item.host)}</span>
                  {#if item.status === 'live' && runtime(item.starts)}
                    · {runtime(item.starts)?.days
                      ? `${runtime(item.starts)?.days}d`
                      : runtime(item.starts)?.hours
                        ? `${runtime(item.starts)?.hours}h`
                        : `${runtime(item.starts)?.minutes}m`}
                  {/if}
                </p>
              </div>
            </div>
          </div>
        </a>
        {#if !isGoLiveItem(item)}
          <!-- Beside the card link, not inside it (see above). Clustered
               with Share in the bottom-right so neither control covers the
               host line or the watching badge. -->
          <button
            type="button"
            class="absolute bottom-2.5 right-12 z-20 rounded-full bg-black/50 p-1.5 backdrop-blur-sm transition-colors cursor-pointer hover:bg-black/70
              {isSaved(item, savedList) ? 'text-amber-400' : 'text-white'}"
            aria-label="Save stream"
            aria-pressed={isSaved(item, savedList)}
            title={isSaved(item, savedList) ? 'Saved' : 'Save'}
            on:click={() => save(item)}
          >
            <BookmarkIcon
              size={16}
              weight={isSaved(item, savedList) ? 'fill' : 'regular'}
            />
          </button>
        {/if}
        {#if href}
          <div class="absolute bottom-2.5 right-2.5 z-20">
            <LiveShareButton url={getSiteOrigin() + href} title={item.title} variant="icon" up />
          </div>
        {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
