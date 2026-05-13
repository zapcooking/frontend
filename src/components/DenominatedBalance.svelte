<script lang="ts">
  import { displayCurrency, type CurrencyCode } from '$lib/currencyStore';
  import { convertSatsToFiat, formatFiatValue } from '$lib/currencyConversion';

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
    // Invalidate any in-flight fetch so it can't write back later.
    requestSeq++;
    fiatValue = null;
    fiatLoading = false;
  }

  function formatSatsValue(n: number): string {
    if (!compact) return n.toLocaleString();
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return n.toLocaleString();
  }
</script>

{#if !visible}
  ***
{:else if loading || sats === null}
  ...
{:else if $displayCurrency === 'SATS'}
  {formatSatsValue(sats)}
{:else if fiatValue !== null}
  {formatFiatValue(fiatValue)}
{:else if fiatLoading}
  ...
{:else}
  --
{/if}
