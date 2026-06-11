<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { ndk, userPublickey } from '$lib/nostr';
  import {
    getMemoriesCached,
    refreshMemories,
    type MemoryGroup
  } from '$lib/memories';
  import MemoryNoteCard from '../../components/MemoryNoteCard.svelte';
  import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwise';

  let groups: MemoryGroup[] = [];
  let loading = false;
  let loadedFor = ''; // pubkey the current groups belong to
  let refreshing = false;
  let refreshNotice = '';
  let destroyed = false;

  $: isLoggedIn = $userPublickey !== '';
  $: sortedGroups = [...groups].sort((a, b) => a.yearsAgo - b.yearsAgo);
  $: allEmpty = groups.length > 0 && groups.every((g) => g.events.length === 0);

  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  function yearLabel(yearsAgo: number): string {
    return yearsAgo === 1 ? '1 year ago' : `${yearsAgo} years ago`;
  }

  function groupDateLabel(date: Date): string {
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  async function load() {
    if (!browser || !$userPublickey || loading) return;
    const pubkey = $userPublickey;
    loading = true;
    try {
      const result = await getMemoriesCached($ndk, pubkey);
      if (destroyed || $userPublickey !== pubkey) return;
      groups = result;
      loadedFor = pubkey;
    } catch (error) {
      console.warn('[memories] Failed to load memories:', error);
    } finally {
      loading = false;
    }
  }

  async function refresh() {
    if (!browser || !$userPublickey || refreshing) return;
    const pubkey = $userPublickey;
    refreshing = true;
    refreshNotice = '';
    try {
      // refreshMemories overwrites today's cache only when the result is
      // authoritative (shouldCacheMemories): a timeout-empty refresh keeps
      // the existing cache, and we keep showing the current data.
      const { groups: fresh, refreshed } = await refreshMemories($ndk, pubkey);
      if (destroyed || $userPublickey !== pubkey) return;
      if (refreshed) {
        groups = fresh;
        loadedFor = pubkey;
      } else {
        refreshNotice = "Couldn't refresh — showing cached memories.";
      }
    } catch (error) {
      console.warn('[memories] Refresh failed:', error);
      refreshNotice = "Couldn't refresh — showing cached memories.";
    } finally {
      refreshing = false;
    }
  }

  onMount(load);

  // Load when the user logs in after landing here logged out
  $: if (browser && isLoggedIn && loadedFor !== $userPublickey && !loading) {
    load();
  }

  onDestroy(() => {
    destroyed = true;
  });
</script>

<svelte:head>
  <title>Echoes - zap.cooking</title>
  <meta name="description" content="Echoes — notes from this day in years past" />
</svelte:head>

<div class="px-4 max-w-2xl mx-auto w-full memories-page">
  {#if !isLoggedIn}
    <div class="text-center py-16">
      <p class="text-4xl mb-3" aria-hidden="true">📅</p>
      <h1 class="text-xl font-semibold mb-2" style="color: var(--color-text-primary);">
        Echoes
      </h1>
      <p class="text-sm mb-4" style="color: var(--color-text-secondary);">
        Notes from this day in years past. Sign in to see yours.
      </p>
      <a
        href="/login?redirect=/memories"
        class="inline-block px-4 py-2 rounded-full text-sm font-medium text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:opacity-90 transition-opacity"
      >
        Sign in
      </a>
    </div>
  {:else}
    <div class="flex items-start justify-between gap-4 mb-6 pt-2">
      <div>
        <h1 class="text-2xl font-bold" style="color: var(--color-text-primary);">Echoes</h1>
        <p class="text-sm mt-1" style="color: var(--color-text-secondary);">
          Notes from this day in years past. · {todayLabel}
        </p>
      </div>
      <button
        on:click={refresh}
        disabled={refreshing}
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium hover:opacity-80 transition-opacity disabled:opacity-50"
        style="color: var(--color-text-secondary); border-color: var(--color-input-border);"
        aria-label="Refresh echoes from relays"
      >
        <span class:animate-spin={refreshing}>
          <ArrowsClockwiseIcon size={14} />
        </span>
        Refresh
      </button>
    </div>

    {#if refreshNotice}
      <p
        class="text-xs rounded-lg border px-3 py-2 mb-4"
        style="color: var(--color-text-secondary); border-color: var(--color-input-border); background-color: var(--color-input);"
        role="status"
      >
        {refreshNotice}
      </p>
    {/if}

    {#if loading && groups.length === 0}
      <p class="text-sm py-8 text-center" style="color: var(--color-text-secondary);">
        Looking back through your notes…
      </p>
    {:else if allEmpty}
      <div class="text-center py-16">
        <p class="text-4xl mb-3" aria-hidden="true">🍳</p>
        <p class="text-sm" style="color: var(--color-text-secondary);">
          No echoes found for this day. Relays may not keep notes this old — or this day is
          still waiting for its first one.
        </p>
      </div>
    {:else}
      <div class="flex flex-col gap-8">
        {#each sortedGroups as group (group.yearsAgo)}
          <section>
            <h2
              class="text-sm font-semibold mb-3"
              style="color: var(--color-text-primary);"
            >
              {yearLabel(group.yearsAgo)}
              <span class="font-normal" style="color: var(--color-text-secondary);">
                · {groupDateLabel(group.date)}
              </span>
            </h2>
            {#if group.events.length > 0}
              <div class="flex flex-col gap-3">
                {#each group.events as event (event.id)}
                  <MemoryNoteCard {event} yearsAgo={group.yearsAgo} />
                {/each}
              </div>
            {:else}
              <p class="text-sm" style="color: var(--color-text-secondary);">
                Nothing from {yearLabel(group.yearsAgo)} — relays may not keep notes this old.
              </p>
            {/if}
          </section>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  /* Bottom padding so the fixed mobile nav doesn't cover content */
  .memories-page {
    padding-bottom: calc(80px + env(safe-area-inset-bottom, 0px));
  }

  @media (min-width: 768px) {
    .memories-page {
      padding-bottom: 2rem;
    }
  }
</style>
