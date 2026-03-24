<script lang="ts">
	import { PRODUCT_CATEGORIES, CATEGORY_LABELS, CATEGORY_EMOJIS, type ProductCategory } from '$lib/marketplace/types';

	export let selected: ProductCategory | null = null;
	export let counts: Partial<Record<ProductCategory | 'all', number>> = {};
	export let onChange: (category: ProductCategory | null) => void = () => {};

	function handleClick(category: ProductCategory | null) {
		selected = category;
		onChange(category);
	}

	// Only show categories that have products (plus always show "All")
	$: visibleCategories = PRODUCT_CATEGORIES.filter((c) => (counts[c] || 0) > 0);
</script>

<div class="chip-row">
	<!-- All -->
	<button
		type="button"
		on:click={() => handleClick(null)}
		class="chip {selected === null ? 'active' : ''}"
		aria-label="All categories"
	>
		<span class="chip-icon">✨</span>
		<span class="chip-label">All</span>
		{#if counts.all}
			<span class="chip-count">{counts.all}</span>
		{/if}
	</button>

	{#each visibleCategories as category}
		<button
			type="button"
			on:click={() => handleClick(category)}
			class="chip {selected === category ? 'active' : ''}"
			aria-label="{CATEGORY_LABELS[category]} ({counts[category] || 0})"
		>
			<span class="chip-icon">{CATEGORY_EMOJIS[category]}</span>
			<span class="chip-label">{CATEGORY_LABELS[category]}</span>
			{#if counts[category]}
				<span class="chip-count">{counts[category]}</span>
			{/if}
		</button>
	{/each}
</div>

<style lang="postcss">
	@reference "../../app.css";

	.chip-row {
		@apply flex flex-wrap gap-1.5;
	}

	.chip {
		@apply flex items-center gap-0 rounded-full text-sm font-medium whitespace-nowrap cursor-pointer;
		background-color: var(--color-bg-secondary);
		color: var(--color-text-secondary);
		border: 1px solid transparent;
		padding: 6px 8px;
		transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
	}

	/* Icon is always visible */
	.chip-icon {
		@apply text-base flex-shrink-0;
		line-height: 1;
	}

	/* Label hidden by default, revealed on active/hover */
	.chip-label {
		display: inline-block;
		max-width: 0;
		overflow: hidden;
		opacity: 0;
		transition: max-width 0.2s ease, opacity 0.15s ease, margin 0.2s ease;
		margin-left: 0;
	}

	/* Count always visible */
	.chip-count {
		@apply text-[10px] font-semibold px-1.5 py-0 rounded-full flex-shrink-0;
		background-color: var(--color-bg-tertiary, rgba(0, 0, 0, 0.2));
		margin-left: 4px;
		line-height: 1.4;
	}

	/* ── Active state ── */
	.chip.active {
		background-color: var(--color-accent);
		color: white;
		border-color: var(--color-accent);
		box-shadow: 0 2px 8px rgba(249, 115, 22, 0.3);
		padding: 6px 10px;
	}

	.chip.active .chip-label {
		max-width: 120px;
		opacity: 1;
		margin-left: 4px;
	}

	.chip.active .chip-count {
		background-color: rgba(255, 255, 255, 0.2);
	}

	/* ── Hover state (desktop only) ── */
	@media (hover: hover) {
		.chip:hover {
			background-color: var(--color-bg-tertiary, var(--color-bg-secondary));
			color: var(--color-text-primary);
		}

		.chip:hover .chip-label {
			max-width: 120px;
			opacity: 1;
			margin-left: 4px;
		}
	}
</style>
