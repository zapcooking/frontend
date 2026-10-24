<script lang="ts">
  import { facts, formatDay, formatMonth, formatNumber } from '$lib/shipped/viewModel';
  import type { PowPayload } from '$lib/shipped/types';

  export let summary: PowPayload;
  /** complete:false — these are running numbers, not final ones. */
  export let counting = false;

  $: f = facts(summary);
  const days = (n: number) => `${formatNumber(n)} ${n === 1 ? 'day' : 'days'}`;
  const prs = (n: number) => `${formatNumber(n)} ${n === 1 ? 'PR' : 'PRs'}`;
</script>

<section aria-labelledby="pow-facts-title">
  <h2 id="pow-facts-title" class="sr-only">Highlights</h2>
  <dl class="facts" class:counting>
    <div class="fact">
      <dt>Hottest day</dt>
      <dd>
        {#if f.hottestDay}
          <strong>{prs(f.hottestDay.count)}</strong>
          <span>{formatDay(f.hottestDay.date)}</span>
        {:else}<strong>—</strong>{/if}
      </dd>
    </div>
    <div class="fact">
      <dt>Current streak</dt>
      <dd><strong>{days(f.currentStreak)}</strong><span>in a row with a merge</span></dd>
    </div>
    <div class="fact">
      <dt>Longest streak</dt>
      <dd>
        <strong>{days(f.longestStreak)}</strong>
        {#if f.longestStart && f.longestEnd}
          <span>{formatDay(f.longestStart)} – {formatDay(f.longestEnd)}</span>
        {/if}
      </dd>
    </div>
    <div class="fact">
      <dt>Busiest weekday</dt>
      <dd>
        {#if f.busiestWeekday}
          <strong>{f.busiestWeekday.name}</strong><span>{prs(f.busiestWeekday.count)} all year</span>
        {:else}<strong>—</strong>{/if}
      </dd>
    </div>
    <div class="fact">
      <dt>Biggest month</dt>
      <dd>
        {#if f.biggestMonth}
          <strong>{formatMonth(f.biggestMonth.month)}</strong><span>{prs(f.biggestMonth.prs)}</span>
        {:else}<strong>—</strong>{/if}
      </dd>
    </div>
  </dl>
</section>

<style>
  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 0.75rem;
  }
  .fact {
    background: var(--color-bg-secondary);
    border-radius: 12px;
    padding: 1rem;
  }
  dt {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-caption);
  }
  dd {
    margin-top: 0.375rem;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  strong {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--color-text-primary);
  }
  .counting strong {
    color: var(--color-text-secondary);
  }
  dd span {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }
</style>
