<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { ndk, userPublickey } from '$lib/nostr';
	import type { NDKEvent } from '@nostr-dev-kit/ndk';
	import { fetchSellerProducts, deleteProduct } from '$lib/marketplace/products';
	import type { Product } from '$lib/marketplace/types';
	import ProductCard from '../../components/marketplace/ProductCard.svelte';
	import PanLoader from '../../components/PanLoader.svelte';
	import Button from '../../components/Button.svelte';
	import Modal from '../../components/Modal.svelte';
	import StorefrontIcon from 'phosphor-svelte/lib/Storefront';
	import PlusIcon from 'phosphor-svelte/lib/Plus';
	import LockIcon from 'phosphor-svelte/lib/Lock';

	let products: NDKEvent[] = [];
	let loading = true;
	let checkingMembership = true;
	let hasActiveMembership = false;
	let membershipTier: string | undefined;

	// Delete confirmation state
	let showDeleteModal = false;
	let productToDelete: Product | null = null;
	let deleting = false;
	let deleteError = '';

	onMount(async () => {
		// Check if logged in
		if (!$userPublickey) {
			goto('/login');
			return;
		}

		// Check membership status
		await checkMembership();

		if (hasActiveMembership) {
			await loadProducts();
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
					<ProductCard {event} showDelete={true} on:delete={handleDeleteRequest} />
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
