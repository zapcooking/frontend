<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import { userPublickey } from '$lib/nostr';
  import {
    pantryStore,
    pantryItems,
    pantryLoading,
    pantryError,
    pantryInitialized,
    pantrySaving,
    pantryReadOnly,
    pantryDecryptFailed
  } from '$lib/stores/pantryStore';
  import { formatPantryQuantity } from '$lib/pantry/schema';
  import { groupPantryItems } from '$lib/pantry/categories';
  import { missingCommonStaples } from '$lib/pantry/catalog';
  import PantryEditor from '../../../components/pantry/PantryEditor.svelte';
  import PantryItem from '../../../components/pantry/PantryItem.svelte';
  import PanLoader from '../../../components/PanLoader.svelte';
  import PullToRefresh from '../../../components/PullToRefresh.svelte';
  import BasketIcon from 'phosphor-svelte/lib/Basket';
  import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotch';
  import CheffyIcon from '../../../components/icons/CheffyIcon.svelte';
  import StarIcon from 'phosphor-svelte/lib/Star';

  let pullToRefreshEl: PullToRefresh;
  let editor: PantryEditor;
  let filter = '';

  $: filtered = $pantryItems.filter((item) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      item.normalizedName.includes(q) ||
      formatPantryQuantity(item).toLowerCase().includes(q)
    );
  });
  $: groups = groupPantryItems(filtered);
  $: stapleSuggestions = missingCommonStaples($pantryItems).slice(0, 8);

  async function handleRefresh() {
    try {
      await pantryStore.load();
    } finally {
      pullToRefreshEl?.complete();
    }
  }

  function focusAdd() {
    editor?.focus();
  }

  function addStaple(name: string) {
    pantryStore.addItems(name, undefined, { isStaple: true });
  }

  onMount(async () => {
    if (!$userPublickey) {
      goto('/login?redirect=' + encodeURIComponent('/my-kitchen/pantry'));
      return;
    }
    if (!$pantryInitialized) {
      await pantryStore.load();
    }
  });

  onDestroy(() => {
    pantryStore.saveNow();
  });
</script>

<svelte:head>
  <title>Pantry - zap.cooking</title>
  <meta
    name="description"
    content="Ingredients you already have at home, private to your kitchen."
  />
</svelte:head>

<PullToRefresh bind:this={pullToRefreshEl} on:refresh={handleRefresh}>
  <div class="flex flex-col gap-6">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-3">
        <div
          class="w-12 h-12 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center flex-shrink-0"
        >
          <BasketIcon size={24} weight="fill" class="text-white" />
        </div>
        <div>
          <h1 class="text-2xl font-bold" style="color: var(--color-text-primary)">Pantry</h1>
          <p class="text-sm text-caption">
            Tell Zap what you have. We'll use it to plan meals and skip the grocery extras.
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        {#if $pantrySaving}
          <div class="flex items-center gap-1.5 text-sm text-caption">
            <CircleNotchIcon size={16} class="animate-spin" />
            <span>Saving…</span>
          </div>
        {/if}
        {#if $pantryItems.length > 0 && !$pantryReadOnly}
          <a
            href="/my-kitchen/planner?planWithPantry=1"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 transition-all"
          >
            <CheffyIcon size={20} expression="happy" />
            <span>Plan With My Pantry</span>
          </a>
        {/if}
      </div>
    </div>

    {#if $pantryError}
      <div
        class="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30"
      >
        <p class="text-sm" style="color: var(--color-text-primary)">
          {#if $pantryDecryptFailed}
            Couldn't unlock your pantry. Check your signer and try again.
          {:else}
            {$pantryError}
          {/if}
        </p>
      </div>
    {/if}

    {#if $pantryReadOnly && !$pantryDecryptFailed}
      <p class="text-sm text-caption">
        This pantry was saved by a newer app version and is read-only here.
      </p>
    {/if}

    {#if $pantryLoading && !$pantryInitialized}
      <div class="flex justify-center items-center py-16">
        <PanLoader size="md" />
      </div>
    {:else}
      <PantryEditor bind:this={editor} disabled={$pantryReadOnly} />

      {#if stapleSuggestions.length > 0 && !$pantryReadOnly}
        <div class="flex flex-col gap-2">
          <p class="text-xs font-medium text-caption flex items-center gap-1.5">
            <StarIcon size={12} weight="fill" class="text-amber-500" />
            Pantry staples
          </p>
          <div class="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
            {#each stapleSuggestions as staple}
              <button
                type="button"
                class="flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors"
                style="border: 1px solid var(--color-input-border); background-color: var(--color-input-bg); color: var(--color-text-primary);"
                on:click={() => addStaple(staple)}
              >
                {staple}
              </button>
            {/each}
          </div>
        </div>
      {/if}

      {#if $pantryItems.length > 0}
        <input
          bind:value={filter}
          type="search"
          placeholder="Search pantry…"
          class="input w-full"
          aria-label="Search pantry"
        />
      {/if}

      {#if $pantryItems.length === 0}
        <div class="flex flex-col items-center justify-center py-12 px-4">
          <div
            class="w-20 h-20 rounded-full bg-gradient-to-br from-orange-100 to-amber-100 dark:from-orange-900/30 dark:to-amber-900/30 flex items-center justify-center mb-4"
          >
            <BasketIcon size={40} weight="regular" class="text-orange-500" />
          </div>
          <h2 class="text-xl font-semibold mb-2" style="color: var(--color-text-primary)">
            What's in your kitchen?
          </h2>
          <p class="text-caption text-center max-w-md mb-5">
            Add ingredients you already have and Zap can use them to help plan meals and simplify
            your grocery list.
          </p>
          <button
            type="button"
            class="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 transition-all"
            on:click={focusAdd}
          >
            Add your first ingredient
          </button>
        </div>
      {:else if filtered.length === 0}
        <p class="text-sm text-caption text-center py-8">No pantry items match that search.</p>
      {:else}
        <div class="flex flex-col gap-6">
          {#each groups as group (group.category)}
            <section class="flex flex-col gap-2">
              <h2
                class="text-xs font-semibold uppercase tracking-wide"
                style="color: var(--color-caption);"
              >
                {group.label}
              </h2>
              <ul class="flex flex-col gap-2">
                {#each group.items as item (item.id)}
                  <PantryItem {item} disabled={$pantryReadOnly} />
                {/each}
              </ul>
            </section>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</PullToRefresh>
