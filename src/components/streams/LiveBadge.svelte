<script lang="ts">
  /** A small LIVE pill shown beside a name while the pubkey is streaming. */
  import { onDestroy } from 'svelte';
  import { watchLiveNow, liveNowStore } from '$lib/streams/liveNow';
  import { streamAddress, naddrEncode } from '$lib/streams/parse';

  export let pubkey: string;
  export let linked = true;

  let unwatch: (() => void) | null = null;
  let watched: string | null = null;
  $: if (pubkey !== watched) {
    unwatch?.();
    unwatch = null;
    watched = pubkey || null;
    if (pubkey) unwatch = watchLiveNow(pubkey);
  }
  onDestroy(() => {
    unwatch?.();
    unwatch = null;
  });

  $: liveItem = pubkey ? $liveNowStore.get(pubkey) || null : null;
  $: naddr = liveItem
    ? (() => {
        const address = streamAddress(liveItem);
        try {
          return address ? naddrEncode(address) : null;
        } catch {
          return null;
        }
      })()
    : null;
</script>

{#if liveItem}
  {#if linked && naddr}
    <a
      href="/live/{naddr}"
      class="inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-red-500"
      title="Live now — watch"
      aria-label="Live now — watch stream"
    >
      <span class="h-1.5 w-1.5 rounded-full bg-white animate-pulse" aria-hidden="true"></span>
      Live
    </a>
  {:else}
    <span
      class="inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
      title="Live now"
    >
      <span class="h-1.5 w-1.5 rounded-full bg-white animate-pulse" aria-hidden="true"></span>
      Live
    </span>
  {/if}
{/if}
