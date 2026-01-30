<script lang="ts">
	import { onMount } from 'svelte';
	import { ndk, userPublickey } from '$lib/nostr';
	import type { NDKEvent } from '@nostr-dev-kit/ndk';
	import { fetchProducts, parseProductEvent } from '$lib/marketplace/products';
	import { type ProductCategory, type Product, PRODUCT_CATEGORIES } from '$lib/marketplace/types';
	import ProductCard from '../../components/marketplace/ProductCard.svelte';
	import CategoryFilter from '../../components/marketplace/CategoryFilter.svelte';
	import StorefrontIcon from 'phosphor-svelte/lib/Storefront';
	import PlusIcon from 'phosphor-svelte/lib/Plus';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlass';
	import FunnelIcon from 'phosphor-svelte/lib/Funnel';

	let allProducts: Product[] = [];
	let loading = true;
	let error: string | null = null;
	let selectedCategory: ProductCategory | null = null;
	let sortBy: 'latest' | 'price-low' | 'price-high' = 'latest';
	let searchQuery = '';

	// Category counts
	let categoryCounts: Record<ProductCategory | 'all', number> = {
		all: 0,
		ingredients: 0,
		tools: 0,
		knowledge: 0,
		merch: 0
	};

	// Filtered and sorted products
	$: filteredProducts = filterAndSortProducts(allProducts, selectedCategory, sortBy, searchQuery);

	function filterAndSortProducts(
		products: Product[],
		category: ProductCategory | null,
		sort: string,
		search: string
	): NDKEvent[] {
		let filtered = products;

		// Filter by category
		if (category) {
			filtered = filtered.filter((p) => p.category === category);
		}

		// Filter by search
		if (search.trim()) {
			const q = search.toLowerCase();
			filtered = filtered.filter(
				(p) =>
					p.title.toLowerCase().includes(q) ||
					p.summary.toLowerCase().includes(q)
			);
		}

		// Sort
		switch (sort) {
			case 'price-low':
				filtered = [...filtered].sort((a, b) => a.priceSats - b.priceSats);
				break;
			case 'price-high':
				filtered = [...filtered].sort((a, b) => b.priceSats - a.priceSats);
				break;
			case 'latest':
			default:
				filtered = [...filtered].sort((a, b) => b.publishedAt - a.publishedAt);
				break;
		}

		return filtered.map((p) => p.event);
	}

	function updateCategoryCounts(products: Product[]) {
		const counts: Record<ProductCategory | 'all', number> = {
			all: products.length,
			ingredients: 0,
			tools: 0,
			knowledge: 0,
			merch: 0
		};

		for (const product of products) {
			if (product.category in counts) {
				counts[product.category as ProductCategory]++;
			}
		}

		categoryCounts = counts;
	}

	onMount(async () => {
		await loadProducts();
	});

	async function loadProducts() {
		console.log('[Marketplace Page] Starting loadProducts...');
		loading = true;
		error = null;

		try {
			console.log('[Marketplace Page] Calling fetchProducts...');
			const fetchedProducts = await fetchProducts($ndk, { limit: 100, timeoutMs: 15000 });
			console.log('[Marketplace Page] Received', fetchedProducts.length, 'products');
			allProducts = fetchedProducts;
			updateCategoryCounts(fetchedProducts);
		} catch (e) {
			console.error('[Marketplace Page] Failed to load products:', e);
			error = 'Failed to load products. Please try again.';
		} finally {
			loading = false;
			console.log('[Marketplace Page] Loading complete, loading =', loading);
		}
	}

	function handleCategoryChange(category: ProductCategory | null) {
		selectedCategory = category;
	}
</script>

<svelte:head>
	<title>Marketplace | zap.cooking</title>
	<meta name="description" content="Buy and sell cooking goods with Bitcoin. Direct Lightning payments, no middleman." />
</svelte:head>

<div class="marketplace-page max-w-6xl mx-auto px-4 py-6">
	<!-- Header -->
	<div class="flex flex-col gap-2 mb-6">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<StorefrontIcon size={32} weight="duotone" class="text-orange-500" />
				<h1 class="text-2xl font-bold" style="color: var(--color-text-primary)">Marketplace</h1>
			</div>
			<div class="flex items-center gap-2">
				{#if $userPublickey}
					<a
						href="/my-store/new"
						class="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all hover:scale-105"
						style="background: linear-gradient(135deg, #f97316, #ea580c); color: white;"
					>
						<PlusIcon size={18} weight="bold" />
						<span class="hidden sm:inline">Create Listing</span>
					</a>
				{/if}
			</div>
		</div>
		<p class="text-base" style="color: var(--color-text-secondary)">
			Buy and sell cooking goods with Bitcoin. Direct Lightning payments, no middleman.
		</p>
	</div>

	<!-- Sticky Category Filter -->
	<div class="sticky top-0 z-40 -mx-4 px-4 py-3 mb-4" style="background-color: var(--color-bg-primary);">
		<CategoryFilter selected={selectedCategory} counts={categoryCounts} onChange={handleCategoryChange} />
	</div>

	<!-- Sort & Search Bar -->
	<div class="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between mb-6">
		<div class="flex gap-2">
			<div class="relative">
				<FunnelIcon size={16} class="absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
				<select
					bind:value={sortBy}
					class="sort-select pl-9 pr-4 py-2 rounded-lg text-sm"
				>
					<option value="latest">Latest</option>
					<option value="price-low">Price: Low to High</option>
					<option value="price-high">Price: High to Low</option>
				</select>
			</div>
		</div>

		<div class="relative w-full sm:w-64">
			<MagnifyingGlassIcon size={16} class="absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
			<input
				type="text"
				placeholder="Search products..."
				bind:value={searchQuery}
				class="search-input w-full pl-9 pr-4 py-2 rounded-lg text-sm"
			/>
		</div>
	</div>

	<!-- Content -->
	{#if loading}
		<!-- Skeleton Loading -->
		<div class="products-grid">
			{#each Array(8) as _, i}
				<div class="skeleton-card animate-pulse">
					<div class="skeleton-image"></div>
					<div class="p-3 space-y-2">
						<div class="skeleton-line w-3/4"></div>
						<div class="skeleton-line w-1/2"></div>
						<div class="skeleton-button"></div>
					</div>
				</div>
			{/each}
		</div>
	{:else if error}
		<div class="text-center py-12">
			<p class="text-red-500 mb-4">{error}</p>
			<button
				type="button"
				on:click={loadProducts}
				class="px-4 py-2 rounded-lg font-medium transition-colors"
				style="background-color: var(--color-accent); color: white;"
			>
				Try Again
			</button>
		</div>
	{:else if filteredProducts.length === 0}
		<!-- Empty State -->
		<div class="empty-state text-center py-16 animate-fade-in">
			<div class="empty-icon-wrap mx-auto mb-6">
				<StorefrontIcon size={72} weight="thin" class="opacity-60" />
			</div>
			<h3 class="text-2xl font-semibold mb-2" style="color: var(--color-text-primary)">
				No products yet
			</h3>
			<p class="text-base mb-8 max-w-md mx-auto" style="color: var(--color-text-secondary)">
				{#if selectedCategory}
					No products in this category. Try selecting a different category or be the first to list!
				{:else if searchQuery}
					No products match your search. Try a different search term.
				{:else}
					Be the first to list! Sell ingredients, tools, courses, and more.
				{/if}
			</p>
			{#if $userPublickey}
				<a
					href="/my-store/new"
					class="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-transform hover:scale-105"
					style="background: linear-gradient(135deg, #f97316, #fb923c); color: white;"
				>
					<PlusIcon size={20} weight="bold" />
					Create Your First Listing
				</a>
			{:else}
				<a
					href="/login"
					class="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-transform hover:scale-105"
					style="background: linear-gradient(135deg, #f97316, #fb923c); color: white;"
				>
					Log In to Sell
				</a>
			{/if}
		</div>
	{:else}
		<!-- Results count -->
		<p class="text-sm mb-4" style="color: var(--color-text-secondary)">
			{filteredProducts.length} product{filteredProducts.length === 1 ? '' : 's'}
			{#if selectedCategory}in this category{/if}
		</p>

		<!-- Products Grid -->
		<div class="products-grid">
			{#each filteredProducts as event (event.id)}
				<ProductCard {event} />
			{/each}
		</div>
	{/if}
</div>


<style lang="postcss">
	@reference "../../app.css";

	.products-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1rem;
	}

	@media (min-width: 640px) {
		.products-grid {
			grid-template-columns: repeat(3, 1fr);
			gap: 1.5rem;
		}
	}

	@media (min-width: 1024px) {
		.products-grid {
			grid-template-columns: repeat(4, 1fr);
		}
	}

	.sort-select,
	.search-input {
		background-color: var(--color-bg-secondary);
		color: var(--color-text-primary);
		border: 1px solid transparent;
	}

	.sort-select:focus,
	.search-input:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	/* Skeleton loading */
	.skeleton-card {
		@apply rounded-xl overflow-hidden;
		background-color: var(--color-bg-secondary);
	}

	.skeleton-image {
		@apply aspect-square;
		background-color: var(--color-bg-tertiary, rgba(0, 0, 0, 0.1));
	}

	.skeleton-line {
		@apply h-3 rounded;
		background-color: var(--color-bg-tertiary, rgba(0, 0, 0, 0.1));
	}

	.skeleton-button {
		@apply h-8 rounded-lg mt-2;
		background-color: var(--color-bg-tertiary, rgba(0, 0, 0, 0.1));
	}

	/* Empty state animations */
	.animate-fade-in {
		animation: fadeIn 0.5s ease-out;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.empty-icon-wrap {
		animation: float 3s ease-in-out infinite;
	}

	@keyframes float {
		0%, 100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-8px);
		}
	}
</style>
