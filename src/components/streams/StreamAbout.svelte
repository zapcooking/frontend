<script lang="ts">
  /** About panel for a stream: summary, start time, categories, runtime. */
  import { runtime } from '$lib/streams/parse';
  import { formatDistanceToNowStrict, format } from 'date-fns';
  import type { StreamItem } from '$lib/streams/types';

  export let item: StreamItem;

  $: started = item.starts ? new Date(item.starts * 1000) : null;
  $: running = item.status !== 'ended' ? runtime(item.starts) : null;

  function runtimeText(r: { days: number; hours: number; minutes: number } | null): string {
    if (!r) return '';
    if (r.days) return `Live for ${r.days} ${r.days === 1 ? 'day' : 'days'}`;
    if (r.hours) return `Live for ${r.hours}h ${r.minutes}m`;
    return `Live for ${r.minutes} ${r.minutes === 1 ? 'minute' : 'minutes'}`;
  }
</script>

<section
  class="rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900"
>
  {#if item.summary}
    <p class="whitespace-pre-wrap leading-relaxed" dir="auto">{item.summary}</p>
  {:else}
    <p class="text-zinc-500">No stream description available.</p>
  {/if}

  {#if started}
    <p class="mt-3 text-xs text-zinc-500">
      {item.status === 'planned'
        ? `Starts ${formatDistanceToNowStrict(started, { addSuffix: true })} · ${format(started, 'EEE, MMM d, HH:mm')}`
        : `Started ${format(started, 'EEE, MMM d, HH:mm')}`}
      {#if running}&nbsp;· {runtimeText(running)}{/if}
    </p>
  {/if}

  {#if item.categories.length}
    <p class="mt-2 flex flex-wrap gap-1.5">
      {#each [...new Set(item.categories)] as category (category)}
        <span
          class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
        >
          #{category}
        </span>
      {/each}
    </p>
  {/if}
</section>
