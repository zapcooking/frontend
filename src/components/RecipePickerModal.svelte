<script lang="ts">
  /**
   * Recipe picker for the Meal Planner (Phase 3 PR10) — pick one of the
   * user's recipes for a plan slot.
   *
   * Structure forked from AddToListModal (portal'd centered dialog,
   * scrollable selectable rows, footer confirm) — AddToListModal itself
   * is untouched. Two sources per the Phase 3 findings:
   * - Saved: unique recipe coordinates across $cookbookLists
   * - Published: fetchMyAuthoredRecipeEvents, lazy on first tab open
   *
   * Rows resolve title+thumbnail cache-first (offlineStorage.getRecipes,
   * then per-coordinate fetchEvent) — same pattern as the planner grid.
   * Selection dispatches the coordinate + resolved title so the caller
   * can write the contract's denormalized `title` snapshot.
   */
  import { createEventDispatcher, onMount } from 'svelte';
  import { blur, scale } from 'svelte/transition';
  import CloseIcon from 'phosphor-svelte/lib/XCircle';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import SpinnerIcon from 'phosphor-svelte/lib/CircleNotch';
  import ForkKnifeIcon from 'phosphor-svelte/lib/ForkKnife';
  import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlass';
  import { ndk, userPublickey } from '$lib/nostr';
  import { isOnline } from '$lib/connectionMonitor';
  import { offlineStorage } from '$lib/offlineStorage';
  import { cookbookStore, cookbookLists } from '$lib/stores/cookbookStore';
  import { fetchMyAuthoredRecipeEvents } from '$lib/myRecipesPack';
  import { getImageOrPlaceholder } from '$lib/placeholderImages';
  import { portal } from './grocery/AddToListModal.svelte';

  export let open = false;

  const dispatch = createEventDispatcher<{
    close: void;
    select: { a: string; title: string };
  }>();

  type PickerTab = 'saved' | 'published';
  type PickerRow = { a: string; title: string; image: string };

  let tab: PickerTab = 'saved';
  let search = '';
  let selectedA: string | null = null;

  let savedRows: PickerRow[] = [];
  let savedLoading = false;
  let savedRequested = false;

  let publishedRows: PickerRow[] = [];
  let publishedLoading = false;
  let publishedRequested = false;

  let portalTarget: HTMLElement;
  onMount(() => {
    portalTarget = document.body;
  });

  function close() {
    dispatch('close');
  }

  // Reset on the open TRANSITION (not on close — prop flips can batch),
  // then lazy-load the visible tab's source.
  let wasOpen = false;
  $: {
    if (open && !wasOpen) {
      search = '';
      selectedA = null;
    }
    wasOpen = open;
    if (open) {
      if (tab === 'saved' && !savedRequested) {
        savedRequested = true;
        loadSaved();
      }
      if (tab === 'published' && !publishedRequested) {
        publishedRequested = true;
        loadPublished();
      }
    }
  }

  // A mid-session logout/store clear closes the picker gracefully.
  $: if (open && !$userPublickey) {
    close();
  }

  /** Cache-first coordinate → {title,image}, the planner grid's pattern. */
  async function resolveRows(aTags: string[]): Promise<PickerRow[]> {
    const rows = new Map<string, PickerRow>();
    const cached = await offlineStorage.getRecipes(aTags);
    for (const c of cached) {
      rows.set(c.id, {
        a: c.id,
        title: c.title,
        image: getImageOrPlaceholder(c.image || '', c.id)
      });
    }
    const missing = aTags.filter((a) => !rows.has(a));
    if (missing.length > 0 && $isOnline && $ndk) {
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
              rows.set(aTag, {
                a: aTag,
                title: e.tags?.find((t) => t[0] === 'title')?.[1] || identifier,
                image: getImageOrPlaceholder(
                  e.tags?.find((t) => t[0] === 'image')?.[1] || '',
                  e.id || identifier
                )
              });
              try {
                await offlineStorage.saveRecipeFromEvent(e);
              } catch {}
            }
          } catch (err) {
            console.warn('[RecipePicker] Failed to resolve', aTag, err);
          }
        })
      );
    }
    // Preserve the input order, drop unresolvable coordinates
    return aTags.map((a) => rows.get(a)).filter((r): r is PickerRow => !!r);
  }

  async function loadSaved() {
    savedLoading = true;
    try {
      if (!$cookbookLists.length) {
        // On a cold cache load() awaits the relay refresh itself.
        await cookbookStore.load();
      }
      const seen = new Set<string>();
      const aTags: string[] = [];
      for (const list of $cookbookLists) {
        for (const a of list.recipes) {
          if (!seen.has(a)) {
            seen.add(a);
            aTags.push(a);
          }
        }
      }
      savedRows = await resolveRows(aTags);
    } catch (err) {
      console.warn('[RecipePicker] Failed to load saved recipes', err);
    } finally {
      savedLoading = false;
    }
  }

  async function loadPublished() {
    publishedLoading = true;
    try {
      if (!$ndk || !$userPublickey) return;
      const events = await fetchMyAuthoredRecipeEvents($ndk, $userPublickey);
      publishedRows = events.map((e) => {
        const dTag = e.tags.find((t) => t[0] === 'd')?.[1] || '';
        return {
          a: `30023:${e.pubkey}:${dTag}`,
          title: e.tags.find((t) => t[0] === 'title')?.[1]?.trim() || dTag,
          image: getImageOrPlaceholder(
            e.tags.find((t) => t[0] === 'image')?.[1] || '',
            e.id || dTag
          )
        };
      });
      for (const e of events) {
        offlineStorage.saveRecipeFromEvent(e).catch(() => {});
      }
    } catch (err) {
      console.warn('[RecipePicker] Failed to load published recipes', err);
    } finally {
      publishedLoading = false;
    }
  }

  $: rows = tab === 'saved' ? savedRows : publishedRows;
  $: loading = tab === 'saved' ? savedLoading : publishedLoading;
  $: filteredRows = search.trim()
    ? rows.filter((r) => r.title.toLowerCase().includes(search.trim().toLowerCase()))
    : rows;
  $: selectedRow = filteredRows.find((r) => r.a === selectedA) || rows.find((r) => r.a === selectedA);

  function confirmSelection() {
    if (!selectedRow) return;
    dispatch('select', { a: selectedRow.a, title: selectedRow.title });
  }

  function setTab(t: PickerTab) {
    tab = t;
    selectedA = null;
  }
</script>

{#if open && portalTarget}
  <div use:portal={portalTarget}>
    <div
      on:click|self={close}
      on:keydown={(e) => e.key === 'Escape' && close()}
      role="presentation"
      transition:blur={{ duration: 250 }}
      class="fixed top-0 left-0 z-50 w-full h-full backdrop-brightness-50 backdrop-blur"
    >
      <dialog
        transition:scale={{ duration: 250 }}
        aria-labelledby="recipe-picker-title"
        aria-modal="true"
        class="absolute m-0 top-1/2 left-1/2 px-4 md:px-6 pt-5 pb-6 rounded-3xl w-[calc(100%-1rem)] md:w-[calc(100vw-4em)] max-w-lg max-h-[90vh] overflow-y-auto -translate-x-1/2 -translate-y-1/2"
        style="background-color: var(--color-bg-secondary);"
        open
      >
        <div class="flex flex-col gap-4">
          <!-- Header -->
          <div class="flex justify-between items-start">
            <div class="flex items-center gap-3">
              <div
                class="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center flex-shrink-0"
              >
                <ForkKnifeIcon size={20} weight="fill" class="text-white" />
              </div>
              <h2
                id="recipe-picker-title"
                class="text-lg font-semibold"
                style="color: var(--color-text-primary)"
              >
                Choose a recipe
              </h2>
            </div>
            <button
              class="cursor-pointer p-1 hover:bg-input rounded-full transition-colors"
              style="color: var(--color-text-primary)"
              on:click={close}
              aria-label="Close recipe picker"
            >
              <CloseIcon size={24} />
            </button>
          </div>

          <!-- Source tabs -->
          <div
            class="inline-flex p-0.5 rounded-full self-start"
            style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
            role="tablist"
            aria-label="Recipe source"
          >
            {#each [{ id: 'saved', label: 'Saved' }, { id: 'published', label: 'Published' }] as t}
              <button
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                on:click={() => setTab(t.id === 'saved' ? 'saved' : 'published')}
                class="px-3 py-1.5 rounded-full text-sm font-medium transition-colors {tab === t.id
                  ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-sm'
                  : ''}"
                style={tab === t.id ? '' : 'color: var(--color-text-secondary);'}
              >
                {t.label}
              </button>
            {/each}
          </div>

          <!-- Search. A real form with a no-op submit so Enter never
               leaks past the modal (the PR9 keydown-leak lesson). -->
          <form on:submit|preventDefault={() => {}} class="relative">
            <MagnifyingGlassIcon
              size={16}
              class="absolute left-3 top-1/2 -translate-y-1/2 text-caption"
            />
            <input
              type="text"
              bind:value={search}
              placeholder="Search recipes…"
              class="input w-full"
              style="padding-left: 2.25rem;"
              aria-label="Search recipes"
            />
          </form>

          <!-- Rows -->
          {#if loading}
            <div class="flex items-center justify-center py-10">
              <SpinnerIcon size={24} class="animate-spin text-orange-500" />
            </div>
          {:else if filteredRows.length === 0}
            <div class="flex flex-col items-center text-center gap-2 py-8">
              {#if rows.length > 0}
                <p class="text-sm text-caption">No recipes match “{search}”.</p>
              {:else if tab === 'saved'}
                <p class="text-sm" style="color: var(--color-text-primary);">
                  No saved recipes yet.
                </p>
                <a href="/recipes" class="text-sm font-medium text-orange-500 hover:underline">
                  Browse recipes to save some
                </a>
              {:else}
                <p class="text-sm" style="color: var(--color-text-primary);">
                  You haven't published any recipes yet.
                </p>
                <a href="/create" class="text-sm font-medium text-orange-500 hover:underline">
                  Create a recipe
                </a>
              {/if}
            </div>
          {:else}
            <div class="max-h-72 overflow-y-auto flex flex-col gap-1.5" role="listbox" aria-label="Recipes">
              {#each filteredRows as row (row.a)}
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedA === row.a}
                  on:click={() => (selectedA = row.a)}
                  class="flex items-center gap-3 w-full text-left px-2.5 py-2 rounded-xl transition-colors {selectedA ===
                  row.a
                    ? 'ring-2 ring-orange-500'
                    : 'hover:bg-accent-gray'}"
                  style="background-color: var(--color-input-bg);"
                >
                  <span
                    class="w-10 h-10 rounded-lg flex-shrink-0 picker-thumb"
                    style="background-image: url('{row.image}');"
                  ></span>
                  <span
                    class="text-sm font-medium truncate flex-1"
                    style="color: var(--color-text-primary);"
                  >
                    {row.title}
                  </span>
                  {#if selectedA === row.a}
                    <CheckIcon size={18} class="text-orange-500 flex-shrink-0" weight="bold" />
                  {/if}
                </button>
              {/each}
            </div>
          {/if}

          <!-- Footer -->
          <div class="flex gap-2 justify-end">
            <button
              type="button"
              on:click={close}
              class="px-4 py-2 rounded-full text-sm font-medium transition-colors hover:bg-accent-gray"
              style="color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!selectedRow}
              on:click={confirmSelection}
              class="px-4 py-2 rounded-full text-sm font-medium text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add to slot
            </button>
          </div>
        </div>
      </dialog>
    </div>
  </div>
{/if}

<style>
  .picker-thumb {
    background-size: cover;
    background-position: center;
    background-color: var(--color-accent-gray);
  }
</style>
