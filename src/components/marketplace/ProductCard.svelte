<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { NDKEvent } from '@nostr-dev-kit/ndk';
	import ChatCircleIcon from 'phosphor-svelte/lib/ChatCircle';
	import LightningIcon from 'phosphor-svelte/lib/Lightning';
	import PackageIcon from 'phosphor-svelte/lib/Package';
	import CloudArrowDownIcon from 'phosphor-svelte/lib/CloudArrowDown';
	import TrashIcon from 'phosphor-svelte/lib/Trash';
	import { nip19 } from 'nostr-tools';
	import { parseProductEvent } from '$lib/marketplace/products';
	import type { Product } from '$lib/marketplace/types';
	import { resolveCommerceState, getCommerceLabel, getCommerceConfig, getShippingText, isMessageFlow } from '$lib/marketplace/commerceState';
	import { getImageOrPlaceholder } from '$lib/placeholderImages';
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwise';
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
	import CustomAvatar from '../CustomAvatar.svelte';
	import CustomName from '../CustomName.svelte';
	import ProductDetailModal from './ProductDetailModal.svelte';
	import TrustBadge from './TrustBadge.svelte';

	export let event: NDKEvent;
	export let showDelete = false;
	export let showRelist = false;
	export let showEdit = false;
	export let trustRank: number | undefined = undefined;
	export let personalized: boolean = false;

	const dispatch = createEventDispatcher<{ delete: { product: Product }; relist: { product: Product }; hide: void }>();

	let imageElement: HTMLImageElement | null = null;
	let showDetailModal = false;
	let openWithDm = false;
	let hidden = false;

	function handleImageError() {
		hidden = true;
		dispatch('hide');
	}

	// Parse product data from event
	$: product = parseProductEvent(event);
	$: title = product?.title || '';
	$: priceSats = product?.priceSats || 0;
	$: sellerPubkey = product?.pubkey || '';
	$: sellerNpub = sellerPubkey ? nip19.npubEncode(sellerPubkey) : '';
	$: kitchenUrl = sellerNpub ? `/market/kitchen/${sellerNpub}` : '';

	// Commerce state
	$: commerceState = product ? resolveCommerceState(product) : 'message_to_order';
	$: stateConfig = getCommerceConfig(commerceState);
	$: commerceLabel = getCommerceLabel(commerceState, priceSats);
	$: shippingText = product ? getShippingText(product) : '';
	$: isDigital = !product?.requiresShipping;

	// Get primary image with placeholder fallback
	$: imageUrl = product?.images?.[0]
		? getImageOrPlaceholder(product.images[0], event.id)
		: getImageOrPlaceholder(undefined, event.id);

	function openDetail() {
		openWithDm = false;
		showDetailModal = true;
	}

	function openDetailWithDm(e: Event) {
		e.stopPropagation();
		openWithDm = true;
		showDetailModal = true;
	}

	function handleDelete(e: Event) {
		e.stopPropagation();
		if (product) {
			dispatch('delete', { product });
		}
	}

	function handleRelist(e: Event) {
		e.stopPropagation();
		if (product) {
			dispatch('relist', { product });
		}
	}

	function handleEdit(e: Event) {
		e.stopPropagation();
		if (product) {
			window.location.href = `/my-store/edit/${product.id}`;
		}
	}
</script>

{#if !hidden}
<button type="button" class="product-card text-left w-full" on:click={openDetail}>
	<!-- Image -->
	<div class="relative image-container">
		<img
			bind:this={imageElement}
			src={imageUrl}
			alt={title}
			class="absolute inset-0 image object-cover"
			on:error={handleImageError}
		/>
		<!-- Owner action buttons -->
		{#if showDelete || showRelist || showEdit}
			<div class="absolute top-2 left-2 flex gap-1.5">
				{#if showEdit}
					<button
						type="button"
						on:click={handleEdit}
						class="p-2 rounded-full edit-button transition-all"
						title="Edit product"
					>
						<PencilSimpleIcon size={16} weight="bold" />
					</button>
				{/if}
				{#if showRelist}
					<button
						type="button"
						on:click={handleRelist}
						class="p-2 rounded-full relist-button transition-all"
						title="Relist product"
					>
						<ArrowClockwiseIcon size={16} weight="bold" />
					</button>
				{/if}
				{#if showDelete}
					<button
						type="button"
						on:click={handleDelete}
						class="p-2 rounded-full delete-button transition-all"
						title="Delete product"
					>
						<TrashIcon size={16} weight="bold" />
					</button>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Content -->
	<div class="p-3 flex flex-col gap-2">
		<!-- Title -->
		<h5 class="text-sm leading-tight line-clamp-2 min-h-[2.5rem] font-semibold" style="color: var(--color-text-primary)">
			{title}
		</h5>

		<!-- Commerce State Label -->
		<div class="flex items-baseline gap-1.5">
			{#if stateConfig.showPrice}
				<span class="text-xl font-bold {stateConfig.accentClass}">
					{commerceLabel}
				</span>
				<LightningIcon size={14} weight="fill" class="text-orange-400 self-center" />
			{:else}
				<span class="text-sm font-semibold {stateConfig.accentClass}">
					{commerceLabel}
				</span>
			{/if}
		</div>

		<!-- Seller -->
		{#if sellerPubkey}
			<span
				role="link"
				tabindex="-1"
				on:click|stopPropagation={() => { window.location.href = kitchenUrl; }}
				on:keydown|stopPropagation={(e) => { if (e.key === 'Enter') window.location.href = kitchenUrl; }}
				class="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer"
			>
				<CustomAvatar pubkey={sellerPubkey} size={20} className="flex-shrink-0" interactive={false} />
				<span class="text-xs truncate" style="color: var(--color-text-secondary)">
					<CustomName pubkey={sellerPubkey} />
				</span>
				<TrustBadge rank={trustRank} {personalized} />
			</span>
		{/if}

		<!-- Shipping / Delivery indicator -->
		<div class="flex items-center gap-1.5 text-xs {isDigital ? 'text-emerald-400' : 'text-gray-400'}">
			{#if isDigital}
				<CloudArrowDownIcon size={14} />
			{:else}
				<PackageIcon size={14} />
			{/if}
			<span>{shippingText}</span>
		</div>

		<!-- Action Buttons -->
		<div class="flex gap-2 mt-2">
			<div class="view-button flex-1 py-2 rounded-lg font-semibold text-sm flex items-center justify-center gap-1.5">
				{stateConfig.primaryCta}
			</div>
			{#if stateConfig.secondaryCta || !isMessageFlow(commerceState)}
				<button
					type="button"
					on:click={openDetailWithDm}
					class="message-button flex-shrink-0 py-2 px-3 rounded-lg transition-all flex items-center justify-center"
					title="Message Seller"
				>
					<ChatCircleIcon size={16} weight="fill" />
				</button>
			{/if}
		</div>
	</div>
</button>

<!-- Product Detail Modal -->
{#if product}
	<ProductDetailModal bind:open={showDetailModal} {product} {trustRank} {personalized} initialShowDm={openWithDm} />
{/if}
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
		@apply w-full h-full transition-transform duration-500;
	}

	.product-card:hover .image {
		transform: scale(1.05);
	}

	.edit-button {
		background-color: rgba(59, 130, 246, 0.9);
		backdrop-filter: blur(4px);
		color: white;
	}

	.edit-button:hover {
		background-color: rgba(37, 99, 235, 1);
		transform: scale(1.1);
	}

	.relist-button {
		background-color: rgba(249, 115, 22, 0.9);
		backdrop-filter: blur(4px);
		color: white;
	}

	.relist-button:hover {
		background-color: rgba(234, 88, 12, 1);
		transform: scale(1.1);
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

	.message-button {
		background-color: var(--color-bg-tertiary, rgba(0, 0, 0, 0.1));
		color: var(--color-accent);
		border: 1px solid rgba(249, 115, 22, 0.3);
	}

	.message-button:hover {
		background-color: rgba(249, 115, 22, 0.15);
		border-color: rgba(249, 115, 22, 0.5);
	}
</style>
