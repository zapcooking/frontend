<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { onMount, onDestroy } from 'svelte';
  import { userPublickey } from '$lib/nostr';
  import {
    cookbookStore,
    cookbookLists,
    cookbookLoading,
    cookbookSyncStatus,
    cookbookPendingOps,
    getCookbookCoverImage,
    type CookbookList
  } from '$lib/stores/cookbookStore';
  import { ndk } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { isOnline } from '$lib/connectionMonitor';
  import PlusIcon from 'phosphor-svelte/lib/Plus';
  import BookmarkIcon from 'phosphor-svelte/lib/BookmarkSimple';
  import PinIcon from 'phosphor-svelte/lib/PushPin';
  import TrashIcon from 'phosphor-svelte/lib/Trash';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import ShareIcon from 'phosphor-svelte/lib/Share';
  import ImageIcon from 'phosphor-svelte/lib/Image';
  import CloudSlashIcon from 'phosphor-svelte/lib/CloudSlash';
  import CloudArrowUpIcon from 'phosphor-svelte/lib/CloudArrowUp';
  import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwise';
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';
  import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotch';
  import SquaresFourIcon from 'phosphor-svelte/lib/SquaresFour';
  import ListBulletsIcon from 'phosphor-svelte/lib/ListBullets';
  import SortAscendingIcon from 'phosphor-svelte/lib/SortAscending';
  import FunnelSimpleIcon from 'phosphor-svelte/lib/FunnelSimple';
  import ForkKnifeIcon from 'phosphor-svelte/lib/ForkKnife';
  import MagicWandIcon from 'phosphor-svelte/lib/MagicWand';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
  import { offlineStorage } from '$lib/offlineStorage';
  import { nip19 } from 'nostr-tools';
  import { getImageOrPlaceholder } from '$lib/placeholderImages';
  import { lazyLoad } from '$lib/lazyLoad';
  import Modal from '../../components/Modal.svelte';
  import Button from '../../components/Button.svelte';
  import SharePackModal from '../../components/SharePackModal.svelte';
  import ImagesComboBox from '../../components/ImagesComboBox.svelte';
  import ShareNetworkIcon from 'phosphor-svelte/lib/ShareNetwork';
  import { writable, type Writable, get } from 'svelte/store';
  import { clickOutside } from '$lib/clickOutside';
  import PullToRefresh from '../../components/PullToRefresh.svelte';

  // ===== View / sort / filter state (synced with URL query params) =====
  type ViewMode = 'packs' | 'feed';
  type SortMode = 'recent-added' | 'recent-updated' | 'az';

  let viewMode: ViewMode = 'packs';
  let sortMode: SortMode = 'recent-added';
  let collectionFilter: 'all' | string = 'all';
  let sortMenuOpen = false;
  let filterMenuOpen = false;
  let createMenuOpen = false;

  // Share-as-Pack modal state
  let sharePackOpen = false;
  let sharePackSource: import('$lib/recipePack').RecipePackSource = { type: 'cookbook' };
  let sharePackATags: string[] = [];
  let sharePackTitle = '';
  let sharePackDescription = '';
  let sharePackImage: string | undefined = undefined;

  function openShareCookbook() {
    if (totalUniqueSaved === 0) return;
    sharePackSource = { type: 'cookbook' };
    sharePackATags = aggregatedRecipes.map((r) => r.aTag);
    sharePackTitle = 'My Zap Cooking Cookbook';
    sharePackDescription = '';
    sharePackImage = savedCollection ? coverImages.get(savedCollection.id) : undefined;
    sharePackOpen = true;
  }

  function openShareCollection(list: CookbookList, e?: Event) {
    if (e) e.stopPropagation();
    if (list.recipes.length === 0) return;
    sharePackSource = { type: 'collection', collectionDTag: list.id };
    sharePackATags = [...list.recipes];
    sharePackTitle = list.title;
    sharePackDescription = list.summary || '';
    sharePackImage = coverImages.get(list.id) || list.image;
    hoveredListId = null;
    sharePackOpen = true;
  }

  const SORT_LABELS: Record<SortMode, string> = {
    'recent-added': 'Recently added',
    'recent-updated': 'Recently updated',
    az: 'A–Z'
  };
  const SORT_OPTIONS: { value: SortMode; label: string }[] = [
    { value: 'recent-added', label: SORT_LABELS['recent-added'] },
    { value: 'recent-updated', label: SORT_LABELS['recent-updated'] },
    { value: 'az', label: SORT_LABELS['az'] }
  ];

  // ----- URL ↔ state sync -----
  //
  // We hydrate state from $page.url.searchParams whenever the URL
  // changes (back/forward, deep link, programmatic goto). Writes are
  // only triggered by the explicit setters, which avoids the
  // hydrate-then-overwrite-with-stale-state loop you'd get with a
  // catch-all reactive sync.
  //
  // Internal flow: setX → state changes → syncUrl() → goto() →
  // $page.url updates → hydrate sees URL matches state → no-op.

  function readParams(params: URLSearchParams): {
    view: ViewMode;
    sort: SortMode;
    collection: 'all' | string;
  } {
    const v = params.get('view');
    let view: ViewMode = 'packs';
    if (v === 'feed') view = 'feed';
    else if (v === 'packs' || v === 'grid') view = 'packs'; // legacy 'grid' alias
    const s = params.get('sort');
    const sort: SortMode =
      s === 'recent-added' || s === 'recent-updated' || s === 'az' ? s : 'recent-added';
    const c = params.get('collection');
    const collection = c || 'all';
    return { view, sort, collection };
  }

  // Re-hydrate from URL on every $page change. Idempotent — updates
  // local state only when URL values disagree with current state.
  $: if (typeof window !== 'undefined') {
    const next = readParams($page.url.searchParams);
    if (next.view !== viewMode) viewMode = next.view;
    if (next.sort !== sortMode) sortMode = next.sort;
    if (next.collection !== collectionFilter) collectionFilter = next.collection;
  }

  function syncUrl() {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (viewMode === 'packs') url.searchParams.delete('view');
    else url.searchParams.set('view', viewMode);
    if (sortMode === 'recent-added') url.searchParams.delete('sort');
    else url.searchParams.set('sort', sortMode);
    if (collectionFilter === 'all') url.searchParams.delete('collection');
    else url.searchParams.set('collection', collectionFilter);
    const target = url.pathname + (url.search || '');
    if (target === window.location.pathname + window.location.search) return;
    goto(target, { replaceState: true, keepFocus: true, noScroll: true });
  }

  function setView(v: ViewMode) {
    viewMode = v;
    syncUrl();
  }
  function setSort(s: SortMode) {
    sortMode = s;
    sortMenuOpen = false;
    syncUrl();
  }
  function setCollectionFilter(c: 'all' | string) {
    collectionFilter = c;
    filterMenuOpen = false;
    syncUrl();
  }

  // Pull-to-refresh ref
  let pullToRefreshEl: PullToRefresh;

  async function handleRefresh() {
    try {
      await cookbookStore.load();
      await loadCoverImages();
      await updateCachedRecipeCount();
    } finally {
      pullToRefreshEl?.complete();
    }
  }

  // Handle manual sync
  function handleSyncNow() {
    cookbookStore.syncNow();
  }

  // Sync status state
  type SyncState = 'synced' | 'syncing' | 'offline' | 'pending';
  let syncState: SyncState = 'synced';
  let cachedRecipeCount = 0;

  // Update sync state based on stores
  $: {
    if (!$isOnline) {
      syncState = 'offline';
    } else if ($cookbookSyncStatus === 'syncing') {
      syncState = 'syncing';
    } else if ($cookbookSyncStatus === 'pending') {
      syncState = 'pending';
    } else {
      syncState = 'synced';
    }
  }

  // Load cached recipe count
  async function updateCachedRecipeCount() {
    try {
      const stats = await offlineStorage.getRecipeCacheStats();
      cachedRecipeCount = stats.count;
    } catch (e) {
      console.warn('Failed to get recipe cache stats:', e);
    }
  }

  // Sync all recipes state
  let isSyncingRecipes = false;
  let syncProgress = { current: 0, total: 0 };

  // Sync all recipes in all cookbooks for offline use
  async function syncAllRecipes() {
    if (isSyncingRecipes || !$isOnline) return;

    isSyncingRecipes = true;
    syncProgress = { current: 0, total: 0 };

    try {
      // Gather all unique recipe a-tags from all cookbooks
      const allRecipeATags = new Set<string>();
      for (const list of $cookbookLists) {
        for (const recipeATag of list.recipes) {
          allRecipeATags.add(recipeATag);
        }
      }

      syncProgress.total = allRecipeATags.size;
      console.log(`[Cookbook] Syncing ${syncProgress.total} recipes for offline use`);

      // Check which recipes are already cached
      const existingRecipes = await offlineStorage.getAllRecipes();
      const cachedIds = new Set(existingRecipes.map((r) => r.id));

      // Fetch and cache each recipe that isn't already cached
      for (const aTag of allRecipeATags) {
        syncProgress.current++;

        // Skip if already cached
        if (cachedIds.has(aTag)) {
          console.log(`[Cookbook] Recipe already cached: ${aTag}`);
          continue;
        }

        // Parse the a-tag
        const parts = aTag.split(':');
        if (parts.length !== 3) continue;

        const [kind, pubkey, identifier] = parts;

        try {
          const recipeEvent = await $ndk.fetchEvent({
            kinds: [Number(kind)],
            '#d': [identifier],
            authors: [pubkey]
          });

          if (recipeEvent) {
            await offlineStorage.saveRecipeFromEvent(recipeEvent);
            console.log(`[Cookbook] Cached recipe: ${identifier}`);
          }
        } catch (err) {
          console.warn(`[Cookbook] Failed to fetch recipe ${identifier}:`, err);
        }
      }

      // Update the cached count
      await updateCachedRecipeCount();
      console.log(`[Cookbook] Sync complete! ${cachedRecipeCount} recipes now cached.`);
    } catch (err) {
      console.error('[Cookbook] Sync all recipes failed:', err);
    } finally {
      isSyncingRecipes = false;
      syncProgress = { current: 0, total: 0 };
    }
  }

  let createModalOpen = false;
  let editModalOpen = false;
  let deleteConfirmOpen = false;
  let changeCoverModalOpen = false;
  let selectedList: CookbookList | null = null;
  let hoveredListId: string | null = null;
  let selectedCoverRecipeATag: string | null = null; // Track selected recipe in modal

  // Cover images cache: listId -> imageUrl
  let coverImages: Map<string, string> = new Map();

  // Form state
  let newListTitle = '';
  let newListSummary = '';
  let newListImages: Writable<string[]> = writable([]);
  let isSubmitting = false;
  let errorMessage = '';

  async function loadCoverImages() {
    // Load cover images for all lists
    for (const list of $cookbookLists) {
      if (!coverImages.has(list.id)) {
        try {
          const coverImage = await getCookbookCoverImage(list, $ndk);
          if (coverImage) {
            coverImages.set(list.id, coverImage);
            coverImages = new Map(coverImages); // Trigger reactivity
          }
        } catch (error) {
          console.warn('Failed to load cover image for list:', list.id, error);
        }
      }
    }
  }

  onMount(async () => {
    if (!$userPublickey) {
      goto('/login');
      return;
    }

    // Load cookbook lists
    await cookbookStore.load();

    // Ensure default list exists
    await cookbookStore.ensureDefaultList();

    // Load cover images
    await loadCoverImages();

    // Load cached recipe count for sync indicator
    await updateCachedRecipeCount();
  });

  // Reload cover images when lists change
  $: if ($cookbookLists.length > 0) {
    loadCoverImages();
    // Also update cached recipe count
    updateCachedRecipeCount();
  }

  onDestroy(() => {
    cookbookStore.reset();
  });

  function openList(list: CookbookList) {
    goto(`/cookbook/${list.naddr}`);
  }

  function openCreateModal() {
    newListTitle = '';
    newListSummary = '';
    newListImages.set([]);
    errorMessage = '';
    createModalOpen = true;
  }

  function closeCreateModal() {
    createModalOpen = false;
    newListTitle = '';
    newListSummary = '';
    newListImages.set([]);
    errorMessage = '';
  }

  async function createList() {
    if (!newListTitle.trim()) {
      errorMessage = 'Please enter a title';
      return;
    }

    isSubmitting = true;
    errorMessage = '';

    try {
      const images = $newListImages;
      const naddr = await cookbookStore.createList(
        newListTitle.trim(),
        newListSummary.trim() || undefined,
        images[0] || undefined
      );

      if (naddr) {
        closeCreateModal();
        goto(`/cookbook/${naddr}`);
      } else {
        errorMessage = 'Failed to create list';
      }
    } catch (err) {
      errorMessage = `Error: ${err}`;
    } finally {
      isSubmitting = false;
    }
  }

  function openEditModal(list: CookbookList, e?: Event) {
    if (e) e.stopPropagation();
    selectedList = list;
    newListTitle = list.title;
    newListSummary = list.summary || '';
    newListImages.set(list.image ? [list.image] : []);
    errorMessage = '';
    hoveredListId = null;
    editModalOpen = true;
  }

  function closeEditModal() {
    editModalOpen = false;
    selectedList = null;
    newListTitle = '';
    newListSummary = '';
    newListImages.set([]);
    errorMessage = '';
  }

  async function updateList() {
    if (!selectedList || !newListTitle.trim()) {
      errorMessage = 'Please enter a title';
      return;
    }

    isSubmitting = true;
    errorMessage = '';

    try {
      const images = $newListImages;
      const success = await cookbookStore.updateList(selectedList.id, {
        title: newListTitle.trim(),
        summary: newListSummary.trim() || undefined,
        image: images[0] || undefined
      });

      if (success) {
        closeEditModal();
      } else {
        errorMessage = 'Failed to update list';
      }
    } catch (err) {
      errorMessage = `Error: ${err}`;
    } finally {
      isSubmitting = false;
    }
  }

  function openDeleteConfirm(list: CookbookList, e?: Event) {
    if (e) e.stopPropagation();
    selectedList = list;
    hoveredListId = null;
    deleteConfirmOpen = true;
  }

  function closeDeleteConfirm() {
    deleteConfirmOpen = false;
    selectedList = null;
  }

  async function deleteList() {
    if (!selectedList) return;

    isSubmitting = true;

    try {
      const success = await cookbookStore.deleteList(selectedList.id);
      if (success) {
        closeDeleteConfirm();
      }
    } catch (err) {
      console.error('Failed to delete list:', err);
    } finally {
      isSubmitting = false;
    }
  }

  async function shareList(list: CookbookList, e?: Event) {
    if (e) e.stopPropagation();
    const url = `${window.location.origin}/cookbook/${list.naddr}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: list.title,
          text: list.summary || `Check out this recipe collection on zap.cooking`,
          url
        });
      } catch (err) {
        // User cancelled or error
        await copyToClipboard(url);
      }
    } else {
      await copyToClipboard(url);
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      // Could add a toast notification here
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  function openChangeCoverModal(list: CookbookList, e?: Event) {
    if (e) e.stopPropagation();
    selectedList = list;
    selectedCoverRecipeATag = list.coverRecipeId || null; // Initialize with current cover
    hoveredListId = null;
    changeCoverModalOpen = true;
  }

  function closeChangeCoverModal() {
    changeCoverModalOpen = false;
    selectedList = null;
    selectedCoverRecipeATag = null;
  }

  function selectCoverRecipe(recipeATag: string) {
    selectedCoverRecipeATag = recipeATag;
  }

  async function saveCoverRecipe() {
    if (!selectedList || !selectedCoverRecipeATag) {
      errorMessage = 'Please select a recipe to use as the cover image.';
      return;
    }

    isSubmitting = true;
    errorMessage = '';

    try {
      console.log('Setting cover recipe:', {
        listId: selectedList.id,
        recipeATag: selectedCoverRecipeATag,
        listRecipes: selectedList.recipes
      });

      // Add timeout wrapper to prevent infinite hanging
      const setCoverPromise = cookbookStore.setCoverRecipe(
        selectedList.id,
        selectedCoverRecipeATag
      );
      const timeoutPromise = new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error('Operation timed out after 15 seconds')), 15000)
      );

      let success: boolean;
      try {
        success = await Promise.race([setCoverPromise, timeoutPromise]);
      } catch (timeoutError) {
        console.error('Set cover recipe timed out:', timeoutError);
        errorMessage = 'Operation timed out. The cover may still update. Please refresh the page.';
        isSubmitting = false;
        return;
      }

      if (success) {
        console.log('Cover recipe updated successfully');
        const selectedListId = selectedList.id;

        // Clear cover image cache for this list
        coverImages.delete(selectedListId);

        // Get updated list from store
        const updatedStoreState = get(cookbookStore);
        const updatedList = updatedStoreState.lists.find((l) => l.id === selectedListId);

        if (updatedList) {
          // Reload cover image immediately with cache-busting
          const newCoverImage = await getCookbookCoverImage(updatedList, $ndk, true);
          if (newCoverImage) {
            coverImages.set(selectedListId, newCoverImage);
            coverImages = new Map(coverImages); // Trigger reactivity
          }
        } else {
          // Fallback: reload all cover images
          await loadCoverImages();
        }

        closeChangeCoverModal();
      } else {
        errorMessage = 'Failed to update cover image. Please try again.';
      }
    } catch (err: any) {
      console.error('Failed to set cover recipe:', err);
      // Provide user-friendly error message
      if (err?.message) {
        errorMessage = err.message;
      } else if (typeof err === 'string') {
        errorMessage = err;
      } else {
        errorMessage = 'Failed to update cover image. Please check your connection and try again.';
      }
    } finally {
      isSubmitting = false;
    }
  }

  async function loadRecipeEvents(list: CookbookList): Promise<NDKEvent[]> {
    const events: NDKEvent[] = [];

    for (const aTag of list.recipes) {
      const parts = aTag.split(':');
      if (parts.length !== 3) continue;

      const [kind, pubkey, identifier] = parts;
      try {
        const recipeEvent = await $ndk.fetchEvent({
          kinds: [Number(kind)],
          '#d': [identifier],
          authors: [pubkey]
        });
        if (recipeEvent) {
          events.push(recipeEvent);
        }
      } catch (error) {
        console.warn('Failed to fetch recipe:', aTag, error);
      }
    }

    return events;
  }

  // Helper to get cover image for a list
  function getListCoverImage(list: CookbookList): string | undefined {
    return coverImages.get(list.id) || list.image;
  }

  // Separate saved collection from custom collections
  $: savedCollection = $cookbookLists.find((l) => l.isDefault);
  $: customCollections = $cookbookLists.filter((l) => !l.isDefault);

  // ===== Aggregated feed across all collections =====
  type AggregatedRecipe = {
    aTag: string;
    collections: string[]; // list IDs containing this recipe
    primaryListUpdatedAt: number; // most-recent list-update time it appears in
    positionInPrimaryList: number; // index within that list (later = newer)
  };

  function aggregateRecipes(lists: CookbookList[]): AggregatedRecipe[] {
    const map = new Map<string, AggregatedRecipe>();
    for (const list of lists) {
      const listTime = list.event?.created_at || list.createdAt || 0;
      list.recipes.forEach((aTag, idx) => {
        const existing = map.get(aTag);
        if (!existing) {
          map.set(aTag, {
            aTag,
            collections: [list.id],
            primaryListUpdatedAt: listTime,
            positionInPrimaryList: idx
          });
        } else {
          if (!existing.collections.includes(list.id)) existing.collections.push(list.id);
          if (listTime > existing.primaryListUpdatedAt) {
            existing.primaryListUpdatedAt = listTime;
            existing.positionInPrimaryList = idx;
          }
        }
      });
    }
    return Array.from(map.values());
  }

  $: aggregatedRecipes = aggregateRecipes($cookbookLists);
  $: totalUniqueSaved = aggregatedRecipes.length;

  // Filtered + ordered a-tag list to load
  $: filteredATags = (
    collectionFilter === 'all'
      ? aggregatedRecipes
      : aggregatedRecipes.filter((r) => r.collections.includes(collectionFilter))
  ).map((r) => r.aTag);

  // Cached map of NDKEvent by a-tag for the feed view
  let feedEventByATag: Map<string, NDKEvent> = new Map();
  let feedLoading = false;
  let feedLoaded = false;

  function eventToAggregateKey(e: NDKEvent): string {
    const dTag = e.tags?.find((t) => t[0] === 'd')?.[1] || '';
    return `${e.kind}:${e.pubkey}:${dTag}`;
  }

  function buildFakeEventFromCache(cached: any): NDKEvent {
    const fake = new NDKEvent($ndk);
    fake.kind = cached.eventKind;
    fake.pubkey = cached.authorPubkey;
    fake.created_at = cached.createdAt;
    fake.content = cached.content;
    fake.tags = cached.eventTags;
    fake.id = cached.id; // a-tag-based stable id
    return fake;
  }

  async function ensureFeedEvents() {
    if (filteredATags.length === 0) {
      feedEventByATag = new Map();
      feedLoaded = true;
      return;
    }
    feedLoading = true;
    try {
      // 1) Cache-first
      const missing: string[] = [];
      const cached = await offlineStorage.getRecipes(filteredATags);
      const cachedById = new Map(cached.map((c) => [c.id, c]));
      for (const aTag of filteredATags) {
        if (feedEventByATag.has(aTag)) continue;
        const c = cachedById.get(aTag);
        if (c) feedEventByATag.set(aTag, buildFakeEventFromCache(c));
        else missing.push(aTag);
      }
      // Show cached results immediately
      feedEventByATag = new Map(feedEventByATag);

      // 2) Fetch missing if online
      if (missing.length > 0 && $isOnline) {
        await Promise.all(
          missing.map(async (aTag) => {
            const parts = aTag.split(':');
            if (parts.length !== 3) return;
            const [kind, pubkey, identifier] = parts;
            try {
              const e = await $ndk.fetchEvent({
                kinds: [Number(kind)],
                '#d': [identifier],
                authors: [pubkey]
              });
              if (e) {
                feedEventByATag.set(aTag, e);
                // Cache for offline
                try {
                  await offlineStorage.saveRecipeFromEvent(e);
                } catch {}
              }
            } catch (err) {
              console.warn('[Cookbook feed] Failed to fetch', aTag, err);
            }
          })
        );
        feedEventByATag = new Map(feedEventByATag);
      }
    } finally {
      feedLoading = false;
      feedLoaded = true;
    }
  }

  // Cheap signature for the underlying cookbook state. We use this
  // instead of `filteredATags.join(',')` so the change detector stays
  // O(number of lists) instead of O(number of recipes) — a join over
  // hundreds of saved a-tags reallocates a multi-KB string on every
  // reactive run. Folding list count + per-list size + per-list update
  // time covers add/remove/reassign without the allocation cost.
  $: cookbookSignature =
    $cookbookLists.length +
    ':' +
    $cookbookLists.reduce(
      (acc, l) => acc + l.recipes.length * 31 + (l.event?.created_at || 0),
      0
    );

  // Trigger fetch when feed becomes active or the underlying recipe set changes.
  let lastFeedKey = '';
  $: {
    const key = viewMode === 'feed' ? `${collectionFilter}:${cookbookSignature}` : '';
    if (viewMode === 'feed' && key !== lastFeedKey) {
      lastFeedKey = key;
      feedLoaded = false;
      ensureFeedEvents();
    } else if (viewMode !== 'feed') {
      lastFeedKey = '';
    }
  }

  // Build the displayed event list with sort applied
  $: displayedEvents = (() => {
    const events: NDKEvent[] = [];
    for (const aTag of filteredATags) {
      const e = feedEventByATag.get(aTag);
      if (e) events.push(e);
    }
    if (sortMode === 'az') {
      events.sort((a, b) => {
        const ta = (a.tags?.find((t) => t[0] === 'title')?.[1] || '').toLowerCase();
        const tb = (b.tags?.find((t) => t[0] === 'title')?.[1] || '').toLowerCase();
        return ta.localeCompare(tb);
      });
    } else if (sortMode === 'recent-updated') {
      events.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    } else {
      // 'recent-added' — order by aggregate primaryListUpdatedAt DESC, then position DESC
      const orderByATag = new Map<string, [number, number]>();
      for (const r of aggregatedRecipes) {
        orderByATag.set(r.aTag, [r.primaryListUpdatedAt, r.positionInPrimaryList]);
      }
      events.sort((a, b) => {
        const ka = orderByATag.get(eventToAggregateKey(a)) || [0, 0];
        const kb = orderByATag.get(eventToAggregateKey(b)) || [0, 0];
        if (kb[0] !== ka[0]) return kb[0] - ka[0];
        return kb[1] - ka[1];
      });
    }
    return events;
  })();

  $: collectionFilterLabel =
    collectionFilter === 'all'
      ? 'All collections'
      : $cookbookLists.find((l) => l.id === collectionFilter)?.title || 'Collection';

  // Feed-card metadata
  function feedCardData(e: NDKEvent) {
    const dTag = e.tags?.find((t) => t[0] === 'd')?.[1] || '';
    const title = e.tags?.find((t) => t[0] === 'title')?.[1] || dTag || 'Untitled';
    const summary = e.tags?.find((t) => t[0] === 'summary')?.[1] || '';
    const rawImage = e.tags?.find((t) => t[0] === 'image')?.[1] || '';
    const image = getImageOrPlaceholder(rawImage, e.id || dTag);
    let link = '';
    if (dTag && (e.author?.pubkey || e.pubkey)) {
      try {
        link = `/recipe/${nip19.naddrEncode({
          identifier: dTag,
          kind: e.kind || 30023,
          pubkey: e.author?.pubkey || e.pubkey
        })}`;
      } catch {}
    }
    return { title, summary, image, link };
  }
</script>

<svelte:head>
  <title>My Cookbook - zap.cooking</title>
  <meta name="description" content="Your saved recipes and collections on zap.cooking" />
</svelte:head>

<!-- Create List Modal -->
<Modal cleanup={closeCreateModal} open={createModalOpen}>
  <h1 slot="title">Create New Collection</h1>

  <form on:submit|preventDefault={createList} class="flex flex-col gap-4">
    <div class="flex flex-col gap-2">
      <label for="title" class="text-sm font-medium" style="color: var(--color-text-primary)">
        Title <span class="text-red-500">*</span>
      </label>
      <input
        id="title"
        type="text"
        bind:value={newListTitle}
        placeholder="e.g., Weeknight Dinners"
        class="input"
        disabled={isSubmitting}
      />
    </div>

    <div class="flex flex-col gap-2">
      <label for="summary" class="text-sm font-medium" style="color: var(--color-text-primary)">
        Description
      </label>
      <textarea
        id="summary"
        bind:value={newListSummary}
        placeholder="A brief description of this collection..."
        rows="3"
        class="input"
        disabled={isSubmitting}
      />
    </div>

    <div class="flex flex-col gap-2">
      <label class="text-sm font-medium" style="color: var(--color-text-primary)">
        Cover Image
      </label>
      <ImagesComboBox uploadedImages={newListImages} limit={1} />
    </div>

    {#if errorMessage}
      <p class="text-red-500 text-sm">{errorMessage}</p>
    {/if}

    <div class="flex justify-end gap-2 pt-2">
      <Button on:click={closeCreateModal} primary={false} disabled={isSubmitting}>Cancel</Button>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Creating...' : 'Create Collection'}
      </Button>
    </div>
  </form>
</Modal>

<!-- Edit List Modal -->
<Modal cleanup={closeEditModal} open={editModalOpen}>
  <h1 slot="title">Edit Collection</h1>

  <form on:submit|preventDefault={updateList} class="flex flex-col gap-4">
    <div class="flex flex-col gap-2">
      <label for="edit-title" class="text-sm font-medium" style="color: var(--color-text-primary)">
        Title <span class="text-red-500">*</span>
      </label>
      <input
        id="edit-title"
        type="text"
        bind:value={newListTitle}
        placeholder="e.g., Weeknight Dinners"
        class="input"
        disabled={isSubmitting || selectedList?.isDefault}
      />
      {#if selectedList?.isDefault}
        <p class="text-xs text-caption">The default collection title cannot be changed.</p>
      {/if}
    </div>

    <div class="flex flex-col gap-2">
      <label
        for="edit-summary"
        class="text-sm font-medium"
        style="color: var(--color-text-primary)"
      >
        Description
      </label>
      <textarea
        id="edit-summary"
        bind:value={newListSummary}
        placeholder="A brief description of this collection..."
        rows="3"
        class="input"
        disabled={isSubmitting}
      />
    </div>

    <div class="flex flex-col gap-2">
      <label class="text-sm font-medium" style="color: var(--color-text-primary)">
        Cover Image
      </label>
      <ImagesComboBox uploadedImages={newListImages} limit={1} />
    </div>

    {#if errorMessage}
      <p class="text-red-500 text-sm">{errorMessage}</p>
    {/if}

    <div class="flex justify-end gap-2 pt-2">
      <Button on:click={closeEditModal} primary={false} disabled={isSubmitting}>Cancel</Button>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Saving...' : 'Save Changes'}
      </Button>
    </div>
  </form>
</Modal>

<!-- Delete Confirmation Modal -->
<Modal cleanup={closeDeleteConfirm} open={deleteConfirmOpen}>
  <h1 slot="title">Delete Collection</h1>

  <div class="flex flex-col gap-4">
    <p style="color: var(--color-text-primary)">
      Are you sure you want to delete "<strong>{selectedList?.title}</strong>"? This will remove the
      collection but won't delete the recipes themselves.
    </p>

    <div class="flex justify-end gap-2">
      <Button on:click={closeDeleteConfirm} primary={false} disabled={isSubmitting}>Cancel</Button>
      <button
        on:click={deleteList}
        disabled={isSubmitting}
        class="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
      >
        {isSubmitting ? 'Deleting...' : 'Delete Collection'}
      </button>
    </div>
  </div>
</Modal>

<!-- Change Cover Modal -->
<Modal cleanup={closeChangeCoverModal} open={changeCoverModalOpen}>
  <h1 slot="title">Choose Cover Image</h1>

  {#if selectedList}
    {#await loadRecipeEvents(selectedList) then recipeEvents}
      <div class="flex flex-col gap-4">
        <p class="text-sm text-caption">Select a recipe to use as your cookbook cover</p>

        {#if recipeEvents.length === 0}
          <p class="text-caption text-center py-8">
            No recipes in this collection yet. Add recipes to choose a cover image.
          </p>
        {:else}
          <div class="grid grid-cols-3 gap-3 max-h-96 overflow-y-auto p-1">
            {#each recipeEvents as recipeEvent}
              {@const recipeATag = `${recipeEvent.kind}:${recipeEvent.pubkey}:${recipeEvent.replaceableDTag()}`}
              {@const recipeImage = recipeEvent.tags.find((t) => t[0] === 'image')?.[1]}
              {@const recipeTitle =
                recipeEvent.tags.find((t) => t[0] === 'title')?.[1] || 'Untitled'}
              {@const isSelected = selectedCoverRecipeATag === recipeATag}

              <button
                type="button"
                on:click|stopPropagation={() => selectCoverRecipe(recipeATag)}
                disabled={isSubmitting}
                class="relative aspect-square rounded-lg overflow-hidden border-2 transition-all cursor-pointer {isSelected
                  ? 'border-orange-500 ring-2 ring-orange-200'
                  : 'border-transparent hover:border-orange-300'}"
                aria-label="Select {recipeTitle} as cover"
              >
                {#if recipeImage}
                  <img
                    src={recipeImage}
                    alt={recipeTitle}
                    class="w-full h-full object-cover pointer-events-none"
                  />
                {:else}
                  <div
                    class="w-full h-full bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800 flex items-center justify-center pointer-events-none"
                  >
                    <span class="text-xs text-caption text-center px-2">{recipeTitle}</span>
                  </div>
                {/if}

                {#if isSelected}
                  <div
                    class="absolute bottom-2 right-2 bg-orange-500 text-white text-xs px-2 py-1 rounded font-semibold"
                  >
                    ✓ Selected
                  </div>
                {/if}
              </button>
            {/each}
          </div>
        {/if}

        {#if errorMessage}
          <p class="text-red-500 text-sm">{errorMessage}</p>
        {/if}

        <div class="flex justify-end gap-2 pt-2">
          <Button on:click={closeChangeCoverModal} primary={false} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button on:click={saveCoverRecipe} disabled={isSubmitting || !selectedCoverRecipeATag}>
            {isSubmitting ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    {:catch error}
      <p class="text-red-500 text-sm">Error loading recipes: {error}</p>
      <div class="flex justify-end gap-2 pt-2">
        <Button on:click={closeChangeCoverModal} primary={false}>Close</Button>
      </div>
    {/await}
  {/if}
</Modal>

<!-- Share as Recipe Pack Modal -->
<SharePackModal
  bind:open={sharePackOpen}
  source={sharePackSource}
  recipeATags={sharePackATags}
  initialTitle={sharePackTitle}
  initialDescription={sharePackDescription}
  initialImage={sharePackImage}
/>

<PullToRefresh bind:this={pullToRefreshEl} on:refresh={handleRefresh}>
  <div class="flex flex-col gap-6">
    <!-- Offline/Sync Status Banner -->
    {#if !$isOnline}
      <div
        class="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30"
      >
        <CloudSlashIcon size={20} class="text-amber-500 flex-shrink-0" />
        <div class="flex-1">
          <p class="text-sm font-medium" style="color: var(--color-text-primary)">You're offline</p>
          <p class="text-xs text-caption">
            Your cookbooks are saved locally. Changes will sync when you're back online.
          </p>
        </div>
      </div>
    {:else if $cookbookSyncStatus === 'syncing'}
      <div
        class="flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-500/10 border border-blue-500/30"
      >
        <ArrowsClockwiseIcon size={20} class="text-blue-500 flex-shrink-0 animate-spin" />
        <div class="flex-1">
          <p class="text-sm font-medium" style="color: var(--color-text-primary)">
            Syncing changes...
          </p>
          <p class="text-xs text-caption">Your cookbooks are being updated.</p>
        </div>
      </div>
    {:else if $cookbookSyncStatus === 'pending' && $cookbookPendingOps > 0}
      <div
        class="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30"
      >
        <CloudArrowUpIcon size={20} class="text-amber-500 flex-shrink-0" />
        <div class="flex-1">
          <p class="text-sm font-medium" style="color: var(--color-text-primary)">
            {$cookbookPendingOps} pending {$cookbookPendingOps === 1 ? 'change' : 'changes'}
          </p>
          <p class="text-xs text-caption">Some changes haven't synced yet.</p>
        </div>
        <button
          on:click={handleSyncNow}
          class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition-colors"
        >
          Sync Now
        </button>
      </div>
    {/if}

    <!-- Header -->
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <!-- Left: Title and Icon -->
      <div class="flex items-center gap-3">
        <div
          class="w-12 h-12 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center flex-shrink-0"
        >
          <BookmarkIcon size={24} weight="fill" class="text-white" />
        </div>
        <div>
          <h1 class="text-2xl font-bold" style="color: var(--color-text-primary)">My Cookbook</h1>
          <p class="text-sm text-caption">Your saved recipes & collections</p>
        </div>
      </div>

      <!-- Right: Status Pill + Sync Button + New Collection -->
      <div class="flex items-center gap-2 flex-wrap">
        <!-- Status Pill -->
        {#if isSyncingRecipes}
          <div
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-blue-500/10 border border-blue-500/30"
          >
            <CircleNotchIcon size={16} weight="bold" class="text-blue-500 animate-spin" />
            <span class="text-blue-600 dark:text-blue-400 font-medium">Syncing</span>
            <span class="text-blue-400 dark:text-blue-500">•</span>
            <span class="text-blue-600 dark:text-blue-400"
              >{syncProgress.current}/{syncProgress.total}</span
            >
          </div>
        {:else if syncState === 'synced'}
          <div
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-green-500/10 border border-green-500/30"
          >
            <CheckCircleIcon size={16} weight="fill" class="text-green-500" />
            <span class="text-green-600 dark:text-green-400 font-medium">Offline Ready</span>
            <span class="text-green-400 dark:text-green-500">•</span>
            <span class="text-green-600 dark:text-green-400">{cachedRecipeCount} recipes</span>
          </div>
        {:else if syncState === 'syncing'}
          <div
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-blue-500/10 border border-blue-500/30"
          >
            <CircleNotchIcon size={16} weight="bold" class="text-blue-500 animate-spin" />
            <span class="text-blue-600 dark:text-blue-400 font-medium">Syncing</span>
            <span class="text-blue-400 dark:text-blue-500">•</span>
            <span class="text-blue-600 dark:text-blue-400">{cachedRecipeCount} recipes</span>
          </div>
        {:else if syncState === 'offline'}
          <div
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-gray-500/10 border border-gray-500/30"
          >
            <CloudSlashIcon size={16} weight="fill" class="text-gray-400" />
            <span class="text-gray-500 dark:text-gray-400 font-medium">Offline Mode</span>
            <span class="text-gray-400 dark:text-gray-500">•</span>
            <span class="text-gray-500 dark:text-gray-400">{cachedRecipeCount} recipes</span>
          </div>
        {:else if syncState === 'pending'}
          <button
            on:click={handleSyncNow}
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-colors cursor-pointer"
          >
            <CloudArrowUpIcon size={16} weight="fill" class="text-amber-500" />
            <span class="text-amber-600 dark:text-amber-400 font-medium"
              >{$cookbookPendingOps} Pending</span
            >
            <span class="text-amber-400 dark:text-amber-500">•</span>
            <span class="text-amber-600 dark:text-amber-400">Tap to sync</span>
          </button>
        {/if}

        <!-- Sync All Button -->
        {#if $isOnline && !isSyncingRecipes}
          <button
            on:click={syncAllRecipes}
            class="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
            style="color: var(--color-text-secondary); border: 1px solid var(--color-input-border);"
            title="Sync all recipes for offline use"
          >
            <ArrowsClockwiseIcon size={16} weight="bold" />
            <span>Sync All</span>
          </button>
        {/if}

        <!-- Add menu (Add recipe / Import / New collection) -->
        <div class="relative" use:clickOutside on:click_outside={() => (createMenuOpen = false)}>
          <button
            on:click={() => (createMenuOpen = !createMenuOpen)}
            class="flex items-center gap-1.5 pl-4 pr-3 py-1.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-full font-medium transition-all text-sm"
            aria-haspopup="true"
            aria-expanded={createMenuOpen}
            aria-label="Add to cookbook"
          >
            <PlusIcon size={18} weight="bold" />
            <span class="hidden sm:inline">Add</span>
            <CaretDownIcon size={14} weight="bold" class="opacity-90" />
          </button>
          {#if createMenuOpen}
            <div
              class="absolute right-0 top-[calc(100%+0.5rem)] z-50 min-w-[200px] rounded-xl py-1 shadow-xl"
              style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
            >
              <button
                on:click={() => {
                  createMenuOpen = false;
                  goto('/create');
                }}
                class="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-accent-gray text-left"
                style="color: var(--color-text-primary);"
              >
                <ForkKnifeIcon size={16} weight="regular" />
                <span>Add recipe</span>
              </button>
              <button
                on:click={() => {
                  createMenuOpen = false;
                  goto('/souschef');
                }}
                class="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-accent-gray text-left"
                style="color: var(--color-text-primary);"
              >
                <MagicWandIcon size={16} weight="regular" />
                <span>Import recipe</span>
              </button>
              <button
                on:click={() => {
                  createMenuOpen = false;
                  openCreateModal();
                }}
                class="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-accent-gray text-left"
                style="color: var(--color-text-primary);"
              >
                <BookmarkIcon size={16} weight="regular" />
                <span>New collection</span>
              </button>
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- View Toggle + (feed) Sort/Filter Toolbar -->
    {#if !$cookbookLoading && $cookbookLists.length > 0}
      <div class="flex flex-wrap items-center gap-2 justify-between">
        <!-- View toggle -->
        <div
          class="inline-flex p-0.5 rounded-full"
          style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
          role="tablist"
          aria-label="Cookbook view"
        >
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'packs'}
            on:click={() => setView('packs')}
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors {viewMode ===
            'packs'
              ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-sm'
              : ''}"
            style={viewMode === 'packs' ? '' : 'color: var(--color-text-secondary);'}
          >
            <SquaresFourIcon size={16} weight={viewMode === 'packs' ? 'fill' : 'regular'} />
            <span>Packs</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'feed'}
            on:click={() => setView('feed')}
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors {viewMode ===
            'feed'
              ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-sm'
              : ''}"
            style={viewMode === 'feed' ? '' : 'color: var(--color-text-secondary);'}
            disabled={totalUniqueSaved === 0}
            aria-disabled={totalUniqueSaved === 0}
            title={totalUniqueSaved === 0 ? 'No saved recipes yet' : 'Browse all saved recipes'}
          >
            <ListBulletsIcon size={16} weight={viewMode === 'feed' ? 'fill' : 'regular'} />
            <span>Feed</span>
            {#if totalUniqueSaved > 0}
              <span class="text-xs opacity-80">·&nbsp;{totalUniqueSaved}</span>
            {/if}
          </button>
        </div>

        <!-- Sort + Filter (feed only) -->
        {#if viewMode === 'feed'}
          <div class="flex items-center gap-2 flex-wrap">
            <!-- Share Cookbook -->
            <button
              on:click={openShareCookbook}
              disabled={totalUniqueSaved === 0}
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
              title="Share your saved recipes as a Recipe Pack"
              aria-label="Share cookbook as Recipe Pack"
            >
              <ShareNetworkIcon size={16} />
              <span>Share Cookbook</span>
            </button>

            <!-- Sort dropdown -->
            <div class="relative" use:clickOutside on:click_outside={() => (sortMenuOpen = false)}>
              <button
                on:click={() => (sortMenuOpen = !sortMenuOpen)}
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
                aria-haspopup="true"
                aria-expanded={sortMenuOpen}
              >
                <SortAscendingIcon size={16} />
                <span>{SORT_LABELS[sortMode]}</span>
                <CaretDownIcon size={12} weight="bold" class="opacity-70" />
              </button>
              {#if sortMenuOpen}
                <div
                  class="absolute right-0 top-[calc(100%+0.4rem)] z-40 min-w-[180px] rounded-xl py-1 shadow-xl"
                  style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
                >
                  {#each SORT_OPTIONS as opt}
                    <button
                      on:click={() => setSort(opt.value)}
                      class="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-accent-gray {sortMode ===
                      opt.value
                        ? 'text-primary font-medium'
                        : ''}"
                      style={sortMode === opt.value ? '' : 'color: var(--color-text-primary);'}
                    >
                      {opt.label}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>

            <!-- Collection filter dropdown -->
            <div
              class="relative"
              use:clickOutside
              on:click_outside={() => (filterMenuOpen = false)}
            >
              <button
                on:click={() => (filterMenuOpen = !filterMenuOpen)}
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
                aria-haspopup="true"
                aria-expanded={filterMenuOpen}
              >
                <FunnelSimpleIcon size={16} />
                <span class="max-w-[140px] truncate">{collectionFilterLabel}</span>
                <CaretDownIcon size={12} weight="bold" class="opacity-70" />
              </button>
              {#if filterMenuOpen}
                <div
                  class="absolute right-0 top-[calc(100%+0.4rem)] z-40 min-w-[200px] max-h-[60vh] overflow-y-auto rounded-xl py-1 shadow-xl"
                  style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
                >
                  <button
                    on:click={() => setCollectionFilter('all')}
                    class="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-accent-gray {collectionFilter ===
                    'all'
                      ? 'text-primary font-medium'
                      : ''}"
                    style={collectionFilter === 'all' ? '' : 'color: var(--color-text-primary);'}
                  >
                    All collections <span class="text-xs opacity-70">· {totalUniqueSaved}</span>
                  </button>
                  {#each $cookbookLists as list (list.id)}
                    <button
                      on:click={() => setCollectionFilter(list.id)}
                      class="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-accent-gray flex items-center justify-between gap-2 {collectionFilter ===
                      list.id
                        ? 'text-primary font-medium'
                        : ''}"
                      style={collectionFilter === list.id
                        ? ''
                        : 'color: var(--color-text-primary);'}
                    >
                      <span class="truncate flex items-center gap-1.5">
                        {#if list.isDefault}
                          <PinIcon size={12} weight="fill" class="text-orange-500 flex-shrink-0" />
                        {/if}
                        {list.title}
                      </span>
                      <span class="text-xs opacity-70 flex-shrink-0">{list.recipeCount}</span>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Loading State -->
    {#if $cookbookLoading}
      <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {#each Array(4) as _}
          <div
            class="h-40 rounded-2xl animate-pulse"
            style="background-color: var(--color-input-bg);"
          ></div>
        {/each}
      </div>
    {:else if $cookbookLists.length === 0}
      <!-- Empty State -->
      <div class="flex flex-col items-center justify-center py-16 px-4">
        <div
          class="w-20 h-20 rounded-full bg-gradient-to-br from-orange-100 to-amber-100 dark:from-orange-900/30 dark:to-amber-900/30 flex items-center justify-center mb-4"
        >
          <BookmarkIcon size={40} weight="regular" class="text-orange-500" />
        </div>
        <h2 class="text-xl font-semibold mb-2" style="color: var(--color-text-primary)">
          Start Your Cookbook
        </h2>
        <p class="text-caption text-center max-w-md mb-6">
          Save recipes you love and organize them into collections. Your cookbook is private to you.
        </p>
        <div class="flex gap-3">
          <button
            on:click={openCreateModal}
            class="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-full font-medium transition-all"
          >
            <PlusIcon size={18} weight="bold" />
            Create Collection
          </button>
          <a
            href="/recipes"
            class="flex items-center px-5 py-2.5 rounded-full font-medium transition-colors"
            style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
          >
            Browse Recipes
          </a>
        </div>
      </div>
    {:else if viewMode === 'feed'}
      <!-- Feed view: all saved recipes -->
      {#if filteredATags.length === 0}
        <div class="flex flex-col items-center justify-center py-12 px-4">
          <div
            class="w-16 h-16 rounded-full bg-gradient-to-br from-orange-100 to-amber-100 dark:from-orange-900/30 dark:to-amber-900/30 flex items-center justify-center mb-4"
          >
            <BookmarkIcon size={32} weight="regular" class="text-orange-500" />
          </div>
          <h3 class="text-lg font-medium mb-2" style="color: var(--color-text-primary)">
            {collectionFilter === 'all' ? 'No saved recipes yet' : 'No recipes in this collection'}
          </h3>
          <p class="text-caption text-center max-w-sm mb-4">
            {collectionFilter === 'all'
              ? "Save recipes from anywhere on Zap.cooking and they'll show up here."
              : 'Save recipes to this collection to see them here.'}
          </p>
          <a
            href="/recipes"
            class="flex items-center px-4 py-2 rounded-full font-medium text-sm transition-colors"
            style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
          >
            Browse Recipes
          </a>
        </div>
      {:else}
        <!-- Big-card feed: 1 col mobile, 2 col tablet, 3 col desktop -->
        <div class="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {#each displayedEvents as e (e.id || feedCardData(e).link)}
            {@const card = feedCardData(e)}
            {#if card.link}
              <a
                href={card.link}
                class="group flex flex-col rounded-2xl overflow-hidden transition-transform duration-200 hover:scale-[1.01] hover:shadow-xl"
                style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
              >
                <div class="relative w-full aspect-[4/3] overflow-hidden feed-card-image-wrap">
                  <div
                    use:lazyLoad={{ url: card.image }}
                    class="absolute inset-0 feed-card-image group-hover:scale-105 transition-transform duration-700 ease-in-out"
                  ></div>
                </div>
                <div class="p-3 sm:p-4 flex flex-col gap-1">
                  <h3
                    class="text-base sm:text-lg font-semibold leading-snug line-clamp-2"
                    style="color: var(--color-text-primary);"
                  >
                    {card.title}
                  </h3>
                  {#if card.summary}
                    <p class="text-sm text-caption line-clamp-2">{card.summary}</p>
                  {/if}
                </div>
              </a>
            {/if}
          {/each}

          <!-- Loading skeletons for not-yet-fetched recipes -->
          {#if feedLoading && displayedEvents.length < filteredATags.length}
            {#each Array(Math.min(3, filteredATags.length - displayedEvents.length)) as _}
              <div
                class="rounded-2xl overflow-hidden animate-pulse"
                style="background-color: var(--color-input-bg);"
              >
                <div class="w-full aspect-[4/3]" style="background-color: var(--color-accent-gray);"></div>
                <div class="p-3 sm:p-4 flex flex-col gap-2">
                  <div
                    class="h-4 w-3/4 rounded"
                    style="background-color: var(--color-accent-gray);"
                  ></div>
                  <div
                    class="h-3 w-1/2 rounded"
                    style="background-color: var(--color-accent-gray);"
                  ></div>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    {:else}
      <!-- Collections Grid -->
      <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <!-- Saved Collection (Always First, Special Styling) -->
        {#if savedCollection}
          {@const list = savedCollection}
          {@const hasAnySaved = totalUniqueSaved > 0}
          <button
            on:click={() => (hasAnySaved ? setView('feed') : openList(list))}
            on:mouseenter={() => (hoveredListId = list.id)}
            on:mouseleave={() => (hoveredListId = null)}
            class="group relative h-40 rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-xl text-left collection-card saved-collection"
            style="box-shadow: {hoveredListId === list.id
              ? '0 8px 24px rgba(255, 107, 53, 0.3)'
              : '0 2px 8px rgba(0,0,0,0.1)'};"
            aria-label={hasAnySaved
              ? `View all ${totalUniqueSaved} of my recipes`
              : 'My Recipes (empty)'}
          >
            <!-- Background -->
            <div
              class="absolute inset-0"
              style={getListCoverImage(list)
                ? `background-image: url('${getListCoverImage(list)}'); background-size: cover; background-position: center;`
                : 'background: linear-gradient(135deg, #FF6B35 0%, #F7931E 100%);'}
            >
              <div
                class="absolute inset-0 bg-black/30 group-hover:bg-black/20 transition-colors"
              ></div>
            </div>

            <!-- Content -->
            <div class="relative h-full flex flex-col justify-between p-4">
              <div class="flex justify-between items-start">
                <div class="flex items-center gap-2">
                  {#if hasAnySaved}
                    <ListBulletsIcon size={20} weight="fill" class="text-white drop-shadow-lg" />
                    <span class="text-white/90 text-xs font-medium drop-shadow">My Recipes</span>
                  {:else}
                    <PinIcon size={20} weight="fill" class="text-white drop-shadow-lg" />
                    <span class="text-white/90 text-xs font-medium drop-shadow">Quick Saves</span>
                  {/if}
                </div>
                <!-- Pending sync badge -->
                {#if list.pendingSync}
                  <div
                    class="flex items-center gap-1 px-2 py-1 rounded-full bg-amber-500/90 text-white text-xs font-medium shadow-lg"
                  >
                    <CloudArrowUpIcon size={12} />
                    <span>Pending</span>
                  </div>
                {/if}
              </div>

              <div>
                {#if hasAnySaved}
                  <h3 class="text-white text-lg font-bold mb-1 drop-shadow-lg truncate">My Recipes</h3>
                  <p class="text-white/90 text-sm drop-shadow">
                    {totalUniqueSaved} {totalUniqueSaved === 1 ? 'recipe' : 'recipes'}
                  </p>
                {:else}
                  <h3 class="text-white text-lg font-bold mb-1 drop-shadow-lg truncate">
                    Start saving recipes
                  </h3>
                  <p class="text-white/90 text-sm drop-shadow">Tap the bookmark on any recipe.</p>
                {/if}
              </div>
            </div>
          </button>
        {/if}

        <!-- Custom Collections -->
        {#each customCollections as list (list.id)}
          <button
            on:click={() => openList(list)}
            on:mouseenter={() => (hoveredListId = list.id)}
            on:mouseleave={() => (hoveredListId = null)}
            class="group relative h-40 rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-xl text-left collection-card"
            style="box-shadow: {hoveredListId === list.id
              ? '0 8px 24px rgba(0,0,0,0.3)'
              : '0 2px 8px rgba(0,0,0,0.1)'}; transform: {hoveredListId === list.id
              ? 'translateY(-4px)'
              : 'translateY(0)'};"
            aria-label="{list.title} collection with {list.recipeCount} recipes"
          >
            <!-- Background -->
            <div
              class="absolute inset-0"
              style={getListCoverImage(list)
                ? `background-image: url('${getListCoverImage(list)}'); background-size: cover; background-position: center;`
                : 'background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);'}
            >
              <div
                class="absolute inset-0 bg-black/30 group-hover:bg-black/20 transition-colors"
              ></div>
            </div>

            <!-- Empty Collection Placeholder Grid -->
            {#if list.recipeCount === 0}
              <div class="absolute inset-0 flex items-center justify-center p-4">
                <div class="grid grid-cols-3 gap-2 w-full max-w-[200px] opacity-40">
                  {#each Array(6) as _}
                    <div
                      class="aspect-square rounded-lg border-2 border-dashed border-white/50 flex items-center justify-center"
                    >
                      <PlusIcon size={16} class="text-white/50" />
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            <!-- Content -->
            <div class="relative h-full flex flex-col justify-between p-4">
              <div class="flex justify-between items-start">
                <!-- Pending sync badge -->
                {#if list.pendingSync}
                  <div
                    class="flex items-center gap-1 px-2 py-1 rounded-full bg-amber-500/90 text-white text-xs font-medium shadow-lg"
                  >
                    <CloudArrowUpIcon size={12} />
                    <span>Pending</span>
                  </div>
                {:else}
                  <span></span>
                {/if}

                <!-- Quick Actions Overlay (Desktop Hover) -->
                {#if hoveredListId === list.id && list.recipeCount > 0}
                  <div class="flex gap-2" on:click|stopPropagation>
                    <button
                      on:click={(e) => openChangeCoverModal(list, e)}
                      class="w-8 h-8 flex items-center justify-center rounded-full bg-white/90 hover:bg-white text-gray-800 transition-colors shadow-lg"
                      aria-label="Change cover image"
                      title="Change Cover"
                    >
                      <ImageIcon size={16} weight="bold" />
                    </button>
                    <button
                      on:click={(e) => openEditModal(list, e)}
                      class="w-8 h-8 flex items-center justify-center rounded-full bg-white/90 hover:bg-white text-gray-800 transition-colors shadow-lg"
                      aria-label="Edit collection"
                      title="Edit"
                    >
                      <PencilSimpleIcon size={16} weight="bold" />
                    </button>
                    <button
                      on:click={(e) => shareList(list, e)}
                      class="w-8 h-8 flex items-center justify-center rounded-full bg-white/90 hover:bg-white text-gray-800 transition-colors shadow-lg"
                      aria-label="Share collection link"
                      title="Share link"
                    >
                      <ShareIcon size={16} weight="bold" />
                    </button>
                    <button
                      on:click={(e) => openShareCollection(list, e)}
                      disabled={list.recipes.length === 0}
                      class="w-8 h-8 flex items-center justify-center rounded-full bg-white/90 hover:bg-white text-gray-800 transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label="Share as Recipe Pack"
                      title="Share as Recipe Pack"
                    >
                      <ShareNetworkIcon size={16} weight="bold" />
                    </button>
                    <button
                      on:click={(e) => openDeleteConfirm(list, e)}
                      class="w-8 h-8 flex items-center justify-center rounded-full bg-red-500/90 hover:bg-red-600 text-white transition-colors shadow-lg"
                      aria-label="Delete collection"
                      title="Delete"
                    >
                      <TrashIcon size={16} weight="bold" />
                    </button>
                  </div>
                {/if}
              </div>

              <div>
                <h3 class="text-white text-lg font-bold mb-1 drop-shadow-lg truncate">
                  {list.title}
                </h3>
                <p class="text-white/90 text-sm drop-shadow">
                  {list.recipeCount}
                  {list.recipeCount === 1 ? 'recipe' : 'recipes'}
                </p>
              </div>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</PullToRefresh>

<style>
  .collection-card {
    position: relative;
    will-change: transform;
  }

  /* Feed view large image cards */
  .feed-card-image-wrap {
    background-color: var(--color-accent-gray);
  }
  .feed-card-image {
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    opacity: 0;
    transition: opacity 0.3s ease-in;
  }
  .feed-card-image:global(.image-loaded) {
    opacity: 1;
  }
</style>
