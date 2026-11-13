<script lang="ts">
  /**
   * Zap bolt + tally for a stream.
   *
   * The zap target is the HOST (the announcement's `p` tag marked `host`),
   * not the announcement's author — streams are usually published by a
   * service account. The zap request carries the `a` coordinate instead of
   * an event id, so receipts land with the `#a` tag every NIP-53 client
   * (zap.stream included) scans.
   */
  import { createEventDispatcher } from 'svelte';
  import { NDKUser } from '@nostr-dev-kit/ndk';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import ZapModal from '../ZapModal.svelte';

  export let address: string;
  export let hostPubkey: string;
  export let sats = 0;
  export let count = 0;
  export let loading = false;

  const dispatch = createEventDispatcher<{ zapComplete: { amount: number } }>();

  let zapOpen = false;

  $: hostUser = hostPubkey ? new NDKUser({ pubkey: hostPubkey }) : null;

  function compact(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
    return String(n);
  }

  function onComplete(e: CustomEvent<{ amount: number }>) {
    dispatch('zapComplete', { amount: e.detail.amount });
  }
</script>

<div class="flex items-center gap-1.5">
  {#if hostUser}
    <button
      type="button"
      class="flex items-center gap-1 rounded-full bg-amber-500/15 px-3 py-1.5 text-sm font-semibold text-amber-500 hover:bg-amber-500/25"
      on:click={() => (zapOpen = true)}
      aria-label="Zap this stream"
      title="Zap this stream"
    >
      <LightningIcon class="h-4 w-4" weight="fill" />
      Zap
    </button>

    {#if count > 0}
      <button
        type="button"
        class="text-sm font-semibold text-amber-500 tabular-nums {loading ? 'opacity-60' : ''}"
        on:click={() => (zapOpen = true)}
        title={'⚡ ' +
          sats.toLocaleString() +
          ' sats across ' +
          count.toLocaleString() +
          (count === 1 ? ' zap' : ' zaps')}
      >
        ⚡ {compact(sats)}
      </button>
    {/if}
  {/if}
</div>

{#if hostUser}
  <ZapModal
    bind:open={zapOpen}
    event={hostUser}
    addressTag={address}
    on:zap-complete={onComplete}
  />
{/if}
