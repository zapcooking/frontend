<script lang="ts">
	import { onMount } from 'svelte';
	import InfoIcon from 'phosphor-svelte/lib/Info';
	import XIcon from 'phosphor-svelte/lib/X';

	const STORAGE_KEY = 'zc_market_buyer_banner_dismissed';

	let dismissed = false;
	let mounted = false;

	onMount(() => {
		dismissed = sessionStorage.getItem(STORAGE_KEY) === '1';
		mounted = true;
	});

	function dismiss() {
		dismissed = true;
		sessionStorage.setItem(STORAGE_KEY, '1');
	}
</script>

{#if mounted && !dismissed}
	<div class="buyer-banner">
		<div class="banner-content">
			<InfoIcon size={16} class="flex-shrink-0 mt-0.5" />
			<p class="text-sm">
				<strong>The Market connects buyers and sellers directly.</strong> Zap Cooking does not process payments, verify sellers, inspect products, or guarantee transactions. All purchases are peer-to-peer and at your own risk. Lightning payments are generally irreversible.
			</p>
		</div>
		<button
			type="button"
			class="dismiss-btn"
			aria-label="Dismiss banner"
			on:click={dismiss}
		>
			<XIcon size={16} />
		</button>
	</div>
{/if}

<style lang="postcss">
	@reference "../../app.css";

	.buyer-banner {
		@apply flex items-start gap-3 px-4 py-3 rounded-xl mb-6;
		background-color: rgba(249, 115, 22, 0.08);
		border: 1px solid rgba(249, 115, 22, 0.2);
		color: var(--color-text-secondary);
	}

	.banner-content {
		@apply flex items-start gap-2 flex-1;
		color: var(--color-text-secondary);
	}

	.dismiss-btn {
		@apply flex-shrink-0 p-1 rounded-lg transition-colors;
		color: var(--color-text-secondary);
		opacity: 0.6;
	}

	.dismiss-btn:hover {
		opacity: 1;
		background-color: var(--color-bg-tertiary, rgba(255, 255, 255, 0.1));
	}
</style>
