<script lang="ts">
  import { displayCurrency } from '$lib/currencyStore';
  import { convertSatsToFiat, formatFiatValue } from '$lib/currencyConversion';

  export let sats: number | null;
  export let visible: boolean = true;
  export let loading: boolean = false;
  /** When true, large sats values are abbreviated (1.2k / 3.4M). */
  export let compact: boolean = true;

  let fiatValue: number | null = null;
  let lastFetchedSats: number | null = null;
  let lastFetchedCurrency: string = '';
  let fiatLoading = false;

  // Re-fetch fiat only when sats, currency, or visibility actually change to
  // an active fiat view. Compares against last-fetched to avoid request
  // storms from unrelated parent reactivity.
  $: if (
    visible &&
    sats !== null &&
    $displayCurrency !== 'SATS' &&
    (sats !== lastFetchedSats || $displayCurrency !== lastFetchedCurrency)
  ) {
    lastFetchedSats = sats;
    lastFetchedCurrency = $displayCurrency;
    fiatLoading = true;
    convertSatsToFiat(sats).then((v) => {
      // Drop stale results if currency switched mid-flight.
      if ($displayCurrency === lastFetchedCurrency) {
        fiatValue = v;
        fiatLoading = false;
      }
    });
  }

  $: if ($displayCurrency === 'SATS') {
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
