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
  import PantryEditor from '../../../components/pantry/PantryEditor.svelte';
  import PantryItem from '../../../components/pantry/PantryItem.svelte';
  import PanLoader from '../../../components/PanLoader.svelte';
  import PullToRefresh from '../../../components/PullToRefresh.svelte';
  import BasketIcon from 'phosphor-svelte/lib/Basket';
  import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotch';

  let pullToRefreshEl: PullToRefresh;
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

  async function handleRefresh() {
    try {
      await pantryStore.load();
    } finally {
      pullToRefreshEl?.complete();
    }
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
          <p class="text-sm text-caption">Ingredients you already have. Private and encrypted.</p>
        </div>
      </div>
      {#if $pantrySaving}
        <div class="flex items-center gap-1.5 text-sm text-caption">
          <CircleNotchIcon size={16} class="animate-spin" />
          <span>Saving…</span>
        </div>
      {/if}
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
      <PantryEditor disabled={$pantryReadOnly} />

      {#if $pantryItems.length > 6}
        <input
          bind:value={filter}
          type="search"
          placeholder="Search pantry…"
          class="input w-full"
          aria-label="Search pantry"
        />
      {/if}

      {#if $pantryItems.length === 0}
        <div class="flex flex-col items-center justify-center py-16 px-4">
          <div
            class="w-20 h-20 rounded-full bg-gradient-to-br from-orange-100 to-amber-100 dark:from-orange-900/30 dark:to-amber-900/30 flex items-center justify-center mb-4"
          >
            <BasketIcon size={40} weight="regular" class="text-orange-500" />
          </div>
          <h2 class="text-xl font-semibold mb-2" style="color: var(--color-text-primary)">
            Your pantry is empty
          </h2>
          <p class="text-caption text-center max-w-md">
            Add a few ingredients you already have and Cheffy can build meals around them.
          </p>
        </div>
      {:else if filtered.length === 0}
        <p class="text-sm text-caption text-center py-8">No pantry items match that search.</p>
      {:else}
        <ul class="flex flex-col gap-2">
          {#each filtered as item (item.id)}
            <PantryItem {item} disabled={$pantryReadOnly} />
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
</PullToRefresh>
