<script lang="ts">
  import { onMount } from 'svelte';
  import { prefersReducedMotion } from '$lib/motion';
  import { displayCurrency, type CurrencyCode } from '$lib/currencyStore';
  import {
    convertSatsToFiat,
    formatFiatValue,
    formatFiatValueCompact
  } from '$lib/currencyConversion';

  export let sats: number | null;
  export let visible: boolean = true;
  export let loading: boolean = false;
  /** When true, large sats values are abbreviated (1.2k / 3.4M). */
  export let compact: boolean = true;

  let fiatValue: number | null = null;
  let lastFetchedSats: number | null = null;
  let lastFetchedCurrency: CurrencyCode | '' = '';
  // Monotonic request id — every fetch increments. Only the most
  // recent request is allowed to write `fiatValue` / `fiatLoading`,
  // so an older promise that resolves after the user switched
  // currency or amount can't clobber the latest state.
  let requestSeq = 0;
  let fiatLoading = false;

  $: if (
    visible &&
    sats !== null &&
    $displayCurrency !== 'SATS' &&
    (sats !== lastFetchedSats || $displayCurrency !== lastFetchedCurrency)
  ) {
    lastFetchedSats = sats;
    lastFetchedCurrency = $displayCurrency;
    // Clear any stale value from a previous currency/amount so we don't
    // briefly render the old fiat under a new label while the fetch
    // resolves. Cached values for SATS round-trips are preserved by
    // *not* clearing in the SATS branch below.
    fiatValue = null;
    const mySeq = ++requestSeq;
    const requestedCurrency = $displayCurrency;
    const requestedSats = sats;
    fiatLoading = true;
    // Pass the requested currency explicitly so the conversion uses
    // it (not whatever the store now points to), and compare against
    // the monotonic seq to discard stale results.
    convertSatsToFiat(requestedSats, requestedCurrency).then((v) => {
      if (mySeq === requestSeq) {
        fiatValue = v;
        fiatLoading = false;
      }
    });
  }

  $: if ($displayCurrency === 'SATS') {
    // Invalidate any in-flight fetch so it can't write back later, and
    // drop the loading flag. fiatValue is intentionally preserved so a
    // SATS → fiat round-trip with unchanged sats/currency renders the
    // cached value instead of falling through to "--" (the dedup gate
    // above would otherwise skip the re-fetch).
    requestSeq++;
    fiatLoading = false;
  }

  function formatSatsValue(n: number): string {
    if (!compact) return n.toLocaleString();
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return n.toLocaleString();
  }

  // ── Balance text swap (transitions.dev text-states-swap recipe) ────
  // Old value exits up with blur, new one enters from below, 150ms. The
  // wrapper is an inline-grid with every state on the same cell so the
  // overlapping outro/intro never shifts layout. The first render skips
  // the animation — a page-load pop on every mount would be noise.
  $: swapText = !visible
    ? '***'
    : loading || sats === null
      ? '...'
      : $displayCurrency === 'SATS'
        ? formatSatsValue(sats!)
        : fiatValue !== null
          ? compact
            ? formatFiatValueCompact(fiatValue)
            : formatFiatValue(fiatValue)
          : fiatLoading
            ? '...'
            : '--';
  $: swapKey = `${visible}|${loading}|${sats}|${fiatValue}|${fiatLoading}|${$displayCurrency}|${compact}`;

  let mounted = false;
  onMount(() => {
    mounted = true;
  });

  const swapReducedMotion = prefersReducedMotion();
  const swapInCss = (t: number) =>
    `opacity: ${t}; transform: translateY(${(1 - t) * 4}px); filter: blur(${(1 - t) * 2}px);`;
  const swapOutCss = (t: number) =>
    `opacity: ${t}; transform: translateY(${(1 - t) * -4}px); filter: blur(${(1 - t) * 2}px);`;
  const swapIn = (node: Element) => {
    (node as HTMLElement).style.willChange = 'transform, filter, opacity';
    return {
      duration: !mounted || swapReducedMotion ? 0 : 150,
      css: swapInCss
    };
  };
  const swapOut = (node: Element) => {
    (node as HTMLElement).style.willChange = 'transform, filter, opacity';
    return {
      duration: !mounted || swapReducedMotion ? 0 : 150,
      css: swapOutCss
    };
  };
</script>

<span class="balance-swap">
  {#key swapKey}
    <span class="balance-swap-item" in:swapIn out:swapOut>{swapText}</span>
  {/key}
</span>

<style>
  .balance-swap {
    display: inline-grid;
  }
  .balance-swap-item {
    grid-area: 1 / 1;
    display: inline-block;
  }
</style>
