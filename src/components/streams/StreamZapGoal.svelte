<script lang="ts">
  /**
   * NIP-75 zap goal for the stream: the announcement's `goal` tag names a
   * kind 9041 event whose `amount` tag is the target in millisats. The
   * raised figure is the stream's verified zap total, so the goal bar and
   * the zap tally always agree. Renders nothing until the goal event
   * arrives (a wrong or gone goal id shows no bar rather than an error).
   */
  import { onDestroy, onMount } from 'svelte';
  import type { SimplePool } from 'nostr-tools/pool';
  import { DISCOVERY_RELAYS } from '$lib/streams/relays';

  export let goalId: string;
  export let pool: SimplePool;
  /** The announcement's relay hints, so the goal is read where it lives. */
  export let relays: string[] = [];
  /** The stream's verified zap total, in sats. */
  export let raised = 0;

  let title = '';
  let goalSats: number | null = null;
  let goalZapSats = 0;
  let close: (() => void) | null = null;

  onMount(() => {
    const goalRelays = [...new Set([...DISCOVERY_RELAYS, ...relays])];
    const sub = pool.subscribeMany(
      goalRelays,
      { kinds: [9041], ids: [goalId] } as never,
      {
        onevent: (event: unknown) => {
          const e = event as { content: string; tags: string[][] };
          if (!Array.isArray(e.tags)) return;
          const amount = e.tags.find((t) => Array.isArray(t) && t[0] === 'amount')?.[1];
          const msat = /^\d+$/.test(amount || '') ? Number(amount) : 0;
          if (msat <= 0) return;
          goalSats = Math.round(msat / 1000);
          title = String(e.content || '').trim().slice(0, 140);
        }
      } as never
    );
    // NIP-75 zap receipts can target the goal event itself; count those
    // toward progress on top of the stream's zap total.
    const zapSub = pool.subscribeMany(
      goalRelays,
      { kinds: [9735], '#e': [goalId] } as never,
      {
        onevent: (event: unknown) => {
          const e = event as { tags: string[][] };
          if (!Array.isArray(e.tags)) return;
          const amount = e.tags.find((t) => Array.isArray(t) && t[0] === 'amount')?.[1];
          const msat = /^\d+$/.test(amount || '') ? Number(amount) : 0;
          if (msat > 0) goalZapSats += Math.round(msat / 1000);
        }
      } as never
    );
    close = () => {
      sub.close();
      zapSub.close();
    };
  });
  onDestroy(() => close?.());

  $: raisedTotal = raised + goalZapSats;
  $: pct = goalSats ? Math.min(100, Math.round((raisedTotal / goalSats) * 100)) : 0;
  function compact(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
    return String(n);
  }
</script>

{#if goalSats}
  <div
    class="zap-goal rounded-lg border px-3 py-2"
    style="border-color: var(--color-input-border); background-color: var(--color-bg-primary);"
    role="group"
    aria-label="Zap goal"
  >
    <p class="truncate text-xs font-medium" style="color: var(--color-text-primary);" title={title}>
      {title || 'Zap goal'}
    </p>
    <div
      class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full"
      style="background-color: var(--color-input-border);"
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax={goalSats}
      aria-valuenow={raisedTotal}
      aria-label="Goal progress"
    >
      <div
        class="h-full rounded-full transition-[width] duration-500"
        style="width: {pct}%; background-color: var(--color-primary);"
      />
    </div>
    <p class="mt-1 flex items-center justify-between text-xs tabular-nums" style="color: var(--color-caption);">
      <span class="font-semibold text-amber-500">⚡ {compact(raisedTotal)}</span>
      <span>{pct}% of {compact(goalSats)} sats</span>
    </p>
  </div>
{/if}
