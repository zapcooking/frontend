<script lang="ts">
  import { formatNumber } from '$lib/shipped/viewModel';
  import type { PowPayload } from '$lib/shipped/types';

  export let summary: PowPayload;

  $: humans = summary.contributors.filter((c) => c.kind === 'human');
  $: automation = summary.contributors.find((c) => c.kind === 'automation');
</script>

<section class="people" aria-labelledby="pow-people-title">
  <h2 id="pow-people-title">Contributors</h2>
  <ol>
    {#each humans as c (c.login)}
      <li>
        <span class="who">{c.login}</span>
        <span class="count">{formatNumber(c.prs)} {c.prs === 1 ? 'PR' : 'PRs'}</span>
        <span class="lines">+{formatNumber(c.countedAdditions)} / −{formatNumber(c.countedDeletions)}</span>
      </li>
    {/each}
    {#if automation}
      <li class="bots">
        <span class="who">Automation</span>
        <span class="count">{formatNumber(automation.prs)} {automation.prs === 1 ? 'PR' : 'PRs'}</span>
        <span class="lines">Copilot and Dependabot</span>
      </li>
    {/if}
  </ol>
</section>

<style>
  .people {
    background: var(--color-bg-secondary);
    border-radius: 12px;
    padding: 1.25rem;
  }
  h2 {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--color-text-primary);
    margin-bottom: 0.5rem;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas: 'who count' 'lines lines';
    padding: 0.5rem 0;
    border-top: 1px solid var(--color-input-border);
  }
  li:first-child {
    border-top: 0;
  }
  .who {
    grid-area: who;
    font-weight: 600;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
  }
  .count {
    grid-area: count;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-primary);
  }
  .lines {
    grid-area: lines;
    font-size: 0.8125rem;
    color: var(--color-caption);
  }
  .bots .who,
  .bots .count {
    color: var(--color-text-secondary);
    font-weight: 500;
  }
</style>
