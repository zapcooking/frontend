<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { NDKEvent } from '@nostr-dev-kit/ndk';
	import LightningIcon from 'phosphor-svelte/lib/Lightning';
	import PackageIcon from 'phosphor-svelte/lib/Package';
	import CloudArrowDownIcon from 'phosphor-svelte/lib/CloudArrowDown';
	import TrashIcon from 'phosphor-svelte/lib/Trash';
	import { parseProductEvent, formatSatsPrice } from '$lib/marketplace/products';
	import { CATEGORY_LABELS, type Product } from '$lib/marketplace/types';
	import { getImageOrPlaceholder } from '$lib/placeholderImages';
	import CustomAvatar from '../CustomAvatar.svelte';
	import CustomName from '../CustomName.svelte';
	import ProductDetailModal from './ProductDetailModal.svelte';

	export let event: NDKEvent;
	export let showDelete = false;

	const dispatch = createEventDispatcher<{ delete: { product: Product } }>();

	let imageElement: HTMLElement | null = null;
	let imageLoaded = false;
	let showDetailModal = false;

	// Parse product data from event
	$: product = parseProductEvent(event);
	$: title = product?.title || '';
	$: priceSats = product?.priceSats || 0;
	$: category = product?.category || 'ingredients';
	$: requiresShipping = product?.requiresShipping ?? true;
	$: sellerPubkey = product?.pubkey || '';

	// Get primary image with placeholder fallback
	$: imageUrl = product?.images?.[0]
		? getImageOrPlaceholder(product.images[0], event.id)
		: getImageOrPlaceholder(undefined, event.id);

	// Load image when element is available
	$: if (imageElement && imageUrl && !imageLoaded) {
		imageElement.style.backgroundImage = `url('${imageUrl}')`;
		imageLoaded = true;
	}

	function openDetail() {
		showDetailModal = true;
	}

	function handleDelete(e: Event) {
		e.stopPropagation();
		if (product) {
			dispatch('delete', { product });
		}
	}
</script>

<button type="button" class="product-card text-left w-full" on:click={openDetail}>
	<!-- Image -->
	<div class="relative image-container">
		<div
			bind:this={imageElement}
			class="absolute inset-0 image"
		/>
		<!-- Category badge -->
		<span class="absolute top-2 right-2 text-xs font-medium px-2 py-1 rounded-full category-badge">
			{CATEGORY_LABELS[category]}
		</span>
		<!-- Delete button (only shown for owner) -->
		{#if showDelete}
			<button
				type="button"
				on:click={handleDelete}
				class="absolute top-2 left-2 p-2 rounded-full delete-button transition-all"
				title="Delete product"
			>
				<TrashIcon size={16} weight="bold" />
			</button>
		{/if}
	</div>

	<!-- Content -->
	<div class="p-3 flex flex-col gap-2">
		<!-- Title -->
		<h5 class="text-sm leading-tight line-clamp-2 min-h-[2.5rem] font-semibold" style="color: var(--color-text-primary)">
			{title}
		</h5>

		<!-- Shipping badge -->
		<div class="flex items-center gap-1.5 text-xs {requiresShipping ? 'text-gray-400' : 'text-emerald-400'}">
			{#if requiresShipping}
				<PackageIcon size={14} />
				<span>Requires shipping</span>
			{:else}
				<CloudArrowDownIcon size={14} />
				<span>Instant delivery</span>
			{/if}
		</div>

		<!-- Price -->
		<div class="flex items-baseline gap-1.5">
			<span class="text-lg font-bold text-orange-500">
				{priceSats.toLocaleString()}
			</span>
			<span class="text-xs" style="color: var(--color-text-secondary)">sats</span>
		</div>

		<!-- Seller -->
		{#if sellerPubkey}
			<div class="flex items-center gap-2 mt-1">
				<CustomAvatar pubkey={sellerPubkey} size={20} className="flex-shrink-0" />
				<span class="text-xs truncate" style="color: var(--color-text-secondary)">
					<CustomName pubkey={sellerPubkey} />
				</span>
			</div>
		{/if}

		<!-- View Details Button -->
		<div class="view-button w-full mt-2 py-2 rounded-lg font-semibold text-sm flex items-center justify-center gap-2">
			<LightningIcon size={16} weight="fill" />
			View Details
		</div>
	</div>
</button>

<!-- Product Detail Modal -->
{#if product}
	<ProductDetailModal bind:open={showDetailModal} {product} />
{/if}

<style lang="postcss">
	@reference "../../app.css";

	.product-card {
		@apply rounded-xl overflow-hidden transition-all duration-200;
		background-color: var(--color-bg-secondary);
		border: 1px solid transparent;
	}

	.product-card:hover {
		border-color: rgba(249, 115, 22, 0.3);
		box-shadow: 0 8px 24px rgba(249, 115, 22, 0.1);
		transform: translateY(-2px);
	}

	.image-container {
		@apply w-full aspect-square relative;
		background-color: var(--color-bg-tertiary, rgba(0, 0, 0, 0.1));
	}

	.image {
		@apply w-full h-full bg-cover bg-center transition-transform duration-500;
	}

	.product-card:hover .image {
		transform: scale(1.05);
	}

	.category-badge {
		background-color: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(4px);
		color: white;
	}

	.delete-button {
		background-color: rgba(239, 68, 68, 0.9);
		backdrop-filter: blur(4px);
		color: white;
	}

	.delete-button:hover {
		background-color: rgba(220, 38, 38, 1);
		transform: scale(1.1);
	}

	.view-button {
		background-color: var(--color-accent);
		color: white;
	}

	.product-card:hover .view-button {
		background-color: #ea580c;
	}
</style>
