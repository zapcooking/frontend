<script lang="ts">
	/**
	 * PriceDisplay — Reusable price display component.
	 *
	 * Sats is always the primary (top-line) price.
	 * USD is always shown as the secondary line for consistency.
	 * - Fiat-priced products: convert to sats (primary), show original fiat (secondary)
	 * - SATS-priced products: show sats (primary), convert to USD (secondary)
	 */
	import LightningIcon from 'phosphor-svelte/lib/Lightning';
	import type { CurrencyCode } from '$lib/currencyStore';
	import { formatPrice, formatSats, convertToSats, convertSatsToFiat } from '$lib/currencyConversion';

	export let price: number;
	export let currency: CurrencyCode;
	/** 'xs' for inline/compact, 'sm' for product cards, 'lg' for detail modal */
	export let size: 'xs' | 'sm' | 'lg' = 'sm';

	let satsAmount: number | null = null;
	let fiatDisplay: string | null = null;
	let loading = false;
	let requestId = 0;

	$: {
		// Bump request ID on every price/currency change to discard stale results
		const thisRequest = ++requestId;

		if (price > 0 && currency === 'SATS') {
			// SATS-priced: sats is known, convert to USD for secondary line
			satsAmount = Math.round(price);
			loading = false;
			convertSatsToFiat(Math.round(price), 'USD').then((usdValue) => {
				if (thisRequest !== requestId) return;
				if (usdValue !== null) {
					fiatDisplay = `$${usdValue < 0.01 ? usdValue.toFixed(4) : usdValue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} USD`;
				} else {
					fiatDisplay = null;
				}
			});
		} else if (price > 0) {
			// Fiat-priced: reset sats before async, show original fiat as secondary
			satsAmount = null;
			loading = true;
			fiatDisplay = `${formatPrice(price, currency)} ${currency}`;
			convertToSats(price, currency).then((result) => {
				if (thisRequest !== requestId) return;
				satsAmount = result;
				loading = false;
			});
		} else {
			satsAmount = null;
			fiatDisplay = null;
			loading = false;
		}
	}

	// Size classes
	$: primaryClass = size === 'lg' ? 'text-3xl' : size === 'sm' ? 'text-xl' : 'text-sm';
	$: secondaryClass = size === 'lg' ? 'text-sm' : 'text-[10px]';
	$: iconSize = size === 'lg' ? 18 : size === 'sm' ? 14 : 12;
</script>

{#if price > 0}
	<div class="flex flex-col gap-0.5">
		<!-- Primary: sats (always on top) -->
		<div class="flex items-center gap-1.5">
			{#if loading}
				<span class="{primaryClass} font-bold text-orange-500">...</span>
			{:else if satsAmount !== null}
				<span class="{primaryClass} font-bold text-orange-500">
					{formatSats(satsAmount)}
				</span>
				<LightningIcon size={iconSize} weight="fill" class="text-orange-400" />
			{:else}
				<!-- Rate unavailable — show placeholder, not fiat as primary -->
				<span class="{primaryClass} font-bold text-orange-500">--</span>
				<LightningIcon size={iconSize} weight="fill" class="text-orange-400 opacity-40" />
			{/if}
		</div>

		<!-- Secondary: fiat (always shown for consistency) -->
		{#if fiatDisplay && !loading}
			<span class="{secondaryClass} font-normal" style="color: var(--color-text-secondary)">
				{fiatDisplay}
			</span>
		{/if}
	</div>
{/if}
