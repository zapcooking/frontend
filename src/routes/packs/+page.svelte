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
  import { savedPacksStore, savedPackATags } from '$lib/savedPacksStore';
  import RecipePackCard from '../../components/RecipePackCard.svelte';
  import PanLoader from '../../components/PanLoader.svelte';
  import BookmarkIcon from 'phosphor-svelte/lib/BookmarkSimple';

  type Tab = 'discover' | 'mine' | 'saved';
  let tab: Tab = 'discover';

  // Hydrate tab from ?tab= query param so links can deep-link to a sub-tab.
  // Snap back to 'discover' when the param is missing or invalid so
  // navigating /packs?tab=mine → /packs (or browser-back) doesn't leave
  // the UI on the previous tab.
  $: {
    const t = $page.url.searchParams.get('tab');
    if (t === 'mine' || t === 'discover' || t === 'saved') tab = t;
    else tab = 'discover';
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

  // Saved tab — same shape, separate state. Populated by resolving each
  // bookmarked a-tag to its underlying kind 30004 event.
  let savedEvents: NDKEvent[] = [];
  let savedLoading = false;
  let savedLoaded = false;
  let savedError = '';
  let savedRequestId = 0;
  let lastResolvedSavedSig = '';

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

  /**
   * Resolve bookmarked pack a-tags to their underlying kind 30004
   * events. Each a-tag is `30004:pubkey:dTag`. We fetch them in
   * parallel via the standard pool (same outbox-bypass pattern as
   * Discover) so the user always sees something even when there's no
   * NIP-65 data for the pack creators.
   */
  async function loadSaved() {
    if (savedLoading) return;
    if (!$userPublickey) {
      savedEvents = [];
      savedLoaded = true;
      return;
    }
    const reqId = ++savedRequestId;
    savedLoading = true;
    savedError = '';
    try {
      try {
        await ensureNdkConnected();
      } catch {
        /* tolerate */
      }
      // Make sure the bookmark list itself is hydrated.
      await savedPacksStore.load();
      const aTags = $savedPackATags;
      lastResolvedSavedSig = aTags.slice().sort().join(',');

      if (aTags.length === 0) {
        if (reqId === savedRequestId) {
          savedEvents = [];
          savedLoaded = true;
        }
        return;
      }

      // Group the saved a-tags by (kind, pubkey) so all packs from the
      // same author can be fetched with a single filter using a multi-
      // value `#d`. This collapses N requests into "one filter per
      // unique creator" — typical case is a handful of creators per
      // user, so the result is usually 1-3 round trips total.
      const relaySet = NDKRelaySet.fromRelayUrls(standardRelays, $ndk, false);
      const groups = new Map<string, { kind: number; pubkey: string; dTags: Set<string> }>();
      for (const aTag of aTags) {
        const parts = aTag.split(':');
        if (parts.length !== 3) continue;
        const [kindStr, pubkey, dTag] = parts;
        const kind = Number(kindStr);
        if (!Number.isFinite(kind) || !pubkey || !dTag) continue;
        const key = `${kind}:${pubkey}`;
        const existing = groups.get(key);
        if (existing) existing.dTags.add(dTag);
        else groups.set(key, { kind, pubkey, dTags: new Set([dTag]) });
      }

      const filters = Array.from(groups.values()).map(({ kind, pubkey, dTags }) => ({
        kinds: [kind],
        authors: [pubkey],
        '#d': Array.from(dTags)
      }));

      let fetched: NDKEvent[] = [];
      if (filters.length > 0) {
        try {
          // NDK's fetchEvents accepts an array of filters → it issues a
          // single REQ with all filters per relay (each filter is OR'd).
          const fetchPromise = $ndk.fetchEvents(filters, { closeOnEose: true }, relaySet);
          const timeoutPromise = new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), 8000)
          );
          const result = await Promise.race([fetchPromise, timeoutPromise]);
          if (result) fetched = Array.from(result);
        } catch {
          fetched = [];
        }
      }

      // Drop result if user changed mid-fetch.
      if (reqId !== savedRequestId) return;
      savedEvents = sortAndDedupe(fetched);
      savedLoaded = true;
    } catch (e: any) {
      console.error('[packs] saved load failed', e);
      if (reqId === savedRequestId) {
        savedError = 'Could not load your saved Recipe Packs.';
      }
    } finally {
      if (reqId === savedRequestId) savedLoading = false;
    }
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

  function retrySaved() {
    savedError = '';
    savedLoaded = false;
    loadSaved();
  }

  // Trigger loads on tab change (or first mount).
  $: if (browser && tab === 'discover' && !discoverLoaded && !discoverLoading && !discoverError) {
    loadDiscover();
  }
  $: if (browser && tab === 'mine' && !mineLoaded && !mineLoading && !mineError) {
    loadMine();
  }
  $: if (browser && tab === 'saved' && !savedLoaded && !savedLoading && !savedError) {
    loadSaved();
  }

  // Re-resolve Saved when the underlying bookmark list changes — e.g.,
  // user clicks bookmark on a card. Compare a stable signature of the
  // a-tag list rather than reference, since the store always emits a
  // fresh array.
  $: if (browser && $userPublickey) {
    const sig = $savedPackATags.slice().sort().join(',');
    if (savedLoaded && sig !== lastResolvedSavedSig) {
      lastResolvedSavedSig = sig;
      savedLoaded = false;
      // If the user is currently viewing the Saved tab, kick a refetch;
      // otherwise the auto-load above will handle it on next visit.
      if (tab === 'saved') loadSaved();
    }
  }

  // Re-load Mine + Saved when sign-in changes — bump request ids so any
  // in-flight fetch for the previous pubkey is ignored on resolution.
  let lastUserPubkey = '';
  $: if (browser && $userPublickey !== lastUserPubkey) {
    lastUserPubkey = $userPublickey;
    mineLoaded = false;
    mineEvents = [];
    mineError = '';
    mineRequestId++;
    mineLoading = false;
    savedLoaded = false;
    savedEvents = [];
    savedError = '';
    savedRequestId++;
    savedLoading = false;
    lastResolvedSavedSig = '';
  }

  onMount(() => {
    // Force first load even before reactive blocks fire.
    if (tab === 'discover') loadDiscover();
    if (tab === 'mine') loadMine();
    if (tab === 'saved') loadSaved();
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
  $: activeEvents =
    tab === 'discover' ? discoverEvents : tab === 'mine' ? mineEvents : savedEvents;
  $: activeLoading =
    tab === 'discover' ? discoverLoading : tab === 'mine' ? mineLoading : savedLoading;
  $: activeLoaded =
    tab === 'discover' ? discoverLoaded : tab === 'mine' ? mineLoaded : savedLoaded;
  $: activeError =
    tab === 'discover' ? discoverError : tab === 'mine' ? mineError : savedError;
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

<div class="flex flex-col gap-4 max-w-full md:max-w-none">
  <!-- Top tab bar — mirrors /recent so navigation stays consistent.
       Recent / Packs / Premium ⚡️ — Packs is active here. -->
  <div class="flex w-full border-b" style="border-color: var(--color-input-border)">
    <a
      href="/recent"
      class="flex-1 py-2.5 text-sm font-medium transition-colors relative cursor-pointer text-center"
      style="color: var(--color-text-secondary)"
    >
      Recent
    </a>
    <div
      class="flex-1 py-2.5 text-sm font-medium transition-colors relative text-center"
      style="color: var(--color-text-primary)"
    >
      Packs
      <span
        class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
      ></span>
    </div>
    <a
      href="/premium"
      class="flex-1 py-2.5 text-sm font-medium transition-colors relative cursor-pointer text-center"
      style="color: var(--color-text-secondary)"
    >
      Premium ⚡️
    </a>
  </div>

  <!-- Sub-tabs: Discover / Mine / Saved -->
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
    <button
      on:click={() => setTab('saved')}
      class="flex-1 py-2.5 text-sm font-medium transition-colors relative cursor-pointer text-center"
      style="color: {tab === 'saved'
        ? 'var(--color-text-primary)'
        : 'var(--color-text-secondary)'}"
    >
      Saved
      {#if tab === 'saved'}
        <span
          class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
        ></span>
      {/if}
    </button>
  </div>

  <!-- Body -->
  {#if (tab === 'mine' || tab === 'saved') && !$userPublickey}
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
        {tab === 'mine'
          ? "Once you're signed in, your published Recipe Packs will appear here."
          : "Once you're signed in, packs you've saved will appear here."}
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
        on:click={() =>
          tab === 'discover' ? retryDiscover() : tab === 'mine' ? retryMine() : retrySaved()}
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
        {tab === 'discover'
          ? 'No packs found yet'
          : tab === 'mine'
            ? "You haven't published any packs"
            : 'No saved packs yet'}
      </h2>
      <p class="text-caption text-center max-w-sm mb-4">
        {tab === 'discover'
          ? "We couldn't find any Recipe Packs on the connected relays. Check back soon."
          : tab === 'mine'
            ? 'Open a collection in your cookbook and tap "Share Pack" to publish your first one.'
            : 'Tap the bookmark icon on a pack to save it here.'}
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
