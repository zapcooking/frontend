<script lang="ts">
	import { clickOutside } from '$lib/clickOutside';
	import { fade } from 'svelte/transition';
	import { displayCurrency, SUPPORTED_CURRENCIES, type CurrencyCode } from '$lib/currencyStore';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
	import CheckIcon from 'phosphor-svelte/lib/Check';
	import CurrencyCircleDollarIcon from 'phosphor-svelte/lib/CurrencyCircleDollar';

	export let compact: boolean = false;

	let dropdownActive = false;

	function selectCurrency(code: CurrencyCode) {
		displayCurrency.setCurrency(code);
		dropdownActive = false;
	}

	$: currentCurrency = SUPPORTED_CURRENCIES.find((c) => c.code === $displayCurrency);
</script>

<div class="relative" use:clickOutside on:click_outside={() => (dropdownActive = false)}>
	<button
		class="flex items-center gap-1.5 rounded-full transition-colors cursor-pointer font-medium"
		class:px-2={compact}
		class:py-1={compact}
		class:text-xs={compact}
		class:px-3={!compact}
		class:py-1.5={!compact}
		class:text-sm={!compact}
		style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
		on:click={() => (dropdownActive = !dropdownActive)}
		title="Select display currency"
	>
		<CurrencyCircleDollarIcon size={compact ? 14 : 16} class="text-amber-500" />
		<span>{$displayCurrency}</span>
		<CaretDownIcon size={compact ? 10 : 12} class="text-caption" />
	</button>

	{#if dropdownActive}
		<div
			class="absolute right-0 top-full mt-2 z-30"
			transition:fade={{ delay: 0, duration: 150 }}
		>
			<div
				role="menu"
				tabindex="-1"
				on:keydown={(e) => e.key === 'Escape' && (dropdownActive = false)}
				class="flex flex-col bg-input rounded-xl drop-shadow py-2 min-w-[180px] max-h-[300px] overflow-y-auto"
				style="color: var(--color-text-primary)"
			>
				{#each SUPPORTED_CURRENCIES as currency}
					<button
						class="flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-accent-gray cursor-pointer text-left"
						class:bg-accent-gray={currency.code === $displayCurrency}
						on:click={() => selectCurrency(currency.code)}
					>
						{#if currency.code === $displayCurrency}
							<CheckIcon size={14} class="text-primary flex-shrink-0" />
						{:else}
							<span class="w-3.5 flex-shrink-0"></span>
						{/if}
						<span class="flex-1">{currency.name}</span>
						<span class="text-caption text-xs">{currency.code}</span>
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>
