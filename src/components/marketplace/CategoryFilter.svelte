<script lang="ts">
	import { PRODUCT_CATEGORIES, CATEGORY_LABELS, CATEGORY_EMOJIS, type ProductCategory } from '$lib/marketplace/types';

	export let selected: ProductCategory | null = null;
	export let counts: Record<ProductCategory | 'all', number> = {
		all: 0,
		ingredients: 0,
		tools: 0,
		knowledge: 0,
		merch: 0
	};
	export let onChange: (category: ProductCategory | null) => void = () => {};

	function handleClick(category: ProductCategory | null) {
		selected = category;
		onChange(category);
	}
</script>

<div class="category-scroll flex gap-2 overflow-x-auto pb-2">
	<!-- All button -->
	<button
		type="button"
		on:click={() => handleClick(null)}
		class="category-pill {selected === null ? 'active' : ''}"
	>
		<span class="text-base">✨</span>
		<span>All</span>
		{#if counts.all > 0}
			<span class="count">{counts.all}</span>
		{/if}
	</button>

	<!-- Category buttons -->
	{#each PRODUCT_CATEGORIES as category}
		<button
			type="button"
			on:click={() => handleClick(category)}
			class="category-pill {selected === category ? 'active' : ''}"
		>
			<span class="text-base">{CATEGORY_EMOJIS[category]}</span>
			<span>{CATEGORY_LABELS[category]}</span>
			{#if counts[category] > 0}
				<span class="count">{counts[category]}</span>
			{/if}
		</button>
	{/each}
</div>

<style lang="postcss">
	@reference "../../app.css";

	.category-scroll {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}

	.category-scroll::-webkit-scrollbar {
		display: none;
	}

	.category-pill {
		@apply flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium transition-all whitespace-nowrap;
		background-color: var(--color-bg-secondary);
		color: var(--color-text-secondary);
		border: 1px solid transparent;
	}

	.category-pill:hover {
		background-color: var(--color-bg-tertiary, var(--color-bg-secondary));
		color: var(--color-text-primary);
	}

	.category-pill.active {
		background-color: var(--color-accent);
		color: white;
		border-color: var(--color-accent);
		box-shadow: 0 4px 12px rgba(249, 115, 22, 0.3);
		transform: scale(1.02);
	}

	.count {
		@apply text-xs px-2 py-0.5 rounded-full;
		background-color: rgba(255, 255, 255, 0.15);
	}

	.category-pill:not(.active) .count {
		background-color: var(--color-bg-tertiary, rgba(0, 0, 0, 0.2));
	}
</style>
