<script lang="ts">
  /**
   * The topic chip row under the /feed tabs on Fresh: All, the featured
   * topics, a few busy groups, More ($lib/freshFeed/topicChips). Tapping a
   * chip filters Fresh in place; the active one is highlighted and scrolled
   * into view. Topic feeds are for members: for everyone else the chips
   * show a small lock and open the membership card (nothing is requested
   * from the relay).
   *
   * One line that scrolls sideways with touch (momentum on iOS), no
   * scrollbar, a fade at the right edge while more chips are off-screen.
   * touch-action allows both pans on the row itself: iOS intersects
   * touch-action with ancestors (PullToRefresh and <body> are pan-y), which
   * otherwise disables horizontal panning; vertical page scroll still works
   * from a drag that starts on the row.
   */
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import LockIcon from 'phosphor-svelte/lib/LockSimple';
  import type { TopicChip } from '$lib/freshFeed/topicChips';

  export let chips: TopicChip[] = [];
  /** The open topic's slug; '' = All. */
  export let active = '';
  export let locked = false;

  const dispatch = createEventDispatcher<{ pick: TopicChip; more: void }>();

  let row: HTMLDivElement;
  let atEnd = true;

  function tap(chip: TopicChip) {
    if (chip.kind === 'more') dispatch('more');
    else dispatch('pick', chip);
  }

  function updateFade() {
    if (!row) return;
    atEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - 4;
  }

  /** Bring the selected chip into view (centred when possible), sideways only. */
  async function revealActive(smooth: boolean) {
    await tick();
    const el = row?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!row || !el) return;
    const target = el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2;
    row.scrollTo({ left: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
  }

  $: if (row) {
    void active;
    revealActive(true);
  }
  $: if (row) {
    void chips;
    tick().then(updateFade);
  }

  onMount(() => {
    revealActive(false);
    updateFade();
  });
</script>

<div class="chip-row-wrap relative mb-4 -mx-4">
  <div
    bind:this={row}
    on:scroll={updateFade}
    class="chip-row flex gap-2 px-4"
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
  {#if !atEnd}
    <div class="chip-fade" aria-hidden="true"></div>
  {/if}
</div>

<style>
  .chip-row {
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
    touch-action: pan-x pan-y;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .chip-row::-webkit-scrollbar {
    display: none;
  }
  .chip-fade {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 2.5rem;
    pointer-events: none;
    background: linear-gradient(to right, transparent, var(--color-bg-primary));
  }
</style>
