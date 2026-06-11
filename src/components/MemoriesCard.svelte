<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { ndk, userPublickey } from '$lib/nostr';
  import {
    getMemoriesCached,
    dismissMemoriesCard,
    isMemoriesCardDismissed,
    type MemoryGroup
  } from '$lib/memories';
  import MemoryNoteCard from './MemoryNoteCard.svelte';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
  import XIcon from 'phosphor-svelte/lib/X';

  let groups: MemoryGroup[] = [];
  let loaded = false;
  let dismissed = false;
  let expanded = false;
  let destroyed = false;

  // Groups ordered newest-first (1 year ago, then 2, then 3) with notes
  $: nonEmptyGroups = groups
    .filter((g) => g.events.length > 0)
    .sort((a, b) => a.yearsAgo - b.yearsAgo);

  $: summary = nonEmptyGroups
    .map((g) => {
      const notes = g.events.length === 1 ? '1 note' : `${g.events.length} notes`;
      const years = g.yearsAgo === 1 ? '1 year' : `${g.yearsAgo} years`;
      return `${notes} from ${years} ago`;
    })
    .join(', ');

  onMount(async () => {
    if (!browser) return;

    const pubkey = $userPublickey;
    if (!pubkey) return;

    if (isMemoriesCardDismissed(pubkey)) {
      dismissed = true;
      return;
    }

    try {
      const result = await getMemoriesCached($ndk, pubkey);
      // In-flight work is moot if the component unmounted or the user changed
      if (destroyed || $userPublickey !== pubkey) return;
      groups = result;
      loaded = true;
    } catch (error) {
      console.warn('[memories] Failed to load memories:', error);
    }
  });

  // No subscription is held open: fetchMemories' subscriptions self-terminate
  // on eose or a 10s timeout, and the destroyed flag discards late results,
  // so there is nothing to register with onRelaySwitchStopSubscriptions.
  onDestroy(() => {
    destroyed = true;
  });

  function dismiss() {
    if ($userPublickey) {
      dismissMemoriesCard($userPublickey);
    }
    dismissed = true;
  }
</script>

{#if loaded && !dismissed && nonEmptyGroups.length > 0}
  <div class="memories-card rounded-xl border mb-4 overflow-hidden">
    <!-- Banner (collapsed surface) -->
    <div class="flex items-center gap-2 px-4 py-3">
      <button
        on:click={() => (expanded = !expanded)}
        class="flex items-center gap-2 flex-1 min-w-0 text-left"
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse memories' : 'Expand memories'}
      >
        <span aria-hidden="true">📅</span>
        <span class="text-sm font-semibold" style="color: var(--color-text-primary);">
          On this day
        </span>
        <span class="text-xs truncate" style="color: var(--color-text-secondary);">
          {summary}
        </span>
        <span
          class="ml-auto flex-shrink-0 transition-transform duration-200"
          class:rotate-180={expanded}
          style="color: var(--color-text-secondary);"
        >
          <CaretDownIcon size={16} />
        </span>
      </button>
      <button
        on:click={dismiss}
        class="flex-shrink-0 p-1 rounded-full hover:opacity-70 transition-opacity"
        style="color: var(--color-text-secondary);"
        aria-label="Dismiss memories for today"
      >
        <XIcon size={16} />
      </button>
    </div>

    {#if expanded}
      <div class="px-4 pb-4 flex flex-col gap-4">
        {#each nonEmptyGroups as group (group.yearsAgo)}
          <div>
            <h3
              class="text-xs font-semibold uppercase tracking-wide mb-2"
              style="color: var(--color-text-secondary);"
            >
              {group.yearsAgo === 1 ? '1 year ago' : `${group.yearsAgo} years ago`}
            </h3>
            <div class="flex flex-col gap-2">
              {#each group.events as event (event.id)}
                <MemoryNoteCard {event} yearsAgo={group.yearsAgo} />
              {/each}
            </div>
          </div>
        {/each}
        <a
          href="/memories"
          class="text-sm font-medium text-orange-500 hover:text-orange-600 transition-colors"
        >
          See all memories →
        </a>
      </div>
    {/if}
  </div>
{/if}

<style>
  .memories-card {
    background-color: var(--color-bg-primary);
    border-color: var(--color-input-border);
  }
</style>
