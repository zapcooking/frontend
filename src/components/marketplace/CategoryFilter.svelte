<script lang="ts">
	import { PRODUCT_CATEGORIES, CATEGORY_LABELS, CATEGORY_EMOJIS, type ProductCategory } from '$lib/marketplace/types';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';

	export let selected: ProductCategory | null = null;
	export let counts: Partial<Record<ProductCategory | 'all', number>> = {};
	export let onChange: (category: ProductCategory | null) => void = () => {};

	// Only show categories that have products
	$: visibleCategories = PRODUCT_CATEGORIES.filter((c) => (counts[c] || 0) > 0);

	// On mobile: show top 5 by count, rest behind "More"
	$: topCategories = [...visibleCategories]
		.sort((a, b) => (counts[b] || 0) - (counts[a] || 0))
		.slice(0, 5);
	$: moreCategories = visibleCategories.filter((c) => !topCategories.includes(c));
	$: hasMore = moreCategories.length > 0;

	let showMore = false;

	function handleClick(category: ProductCategory | null) {
		selected = category;
		onChange(category);
	}

	// If user selects a category that's in "more", keep it visible
	$: selectedIsHidden = selected !== null && !topCategories.includes(selected) && moreCategories.includes(selected);
</script>

<!-- Mobile: compact horizontal scroll with overflow menu -->
<div class="flex flex-col gap-2">
	<div class="chip-scroll">
		<!-- All -->
		<button
			type="button"
			on:click={() => handleClick(null)}
			class="chip {selected === null ? 'active' : ''}"
			aria-label="All categories"
		>
			All
			{#if counts.all}
				<span class="chip-count">{counts.all}</span>
			{/if}
		</button>

		<!-- Top categories (always visible) -->
		{#each topCategories as category}
			<button
				type="button"
				on:click={() => handleClick(category)}
				class="chip {selected === category ? 'active' : ''}"
				aria-label="{CATEGORY_LABELS[category]} ({counts[category] || 0})"
			>
				<span class="chip-emoji">{CATEGORY_EMOJIS[category]}</span>
				<span class="chip-label">{CATEGORY_LABELS[category]}</span>
				{#if counts[category]}
					<span class="chip-count">{counts[category]}</span>
				{/if}
			</button>
		{/each}

		<!-- Selected category from "more" (pinned when active) -->
		{#if selectedIsHidden && selected}
			<button
				type="button"
				on:click={() => handleClick(selected)}
				class="chip active"
				aria-label="{CATEGORY_LABELS[selected]} ({counts[selected] || 0})"
			>
				<span class="chip-emoji">{CATEGORY_EMOJIS[selected]}</span>
				<span class="chip-label">{CATEGORY_LABELS[selected]}</span>
				{#if counts[selected]}
					<span class="chip-count">{counts[selected]}</span>
				{/if}
			</button>
		{/if}

		<!-- More button -->
		{#if hasMore}
			<button
				type="button"
				on:click={() => (showMore = !showMore)}
				class="chip {showMore ? 'active' : ''}"
				aria-label="More categories"
			>
				More
				<CaretDownIcon
					size={12}
					class="transition-transform duration-200"
					style="transform: rotate({showMore ? '180deg' : '0deg'});"
				/>
			</button>
		{/if}
	</div>

	<!-- Expanded "More" categories -->
	{#if showMore}
		<div class="chip-more">
			{#each moreCategories as category}
				<button
					type="button"
					on:click={() => { handleClick(category); showMore = false; }}
					class="chip {selected === category ? 'active' : ''}"
					aria-label="{CATEGORY_LABELS[category]} ({counts[category] || 0})"
				>
					<span class="chip-emoji">{CATEGORY_EMOJIS[category]}</span>
					<span class="chip-label">{CATEGORY_LABELS[category]}</span>
					{#if counts[category]}
						<span class="chip-count">{counts[category]}</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style lang="postcss">
	@reference "../../app.css";

	.chip-scroll {
		@apply flex gap-1.5 overflow-x-auto;
		-ms-overflow-style: none;
		scrollbar-width: none;
	}

	.chip-scroll::-webkit-scrollbar {
		display: none;
	}

	.chip-more {
		@apply flex flex-wrap gap-1.5;
		animation: slideDown 0.15s ease-out;
	}

	@keyframes slideDown {
		from { opacity: 0; transform: translateY(-4px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.chip {
		@apply flex items-center gap-1.5 rounded-full text-xs font-medium whitespace-nowrap cursor-pointer;
		background-color: var(--color-bg-secondary);
		color: var(--color-text-secondary);
		border: 1px solid transparent;
		padding: 7px 12px;
		transition: all 0.15s ease;
	}

	.chip:hover {
		background-color: var(--color-bg-tertiary, var(--color-bg-secondary));
		color: var(--color-text-primary);
	}

	.chip.active {
		background-color: rgba(249, 115, 22, 0.15);
		color: #f97316;
		border-color: rgba(249, 115, 22, 0.4);
	}

	.chip-emoji {
		font-size: 13px;
		line-height: 1;
	}

	.chip-label {
		/* Hide on very small screens, show on sm+ */
		display: none;
	}

	@media (min-width: 480px) {
		.chip-label {
			display: inline;
		}
	}

	.chip-count {
		@apply text-[10px] font-semibold px-1.5 rounded-full;
		background-color: var(--color-bg-tertiary, rgba(0, 0, 0, 0.2));
		line-height: 1.5;
	}

	.chip.active .chip-count {
		background-color: rgba(249, 115, 22, 0.2);
	}
</style>
