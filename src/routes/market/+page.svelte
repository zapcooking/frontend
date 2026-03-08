<script lang="ts">
	import { onMount } from 'svelte';
	import { ndk, userPublickey } from '$lib/nostr';
	import { fetchAllKitchenDisplays } from '$lib/marketplace/kitchens';
	import type { KitchenDisplay } from '$lib/marketplace/types';
	import KitchenCard from '../../components/marketplace/KitchenCard.svelte';
	import StorefrontIcon from 'phosphor-svelte/lib/Storefront';
	import PlusIcon from 'phosphor-svelte/lib/Plus';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlass';
	import PackageIcon from 'phosphor-svelte/lib/Package';

	let allKitchens: KitchenDisplay[] = [];
	let loading = true;
	let error: string | null = null;
	let searchQuery = '';

	$: filteredKitchens = filterKitchens(allKitchens, searchQuery);

	function filterKitchens(kitchens: KitchenDisplay[], search: string) {
		if (!search.trim()) return kitchens;
		const q = search.toLowerCase();
		return kitchens.filter(
			(k) =>
				k.name.toLowerCase().includes(q) ||
				k.description.toLowerCase().includes(q)
		);
	}

	onMount(async () => {
		await loadKitchens();
	});

	async function loadKitchens() {
		loading = true;
		error = null;

		try {
			allKitchens = await fetchAllKitchenDisplays($ndk, {
				onTrustRanksReady: () => {
					// Trigger Svelte reactivity so trust badges appear
					allKitchens = [...allKitchens];
				}
			});
		} catch (e) {
			console.error('[The Market] Failed to load kitchens:', e);
			error = 'Failed to load stores. Please try again.';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>The Market | zap.cooking</title>
	<meta name="description" content="Discover stores selling cooking goods with Bitcoin. Direct Lightning payments, no middleman." />
</svelte:head>

<div class="marketplace-page max-w-6xl mx-auto px-4 py-6">
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
						href="/my-store/kitchen"
						class="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all hover:scale-105"
						style="background: linear-gradient(135deg, #f97316, #ea580c); color: white;"
					>
						<PlusIcon size={18} weight="bold" />
						<span class="hidden sm:inline">Create Store</span>
					</a>
				{/if}
			</div>
		</div>
		<p class="text-base" style="color: var(--color-text-secondary)">
			Discover stores selling cooking goods with Bitcoin. Direct Lightning payments, no middleman.
		</p>
	</div>

	<!-- Navigation Tabs -->
	<div class="flex gap-2 mb-6">
		<a
			href="/market"
			class="nav-tab active"
		>
			<StorefrontIcon size={16} />
			Stores
		</a>
		<a
			href="/market/products"
			class="nav-tab"
		>
			<PackageIcon size={16} />
			Products
		</a>
	</div>

	<!-- Search -->
	<div class="mb-6">
		<div class="relative w-full sm:w-64">
			<MagnifyingGlassIcon size={16} class="absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
			<input
				type="text"
				placeholder="Search stores..."
				bind:value={searchQuery}
				class="search-input w-full pl-9 pr-4 py-2 rounded-lg text-sm"
			/>
		</div>
	</div>

	<!-- Content -->
	{#if loading}
		<div class="kitchens-grid">
			{#each Array(6) as _}
				<div class="skeleton-card animate-pulse">
					<div class="skeleton-banner"></div>
					<div class="p-4 pt-8 space-y-3">
						<div class="skeleton-line w-2/3"></div>
						<div class="skeleton-line w-full"></div>
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
				on:click={loadKitchens}
				class="px-4 py-2 rounded-lg font-medium transition-colors"
				style="background-color: var(--color-accent); color: white;"
			>
				Try Again
			</button>
		</div>
	{:else if filteredKitchens.length === 0}
		<div class="empty-state text-center py-16 animate-fade-in">
			<div class="empty-icon-wrap mx-auto mb-6">
				<StorefrontIcon size={72} weight="thin" class="opacity-60" />
			</div>
			<h3 class="text-2xl font-semibold mb-2" style="color: var(--color-text-primary)">
				{#if searchQuery}
					No stores match your search
				{:else}
					No stores yet
				{/if}
			</h3>
			<p class="text-base mb-8 max-w-md mx-auto" style="color: var(--color-text-secondary)">
				{#if searchQuery}
					Try a different search term or browse all stores.
				{:else}
					Be the first to set up your store!
				{/if}
			</p>
			{#if $userPublickey && !searchQuery}
				<a
					href="/my-store/kitchen"
					class="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-transform hover:scale-105"
					style="background: linear-gradient(135deg, #f97316, #fb923c); color: white;"
				>
					<PlusIcon size={20} weight="bold" />
					Create Your Store
				</a>
			{/if}
		</div>
	{:else}
		<p class="text-sm mb-4" style="color: var(--color-text-secondary)">
			{filteredKitchens.length} store{filteredKitchens.length === 1 ? '' : 's'}
		</p>

		<div class="kitchens-grid">
			{#each filteredKitchens as kitchen (kitchen.pubkey)}
				<KitchenCard {kitchen} />
			{/each}
		</div>
	{/if}
</div>

<style lang="postcss">
	@reference "../../app.css";

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

	.kitchens-grid {
		display: grid;
		grid-template-columns: repeat(1, 1fr);
		gap: 1.5rem;
	}

	@media (min-width: 640px) {
		.kitchens-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (min-width: 1024px) {
		.kitchens-grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}

	.search-input {
		background-color: var(--color-bg-secondary);
		color: var(--color-text-primary);
		border: 1px solid transparent;
	}

	.search-input:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	.skeleton-card {
		@apply rounded-xl overflow-hidden;
		background-color: var(--color-bg-secondary);
	}

	.skeleton-banner {
		aspect-ratio: 3 / 1;
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
