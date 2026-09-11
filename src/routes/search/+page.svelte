<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { onDestroy } from 'svelte';
  import { nip19 } from 'nostr-tools';
  import { ndk } from '$lib/nostr';
  import { mutedPubkeys } from '$lib/muteListStore';
  import { NDKRelaySet, type NDKEvent, type NDKSubscription } from '@nostr-dev-kit/ndk';
  import { isHiddenRecipeEvent } from '$lib/consts';
  import { searchProfiles, getDisplayName, type SearchProfile } from '$lib/profileSearchService';
  import { isHumanReadablePostContent } from '$lib/postContentReadability';
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
  const RECIPE_LIMIT = 25;
  const SEARCH_TIMEOUT_MS = 6000;

  $: query = ($page.url.searchParams.get('q') || '').trim();
  $: type = (['posts', 'users', 'recipes'] as const).includes(
    $page.url.searchParams.get('type') as 'posts'
  )
    ? ($page.url.searchParams.get('type') as 'posts' | 'users' | 'recipes')
    : 'posts';

  function switchType(next: 'posts' | 'users' | 'recipes') {
    if (next === type) return;
    const params = new URLSearchParams($page.url.searchParams);
    params.set('type', next);
    goto(`/search?${params.toString()}`, { keepFocus: true, noScroll: true });
  }

  // ── Posts (NIP-50 kind 1/1068) ─────────────────────────────────────
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

  async function preconnectRelays(q: string) {
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
    return searchedFor === q;
  }

  async function runSearch(q: string) {
    stopSearch();
    seen.clear();
    results = [];
    pending = [];
    if (!q || !$ndk) return;

    searchedFor = q;
    loading = true;

    if (!(await preconnectRelays(q))) return; // superseded by a newer query

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
        // Polls carry their question in content; everything else must
        // read as prose — search relays index JSON payloads and data
        // walls that render as garbage otherwise.
        if (event.kind !== 1068 && !isHumanReadablePostContent(event.content)) return;
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

  // ── Users (Primal-backed profile search) ───────────────────────────
  let userResults: SearchProfile[] = [];
  let usersLoading = false;

  async function runUserSearch(q: string) {
    if (!q) {
      userResults = [];
      return;
    }
    usersLoading = true;
    try {
      userResults = await searchProfiles(q, 20);
    } catch {
      userResults = [];
    } finally {
      usersLoading = false;
    }
  }

  // ── Recipes (NIP-50 kind 30023) ────────────────────────────────────
  let recipeResults: { title: string; naddr: string }[] = [];
  let recipesLoading = false;
  let recipeSub: NDKSubscription | null = null;
  let recipeTimeout: ReturnType<typeof setTimeout> | null = null;
  const recipeSeen = new Set<string>();

  function stopRecipeSearch() {
    if (recipeSub) {
      try {
        recipeSub.stop();
      } catch {
        /* ignore */
      }
      recipeSub = null;
    }
    if (recipeTimeout) {
      clearTimeout(recipeTimeout);
      recipeTimeout = null;
    }
  }

  async function runRecipeSearch(q: string) {
    stopRecipeSearch();
    recipeSeen.clear();
    recipeResults = [];
    if (!q || !$ndk) return;

    recipesLoading = true;
    if (!(await preconnectRelays(q))) return;

    try {
      const relaySet = NDKRelaySet.fromRelayUrls(SEARCH_RELAYS, $ndk, false);
      recipeSub = $ndk.subscribe(
        { kinds: [30023], search: q, limit: RECIPE_LIMIT },
        { closeOnEose: true, groupable: false },
        relaySet
      );

      recipeSub.on('event', (event: NDKEvent) => {
        const d = event.tags.find((t) => t[0] === 'd')?.[1];
        if (!d) return;
        if (isHiddenRecipeEvent(event)) return;
        const naddr = nip19.naddrEncode({ kind: 30023, pubkey: event.pubkey, identifier: d });
        if (recipeSeen.has(naddr)) return;
        recipeSeen.add(naddr);
        const title = event.tags.find((t) => t[0] === 'title')?.[1] || d;
        recipeResults = [...recipeResults, { title, naddr }].slice(0, RECIPE_LIMIT);
      });

      const finish = () => {
        recipesLoading = false;
      };
      recipeSub.on('eose', finish);
      recipeTimeout = setTimeout(finish, SEARCH_TIMEOUT_MS);
    } catch {
      recipesLoading = false;
    }
  }

  // Re-run all three searches when the query changes (URL-driven —
  // back/forward works). Tab switches don't re-fetch.
  $: if (browser && query !== undefined) {
    runSearch(query);
    runUserSearch(query);
    runRecipeSearch(query);
  }

  onDestroy(() => {
    stopSearch();
    stopRecipeSearch();
  });

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

  $: tabs = [
    { id: 'posts', label: 'Posts', count: visibleResults.length, active: loading },
    { id: 'users', label: 'Users', count: userResults.length, active: usersLoading },
    { id: 'recipes', label: 'Recipes', count: recipeResults.length, active: recipesLoading }
  ];
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

  <h1 class="text-xl font-bold mb-3" style="color: var(--color-text-primary);">
    Results{query ? ` for “${query}”` : ''}
  </h1>

  <div class="flex gap-1 mb-4 border-b" style="border-color: var(--color-input-border);" role="tablist">
    {#each tabs as tab (tab.id)}
      <button
        type="button"
        role="tab"
        aria-selected={type === tab.id}
        on:click={() => switchType(tab.id)}
        class="px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px {type === tab.id
          ? 'border-primary'
          : 'border-transparent hover:opacity-80'}"
        style="color: {type === tab.id ? 'var(--color-text-primary)' : 'var(--color-text-caption)'};"
      >
        {tab.label}
        <span class="ml-1 text-xs opacity-70">
          {#if tab.active}…{:else}{tab.count}{/if}
        </span>
      </button>
    {/each}
  </div>

  {#if type === 'posts'}
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
          Try a different keyword, or the Users and Recipes tabs.
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
  {:else if type === 'users'}
    {#if usersLoading && userResults.length === 0}
      <div class="flex justify-center items-center page-loader">
        <PanLoader />
      </div>
    {:else if userResults.length === 0}
      <div class="flex flex-col items-center py-16 gap-2">
        <p class="text-sm font-medium" style="color: var(--color-text-primary);">
          No users found{query ? ` for “${query}”` : ''}
        </p>
      </div>
    {:else}
      <div class="flex flex-col gap-2 pb-16">
        {#each userResults as user (user.npub)}
          <a
            href="/user/{user.npub}"
            class="flex items-center gap-3 rounded-2xl border p-3 transition-colors hover:bg-accent-gray"
            style="border-color: var(--color-input-border);"
          >
            {#if user.picture}
              <img
                src={user.picture}
                alt=""
                class="w-10 h-10 rounded-full object-cover flex-shrink-0"
                loading="lazy"
              />
            {:else}
              <div class="flex-shrink-0"><Avatar pubkey={user.pubkey} size={40} /></div>
            {/if}
            <div class="flex flex-col min-w-0">
              <span class="font-semibold text-[15px] truncate" style="color: var(--color-text-primary);">
                {getDisplayName(user)}
              </span>
              {#if user.nip05}
                <span class="text-xs truncate" style="color: var(--color-text-caption);">
                  {user.nip05}
                </span>
              {:else}
                <span class="text-xs truncate font-mono" style="color: var(--color-text-caption);">
                  {user.npub.slice(0, 16)}…
                </span>
              {/if}
            </div>
          </a>
        {/each}
      </div>
    {/if}
  {:else if type === 'recipes'}
    {#if recipesLoading && recipeResults.length === 0}
      <div class="flex justify-center items-center page-loader">
        <PanLoader />
      </div>
    {:else if recipeResults.length === 0}
      <div class="flex flex-col items-center py-16 gap-2">
        <p class="text-sm font-medium" style="color: var(--color-text-primary);">
          No recipes found{query ? ` for “${query}”` : ''}
        </p>
      </div>
    {:else}
      <div class="flex flex-col gap-2 pb-16">
        {#each recipeResults as recipe (recipe.naddr)}
          <a
            href="/recipe/{recipe.naddr}"
            class="flex items-center gap-3 rounded-2xl border p-3 transition-colors hover:bg-accent-gray"
            style="border-color: var(--color-input-border);"
          >
            <span class="font-medium text-[15px] truncate" style="color: var(--color-text-primary);">
              {recipe.title}
            </span>
          </a>
        {/each}
      </div>
    {/if}
  {/if}
</div>
