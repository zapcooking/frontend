<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { nip19 } from 'nostr-tools';
	import { ndk, userPublickey } from '$lib/nostr';
	import { fetchKitchenByPubkey, buildImplicitKitchen, fetchTrustRanks } from '$lib/marketplace/kitchens';
	import { fetchSellerProducts } from '$lib/marketplace/products';
	import type { KitchenDisplay, Product } from '$lib/marketplace/types';
	import KitchenHeader from '../../../../components/marketplace/KitchenHeader.svelte';
	import ProductCard from '../../../../components/marketplace/ProductCard.svelte';
	import PanLoader from '../../../../components/PanLoader.svelte';
	import PackageIcon from 'phosphor-svelte/lib/Package';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeft';
	import type { PageData } from './$types';

	export let data: PageData;

	let kitchen: KitchenDisplay | null = null;
	let products: Product[] = [];
	let loading = true;
	let error: string | null = null;
	let activeTab: 'products' | 'about' = 'products';

	$: pubkey = decodePubkey($page.params.npub || '');
	$: isOwner = $userPublickey === pubkey;
	$: productEvents = products.map((p) => p.event);

	function decodePubkey(npubStr: string): string {
		try {
			if (npubStr.startsWith('npub1')) {
				const decoded = nip19.decode(npubStr);
				if (decoded.type === 'npub') return decoded.data as string;
			}
			if (/^[0-9a-f]{64}$/.test(npubStr)) return npubStr;
		} catch {
			// invalid
		}
		return '';
	}

	onMount(async () => {
		if (!pubkey) {
			error = 'Invalid store address';
			loading = false;
			return;
		}

		await loadKitchen();
	});

	async function loadKitchen() {
		loading = true;
		error = null;

		try {
			// Fetch kitchen and products in parallel
			const [kitchenResult, productsResult] = await Promise.all([
				fetchKitchenByPubkey($ndk, pubkey),
				fetchSellerProducts($ndk, pubkey)
			]);

			products = productsResult;

			if (kitchenResult) {
				kitchen = { ...kitchenResult, productCount: products.length, isImplicit: false as const };
			} else {
				// Build implicit kitchen from profile
				kitchen = await buildImplicitKitchen(pubkey, products.length);
			}

			// Fetch trust rank for this seller
			fetchTrustRanks($ndk, [pubkey]).then((ranks) => {
				const rank = ranks.get(pubkey);
				if (rank !== undefined && kitchen) {
					kitchen = { ...kitchen, trustRank: rank };
				}
			});
		} catch (e) {
			console.error('[Kitchen Page] Failed to load:', e);
			error = 'Failed to load store. Please try again.';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	{#if data?.ogMeta}
		<title>{data.ogMeta.title}</title>
		<meta name="description" content={data.ogMeta.description} />
		<meta property="og:title" content={data.ogMeta.title} />
		<meta property="og:description" content={data.ogMeta.description} />
		<meta property="og:image" content={data.ogMeta.image} />
		<meta property="og:type" content="profile" />
		<meta name="twitter:card" content="summary_large_image" />
		<meta name="twitter:title" content={data.ogMeta.title} />
		<meta name="twitter:description" content={data.ogMeta.description} />
		<meta name="twitter:image" content={data.ogMeta.image} />
	{:else}
		<title>{kitchen?.name ? `${kitchen.name} | The Market` : 'Store'} | zap.cooking</title>
	{/if}
</svelte:head>

<div class="kitchen-page max-w-6xl mx-auto px-4 py-6">
	<!-- Back link -->
	<a
		href="/market"
		class="inline-flex items-center gap-2 mb-6 text-sm hover:underline"
		style="color: var(--color-text-secondary)"
	>
		<ArrowLeftIcon size={16} />
		Back to The Market
	</a>

	{#if loading}
		<div class="flex justify-center py-12">
			<PanLoader size="md" />
		</div>
	{:else if error}
		<div class="text-center py-12">
			<p class="text-red-500 mb-4">{error}</p>
			<a href="/market" class="text-orange-500 hover:underline">Back to The Market</a>
		</div>
	{:else if kitchen}
		<!-- Kitchen Header -->
		<KitchenHeader {kitchen} {isOwner} />

		<!-- Tabs -->
		<div class="flex gap-2 mt-6 mb-6">
			<button
				type="button"
				class="tab-btn {activeTab === 'products' ? 'active' : ''}"
				on:click={() => (activeTab = 'products')}
			>
				<PackageIcon size={16} />
				Products ({products.length})
			</button>
			<button
				type="button"
				class="tab-btn {activeTab === 'about' ? 'active' : ''}"
				on:click={() => (activeTab = 'about')}
			>
				About
			</button>
		</div>

		<!-- Tab Content -->
		{#if activeTab === 'products'}
			{#if products.length === 0}
				<div class="text-center py-12">
					<PackageIcon size={64} weight="thin" class="mx-auto mb-4 opacity-50" />
					<h3 class="text-lg font-medium mb-2" style="color: var(--color-text-primary)">
						No products yet
					</h3>
					<p class="text-sm" style="color: var(--color-text-secondary)">
						This store hasn't listed any products.
					</p>
				</div>
			{:else}
				<div class="products-grid">
					{#each productEvents as event (event.id)}
						<ProductCard {event} trustRank={kitchen?.trustRank} />
					{/each}
				</div>
			{/if}
		{:else if activeTab === 'about'}
			<div class="about-section p-6 rounded-2xl" style="background-color: var(--color-bg-secondary);">
				{#if kitchen.description}
					<div class="mb-4">
						<h3 class="text-sm font-semibold mb-2" style="color: var(--color-text-secondary)">About</h3>
						<p style="color: var(--color-text-primary)">{kitchen.description}</p>
					</div>
				{/if}
				{#if kitchen.location}
					<div class="mb-4">
						<h3 class="text-sm font-semibold mb-2" style="color: var(--color-text-secondary)">Location</h3>
						<p style="color: var(--color-text-primary)">{kitchen.location}</p>
					</div>
				{/if}
				{#if kitchen.lightningAddress}
					<div>
						<h3 class="text-sm font-semibold mb-2" style="color: var(--color-text-secondary)">Lightning Address</h3>
						<p class="text-orange-500">{kitchen.lightningAddress}</p>
					</div>
				{/if}
				{#if !kitchen.description && !kitchen.location && !kitchen.lightningAddress}
					<p class="text-sm" style="color: var(--color-text-secondary)">No additional information available.</p>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<style lang="postcss">
	@reference "../../../../app.css";

	.tab-btn {
		@apply flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all;
		background-color: var(--color-bg-secondary);
		color: var(--color-text-secondary);
	}

	.tab-btn:hover {
		color: var(--color-text-primary);
	}

	.tab-btn.active {
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
</style>
