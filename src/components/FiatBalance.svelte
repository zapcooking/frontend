<script lang="ts">
	import { onMount } from 'svelte';
	import { displayCurrency } from '$lib/currencyStore';
	import {
		convertSatsToFiat,
		formatFiatValue,
		conversionLoading,
		conversionError
	} from '$lib/currencyConversion';

	export let satoshis: number | null;
	export let visible: boolean = true;

	let fiatValue: number | null = null;

	// Update fiat value when satoshis or currency changes
	$: if (satoshis !== null && $displayCurrency !== 'SATS' && visible) {
		updateFiatValue(satoshis);
	}

	// Reset when currency changes to SATS
	$: if ($displayCurrency === 'SATS') {
		fiatValue = null;
	}

	async function updateFiatValue(sats: number) {
		fiatValue = await convertSatsToFiat(sats);
	}

	onMount(() => {
		if (satoshis !== null && $displayCurrency !== 'SATS') {
			updateFiatValue(satoshis);
		}
	});
</script>

{#if $displayCurrency !== 'SATS'}
	<div class="text-sm text-caption">
		{#if !visible}
			***
		{:else if $conversionLoading && fiatValue === null}
			...
		{:else if $conversionError && fiatValue === null}
			--
		{:else}
			{formatFiatValue(fiatValue)}
		{/if}
	</div>
{/if}
