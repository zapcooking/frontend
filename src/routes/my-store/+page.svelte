<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { ndk, userPublickey } from '$lib/nostr';
	import type { NDKEvent } from '@nostr-dev-kit/ndk';
	import { fetchSellerProducts, deleteProduct, relistProduct, getRelistCooldownRemaining } from '$lib/marketplace/products';
	import { fetchKitchenByPubkey } from '$lib/marketplace/kitchens';
	import type { Product, Kitchen } from '$lib/marketplace/types';
	import { MARKETPLACE_LISTING_MAX_AGE_DAYS } from '$lib/marketplace/types';
	import ProductCard from '../../components/marketplace/ProductCard.svelte';
	import PanLoader from '../../components/PanLoader.svelte';
	import Button from '../../components/Button.svelte';
	import Modal from '../../components/Modal.svelte';
	import StorefrontIcon from 'phosphor-svelte/lib/Storefront';
	import PlusIcon from 'phosphor-svelte/lib/Plus';
	import LockIcon from 'phosphor-svelte/lib/Lock';
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';

	let products: NDKEvent[] = [];
	let loading = true;
	let checkingMembership = true;
	let hasActiveMembership = false;
	let membershipTier: string | undefined;
	let existingKitchen: Kitchen | null = null;
	let loadingKitchen = true;

	// Delete confirmation state
	let showDeleteModal = false;
	let productToDelete: Product | null = null;
	let deleting = false;
	let deleteError = '';

	// Relist confirmation state
	let showRelistModal = false;
	let productToRelist: Product | null = null;
	let relisting = false;
	let relistError = '';
	let relistSuccess = '';

	onMount(async () => {
		// Check if logged in
		if (!$userPublickey) {
			goto('/login');
			return;
		}

		// Check membership status
		await checkMembership();

		if (hasActiveMembership) {
			await Promise.all([loadProducts(), loadKitchen()]);
		}
	});

	async function checkMembership() {
		checkingMembership = true;
		try {
			const res = await fetch('/api/membership/check-status', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ pubkey: $userPublickey })
			});

			if (res.ok) {
				const data = await res.json();
				hasActiveMembership = data.isActive === true;
				membershipTier = data.member?.tier;
			}
		} catch (e) {
			console.error('[MyStore] Failed to check membership:', e);
		} finally {
			checkingMembership = false;
		}
	}

	async function loadKitchen() {
		loadingKitchen = true;
		try {
			existingKitchen = await fetchKitchenByPubkey($ndk, $userPublickey);
		} catch (e) {
			console.error('[MyStore] Failed to load kitchen:', e);
		} finally {
			loadingKitchen = false;
		}
	}

	async function loadProducts() {
		loading = true;
		try {
			const fetchedProducts = await fetchSellerProducts($ndk, $userPublickey);
			products = fetchedProducts.map((p) => p.event);
		} catch (e) {
			console.error('[MyStore] Failed to load products:', e);
		} finally {
			loading = false;
		}
	}

	function handleDeleteRequest(e: CustomEvent<{ product: Product }>) {
		productToDelete = e.detail.product;
		deleteError = '';
		showDeleteModal = true;
	}

	async function confirmDelete() {
		if (!productToDelete) return;

		deleting = true;
		deleteError = '';

		try {
			const result = await deleteProduct($ndk, productToDelete);

			if (result.success) {
				// Remove from local list
				products = products.filter((p) => p.id !== productToDelete?.event?.id);
				showDeleteModal = false;
				productToDelete = null;
			} else {
				deleteError = result.error || 'Failed to delete product';
			}
		} catch (e) {
			console.error('[MyStore] Delete failed:', e);
			deleteError = e instanceof Error ? e.message : 'Failed to delete product';
		} finally {
			deleting = false;
		}
	}

	function cancelDelete() {
		showDeleteModal = false;
		productToDelete = null;
		deleteError = '';
	}

	function handleRelistRequest(e: CustomEvent<{ product: Product }>) {
		const product = e.detail.product;

		// Check cooldown before showing modal
		const remaining = getRelistCooldownRemaining(product.id);
		if (remaining > 0) {
			const days = Math.ceil(remaining / (24 * 60 * 60 * 1000));
			relistError = `You can relist this item again in ${days} day${days === 1 ? '' : 's'}`;
			productToRelist = product;
			showRelistModal = true;
			return;
		}

		productToRelist = product;
		relistError = '';
		showRelistModal = true;
	}

	$: relistProductIsStillActive = productToRelist
		? (productToRelist.createdAt >= Math.floor(Date.now() / 1000) - 60 * 60 * 24 * MARKETPLACE_LISTING_MAX_AGE_DAYS)
		: false;

	$: relistOnCooldown = productToRelist
		? getRelistCooldownRemaining(productToRelist.id) > 0
		: false;

	async function confirmRelist() {
		if (!productToRelist || relistOnCooldown) return;

		relisting = true;
		relistError = '';

		try {
			const result = await relistProduct($ndk, productToRelist);

			if (result.success && result.event) {
				// Replace the old event in the local list with the new one
				const oldId = productToRelist.event.id;
				products = products.map((p) => (p.id === oldId ? result.event! : p));

				showRelistModal = false;
				productToRelist = null;
				relistSuccess = 'Listing refreshed!';
				setTimeout(() => { relistSuccess = ''; }, 3000);
			} else {
				relistError = result.error || 'Failed to relist product';
			}
		} catch (e) {
			console.error('[MyStore] Relist failed:', e);
			relistError = e instanceof Error ? e.message : 'Failed to relist product';
		} finally {
			relisting = false;
		}
	}

	function cancelRelist() {
		showRelistModal = false;
		productToRelist = null;
		relistError = '';
	}
</script>

<svelte:head>
	<title>My Store | zap.cooking</title>
</svelte:head>

<div class="my-store-page max-w-4xl mx-auto px-4 py-6">
	<!-- Header -->
	<div class="flex items-center justify-between mb-6">
		<div class="flex items-center gap-3">
			<StorefrontIcon size={32} weight="duotone" class="text-orange-500" />
			<h1 class="text-2xl font-bold" style="color: var(--color-text-primary)">My Store</h1>
		</div>
		{#if hasActiveMembership}
			<a href="/my-store/new">
				<Button>
					<PlusIcon size={18} weight="bold" class="mr-1" />
					New Product
				</Button>
			</a>
		{/if}
	</div>

	<!-- Loading membership check -->
	{#if checkingMembership}
		<div class="flex justify-center py-12">
			<PanLoader size="md" />
		</div>

	<!-- Not a member - show upgrade prompt -->
	{:else if !hasActiveMembership}
		<div class="membership-gate text-center py-12 px-6 rounded-2xl" style="background-color: var(--color-bg-secondary);">
			<LockIcon size={64} weight="duotone" class="mx-auto mb-4 text-orange-500" />
			<h2 class="text-xl font-bold mb-2" style="color: var(--color-text-primary)">
				Membership Required
			</h2>
			<p class="text-sm mb-6 max-w-md mx-auto" style="color: var(--color-text-secondary)">
				Create your own store and sell products to the cooking community. 
				Upgrade to a zap.cooking membership to unlock marketplace features.
			</p>
			<a
				href="/membership"
				class="inline-block px-6 py-3 rounded-xl font-semibold transition-transform hover:scale-105"
				style="background: linear-gradient(135deg, #f97316, #fb923c); color: white;"
			>
				View Membership Plans
			</a>
		</div>

	<!-- Has membership - show dashboard -->
	{:else}
		<!-- Kitchen Section -->
		<div class="mb-8">
			<h2 class="text-lg font-semibold mb-3" style="color: var(--color-text-primary)">Store</h2>
			{#if loadingKitchen}
				<div class="p-6 rounded-2xl animate-pulse" style="background-color: var(--color-bg-secondary);">
					<div class="h-4 w-1/3 rounded" style="background-color: var(--color-bg-tertiary, rgba(0,0,0,0.1));"></div>
				</div>
			{:else if existingKitchen}
				<div class="p-4 rounded-2xl flex items-center justify-between" style="background-color: var(--color-bg-secondary);">
					<div class="flex items-center gap-3">
						{#if existingKitchen.avatar}
							<img src={existingKitchen.avatar} alt="" class="w-10 h-10 rounded-full object-cover" />
						{:else}
							<div class="w-10 h-10 rounded-full flex items-center justify-center" style="background-color: var(--color-bg-tertiary, rgba(0,0,0,0.1));">
								<StorefrontIcon size={20} class="opacity-50" />
							</div>
						{/if}
						<div>
							<p class="font-medium" style="color: var(--color-text-primary)">{existingKitchen.name}</p>
							{#if existingKitchen.description}
								<p class="text-sm line-clamp-1" style="color: var(--color-text-secondary)">{existingKitchen.description}</p>
							{/if}
						</div>
					</div>
					<a href="/my-store/kitchen" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:bg-white/5" style="color: var(--color-text-secondary);">
						<PencilSimpleIcon size={16} />
						Edit
					</a>
				</div>
			{:else}
				<div class="p-6 rounded-2xl text-center" style="background-color: var(--color-bg-secondary);">
					<p class="text-sm mb-3" style="color: var(--color-text-secondary)">
						Set up your store to group your products and build your brand.
					</p>
					<a
						href="/my-store/kitchen"
						class="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all hover:scale-105"
						style="background: linear-gradient(135deg, #f97316, #ea580c); color: white;"
					>
						<PlusIcon size={16} weight="bold" />
						Create Store
					</a>
				</div>
			{/if}
		</div>

		<!-- Products Section -->
		{#if loading}
			<div class="flex justify-center py-12">
				<PanLoader size="md" />
			</div>
		{:else if products.length === 0}
			<!-- Empty state -->
			<div class="text-center py-12 px-6 rounded-2xl" style="background-color: var(--color-bg-secondary);">
				<StorefrontIcon size={64} weight="thin" class="mx-auto mb-4 opacity-50" />
				<h2 class="text-lg font-medium mb-2" style="color: var(--color-text-primary)">
					No products yet
				</h2>
				<p class="text-sm mb-6" style="color: var(--color-text-secondary)">
					Start selling by creating your first product listing.
				</p>
				<a href="/my-store/new">
					<Button>
						<PlusIcon size={18} weight="bold" class="mr-1" />
						Create Your First Product
					</Button>
				</a>
			</div>
		{:else}
			<!-- Products list -->
			<div class="mb-4">
				<p class="text-sm" style="color: var(--color-text-secondary)">
					{products.length} product{products.length === 1 ? '' : 's'} listed
				</p>
			</div>
			<div class="products-grid">
				{#each products as event (event.id)}
					<ProductCard {event} showDelete={true} showRelist={true} on:delete={handleDeleteRequest} on:relist={handleRelistRequest} />
				{/each}
			</div>
		{/if}
	{/if}
</div>

<!-- Delete Confirmation Modal -->
<Modal bind:open={showDeleteModal} on:close={cancelDelete}>
	<svelte:fragment slot="title">Delete Product</svelte:fragment>
	<div class="flex flex-col gap-4">
		<p style="color: var(--color-text-secondary)">
			Are you sure you want to delete <strong style="color: var(--color-text-primary)">{productToDelete?.title}</strong>?
		</p>
		<p class="text-sm" style="color: var(--color-text-secondary)">
			This action cannot be undone. The product listing will be removed from the marketplace.
		</p>

		{#if deleteError}
			<div class="p-3 rounded-lg text-sm" style="background-color: rgba(239, 68, 68, 0.1); color: #ef4444;">
				{deleteError}
			</div>
		{/if}

		<div class="flex gap-3 justify-end mt-2">
			<Button on:click={cancelDelete} disabled={deleting}>
				Cancel
			</Button>
			<button
				on:click={confirmDelete}
				disabled={deleting}
				class="px-4 py-2 rounded-lg font-semibold text-white transition-colors disabled:opacity-50"
				style="background-color: #ef4444;"
			>
				{#if deleting}
					Deleting...
				{:else}
					Delete Product
				{/if}
			</button>
		</div>
	</div>
</Modal>

<!-- Relist Confirmation Modal -->
<Modal bind:open={showRelistModal} on:close={cancelRelist}>
	<svelte:fragment slot="title">Relist Product</svelte:fragment>
	<div class="flex flex-col gap-4">
		{#if relistOnCooldown}
			<p style="color: var(--color-text-secondary)">
				{relistError}
			</p>
			<div class="flex gap-3 justify-end mt-2">
				<Button on:click={cancelRelist}>OK</Button>
			</div>
		{:else}
			<p style="color: var(--color-text-secondary)">
				{#if relistProductIsStillActive}
					Your listing <strong style="color: var(--color-text-primary)">{productToRelist?.title}</strong> is still active — relist now to reset the 6-month timer?
				{:else}
					This will repost your listing <strong style="color: var(--color-text-primary)">{productToRelist?.title}</strong> with today's date. Your current listing will be replaced.
				{/if}
			</p>

			{#if relistError}
				<div class="p-3 rounded-lg text-sm" style="background-color: rgba(239, 68, 68, 0.1); color: #ef4444;">
					{relistError}
				</div>
			{/if}

			<div class="flex gap-3 justify-end mt-2">
				<Button on:click={cancelRelist} disabled={relisting}>
					Cancel
				</Button>
				<button
					on:click={confirmRelist}
					disabled={relisting}
					class="px-4 py-2 rounded-lg font-semibold text-white transition-colors disabled:opacity-50"
					style="background: linear-gradient(135deg, #f97316, #ea580c);"
				>
					{#if relisting}
						Relisting...
					{:else}
						Confirm Relist
					{/if}
				</button>
			</div>
		{/if}
	</div>
</Modal>

<!-- Success Toast -->
{#if relistSuccess}
	<div class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-sm font-medium text-white shadow-lg" style="background: linear-gradient(135deg, #f97316, #ea580c);">
		{relistSuccess}
	</div>
{/if}

<style lang="postcss">
	@reference "../../app.css";

	.products-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		gap: 1.5rem;
		justify-items: center;
	}

	@media (min-width: 640px) {
		.products-grid {
			grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		}
	}
</style>
