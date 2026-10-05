<script lang="ts">
  /**
   * The topic chip row under the /feed tabs on Fresh: All, the featured
   * topics, a few busy groups, More ($lib/freshFeed/topicChips). Tapping a
   * chip filters Fresh in place; the active one is highlighted. Topic feeds
   * are for members: for everyone else the chips show a small lock and
   * open the membership card (nothing is requested from the relay).
   */
  import { createEventDispatcher } from 'svelte';
  import LockIcon from 'phosphor-svelte/lib/LockSimple';
  import type { TopicChip } from '$lib/freshFeed/topicChips';

  export let chips: TopicChip[] = [];
  /** The open topic's slug; '' = All. */
  export let active = '';
  export let locked = false;

  const dispatch = createEventDispatcher<{ pick: TopicChip; more: void }>();

  function tap(chip: TopicChip) {
    if (chip.kind === 'more') dispatch('more');
    else dispatch('pick', chip);
  }
</script>

<div
  class="flex gap-2 overflow-x-auto flex-nowrap scrollbar-hide -mx-4 px-4 mb-4"
  role="tablist"
  aria-label="Topics"
>
  {#each chips as chip (chip.kind + chip.slug)}
    {@const selected = chip.kind !== 'more' && chip.slug === active}
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      class="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors
        {selected ? 'bg-primary text-white' : 'hover:bg-accent-gray'}"
      style={selected
        ? ''
        : 'color: var(--color-text-primary); background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);'}
      on:click={() => tap(chip)}
    >
      {chip.label}
      {#if locked && chip.slug && chip.kind !== 'more'}
        <LockIcon size={11} weight="bold" class="opacity-60" aria-label="Members" />
      {/if}
    </button>
  {/each}
</div>
