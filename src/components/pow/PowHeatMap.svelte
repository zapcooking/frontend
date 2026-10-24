<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    FILTERS,
    REPO_LABELS,
    formatDay,
    formatNumber,
    heatCells,
    type HeatCell,
    type RepoFilter
  } from '$lib/shipped/viewModel';
  import { REPOS } from '$lib/shipped/config';
  import type { PowPayload } from '$lib/shipped/types';

  export let summary: PowPayload;
  /** Today's calendar date in the summary's zone. */
  export let today: string;
  /** Dates whose count just went up (live update): they warm up once. */
  export let warmDates: Set<string> = new Set();

  let filter: RepoFilter = 'all';
  let scroller: HTMLDivElement;
  let focusedIndex = -1;
  let hoverIndex = -1;

  $: grid = heatCells(summary, today, filter);
  $: activeIndex = focusedIndex >= 0 ? focusedIndex : grid.cells.length - 1;
  $: tipIndex = hoverIndex >= 0 ? hoverIndex : focusedIndex;
  $: tip = tipIndex >= 0 ? grid.cells[tipIndex] : null;
  $: tzLabel = summary.tz === 'America/New_York' ? 'Eastern Time' : summary.tz;

  // Month labels over the first column that contains the 1st of the month.
  $: months = grid.cells
    .filter((c) => c.date.endsWith('-01'))
    .map((c) => ({
      week: c.week,
      label: new Date(`${c.date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
    }));

  function describe(c: HeatCell): string {
    const parts = REPOS.filter((r) => c.byRepo[r] > 0).map((r) => `${REPO_LABELS[r]} ${c.byRepo[r]}`);
    const total = REPOS.reduce((n, r) => n + c.byRepo[r], 0);
    const noun = total === 1 ? 'pull request' : 'pull requests';
    return `${formatDay(c.date)}: ${total === 0 ? 'no' : formatNumber(total)} ${noun} merged${
      parts.length ? ` (${parts.join(', ')})` : ''
    }`;
  }

  async function onKey(e: KeyboardEvent) {
    const moves: Record<string, number> = {
      ArrowUp: -1,
      ArrowDown: 1,
      ArrowLeft: -7,
      ArrowRight: 7,
      Home: -Infinity,
      End: Infinity
    };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const from = activeIndex;
    const step = moves[e.key];
    const next =
      step === -Infinity ? 0 : step === Infinity ? grid.cells.length - 1 : from + step;
    if (next < 0 || next >= grid.cells.length) return;
    focusedIndex = next;
    await tick();
    scroller?.querySelector<HTMLButtonElement>(`[data-index="${next}"]`)?.focus();
  }

  onMount(() => {
    // Small screens: open scrolled to today.
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  });
</script>

<section class="pow-heat" aria-labelledby="pow-heat-title">
  <div class="heat-head">
    <h2 id="pow-heat-title">Every day, every merge</h2>
    <div class="filters" role="group" aria-label="Filter by app">
      {#each FILTERS as f (f.value)}
        <button
          type="button"
          class="filter"
          class:selected={filter === f.value}
          aria-pressed={filter === f.value}
          on:click={() => (filter = f.value)}>{f.label}</button
        >
      {/each}
    </div>
  </div>

  <div class="heat-scroll" bind:this={scroller}>
    <div class="heat-inner" style="--weeks: {grid.weeks}">
      <div class="month-row" aria-hidden="true">
        {#each months as m (m.week)}
          <span style="grid-column: {m.week + 1}">{m.label}</span>
        {/each}
      </div>
      <div class="heat-body">
        <div class="weekday-col" aria-hidden="true">
          <span style="grid-row: 2">Mon</span>
          <span style="grid-row: 4">Wed</span>
          <span style="grid-row: 6">Fri</span>
        </div>
        <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
        <div
          class="cells"
          role="group"
          aria-label="Pull requests merged per day. Arrow keys move between days."
          on:keydown={onKey}
          on:mouseleave={() => (hoverIndex = -1)}
        >
          {#each grid.cells as c, i (c.date)}
            <button
              type="button"
              class="cell level-{c.level}"
              class:today={c.date === today}
              class:warm={warmDates.has(c.date)}
              style="grid-column: {c.week + 1}; grid-row: {c.weekday + 1}"
              data-index={i}
              tabindex={i === activeIndex ? 0 : -1}
              aria-label={describe(c)}
              on:focus={() => (focusedIndex = i)}
              on:blur={() => (focusedIndex = focusedIndex === i ? -1 : focusedIndex)}
              on:mouseenter={() => (hoverIndex = i)}
            />
          {/each}
        </div>
      </div>
    </div>
  </div>

  <div class="heat-foot">
    <p class="tip" aria-hidden="true">{tip ? describe(tip) : ' '}</p>
    <div class="legend" aria-hidden="true">
      <span>Less</span>
      {#each [0, 1, 2, 3, 4] as l}<span class="cell level-{l}" />{/each}
      <span>More</span>
    </div>
  </div>
  <p class="tz">Days are counted in {tzLabel}.</p>
</section>

<style>
  .pow-heat {
    background: var(--color-bg-secondary);
    border-radius: 12px;
    padding: 1.25rem;
  }
  .heat-head {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }
  h2 {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--color-text-primary);
  }
  .filters {
    display: flex;
    gap: 0.375rem;
    flex-wrap: wrap;
  }
  /* The site's Pill, minus its md-only horizontal padding (which clips
     labels on phones). */
  .filter {
    padding: 0.375rem 0.875rem;
    border-radius: 999px;
    font-size: 0.875rem;
    font-weight: 600;
    background: var(--color-input-bg);
    color: var(--color-text-primary);
  }
  .filter.selected {
    background: var(--color-accent-gray);
  }
  .filter:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  .heat-scroll {
    overflow-x: auto;
    padding-bottom: 0.25rem;
    scrollbar-width: thin;
  }
  .heat-inner {
    --cell: 12px;
    --gap: 3px;
    width: max-content;
  }
  .month-row {
    display: grid;
    grid-template-columns: repeat(var(--weeks), var(--cell));
    column-gap: var(--gap);
    margin-left: calc(2rem + var(--gap));
    font-size: 0.6875rem;
    color: var(--color-caption);
    height: 1rem;
  }
  .month-row span {
    white-space: nowrap;
  }
  .heat-body {
    display: flex;
    gap: var(--gap);
  }
  .weekday-col {
    position: sticky;
    left: 0;
    z-index: 1;
    background: var(--color-bg-secondary);
    display: grid;
    grid-template-rows: repeat(7, var(--cell));
    row-gap: var(--gap);
    width: 2rem;
    font-size: 0.6875rem;
    line-height: var(--cell);
    color: var(--color-caption);
  }
  .cells {
    display: grid;
    grid-template-columns: repeat(var(--weeks), var(--cell));
    grid-template-rows: repeat(7, var(--cell));
    gap: var(--gap);
  }
  .cell {
    display: block;
    width: var(--cell);
    height: var(--cell);
    border-radius: 3px;
    padding: 0;
    border: 0;
    cursor: default;
    transition: background-color 600ms ease;
  }
  .level-0 {
    background: var(--color-card-sunken);
  }
  .level-1 {
    background: color-mix(in srgb, var(--color-primary) 28%, var(--color-card-sunken));
  }
  .level-2 {
    background: color-mix(in srgb, var(--color-primary) 50%, var(--color-card-sunken));
  }
  .level-3 {
    background: color-mix(in srgb, var(--color-primary) 75%, var(--color-card-sunken));
  }
  .level-4 {
    background: var(--color-primary);
  }
  .cell.today {
    outline: 1px solid var(--color-text-secondary);
    outline-offset: 1px;
  }
  .cell:focus-visible {
    outline: 2px solid var(--color-text-primary);
    outline-offset: 1px;
  }
  .cell.warm {
    animation: warm 1.6s ease-out 1;
  }
  @keyframes warm {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-primary) 70%, transparent);
    }
    100% {
      box-shadow: 0 0 0 8px transparent;
    }
  }
  .heat-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-top: 0.75rem;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }
  .tip {
    min-height: 1.25rem;
  }
  .legend {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 0.75rem;
    color: var(--color-caption);
  }
  .legend .cell {
    width: 10px;
    height: 10px;
  }
  .legend span:first-child {
    margin-right: 0.25rem;
  }
  .legend span:last-child {
    margin-left: 0.25rem;
  }
  .tz {
    margin-top: 0.25rem;
    font-size: 0.75rem;
    color: var(--color-caption);
  }
  @media (prefers-reduced-motion: reduce) {
    .cell {
      transition: none;
    }
    .cell.warm {
      animation: none;
    }
  }
</style>
