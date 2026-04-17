<script lang="ts">
	/**
	 * PaymentActionPanel — shared visual block for product payment.
	 *
	 * Renders exactly one of: success panel, error panel, or the pay + copy-lightning
	 * action buttons (when canInstantBuy and no terminal state reached). Events
	 * `pay` / `copy` / `retry` are dispatched to the parent for handling.
	 *
	 * Success panel has a named slot `success-extra` for modal-specific follow-up
	 * CTAs (e.g., ProductViewModal's "Message seller with order details").
	 */
	import { createEventDispatcher } from 'svelte';
	import Button from '../Button.svelte';
	import LightningIcon from 'phosphor-svelte/lib/Lightning';
	import CopyIcon from 'phosphor-svelte/lib/Copy';
	import CheckIcon from 'phosphor-svelte/lib/Check';
	import XIcon from 'phosphor-svelte/lib/X';
	import type { PaymentState } from '$lib/marketplace/productPayment';

	export let canInstantBuy: boolean;
	export let paymentState: PaymentState;
	export let paymentError = '';
	export let paymentLabel = '';
	export let resolvingLightning = false;
	export let resolvedLightningAddress = '';
	export let copiedLightning = false;

	/** Text beside the spinner while loading. `null` → spinner only (MessageSellerModal); string → shown (ProductViewModal: "Getting Invoice..."). */
	export let loadingText: string | null = null;

	/** Extra classes on the Pay button. MessageSellerModal uses the default; ProductViewModal passes `'w-full py-3 text-lg'`. */
	export let payButtonClass = 'w-full py-3';

	const dispatch = createEventDispatcher<{ pay: void; copy: void; retry: void }>();
</script>

{#if paymentState === 'success'}
	<div
		class="flex flex-col items-center gap-3 py-4 rounded-xl"
		style="background-color: var(--color-bg-tertiary);"
	>
		<div class="w-12 h-12 rounded-full flex items-center justify-center bg-emerald-500/20">
			<CheckIcon size={24} weight="bold" class="text-emerald-400" />
		</div>
		<p class="text-sm font-medium" style="color: var(--color-text-primary)">Payment sent!</p>
		<p class="text-xs" style="color: var(--color-text-secondary)">{paymentLabel}</p>
		<slot name="success-extra" />
	</div>
{:else if paymentState === 'error'}
	<div
		class="flex flex-col items-center gap-3 py-4 rounded-xl"
		style="background-color: rgba(239, 68, 68, 0.1);"
	>
		<XIcon size={24} weight="bold" class="text-red-400" />
		<p class="text-sm text-red-400">{paymentError}</p>
		<Button on:click={() => dispatch('retry')}>Try Again</Button>
	</div>
{:else if canInstantBuy}
	<Button
		class={payButtonClass}
		on:click={() => dispatch('pay')}
		disabled={paymentState === 'loading' || resolvingLightning || !resolvedLightningAddress}
	>
		<span class="flex items-center justify-center gap-2">
			{#if resolvingLightning || paymentState === 'loading'}
				<svg
					class="animate-spin h-5 w-5"
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
				>
					<circle
						class="opacity-25"
						cx="12"
						cy="12"
						r="10"
						stroke="currentColor"
						stroke-width="4"
					></circle>
					<path
						class="opacity-75"
						fill="currentColor"
						d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
					></path>
				</svg>
				{#if loadingText}
					{loadingText}
				{/if}
			{:else}
				<LightningIcon size={20} weight="fill" />
				Pay {paymentLabel}
			{/if}
		</span>
	</Button>

	{#if resolvedLightningAddress}
		<button
			type="button"
			on:click={() => dispatch('copy')}
			class="flex items-center justify-center gap-2 py-1.5 text-xs transition-colors hover:opacity-80"
			style="color: var(--color-text-secondary);"
		>
			{#if copiedLightning}
				<CheckIcon size={12} class="text-emerald-400" />
				<span class="text-emerald-400">Copied!</span>
			{:else}
				<CopyIcon size={12} />
				Copy Lightning address
			{/if}
		</button>
	{/if}
{/if}
