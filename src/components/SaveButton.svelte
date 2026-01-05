<script lang="ts">
  /**
   * SaveButton - Unified save/bookmark button for recipes
   * 
   * Features:
   * - Single tap: Quick save to default "Saved" list
   * - Long press (mobile) or dropdown: Choose specific list
   * - Visual feedback when recipe is already saved
   */
  
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import BookmarkIcon from 'phosphor-svelte/lib/BookmarkSimple';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
  import PlusIcon from 'phosphor-svelte/lib/Plus';
  import { clickOutside } from '$lib/clickOutside';
  import { cookbookStore, type CookbookList, DEFAULT_LIST_ID } from '$lib/stores/cookbookStore';
  import { RECIPE_TAGS, RECIPE_TAG_PREFIX_NEW } from '$lib/consts';
  import { fade, slide } from 'svelte/transition';

  export let event: NDKEvent;
  export let size: 'sm' | 'md' | 'lg' = 'md';
  export let variant: 'primary' | 'secondary' | 'ghost' = 'primary';
  export let showText = false;

  const dispatch = createEventDispatcher<{
    saved: { listId: string };
    removed: { listId: string };
  }>();

  let dropdownOpen = false;
  let loading = false;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let isLongPress = false;
  let lists: CookbookList[] = [];
  let listsLoaded = false;
  let isSaved = false;
  let savedInLists: Set<string> = new Set();

  // Size classes
  $: sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12'
  }[size];

  $: iconSize = {
    sm: 16,
    md: 20,
    lg: 24
  }[size];

  // Variant classes
  $: variantClasses = {
    primary: isSaved 
      ? 'bg-green-500 hover:bg-green-600 text-white' 
      : 'bg-primary hover:bg-primary/90 text-white',
    secondary: isSaved
      ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-800'
      : 'bg-input hover:bg-accent-gray border border-input-border',
    ghost: isSaved
      ? 'text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20'
      : 'hover:bg-accent-gray'
  }[variant];

  // Recipe a-tag for comparison
  $: recipeATag = event ? `${event.kind}:${event.pubkey}:${event.replaceableDTag()}` : '';

  // Check save status
  function checkSaveStatus() {
    if (!lists.length || !recipeATag) {
      isSaved = false;
      savedInLists = new Set();
      return;
    }

    const newSavedIn = new Set<string>();
    lists.forEach(list => {
      if (list.recipes.includes(recipeATag)) {
        newSavedIn.add(list.id);
      }
    });

    savedInLists = newSavedIn;
    isSaved = savedInLists.size > 0;
  }

  $: if (lists && recipeATag) {
    checkSaveStatus();
  }

  async function loadLists() {
    if (listsLoaded || !$userPublickey) return;

    try {
      const filters = [
        {
          authors: [$userPublickey],
          kinds: [30001],
          '#t': RECIPE_TAGS,
          limit: 256
        },
        {
          '#d': [DEFAULT_LIST_ID],
          authors: [$userPublickey],
          kinds: [30001]
        }
      ];

      const subscription = $ndk.subscribe(filters, { closeOnEose: true });
      const loadedLists: CookbookList[] = [];
      const seenIds = new Set<string>();

      subscription.on('event', (ev: NDKEvent) => {
        const dTag = ev.tags.find(t => t[0] === 'd')?.[1];
        if (!dTag || seenIds.has(dTag)) return;
        seenIds.add(dTag);

        const title = ev.tags.find(t => t[0] === 'title')?.[1] || dTag;
        const recipes = ev.tags.filter(t => t[0] === 'a').map(t => t[1]);
        const isDefault = dTag === DEFAULT_LIST_ID;

        loadedLists.push({
          id: dTag,
          naddr: '',
          title: isDefault ? 'Saved' : title,
          recipeCount: recipes.length,
          recipes,
          createdAt: ev.created_at || 0,
          isDefault,
          event: ev
        });
      });

      subscription.on('eose', () => {
        // Final deduplication by id (in case of race conditions)
        const uniqueLists = loadedLists.filter((list, index, self) => 
          index === self.findIndex(l => l.id === list.id)
        );

        // Sort: default first, then alphabetically
        uniqueLists.sort((a, b) => {
          if (a.isDefault) return -1;
          if (b.isDefault) return 1;
          return a.title.localeCompare(b.title);
        });

        lists = uniqueLists;
        listsLoaded = true;
        checkSaveStatus();
      });
    } catch (error) {
      console.error('Failed to load lists:', error);
    }
  }

  async function quickSave() {
    if (!$userPublickey) {
      goto('/login');
      return;
    }

    if (loading) return;
    loading = true;

    try {
      // Load lists if not loaded
      if (!listsLoaded) {
        await new Promise<void>(resolve => {
          const check = () => {
            if (listsLoaded) resolve();
            else setTimeout(check, 50);
          };
          loadLists();
          check();
        });
      }

      // Find or create default list
      let defaultList = lists.find(l => l.isDefault);

      if (!defaultList) {
        // Create default list
        const { NDKEvent } = await import('@nostr-dev-kit/ndk');
        const newEvent = new NDKEvent($ndk);
        newEvent.kind = 30001;
        newEvent.tags = [
          ['d', DEFAULT_LIST_ID],
          ['title', 'Saved']
        ];
        await newEvent.publish();

        defaultList = {
          id: DEFAULT_LIST_ID,
          naddr: '',
          title: 'Saved',
          recipeCount: 0,
          recipes: [],
          createdAt: Math.floor(Date.now() / 1000),
          isDefault: true,
          event: newEvent
        };
        lists = [defaultList, ...lists];
      }

      // Toggle: if already in default list, remove; otherwise add
      if (savedInLists.has(DEFAULT_LIST_ID)) {
        await removeFromList(DEFAULT_LIST_ID);
      } else {
        await addToList(DEFAULT_LIST_ID);
      }
    } catch (error) {
      console.error('Quick save failed:', error);
    } finally {
      loading = false;
    }
  }

  async function addToList(listId: string) {
    const list = lists.find(l => l.id === listId);
    if (!list || list.recipes.includes(recipeATag)) return;

    loading = true;

    try {
      const { NDKEvent } = await import('@nostr-dev-kit/ndk');
      const newEvent = new NDKEvent($ndk);
      newEvent.kind = 30001;

      // Copy metadata tags
      const metaTags = ['d', 'title', 'summary', 'image', 't'];
      list.event.tags.forEach(tag => {
        if (metaTags.includes(tag[0])) {
          newEvent.tags.push([...tag]);
        }
      });

      // Add existing recipes
      list.recipes.forEach(r => {
        newEvent.tags.push(['a', r]);
      });

      // Add new recipe
      newEvent.tags.push(['a', recipeATag]);

      const { addClientTagToEvent } = await import('$lib/nip89');
      addClientTagToEvent(newEvent);

      await newEvent.publish();

      // Update local state
      const index = lists.findIndex(l => l.id === listId);
      if (index !== -1) {
        lists[index] = {
          ...lists[index],
          recipes: [...lists[index].recipes, recipeATag],
          recipeCount: lists[index].recipeCount + 1,
          event: newEvent
        };
        lists = lists;
      }

      checkSaveStatus();
      dispatch('saved', { listId });
    } catch (error) {
      console.error('Failed to add to list:', error);
    } finally {
      loading = false;
    }
  }

  async function removeFromList(listId: string) {
    const list = lists.find(l => l.id === listId);
    if (!list || !list.recipes.includes(recipeATag)) return;

    loading = true;

    try {
      const { NDKEvent } = await import('@nostr-dev-kit/ndk');
      const newEvent = new NDKEvent($ndk);
      newEvent.kind = 30001;

      // Copy metadata tags
      const metaTags = ['d', 'title', 'summary', 'image', 't'];
      list.event.tags.forEach(tag => {
        if (metaTags.includes(tag[0])) {
          newEvent.tags.push([...tag]);
        }
      });

      // Add recipes except the one being removed
      list.recipes.forEach(r => {
        if (r !== recipeATag) {
          newEvent.tags.push(['a', r]);
        }
      });

      const { addClientTagToEvent } = await import('$lib/nip89');
      addClientTagToEvent(newEvent);

      await newEvent.publish();

      // Update local state
      const index = lists.findIndex(l => l.id === listId);
      if (index !== -1) {
        lists[index] = {
          ...lists[index],
          recipes: lists[index].recipes.filter(r => r !== recipeATag),
          recipeCount: Math.max(0, lists[index].recipeCount - 1),
          event: newEvent
        };
        lists = lists;
      }

      checkSaveStatus();
      dispatch('removed', { listId });
    } catch (error) {
      console.error('Failed to remove from list:', error);
    } finally {
      loading = false;
    }
  }

  function toggleListSelection(listId: string) {
    if (savedInLists.has(listId)) {
      removeFromList(listId);
    } else {
      addToList(listId);
    }
  }

  // Long press handling
  function handlePointerDown(e: PointerEvent) {
    isLongPress = false;
    longPressTimer = setTimeout(() => {
      isLongPress = true;
      openDropdown();
    }, 500);
  }

  function handlePointerUp(e: PointerEvent) {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }

    if (!isLongPress) {
      quickSave();
    }
  }

  function handlePointerLeave() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function openDropdown() {
    if (!$userPublickey) {
      goto('/login');
      return;
    }
    loadLists();
    dropdownOpen = true;
  }

  function closeDropdown() {
    dropdownOpen = false;
  }

  onMount(() => {
    if ($userPublickey) {
      loadLists();
    }
  });

  onDestroy(() => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
    }
  });
</script>

<div class="relative inline-flex" use:clickOutside on:click_outside={closeDropdown}>
  <!-- Main Save Button -->
  <div class="flex items-center">
    <button
      on:pointerdown={handlePointerDown}
      on:pointerup={handlePointerUp}
      on:pointerleave={handlePointerLeave}
      disabled={loading}
      class="flex items-center justify-center rounded-full transition duration-200 touch-none select-none {sizeClasses} {variantClasses} {showText ? 'px-4 gap-2' : ''}"
      aria-label={isSaved ? 'Recipe saved' : 'Save recipe'}
      title={isSaved ? 'Recipe saved (hold for options)' : 'Save to cookbook (hold for options)'}
    >
      {#if loading}
        <div class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
      {:else if isSaved}
        <CheckIcon size={iconSize} weight="bold" />
      {:else}
        <BookmarkIcon size={iconSize} weight="fill" />
      {/if}
      {#if showText}
        <span class="text-sm font-medium">{isSaved ? 'Saved' : 'Save'}</span>
      {/if}
    </button>

    <!-- Dropdown trigger for desktop -->
    <button
      on:click|stopPropagation={openDropdown}
      class="hidden sm:flex items-center justify-center w-6 h-6 ml-1 rounded-full transition-colors hover:bg-black/10 dark:hover:bg-white/10"
      aria-label="Choose list"
    >
      <CaretDownIcon size={14} weight="bold" />
    </button>
  </div>

  <!-- Dropdown Menu -->
  {#if dropdownOpen}
    <div
      transition:fade={{ duration: 150 }}
      class="absolute right-0 top-full mt-2 z-50 py-2 rounded-xl shadow-xl min-w-[220px] max-h-80 overflow-y-auto"
      style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
    >
      <div class="px-3 py-2 text-xs font-semibold text-caption uppercase tracking-wide">
        Save to collection
      </div>

      {#if !listsLoaded}
        <div class="px-3 py-4 text-center text-caption">
          Loading...
        </div>
      {:else if lists.length === 0}
        <div class="px-3 py-4 text-center text-caption">
          <p class="mb-2">No collections yet</p>
          <a
            href="/cookbook"
            class="text-primary hover:underline text-sm"
            on:click={closeDropdown}
          >
            Create your first collection
          </a>
        </div>
      {:else}
        {#each lists as list (list.id)}
          <button
            on:click|stopPropagation={() => toggleListSelection(list.id)}
            class="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-accent-gray transition-colors"
            style="color: var(--color-text-primary)"
          >
            <div class="w-5 h-5 rounded border-2 flex items-center justify-center transition-colors {savedInLists.has(list.id) ? 'bg-green-500 border-green-500' : ''}" style="{savedInLists.has(list.id) ? '' : 'border-color: var(--color-input-border)'}">
              {#if savedInLists.has(list.id)}
                <CheckIcon size={12} weight="bold" class="text-white" />
              {/if}
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="truncate font-medium">{list.title}</span>
                {#if list.isDefault}
                  <span class="text-xs px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400">
                    Default
                  </span>
                {/if}
              </div>
              <span class="text-xs text-caption">
                {list.recipeCount} {list.recipeCount === 1 ? 'recipe' : 'recipes'}
              </span>
            </div>
          </button>
        {/each}

        <div class="border-t my-1" style="border-color: var(--color-input-border);"></div>

        <a
          href="/cookbook"
          on:click={closeDropdown}
          class="flex items-center gap-3 px-3 py-2 text-left hover:bg-accent-gray transition-colors"
          style="color: var(--color-text-primary)"
        >
          <div class="w-5 h-5 rounded-full flex items-center justify-center" style="background-color: var(--color-accent-gray);">
            <PlusIcon size={12} weight="bold" />
          </div>
          <span class="text-sm">Manage Collections</span>
        </a>
      {/if}
    </div>
  {/if}
</div>

