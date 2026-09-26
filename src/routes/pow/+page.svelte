<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { formatDistanceToNow } from 'date-fns';
  import PowHeatMap from '../../components/pow/PowHeatMap.svelte';
  import PowFacts from '../../components/pow/PowFacts.svelte';
  import PowMonthly from '../../components/pow/PowMonthly.svelte';
  import PowRecent from '../../components/pow/PowRecent.svelte';
  import PowContributors from '../../components/pow/PowContributors.svelte';
  import PowZapButton from '../../components/pow/PowZapButton.svelte';
  import { createHeadPoller } from '$lib/shipped/poller';
  import { zonedDate } from '$lib/shipped/rollup';
  import { REPOS } from '$lib/shipped/config';
  import { pageState, summarySentence, type PageData } from '$lib/shipped/viewModel';
  import type { PowPayload } from '$lib/shipped/types';

  // Static (Capacitor) builds have no server load; they fetch on the client.
  export let data: Partial<PageData> & Record<string, unknown>;

  let summary: PowPayload | null = data.state === 'ok' ? (data as { summary: PowPayload }).summary : null;
  let serverState = typeof data.state === 'string' ? data.state : null;
  let mounted = false;
  let now = Date.now();
  let warmDates = new Set<string>();

  $: view = pageState(
    summary ? { state: 'ok', summary } : { state: serverState === 'unconfigured' ? 'unconfigured' : 'unavailable' }
  );
  $: today = zonedDate(new Date(now));

  // Server render: an absolute time (no clock drift between server and
  // browser). After mount: relative, refreshed every minute.
  function updatedLabel(iso: string, isMounted: boolean, _now: number): string {
    return isMounted
      ? formatDistanceToNow(new Date(iso), { addSuffix: true })
      : new Date(iso).toLocaleString('en-US', {
          timeZone: 'America/New_York',
          dateStyle: 'medium',
          timeStyle: 'short'
        }) + ' ET';
  }

  function applyUpdate(next: PowPayload) {
    if (summary) {
      // Days whose count went up warm once in the heat map.
      const warmed = new Set<string>();
      for (const [date, entry] of Object.entries(next.daily)) {
        const before = summary.daily[date];
        const sum = (e: typeof entry | undefined) => REPOS.reduce((n, r) => n + (e?.[r] ?? 0), 0);
        if (sum(entry) > sum(before)) warmed.add(date);
      }
      warmDates = warmed;
      setTimeout(() => (warmDates = new Set()), 2000);
    }
    summary = next;
  }

  let poller: ReturnType<typeof createHeadPoller> | null = null;
  let clock: ReturnType<typeof setInterval> | undefined;

  onMount(async () => {
    mounted = true;
    clock = setInterval(() => (now = Date.now()), 60_000);

    if (!summary && serverState === null) {
      // No server load ran (static build): one client fetch, else stay empty.
      try {
        const res = await fetch('/api/pow');
        if (res.ok) summary = (await res.json()) as PowPayload;
      } catch {
        // calm empty state
      }
    }
    if (summary) {
      poller = createHeadPoller({ version: summary.dataVersion, onSummary: applyUpdate });
      poller.start();
    }
  });

  onDestroy(() => {
    poller?.stop();
    if (clock) clearInterval(clock);
  });
</script>

<svelte:head>
  <title>Proof of Work - zap.cooking</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="pow-page">
  <header class="pow-header">
    <div class="title-row">
      <h1>Proof of Work</h1>
      {#if view.kind === 'ok'}<PowZapButton />{/if}
    </div>

    {#if summary && view.kind === 'ok'}
      <p class="sentence">
        {#if view.counting}<span class="counting-badge">Still counting…</span>{/if}
        {summarySentence(summary)}
      </p>
      <p class="footnote">Excludes lockfiles, images, and generated files.</p>
      <p class="updated">
        Last updated <time datetime={summary.lastSuccessAt}>{updatedLabel(summary.lastSuccessAt, mounted, now)}</time>
      </p>
    {/if}
  </header>

  {#if summary && view.kind === 'ok'}
    <div class="sections" class:counting={view.counting}>
      <PowHeatMap {summary} {today} {warmDates} />
      <PowFacts {summary} counting={view.counting} />
      <div class="two-col">
        <PowRecent {summary} {now} />
        <PowContributors {summary} />
      </div>
      <PowMonthly {summary} />
    </div>
  {:else}
    <div class="empty">
      <p class="empty-title">Nothing to show just yet.</p>
      <p>The shipping log is warming up. Check back in a little while.</p>
    </div>
  {/if}
</div>

<style>
  .pow-page {
    max-width: 1100px;
    margin: 0 auto;
    padding: 1.5rem 0 3rem;
  }
  .pow-header {
    margin-bottom: 1.5rem;
  }
  .title-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }
  h1 {
    font-size: 2rem;
    font-weight: 700;
    color: var(--color-text-primary);
  }
  .sentence {
    margin-top: 0.5rem;
    font-size: 1.0625rem;
    color: var(--color-text-primary);
  }
  .counting-badge {
    display: inline-block;
    margin-right: 0.375rem;
    padding: 0.0625rem 0.5rem;
    border-radius: 999px;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-text-secondary);
    border: 1px dashed var(--color-accent-gray);
  }
  .footnote,
  .updated {
    margin-top: 0.25rem;
    font-size: 0.8125rem;
    color: var(--color-caption);
  }
  .sections {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .two-col {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    gap: 1rem;
    align-items: start;
  }
  @media (max-width: 768px) {
    .two-col {
      grid-template-columns: minmax(0, 1fr);
    }
    h1 {
      font-size: 1.625rem;
    }
  }
  .empty {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--color-text-secondary);
  }
  .empty-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-text-primary);
    margin-bottom: 0.25rem;
  }
</style>
