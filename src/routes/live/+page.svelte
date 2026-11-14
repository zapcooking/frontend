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
  import { StreamDirectory } from '$lib/streams/directory';
  import { pseudonym, runtime } from '$lib/streams/parse';
  import { createStreamPool } from '$lib/streams/relayPage';
  import { fetchChatProfiles, type ChatProfile } from '$lib/streams/chat';
  import { DISCOVERY_RELAYS } from '$lib/streams/relays';
  import type { NostrEventLike, StreamItem } from '$lib/streams/types';
  import { get } from 'svelte/store';
  import { ndk } from '$lib/nostr';
  import {
    fetchLiveSessions,
    mergeLiveItems,
    sessionToStreamItem,
    streamPath,
    type GoLiveSession,
    type RecipeCard
  } from '$lib/streams/goLive';
  import { fetchRecipeEventWithRetry, recipeCardOf } from '$lib/streams/recipeCard';

  type Tab = 'live' | 'upcoming' | 'past';
  const TABS: { id: Tab; label: string }[] = [
    { id: 'live', label: 'Live now' },
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'past', label: 'Past' }
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

  const GO_LIVE_REFRESH_MS = 20000;

  function link(item: StreamItem): string | null {
    return streamPath(item);
  }

  function goLiveItems(): StreamItem[] {
    return goLiveSessions.map((s) =>
      sessionToStreamItem(s, s.recipe_a ? recipeCards.get(s.recipe_a) : null)
    );
  }

  async function fillGoLive() {
    if (document.hidden && goLiveLoaded) return;
    goLiveSessions = await fetchLiveSessions();
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

  {#if loading}
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
        {@const thumb = item.thumb || item.image}
        <a
          href={href || '#'}
          class="group overflow-hidden rounded-xl border transition-colors"
          style="border-color: var(--color-input-border); background-color: var(--color-bg-primary);"
        >
          <div class="relative aspect-video w-full overflow-hidden bg-zinc-200 dark:bg-zinc-800">
            {#if thumb}
              <img
                src={thumb}
                alt={item.title}
                loading="lazy"
                class="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
              />
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
            {#if item.viewers != null && item.status === 'live'}
              <span
                class="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white"
              >
                {item.viewers.toLocaleString()}
              </span>
            {/if}
          </div>
          <div class="p-3">
            <p
              class="truncate text-sm font-semibold"
              style="color: var(--color-text-primary);"
              title={item.title}
            >
              {item.title}
            </p>
            <p class="mt-1 flex items-center gap-1.5 text-xs" style="color: var(--color-caption);">
              <Avatar pubkey={item.host} size={16} alt={hostName(item.host)} interactive={false} />
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
        </a>
      {/each}
    </div>
  {/if}
</div>
