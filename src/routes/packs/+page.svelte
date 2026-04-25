<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { nip19 } from 'nostr-tools';
  import { ndk, userPublickey, ensureNdkConnected } from '$lib/nostr';
  import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk';
  import { standardRelays } from '$lib/consts';
  import { RECIPE_PACK_KIND, RECIPE_PACK_TAG, ZAP_COOKING_TAG } from '$lib/recipePack';
  import RecipePackCard from '../../components/RecipePackCard.svelte';
  import PanLoader from '../../components/PanLoader.svelte';
  import BookmarkIcon from 'phosphor-svelte/lib/BookmarkSimple';
  import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeft';

  type Tab = 'discover' | 'mine';
  let tab: Tab = 'discover';

  // Hydrate tab from ?tab= query param so links can deep-link to "Mine".
  $: {
    const t = $page.url.searchParams.get('tab');
    if (t === 'mine' || t === 'discover') tab = t;
  }

  function setTab(next: Tab) {
    tab = next;
    if (browser) {
      const url = new URL(window.location.href);
      if (next === 'discover') url.searchParams.delete('tab');
      else url.searchParams.set('tab', next);
      goto(url.pathname + (url.search || ''), {
        replaceState: true,
        keepFocus: true,
        noScroll: true
      });
    }
  }

  // ===== Pack feeds =====
  // Cache events so switching tabs is instant after first load.
  let discoverEvents: NDKEvent[] = [];
  let mineEvents: NDKEvent[] = [];
  let discoverLoading = false;
  let mineLoading = false;
  let discoverLoaded = false; // success-only; on error we leave this false so retry is possible
  let mineLoaded = false;
  let discoverError = '';
  let mineError = '';

  // Per-load request id for the Mine fetch. Captured at the start of
  // each load and re-checked when the network returns; if it doesn't
  // match anymore (user signed out / switched accounts), the result
  // is dropped without overwriting state. Same idea as the relay-
  // generation guard in /recent.
  let mineRequestId = 0;

  async function loadDiscover() {
    if (discoverLoading) return;
    discoverLoading = true;
    discoverError = '';
    try {
      // Make sure NDK has at least one connected relay before subscribing
      // — mirrors /recent's pattern. Reduces cold-load failure rate when
      // the page is loaded directly (rather than via SPA nav from the home
      // feed which has already warmed connections).
      try {
        await ensureNdkConnected();
      } catch {
        /* tolerate; fetchEvents will surface the error if relays are still down */
      }

      // CRITICAL: outbox model is enabled on this NDK instance. Filters
      // without `authors` get an empty relay set ("No relays found for
      // filter") and the subscription hangs forever — no relays → no
      // EOSE → fetchEvents never resolves. Pass an explicit relay set
      // built from the standard pool so unauthored discovery queries
      // actually run. (`false` here means use existing pool connections;
      // no extra WebSocket churn.)
      const relaySet = NDKRelaySet.fromRelayUrls(standardRelays, $ndk, false);

      // Race against a timeout so we never hang the UI even if every
      // relay is silent. 8s is generous — typical EOSE arrives in 1-2s.
      const fetchPromise = $ndk.fetchEvents(
        {
          kinds: [RECIPE_PACK_KIND as number],
          '#t': [ZAP_COOKING_TAG, RECIPE_PACK_TAG],
          limit: 60
        },
        { closeOnEose: true },
        relaySet
      );
      const timeoutPromise = new Promise<Set<NDKEvent>>((_, reject) =>
        setTimeout(() => reject(new Error('Relay timeout')), 8000)
      );

      const events = (await Promise.race([fetchPromise, timeoutPromise])) as Set<NDKEvent>;
      discoverEvents = sortAndDedupe(Array.from(events));
      discoverLoaded = true; // mark loaded only on success — error path leaves it false so Retry works
    } catch (e: any) {
      console.error('[packs] discover load failed', e);
      discoverError = 'Could not load Recipe Packs. Try again in a moment.';
    } finally {
      discoverLoading = false;
    }
  }

  async function loadMine() {
    if (mineLoading) return;
    if (!$userPublickey) {
      mineEvents = [];
      mineLoaded = true;
      return;
    }
    const reqId = ++mineRequestId;
    const reqPubkey = $userPublickey;
    mineLoading = true;
    mineError = '';
    try {
      try {
        await ensureNdkConnected();
      } catch {
        /* tolerate */
      }

      // Same timeout protection as loadDiscover. Outbox model usually
      // handles authored queries fine, but a stalled relay can still hang
      // fetchEvents indefinitely. Bound the wait so the spinner can't
      // stick forever.
      const fetchPromise = $ndk.fetchEvents(
        {
          kinds: [RECIPE_PACK_KIND as number],
          authors: [reqPubkey],
          limit: 60
        },
        { closeOnEose: true }
      );
      const timeoutPromise = new Promise<Set<NDKEvent>>((_, reject) =>
        setTimeout(() => reject(new Error('Relay timeout')), 8000)
      );
      const events = (await Promise.race([fetchPromise, timeoutPromise])) as Set<NDKEvent>;

      // Drop the result if the user has logged out or switched accounts
      // since this fetch began — otherwise stale events from the previous
      // pubkey would overwrite the current state.
      if (reqId !== mineRequestId || reqPubkey !== $userPublickey) {
        return;
      }

      mineEvents = sortAndDedupe(Array.from(events));
      mineLoaded = true;
    } catch (e: any) {
      console.error('[packs] mine load failed', e);
      if (reqId === mineRequestId) {
        mineError = 'Could not load your Recipe Packs.';
      }
    } finally {
      if (reqId === mineRequestId) {
        mineLoading = false;
      }
    }
  }

  // Replaceable events: drop anything missing a `d` tag (Recipe Packs are
  // addressable so a missing `d` means malformed/spam — we'd also have no
  // way to build a working /pack/<naddr> link), then keep only the newest
  // event per (pubkey, d-tag), then sort newest-first.
  function sortAndDedupe(events: NDKEvent[]): NDKEvent[] {
    const valid = events.filter((e) => {
      const dTag = e.tags?.find((t) => t[0] === 'd')?.[1];
      // Need a non-empty d-tag AND at least one recipe `a` reference.
      // Empty packs would render as empty cards; bare-d packs would
      // collide in the dedupe map by pubkey alone.
      return !!dTag && e.tags?.some((t) => t[0] === 'a');
    });

    const byKey = new Map<string, NDKEvent>();
    for (const e of valid) {
      const dTag = e.tags!.find((t) => t[0] === 'd')![1];
      const key = `${e.pubkey}:${dTag}`;
      const existing = byKey.get(key);
      if (!existing || (e.created_at || 0) > (existing.created_at || 0)) {
        byKey.set(key, e);
      }
    }
    return Array.from(byKey.values()).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  }

  function retryDiscover() {
    discoverError = '';
    discoverLoaded = false;
    loadDiscover();
  }

  function retryMine() {
    mineError = '';
    mineLoaded = false;
    loadMine();
  }

  // Trigger loads on tab change (or first mount).
  $: if (browser && tab === 'discover' && !discoverLoaded && !discoverLoading && !discoverError) {
    loadDiscover();
  }
  $: if (browser && tab === 'mine' && !mineLoaded && !mineLoading && !mineError) {
    loadMine();
  }

  // Re-load Mine when sign-in changes — bump the request id so any
  // in-flight fetch for the previous pubkey is ignored on resolution.
  let lastUserPubkey = '';
  $: if (browser && $userPublickey !== lastUserPubkey) {
    lastUserPubkey = $userPublickey;
    mineLoaded = false;
    mineEvents = [];
    mineError = '';
    mineRequestId++;
    mineLoading = false;
  }

  onMount(() => {
    // Force first load even before reactive blocks fire.
    if (tab === 'discover') loadDiscover();
    if (tab === 'mine') loadMine();
  });

  // Card-friendly view of a pack event.
  function packCardData(e: NDKEvent) {
    const find = (name: string) => e.tags?.find((t) => t[0] === name)?.[1];
    const title = find('title') || find('d') || 'Recipe Pack';
    const description = find('description') || '';
    const image = find('image') || undefined;
    const recipeCount = e.tags?.filter((t) => t[0] === 'a').length || 0;
    const dTag = find('d') || '';
    let viewUrl = '';
    if (dTag && e.pubkey) {
      try {
        const naddr = nip19.naddrEncode({
          identifier: dTag,
          kind: RECIPE_PACK_KIND as number,
          pubkey: e.pubkey
        });
        viewUrl = `/pack/${naddr}`;
      } catch {
        /* ignore */
      }
    }
    return { title, description, image, recipeCount, viewUrl };
  }

  // Explicit declarations to satisfy strict-mode tooling (Svelte's `$:`
  // creates an implicit binding, but eslint-svelte and svelte-check in
  // strict TS configs sometimes flag it).
  let activeEvents: NDKEvent[] = [];
  let activeLoading = false;
  let activeLoaded = false;
  let activeError = '';
  $: activeEvents = tab === 'discover' ? discoverEvents : mineEvents;
  $: activeLoading = tab === 'discover' ? discoverLoading : mineLoading;
  $: activeLoaded = tab === 'discover' ? discoverLoaded : mineLoaded;
  $: activeError = tab === 'discover' ? discoverError : mineError;
</script>

<svelte:head>
  <title>Recipe Packs — Zap Cooking</title>
  <meta
    name="description"
    content="Browse curated, zappable Recipe Packs from chefs across Nostr."
  />
  <meta property="og:title" content="Recipe Packs — Zap Cooking" />
  <meta
    property="og:description"
    content="Browse curated, zappable Recipe Packs from chefs across Nostr."
  />
  <meta property="og:image" content="https://zap.cooking/social-share.png" />
  <meta property="og:url" content="https://zap.cooking/packs" />
  <meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<div class="flex flex-col gap-5">
  <!-- Header -->
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div class="flex items-center gap-3">
      <div
        class="w-12 h-12 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center flex-shrink-0"
      >
        <BookmarkIcon size={24} weight="fill" class="text-white" />
      </div>
      <div>
        <h1 class="text-2xl font-bold" style="color: var(--color-text-primary)">Recipe Packs</h1>
        <p class="text-sm text-caption">Curated, zappable recipe collections from across Nostr.</p>
      </div>
    </div>
    <a
      href="/cookbook"
      class="inline-flex items-center gap-1.5 text-sm text-caption hover:text-primary transition-colors"
    >
      <ArrowLeftIcon size={16} />
      <span>My Cookbook</span>
    </a>
  </div>

  <!-- Sub-tabs: Discover / Mine -->
  <div class="flex w-full border-b" style="border-color: var(--color-input-border)">
    <button
      on:click={() => setTab('discover')}
      class="flex-1 py-2.5 text-sm font-medium transition-colors relative cursor-pointer text-center"
      style="color: {tab === 'discover'
        ? 'var(--color-text-primary)'
        : 'var(--color-text-secondary)'}"
    >
      Discover
      {#if tab === 'discover'}
        <span
          class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
        ></span>
      {/if}
    </button>
    <button
      on:click={() => setTab('mine')}
      class="flex-1 py-2.5 text-sm font-medium transition-colors relative cursor-pointer text-center"
      style="color: {tab === 'mine'
        ? 'var(--color-text-primary)'
        : 'var(--color-text-secondary)'}"
    >
      Mine
      {#if tab === 'mine'}
        <span
          class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
        ></span>
      {/if}
    </button>
  </div>

  <!-- Body -->
  {#if tab === 'mine' && !$userPublickey}
    <div class="flex flex-col items-center justify-center py-16 px-4">
      <div
        class="w-16 h-16 rounded-full bg-gradient-to-br from-orange-100 to-amber-100 dark:from-orange-900/30 dark:to-amber-900/30 flex items-center justify-center mb-4"
      >
        <BookmarkIcon size={32} weight="regular" class="text-orange-500" />
      </div>
      <h2 class="text-lg font-medium mb-2" style="color: var(--color-text-primary)">
        Sign in to see your packs
      </h2>
      <p class="text-caption text-center max-w-sm mb-4">
        Once you're signed in, your published Recipe Packs will appear here.
      </p>
      <a
        href="/login"
        class="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-full font-medium transition-all"
      >
        Sign in
      </a>
    </div>
  {:else if !activeLoaded && activeLoading}
    <div class="flex justify-center items-center py-16">
      <PanLoader />
    </div>
  {:else if activeError}
    <div class="flex flex-col items-center justify-center py-12 px-4 gap-3">
      <p class="text-caption text-sm text-center">{activeError}</p>
      <button
        on:click={() => (tab === 'discover' ? retryDiscover() : retryMine())}
        class="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors"
        style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
      >
        Retry
      </button>
    </div>
  {:else if activeEvents.length === 0}
    <div class="flex flex-col items-center justify-center py-16 px-4">
      <div
        class="w-16 h-16 rounded-full bg-gradient-to-br from-orange-100 to-amber-100 dark:from-orange-900/30 dark:to-amber-900/30 flex items-center justify-center mb-4"
      >
        <BookmarkIcon size={32} weight="regular" class="text-orange-500" />
      </div>
      <h2 class="text-lg font-medium mb-2" style="color: var(--color-text-primary)">
        {tab === 'discover' ? 'No packs found yet' : "You haven't published any packs"}
      </h2>
      <p class="text-caption text-center max-w-sm mb-4">
        {tab === 'discover'
          ? "We couldn't find any Recipe Packs on the connected relays. Check back soon."
          : 'Open a collection in your cookbook and tap "Share Pack" to publish your first one.'}
      </p>
      <a
        href="/cookbook"
        class="flex items-center px-4 py-2 rounded-full font-medium text-sm transition-colors"
        style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
      >
        Open Cookbook
      </a>
    </div>
  {:else}
    <div class="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {#each activeEvents as e (e.id)}
        {@const card = packCardData(e)}
        <RecipePackCard
          event={e}
          title={card.title}
          description={card.description}
          image={card.image}
          creatorPubkey={e.pubkey}
          recipeCount={card.recipeCount}
          viewUrl={card.viewUrl}
        />
      {/each}
    </div>
  {/if}
</div>
