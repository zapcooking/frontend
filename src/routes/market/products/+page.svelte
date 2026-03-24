<script lang="ts">
	import { onMount } from 'svelte';
	import { ndk, userPublickey } from '$lib/nostr';
	import { fetchProductsWithStaleCount } from '$lib/marketplace/products';
	import { fetchTrustRanks } from '$lib/marketplace/kitchens';
	import { getMembership } from '$lib/stores/membershipStatus';
	import { PRODUCT_CATEGORIES, type Product, type ProductCategory } from '$lib/marketplace/types';
	import ProductCard from '../../../components/marketplace/ProductCard.svelte';
	import CategoryFilter from '../../../components/marketplace/CategoryFilter.svelte';
	import MarketBuyerBanner from '../../../components/marketplace/MarketBuyerBanner.svelte';
	import StorefrontIcon from 'phosphor-svelte/lib/Storefront';
	import PlusIcon from 'phosphor-svelte/lib/Plus';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlass';
	import SlidersHorizontalIcon from 'phosphor-svelte/lib/SlidersHorizontal';
	import PackageIcon from 'phosphor-svelte/lib/Package';
	import XIcon from 'phosphor-svelte/lib/X';

	let allProducts: Product[] = [];
	let staleListingsHidden = 0;
	let trustRanks = new Map<string, number>();
	let trustPersonalized = false;
	let memberPubkeys = new Set<string>();
	let membersOnly = false;
	let loading = true;
	let error: string | null = null;
	let sortBy: 'latest' | 'price-low' | 'price-high' = 'latest';
	let searchQuery = '';
	let selectedCategory: ProductCategory | null = null;
	let searchOpen = false;

	$: categoryCounts = computeCategoryCounts(allProducts);

	function computeCategoryCounts(products: Product[]): Partial<Record<ProductCategory | 'all', number>> {
		const counts: Partial<Record<ProductCategory | 'all', number>> = { all: products.length };
		for (const product of products) {
			counts[product.category] = (counts[product.category] ?? 0) + 1;
		}
		return counts;
	}

	$: filteredProducts = filterAndSortProducts(allProducts, sortBy, searchQuery, membersOnly, selectedCategory);

	// Count active filters for the badge
	$: activeFilterCount = (membersOnly ? 1 : 0) + (selectedCategory ? 1 : 0) + (searchQuery.trim() ? 1 : 0);

	function filterAndSortProducts(
		products: Product[],
		sort: string,
		search: string,
		filterMembers: boolean,
		category: ProductCategory | null
	) {
		let filtered = products;

		if (category) {
			filtered = filtered.filter((p) => p.category === category);
		}

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
				filtered = [...filtered].sort((a, b) => a.price - b.price);
				break;
			case 'price-high':
				filtered = [...filtered].sort((a, b) => b.price - a.price);
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
			const result = await fetchProductsWithStaleCount($ndk, { limit: 100, timeoutMs: 15000 });
			allProducts = result.products;
			staleListingsHidden = result.staleCount;

			const sellerPubkeys = [...new Set(result.products.map((p) => p.pubkey))];

			fetchTrustRanks($ndk, sellerPubkeys, $userPublickey || undefined).then(({ ranks, personalized }) => {
				trustRanks = ranks;
				trustPersonalized = personalized;
			});

			getMembership(sellerPubkeys).then((statuses) => {
				const validTiers = ['member', 'cook_plus', 'pro_kitchen', 'founders'];
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

	function clearFilters() {
		selectedCategory = null;
		membersOnly = false;
		searchQuery = '';
		searchOpen = false;
	}
</script>

<svelte:head>
	<title>Products | The Market | zap.cooking</title>
	<meta name="description" content="Buy and sell cooking goods with Bitcoin. Direct Lightning payments, no middleman." />
</svelte:head>

<div class="products-page max-w-6xl mx-auto px-4 py-6">

	<!-- ═══ Header ═══ -->
	<div class="flex items-center justify-between mb-5">
		<div class="flex items-center gap-2.5">
			<StorefrontIcon size={28} weight="duotone" class="text-orange-500" />
			<h1 class="text-xl font-bold" style="color: var(--color-text-primary)">The Market</h1>
		</div>
		{#if $userPublickey}
			<a
				href="/my-store/new"
				class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all hover:scale-105"
				style="background: linear-gradient(135deg, #f97316, #ea580c); color: white;"
			>
				<PlusIcon size={16} weight="bold" />
				<span class="hidden sm:inline">List</span>
			</a>
		{/if}
	</div>

	<!-- ═══ Row 1: Navigation Tabs ═══ -->
	<div class="flex gap-2 mb-4">
		<a href="/market" class="nav-tab">
			<StorefrontIcon size={15} />
			Shops
		</a>
		<a href="/market/products" class="nav-tab active">
			<PackageIcon size={15} />
			Products
		</a>
	</div>

	<!-- ═══ Row 2: Categories ═══ -->
	<div class="mb-3">
		<CategoryFilter
			selected={selectedCategory}
			counts={categoryCounts}
			onChange={(cat) => (selectedCategory = cat)}
		/>
	</div>

	<!-- ═══ Row 3: Modifiers (search, sort, members) ═══ -->
	<div class="modifier-row">
		<!-- Search (expandable) -->
		{#if searchOpen}
			<div class="search-container">
				<MagnifyingGlassIcon size={14} class="search-icon" />
				<input
					type="text"
					placeholder="Search..."
					bind:value={searchQuery}
					class="search-input"
					autofocus
				/>
				<button
					type="button"
					on:click={() => { searchQuery = ''; searchOpen = false; }}
					class="search-close"
				>
					<XIcon size={14} />
				</button>
			</div>
		{:else}
			<button
				type="button"
				on:click={() => (searchOpen = true)}
				class="mod-btn"
				aria-label="Search"
			>
				<MagnifyingGlassIcon size={14} />
				<span class="hidden xs:inline">Search</span>
			</button>
		{/if}

		<!-- Sort -->
		<div class="relative">
			<select
				bind:value={sortBy}
				class="mod-select"
			>
				<option value="latest">Latest</option>
				<option value="price-low">Price: Low</option>
				<option value="price-high">Price: High</option>
			</select>
		</div>

		<!-- Members only toggle -->
		<button
			type="button"
			class="mod-btn {membersOnly ? 'mod-active' : ''}"
			on:click={() => (membersOnly = !membersOnly)}
		>
			<span class="text-xs">Members</span>
		</button>

		<!-- Clear all (shown when filters active) -->
		{#if activeFilterCount > 0}
			<button
				type="button"
				on:click={clearFilters}
				class="mod-btn mod-clear"
			>
				<XIcon size={12} />
				<span class="text-xs">Clear</span>
			</button>
		{/if}
	</div>

	<!-- Buyer Disclaimer Banner -->
	<MarketBuyerBanner />

	<!-- ═══ Results ═══ -->
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
			{#if staleListingsHidden > 0 && !searchQuery && !membersOnly}
				<h3 class="text-2xl font-semibold mb-2" style="color: var(--color-text-primary)">
					No recent products
				</h3>
				<p class="text-base mb-8 max-w-md mx-auto" style="color: var(--color-text-secondary)">
					Some older listings have been hidden. Check back for fresh listings!
				</p>
			{:else}
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
			{/if}
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
		<div class="flex items-center gap-3 mb-4">
			<p class="text-sm" style="color: var(--color-text-secondary)">
				{filteredProducts.length} product{filteredProducts.length === 1 ? '' : 's'}
			</p>
			{#if staleListingsHidden > 0}
				<p class="text-xs" style="color: var(--color-text-secondary); opacity: 0.7;">
					Some older listings hidden
				</p>
			{/if}
		</div>

		<div class="products-grid">
			{#each filteredProducts as event (event.id)}
				<ProductCard {event} trustRank={trustRanks.get(event.pubkey)} personalized={trustPersonalized} on:hide={() => removeProduct(event.id)} />
			{/each}
		</div>
	{/if}
</div>

<style lang="postcss">
	@reference "../../../app.css";

	/* ── Navigation Tabs ── */
	.nav-tab {
		@apply flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer;
		background-color: var(--color-bg-secondary);
		color: var(--color-text-secondary);
		border: 1.5px solid transparent;
		text-decoration: none;
	}

	.nav-tab:hover {
		color: var(--color-text-primary);
		border-color: rgba(249, 115, 22, 0.3);
	}

	.nav-tab.active {
		background-color: rgba(249, 115, 22, 0.12);
		color: #f97316;
		border-color: #f97316;
	}

	/* ── Modifier Row ── */
	.modifier-row {
		@apply flex items-center gap-2 mb-5 flex-wrap;
	}

	.mod-btn {
		@apply flex items-center gap-1.5 rounded-lg text-xs font-medium cursor-pointer;
		background-color: var(--color-bg-secondary);
		color: var(--color-text-secondary);
		border: 1px solid transparent;
		padding: 7px 10px;
		transition: all 0.15s ease;
		white-space: nowrap;
	}

	.mod-btn:hover {
		color: var(--color-text-primary);
		border-color: rgba(255, 255, 255, 0.1);
	}

	.mod-active {
		background-color: rgba(249, 115, 22, 0.15);
		color: #f97316;
		border-color: rgba(249, 115, 22, 0.4);
	}

	.mod-clear {
		color: var(--color-text-secondary);
		opacity: 0.7;
	}

	.mod-clear:hover {
		opacity: 1;
		color: #ef4444;
	}

	.mod-select {
		@apply text-xs font-medium rounded-lg cursor-pointer;
		background-color: var(--color-bg-secondary);
		color: var(--color-text-secondary);
		border: 1px solid transparent;
		padding: 7px 10px;
		transition: all 0.15s ease;
	}

	.mod-select:focus {
		outline: none;
		border-color: rgba(249, 115, 22, 0.4);
	}

	/* ── Search ── */
	.search-container {
		@apply flex items-center gap-2 flex-1 min-w-0 rounded-lg;
		background-color: var(--color-bg-secondary);
		border: 1px solid rgba(249, 115, 22, 0.3);
		padding: 5px 10px;
		animation: expandIn 0.15s ease-out;
	}

	@keyframes expandIn {
		from { opacity: 0; transform: scaleX(0.9); }
		to { opacity: 1; transform: scaleX(1); }
	}

	.search-icon {
		@apply flex-shrink-0 opacity-40;
	}

	.search-input {
		@apply flex-1 min-w-0 text-xs bg-transparent outline-none;
		color: var(--color-text-primary);
	}

	.search-close {
		@apply flex-shrink-0 p-0.5 rounded opacity-50 cursor-pointer;
		color: var(--color-text-secondary);
		transition: opacity 0.1s ease;
	}

	.search-close:hover {
		opacity: 1;
	}

	/* ── Product Grid ── */
	.products-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
	}

	@media (min-width: 640px) {
		.products-grid {
			grid-template-columns: repeat(3, 1fr);
			gap: 1.25rem;
		}
	}

	@media (min-width: 1024px) {
		.products-grid {
			grid-template-columns: repeat(4, 1fr);
			gap: 1.5rem;
		}
	}

	/* ── Skeletons ── */
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

	/* ── Animations ── */
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
