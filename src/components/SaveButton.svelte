<script lang="ts">
  /**
   * SaveButton - Unified save/bookmark button for recipes
   * 
   * Features:
   * - Single tap: Quick save to default "Saved" list
   * - Long press (mobile) or dropdown: Choose specific list
   * - Visual feedback when recipe is already saved
   */
  
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { userPublickey } from '$lib/nostr';
  import { requireAuth, isSignedIn } from '$lib/auth/requireAuth';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import BookmarkIcon from 'phosphor-svelte/lib/BookmarkSimple';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
  import PlusIcon from 'phosphor-svelte/lib/Plus';
  import { clickOutside } from '$lib/clickOutside';
  import { cookbookStore, DEFAULT_LIST_ID } from '$lib/stores/cookbookStore';
  import { showToast } from '$lib/toast';
  import { get } from 'svelte/store';
  import { fade, slide } from 'svelte/transition';

  export let event: NDKEvent;
  export let size: 'sm' | 'md' | 'lg' = 'md';
  export let variant: 'primary' | 'secondary' | 'ghost' = 'primary';
  export let showText = false;
  /** Button text with showText (e.g. "Save to cookbook"). */
  export let text = 'Save';
  export let savedText = 'Saved';
  /** Fill the container's width (a full-width button). */
  export let block = false;

  const dispatch = createEventDispatcher<{
    saved: { listId: string };
    removed: { listId: string };
  }>();

  let dropdownOpen = false;
  let loading = false;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let isLongPress = false;
  // The lists come from My Kitchen's store — the one place lists are read
  // and written (the "Saved" list only through its safe edit). This button
  // never builds or publishes a list event itself.
  $: lists = $userPublickey ? $cookbookStore.lists.filter((l) => !l.localOnly) : [];
  $: listsLoaded = $cookbookStore.initialized;
  $: if ($userPublickey) cookbookStore.ensureLoaded();

  // Size classes
  // With text the button sizes to its label; only the height is fixed.
  $: sizeClasses = (
    showText
      ? { sm: 'h-8', md: 'h-10', lg: 'h-12' }
      : { sm: 'w-8 h-8', md: 'w-10 h-10', lg: 'w-12 h-12' }
  )[size];

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

  $: savedInLists = new Set(lists.filter((l) => l.recipes.includes(recipeATag)).map((l) => l.id));
  $: isSaved = savedInLists.size > 0;

  async function quickSave() {
    // Resuming after sign-in saves, never unsaves: the account may already
    // have this recipe saved from another device.
    const resuming = !isSignedIn();
    if (!(await requireAuth({ kind: 'save', reason: 'Sign in to save this recipe' }))) return;

    if (loading) return;
    loading = true;

    try {
      await cookbookStore.ensureLoaded();
      const inDefault = !!get(cookbookStore)
        .lists.find((l) => l.id === DEFAULT_LIST_ID && !l.localOnly)
        ?.recipes.includes(recipeATag);
      // The store's safe edit re-reads the list from the relays before it
      // publishes, so neither direction can build on a stale copy.
      if (inDefault && resuming) return;
      const result = inDefault
        ? await cookbookStore.removeFromDefaultList(recipeATag)
        : await cookbookStore.saveToDefaultList(event);
      if (!result.ok) {
        showToast('error', result.message);
      } else if (result.changed) {
        dispatch(inDefault ? 'removed' : 'saved', { listId: DEFAULT_LIST_ID });
      }
    } finally {
      loading = false;
    }
  }

  async function toggleListSelection(listId: string) {
    if (loading) return;
    loading = true;
    const wasIn = savedInLists.has(listId);
    try {
      if (listId === DEFAULT_LIST_ID) {
        const result = wasIn
          ? await cookbookStore.removeFromDefaultList(recipeATag)
          : await cookbookStore.saveToDefaultList(event);
        if (!result.ok) {
          showToast('error', result.message);
          return;
        }
        if (result.changed) dispatch(wasIn ? 'removed' : 'saved', { listId });
        return;
      }
      const ok = wasIn
        ? await cookbookStore.removeRecipeFromList(listId, recipeATag)
        : await cookbookStore.addRecipeToList(listId, event);
      if (ok) dispatch(wasIn ? 'removed' : 'saved', { listId });
      else showToast('error', "Couldn't update that list. Please try again.");
    } finally {
      loading = false;
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

  async function openDropdown() {
    if (!(await requireAuth({ kind: 'save', reason: 'Sign in to save this recipe' }))) return;
    cookbookStore.ensureLoaded();
    dropdownOpen = true;
  }

  function closeDropdown() {
    dropdownOpen = false;
  }


  onDestroy(() => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
    }
  });
</script>

<div
  class="relative {block ? 'flex w-full' : 'inline-flex'}"
  use:clickOutside
  on:click_outside={closeDropdown}
>
  <!-- Main Save Button -->
  <div class="flex items-center {block ? 'flex-1' : ''}">
    <button
      on:pointerdown={handlePointerDown}
      on:pointerup={handlePointerUp}
      on:pointerleave={handlePointerLeave}
      disabled={loading}
      class="flex items-center justify-center rounded-full transition duration-200 touch-none select-none {sizeClasses} {variantClasses} {showText ? 'px-4 gap-2' : ''} {block ? 'flex-1' : ''}"
      aria-label={showText ? undefined : isSaved ? 'Recipe saved' : 'Save recipe'}
      title={isSaved ? 'Recipe saved (hold for options)' : 'Save to My Kitchen (hold for options)'}
    >
      {#if loading}
        <div class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
      {:else if isSaved}
        <CheckIcon size={iconSize} weight="bold" />
      {:else}
        <BookmarkIcon size={iconSize} weight="fill" />
      {/if}
      {#if showText}
        <span class="text-sm font-medium whitespace-nowrap">{isSaved ? savedText : text}</span>
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
            href="/my-kitchen"
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
          href="/my-kitchen"
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

