<script lang="ts">
  /**
   * Avatar with a live indicator: a red ring and a pulsing dot when the
   * pubkey is live right now (NIP-53). With `linked`, the dot opens the
   * stream; indicator-only when a parent control owns clicks (a lightbox
   * or a QR modal under the avatar). `dot={false}` keeps just the ring, for
   * a page that puts a bigger, tappable LiveBadge pill beside the avatar.
   */
  import Avatar from '../Avatar.svelte';
  import { watchLiveNow, liveNowStore } from '$lib/streams/liveNow';
  import { streamAddress, naddrEncode } from '$lib/streams/parse';
  import { onDestroy } from 'svelte';

  export let pubkey: string;
  export let src: string | null = null;
  export let alt: string = 'Avatar';
  export let size: number = 40;
  export let linked = true;
  export let dot = true;
  export let interactive = true;
  export let className: string = '';

  let unwatch: (() => void) | null = null;
  let watched: string | null = null;
  // Re-subscribe whenever the pubkey changes — including nonempty →
  // nonempty — so a reused avatar never keeps polling a previous host.
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

<span class="relative inline-block shrink-0" style="width:{size}px;height:{size}px">
  <Avatar {pubkey} {src} {alt} {size} {interactive} {className} on:click on:load on:fallback />
  {#if liveItem}
    <span
      class="pointer-events-none absolute inset-0 rounded-full ring-2 ring-red-500"
      aria-hidden="true"
    ></span>
    {#if !dot}
      <!-- ring only -->
    {:else if linked && naddr}
      <a
        href="/live/{naddr}"
        class="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 ring-2 ring-white dark:ring-zinc-900 transition-transform hover:scale-110"
        title="Live now — watch"
        aria-label="Live now — watch stream"
      >
        <span class="h-1.5 w-1.5 rounded-full bg-white animate-pulse"></span>
      </a>
    {:else}
      <span
        class="pointer-events-none absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 ring-2 ring-white dark:ring-zinc-900"
        title="Live now"
      >
        <span class="h-1.5 w-1.5 rounded-full bg-white animate-pulse"></span>
      </span>
    {/if}
  {/if}
</span>
