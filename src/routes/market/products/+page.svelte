<script lang="ts">
	import { onMount } from 'svelte';
	import { ndk, userPublickey } from '$lib/nostr';
	import { fetchProducts } from '$lib/marketplace/products';
	import { fetchTrustRanks } from '$lib/marketplace/kitchens';
	import { getMembership } from '$lib/stores/membershipStatus';
	import type { Product } from '$lib/marketplace/types';
	import ProductCard from '../../../components/marketplace/ProductCard.svelte';
	import StorefrontIcon from 'phosphor-svelte/lib/Storefront';
	import PlusIcon from 'phosphor-svelte/lib/Plus';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlass';
	import FunnelIcon from 'phosphor-svelte/lib/Funnel';
	import PackageIcon from 'phosphor-svelte/lib/Package';

	let allProducts: Product[] = [];
	let trustRanks = new Map<string, number>();
	let trustPersonalized = false;
	let memberPubkeys = new Set<string>();
	let membersOnly = false;
	let loading = true;
	let error: string | null = null;
	let sortBy: 'latest' | 'price-low' | 'price-high' = 'latest';
	let searchQuery = '';

	$: filteredProducts = filterAndSortProducts(allProducts, sortBy, searchQuery, membersOnly);

	function filterAndSortProducts(
		products: Product[],
		sort: string,
		search: string,
		filterMembers: boolean
	) {
		let filtered = products;

		if (filterMembers) {
			filtered = filtered.filter((p) => memberPubkeys.has(p.pubkey));
		}

		if (search.trim()) {
			const q = search.toLowerCase();
			filtered = filtered.filter(
				(p) =>
					p.title.toLowerCase().includes(q) ||
					p.summary.toLowerCase().includes(q)
			);
		}

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

	onMount(async () => {
		await loadProducts();
	});

	async function loadProducts() {
		loading = true;
		error = null;

		try {
			const fetchedProducts = await fetchProducts($ndk, { limit: 100, timeoutMs: 15000 });
			allProducts = fetchedProducts;

			const sellerPubkeys = [...new Set(fetchedProducts.map((p) => p.pubkey))];

			// Fetch trust ranks and membership in parallel (both background, non-blocking)
			fetchTrustRanks($ndk, sellerPubkeys, $userPublickey || undefined).then(({ ranks, personalized }) => {
				trustRanks = ranks;
				trustPersonalized = personalized;
			});

			getMembership(sellerPubkeys).then((statuses) => {
				const validTiers = ['cook_plus', 'pro_kitchen', 'founders'];
				const members = new Set<string>();
				for (const [pubkey, status] of Object.entries(statuses)) {
					if (status.active && validTiers.includes(status.tier)) {
						members.add(pubkey);
					}
				}
				memberPubkeys = members;
			});
		} catch (e) {
			console.error('[Products Page] Failed to load products:', e);
			error = 'Failed to load products. Please try again.';
		} finally {
			loading = false;
		}
	}

	function removeProduct(eventId: string) {
		allProducts = allProducts.filter((p) => p.event.id !== eventId);
	}
</script>

<svelte:head>
	<title>Products | The Market | zap.cooking</title>
	<meta name="description" content="Buy and sell cooking goods with Bitcoin. Direct Lightning payments, no middleman." />
</svelte:head>

<div class="products-page max-w-6xl mx-auto px-4 py-6">
	<!-- Header -->
	<div class="flex flex-col gap-2 mb-6">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<StorefrontIcon size={32} weight="duotone" class="text-orange-500" />
				<h1 class="text-2xl font-bold" style="color: var(--color-text-primary)">The Market</h1>
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

	<!-- Navigation Tabs -->
	<div class="flex gap-2 mb-6">
		<a
			href="/market"
			class="nav-tab"
		>
			<StorefrontIcon size={16} />
			Stores
		</a>
		<a
			href="/market/products"
			class="nav-tab active"
		>
			<PackageIcon size={16} />
			Products
		</a>
	</div>

	<!-- Sort, Search & Filter Bar -->
	<div class="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between mb-6">
		<div class="flex gap-3 items-center">
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

			<label class="members-toggle">
				<span class="toggle-track" class:active={membersOnly}>
					<span class="toggle-thumb"></span>
				</span>
				<input type="checkbox" bind:checked={membersOnly} class="sr-only" />
				<span class="toggle-label">Members only</span>
			</label>
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
		<div class="empty-state text-center py-16 animate-fade-in">
			<div class="empty-icon-wrap mx-auto mb-6">
				<PackageIcon size={72} weight="thin" class="opacity-60" />
			</div>
			<h3 class="text-2xl font-semibold mb-2" style="color: var(--color-text-primary)">
				No products found
			</h3>
			<p class="text-base mb-8 max-w-md mx-auto" style="color: var(--color-text-secondary)">
				{#if searchQuery}
					No products match your search. Try a different term.
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
			{/if}
		</div>
	{:else}
		<p class="text-sm mb-4" style="color: var(--color-text-secondary)">
			{filteredProducts.length} product{filteredProducts.length === 1 ? '' : 's'}
		</p>

		<div class="products-grid">
			{#each filteredProducts as event (event.id)}
				<ProductCard {event} trustRank={trustRanks.get(event.pubkey)} personalized={trustPersonalized} on:hide={() => removeProduct(event.id)} />
			{/each}
		</div>
	{/if}
</div>

<style lang="postcss">
	@reference "../../../app.css";

	.nav-tab {
		@apply flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all;
		background-color: var(--color-bg-secondary);
		color: var(--color-text-secondary);
	}

	.nav-tab:hover {
		color: var(--color-text-primary);
	}

	.nav-tab.active {
		background-color: var(--color-accent);
		color: white;
	}

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

	.members-toggle {
		@apply flex items-center gap-2 cursor-pointer flex-shrink-0;
	}

	.toggle-track {
		@apply relative inline-flex w-9 h-5 rounded-full transition-colors;
		background-color: var(--color-bg-tertiary, rgba(255, 255, 255, 0.1));
	}

	.toggle-track.active {
		background-color: var(--color-accent, #f97316);
	}

	.toggle-thumb {
		@apply absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform;
		background-color: white;
	}

	.toggle-track.active .toggle-thumb {
		transform: translateX(16px);
	}

	.toggle-label {
		@apply text-sm font-medium;
		color: var(--color-text-secondary);
	}

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

	.animate-fade-in {
		animation: fadeIn 0.5s ease-out;
	}

	@keyframes fadeIn {
		from { opacity: 0; transform: translateY(10px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.empty-icon-wrap {
		animation: float 3s ease-in-out infinite;
	}

	@keyframes float {
		0%, 100% { transform: translateY(0); }
		50% { transform: translateY(-8px); }
	}
</style>
