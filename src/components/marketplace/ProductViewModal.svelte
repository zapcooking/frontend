<script lang="ts">
	/**
	 * ProductViewModal — Full product detail view.
	 *
	 * Shows images, description, price, seller info, and shipping.
	 * "Message seller" button at the bottom opens the messaging modal.
	 * Payment button shown when instant checkout is available.
	 */
	import { nip19 } from 'nostr-tools';
	import Modal from '../Modal.svelte';
	import PackageIcon from 'phosphor-svelte/lib/Package';
	import CloudArrowDownIcon from 'phosphor-svelte/lib/CloudArrowDown';
	import MapPinIcon from 'phosphor-svelte/lib/MapPin';
	import TagIcon from 'phosphor-svelte/lib/Tag';
	import ChatCircleIcon from 'phosphor-svelte/lib/ChatCircle';
	import StorefrontIcon from 'phosphor-svelte/lib/Storefront';
	import CustomAvatar from '../CustomAvatar.svelte';
	import CustomName from '../CustomName.svelte';
	import TrustBadge from './TrustBadge.svelte';
	import PriceDisplay from './PriceDisplay.svelte';
	import PaymentActionPanel from './PaymentActionPanel.svelte';
	import Button from '../Button.svelte';
	import { CATEGORY_LABELS, type Product } from '$lib/marketplace/types';
	import { resolveCommerceState, getShippingText, isInstantCheckout } from '$lib/marketplace/commerceState';
	import { getImageOrPlaceholder } from '$lib/placeholderImages';
	import { formatSats } from '$lib/currencyConversion';
	import { createProductPaymentController } from '$lib/marketplace/productPayment';
	import { createEventDispatcher } from 'svelte';

	const dispatch = createEventDispatcher<{ message: void }>();

	export let open = false;
	export let product: Product;
	export let trustRank: number | undefined = undefined;
	export let personalized: boolean = false;

	const payment = createProductPaymentController();
	const { paymentSats, paymentState, paymentError, resolvingLightning, resolvedLightningAddress, copiedLightning } = payment;

	$: commerceState = resolveCommerceState(product);
	$: canInstantBuy = isInstantCheckout(commerceState);
	$: shippingText = getShippingText(product);

	// Drive controller sync reactively from props.
	$: payment.sync(product, open);

	$: paymentLabel =
		$paymentSats !== null
			? formatSats($paymentSats)
			: open && product && product.price > 0
				? 'Calculating...'
				: '';

	// Image gallery
	let activeImageIndex = 0;

	$: npub = product?.pubkey ? nip19.npubEncode(product.pubkey) : '';
	$: kitchenUrl = npub ? `/market/kitchen/${npub}` : '';

	$: allImages = (product?.images || []).map((img, i) =>
		getImageOrPlaceholder(img, `${product.id}-${i}`)
	);
	$: imageUrl = allImages.length > 0
		? allImages[activeImageIndex] || allImages[0]
		: getImageOrPlaceholder(undefined, product.id);

	$: if (open && product) {
		activeImageIndex = 0;
	}

	function handlePayClick() {
		payment.handlePayment(product, {
			onExternalLaunch: () => {
				open = false;
			},
			onExternalPaid: () => {
				open = true;
			},
			onExternalCancelled: () => {
				open = true;
			}
		});
	}

	function openMessageModal() {
		open = false;
		dispatch('message');
	}
</script>

<Modal bind:open>
	<h2 slot="title" class="line-clamp-1">{product?.title || 'Product Details'}</h2>

	<div class="flex flex-col gap-5">
		<!-- Product Image -->
		<div class="relative aspect-video rounded-xl overflow-hidden" style="background-color: var(--color-bg-tertiary);">
			<img src={imageUrl} alt={product?.title} class="w-full h-full object-cover" />
		</div>

		<!-- Image Thumbnails -->
		{#if allImages.length > 1}
			<div class="flex gap-2 overflow-x-auto pb-1">
				{#each allImages as thumb, i}
					<button
						type="button"
						on:click={() => (activeImageIndex = i)}
						class="flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-all"
						style="border-color: {activeImageIndex === i ? 'var(--color-accent)' : 'transparent'}; opacity: {activeImageIndex === i ? '1' : '0.6'};"
					>
						<img src={thumb} alt="" class="w-full h-full object-cover" />
					</button>
				{/each}
			</div>
		{/if}

		<!-- Price & Shipping -->
		<div class="flex items-center justify-between">
			{#if product && product.price > 0}
				<PriceDisplay price={product.price} currency={product.currency} size="lg" />
			{/if}
			<div class="flex items-center gap-1.5 text-sm {product?.requiresShipping ? '' : 'text-emerald-400'}">
				{#if product?.requiresShipping}
					<PackageIcon size={18} />
					<span style="color: var(--color-text-secondary)">{shippingText}</span>
				{:else}
					<CloudArrowDownIcon size={18} />
					<span>{shippingText}</span>
				{/if}
			</div>
		</div>

		<!-- Category & Location -->
		<div class="flex flex-wrap items-center gap-3 text-xs" style="color: var(--color-text-secondary)">
			{#if product?.category}
				<span class="flex items-center gap-1 px-2 py-1 rounded-full" style="background-color: var(--color-bg-tertiary);">
					<TagIcon size={12} />
					{CATEGORY_LABELS[product.category] || product.category}
				</span>
			{/if}
			{#if product?.location}
				<span class="flex items-center gap-1">
					<MapPinIcon size={14} />
					{product.location}
				</span>
			{/if}
		</div>

		<!-- Seller -->
		<div class="flex items-center gap-3 p-3 rounded-xl" style="background-color: var(--color-bg-tertiary);">
			<CustomAvatar pubkey={product?.pubkey || ''} size={40} className="flex-shrink-0" />
			<div class="flex flex-col flex-1">
				<span class="text-sm" style="color: var(--color-text-secondary)">Sold by</span>
				<span class="flex items-center gap-1.5 font-semibold" style="color: var(--color-text-primary)">
					<CustomName pubkey={product?.pubkey || ''} />
					<TrustBadge rank={trustRank} {personalized} />
				</span>
			</div>
			{#if kitchenUrl}
				<a
					href={kitchenUrl}
					on:click={() => (open = false)}
					class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-white/10"
					style="color: var(--color-text-secondary);"
				>
					<StorefrontIcon size={16} />
					<span class="hidden sm:inline">Store</span>
				</a>
			{/if}
		</div>

		<!-- Summary -->
		{#if product?.summary}
			<p class="text-sm" style="color: var(--color-text-secondary)">{product.summary}</p>
		{/if}

		<!-- Full Description -->
		{#if product?.description}
			<div class="text-sm whitespace-pre-wrap" style="color: var(--color-text-primary)">
				{product.description}
			</div>
		{/if}

		<!-- ═══ Actions ═══ -->

		{#if $paymentState === 'success' || $paymentState === 'error'}
			<PaymentActionPanel
				{canInstantBuy}
				paymentState={$paymentState}
				paymentError={$paymentError}
				{paymentLabel}
				resolvingLightning={$resolvingLightning}
				resolvedLightningAddress={$resolvedLightningAddress}
				copiedLightning={$copiedLightning}
				loadingText="Getting Invoice..."
				payButtonClass="w-full py-3 text-lg"
				on:pay={handlePayClick}
				on:copy={() => payment.copyLightning()}
				on:retry={() => payment.reset()}
			>
				<Button on:click={openMessageModal} class="w-full mt-2" slot="success-extra">
					<span class="flex items-center justify-center gap-2">
						<ChatCircleIcon size={18} weight="fill" />
						Message seller with order details
					</span>
				</Button>
			</PaymentActionPanel>
		{:else}
			<div class="flex flex-col gap-3">
				<PaymentActionPanel
					{canInstantBuy}
					paymentState={$paymentState}
					paymentError={$paymentError}
					{paymentLabel}
					resolvingLightning={$resolvingLightning}
					resolvedLightningAddress={$resolvedLightningAddress}
					copiedLightning={$copiedLightning}
					loadingText="Getting Invoice..."
					payButtonClass="w-full py-3 text-lg"
					on:pay={handlePayClick}
					on:copy={() => payment.copyLightning()}
					on:retry={() => payment.reset()}
				/>

				<!-- Message seller (always at bottom) -->
				<button
					type="button"
					on:click={openMessageModal}
					class="w-full py-3 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2"
					style="border: 1.5px solid rgba(249, 115, 22, 0.4); color: #f97316; background-color: rgba(249, 115, 22, 0.1);"
				>
					<ChatCircleIcon size={18} weight="fill" />
					Message seller
				</button>
			</div>
		{/if}
	</div>
</Modal>
