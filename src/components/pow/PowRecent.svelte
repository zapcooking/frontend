<script lang="ts">
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { prefersReducedMotion } from '$lib/motion';
  import { formatCompactTime } from '$lib/utils';
  import { REPO_LABELS, displayTitle, recentShipped } from '$lib/shipped/viewModel';
  import type { PowPayload } from '$lib/shipped/types';

  export let summary: PowPayload;
  /** Re-render tick for relative times (bumped by the page each minute). */
  export let now = 0;

  $: items = recentShipped(summary, 10);
  // Only PRs that arrive after the page is up animate in: the hydration
  // render must not replay the intro for every item.
  let live = false;
  onMount(() => {
    live = true;
  });
  $: duration = live && !prefersReducedMotion() ? 450 : 0;

  function ago(mergedAt: string, _tick: number): string {
    const t = formatCompactTime(Math.floor(Date.parse(mergedAt) / 1000));
    return t === 'now' ? 'just now' : `${t} ago`;
  }
</script>

<section class="recent" aria-labelledby="pow-recent-title">
  <h2 id="pow-recent-title">Recently shipped</h2>
  {#if items.length}
    <ol aria-live="polite">
      {#each items as pr (pr.id)}
        <li in:fly={{ y: -12, duration }}>
          <a href={pr.url} target="_blank" rel="noopener noreferrer">{displayTitle(pr.title)}</a>
          <p class="meta">
            {REPO_LABELS[pr.repo]} · {pr.author ?? 'ghost'} · <time datetime={pr.mergedAt}>{ago(pr.mergedAt, now)}</time>
          </p>
        </li>
      {/each}
    </ol>
  {:else}
    <p class="empty">Nothing merged yet.</p>
  {/if}
</section>

<style>
  .recent {
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
    padding: 0.625rem 0;
    border-top: 1px solid var(--color-input-border);
  }
  li:first-child {
    border-top: 0;
  }
  a {
    font-weight: 600;
    color: var(--color-text-primary);
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  a:hover,
  a:focus-visible {
    color: var(--color-primary);
    text-decoration: underline;
  }
  .meta,
  .empty {
    margin-top: 0.125rem;
    font-size: 0.8125rem;
    color: var(--color-caption);
  }
</style>
