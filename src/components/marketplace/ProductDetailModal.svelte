<script lang="ts">
	import { nip19 } from 'nostr-tools';
	import { browser } from '$app/environment';
	import { onMount, tick } from 'svelte';
	import Modal from '../Modal.svelte';
	import Button from '../Button.svelte';
	import CustomAvatar from '../CustomAvatar.svelte';
	import CustomName from '../CustomName.svelte';
	import LightningIcon from 'phosphor-svelte/lib/Lightning';
	import CopyIcon from 'phosphor-svelte/lib/Copy';
	import CheckIcon from 'phosphor-svelte/lib/Check';
	import PaperPlaneTiltIcon from 'phosphor-svelte/lib/PaperPlaneTilt';
	import XIcon from 'phosphor-svelte/lib/X';
	import LockSimpleIcon from 'phosphor-svelte/lib/LockSimple';
	import LockSimpleOpenIcon from 'phosphor-svelte/lib/LockSimpleOpen';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
	import TrustBadge from './TrustBadge.svelte';
	import PriceDisplay from './PriceDisplay.svelte';
	import type { Product } from '$lib/marketplace/types';
	import { resolveCommerceState, getCommerceConfig, isInstantCheckout } from '$lib/marketplace/commerceState';
	import { getImageOrPlaceholder } from '$lib/placeholderImages';
	import { getInvoiceFromLightningAddress } from '$lib/marketplace/products';
	import { formatPrice, formatSats, convertToSats } from '$lib/currencyConversion';
	import { activeWallet } from '$lib/wallet';
	import { sendPayment } from '$lib/wallet/walletManager';
	import { lightningService } from '$lib/lightningService';
	import { userPublickey } from '$lib/nostr';
	import { sendDirectMessage, sendNip04DirectMessage, isNip17Supported } from '$lib/nip17';

	// Dynamic imports for browser-only modules
	let hasEncryptionSupport: (() => boolean) | null = null;
	let encryptionServiceLoaded = false;
	let encryptionDebugInfo: { signerType: string; hasWindowNostr: boolean; hasPrivateKey: boolean; hasNip04: boolean; hasNip44: boolean } | null = null;

	onMount(async () => {
		const encryptionService = await import('$lib/encryptionService');
		hasEncryptionSupport = encryptionService.hasEncryptionSupport;
		encryptionServiceLoaded = true;

		const ndkInstance = (await import('$lib/nostr')).ndk;
		const { get } = await import('svelte/store');
		const ndk = get(ndkInstance);
		const signer = ndk?.signer;
		const nostr = (window as any).nostr;

		encryptionDebugInfo = {
			signerType: signer?.constructor?.name || 'none',
			hasWindowNostr: !!nostr,
			hasPrivateKey: !!localStorage.getItem('nostrcooking_privateKey'),
			hasNip04: !!(nostr?.nip04?.encrypt),
			hasNip44: !!(nostr?.nip44?.encrypt)
		};
	});

	export let open = false;
	export let product: Product;
	export let trustRank: number | undefined = undefined;
	export let personalized: boolean = false;

	// Commerce state
	$: commerceState = resolveCommerceState(product);
	$: stateConfig = getCommerceConfig(commerceState);
<<<<<<< feat/marketplace-commerce-state-v2
	$: canInstantBuy = isInstantCheckout(commerceState);

	// Sats amount for payment
	let paymentSats: number | null = null;
	$: {
		if (open && product && product.price > 0) {
			if (product.currency === 'SATS') {
				paymentSats = Math.round(product.price);
			} else {
				paymentSats = null;
				convertToSats(product.price, product.currency).then((s) => {
					paymentSats = s;
				});
			}
		} else {
			paymentSats = null;
		}
	}

	$: nativePriceDisplay = product ? formatPrice(product.price, product.currency) : '';
	$: paymentLabel =
		paymentSats !== null
			? formatSats(paymentSats)
			: open && product && product.price > 0
				? 'Calculating...'
				: nativePriceDisplay;

	// Lightning address resolution
	let resolvedLightningAddress = '';
=======
	$: commerceLabel = getCommerceLabel(commerceState, product?.priceSats || 0);
	$: shippingText = getShippingText(product);
	// canInstantBuy is strictly derived from commerce state.
	// A seller's profile lightning address does NOT upgrade a message_to_order
	// listing to instant checkout — the product must be explicitly configured
	// with both a price and a lightning tag to qualify.
	$: canInstantBuy = isInstantCheckout(commerceState);

	// Resolved lightning address (from product tag or seller profile fallback)
	let resolvedLightningAddress: string = '';
>>>>>>> main
	let resolvingLightning = false;

	$: if (open && product) {
		resolveLightningAddress(product);
	}

	async function resolveLightningAddress(p: Product) {
		if (p.lightningAddress) {
			resolvedLightningAddress = p.lightningAddress;
			return;
		}
		resolvingLightning = true;
		try {
			const ndkModule = await import('$lib/nostr');
			const { get } = await import('svelte/store');
			const ndkInstance = get(ndkModule.ndk);
			const user = ndkInstance.getUser({ pubkey: p.pubkey });
			const profile = await user.fetchProfile();
			resolvedLightningAddress = profile?.lud16 || '';
		} catch {
			resolvedLightningAddress = '';
		} finally {
			resolvingLightning = false;
		}
	}

	// Copy states
	let copiedLightning = false;

	// Payment states
	type PaymentState = 'idle' | 'loading' | 'success' | 'error';
	let paymentState: PaymentState = 'idle';
	let paymentError = '';

	// DM states
	let dmMessage = '';
	let sendingDm = false;
	let dmSent = false;
	let dmError = '';
	let sendProtocol: 'nip04' | 'nip17' = 'nip04';
	let messageInput: HTMLTextAreaElement;

	// Full details toggle
	let showFullDetails = false;

	$: nip17Available = isNip17Supported().supported;

	function toggleProtocol() {
		sendProtocol = sendProtocol === 'nip04' ? 'nip17' : 'nip04';
	}

	$: npub = product?.pubkey ? nip19.npubEncode(product.pubkey) : '';
	$: hasInAppWallet = $activeWallet && ($activeWallet.kind === 3 || $activeWallet.kind === 4);
	$: canSendDm = browser && $userPublickey && encryptionServiceLoaded && hasEncryptionSupport?.();

	$: imageUrl = product?.images?.[0]
		? getImageOrPlaceholder(product.images[0], product.id)
		: getImageOrPlaceholder(undefined, product.id);

	// Post-purchase DM
	$: postPurchaseDmMessage = `Hey! I just paid for "${product?.title}" (${paymentLabel}).${product?.requiresShipping ? '\n\nShipping address:\n[Your address here]' : ''}\n\nThanks!`;

	// Reset / initialize on open/close
	$: if (!open) {
		paymentState = 'idle';
		paymentError = '';
		dmMessage = '';
		dmSent = false;
		dmError = '';
		showFullDetails = false;
	} else if (open && !dmMessage) {
		// Pre-fill with casual inquiry
		dmMessage = `Hey \u2014 is "${product?.title}" still available?`;
		// Autofocus the textarea after the modal renders
		tick().then(() => {
			messageInput?.focus();
		});
	}

	async function copyLightning() {
		if (!resolvedLightningAddress) return;
		try {
			await navigator.clipboard.writeText(resolvedLightningAddress);
			copiedLightning = true;
			setTimeout(() => (copiedLightning = false), 2000);
		} catch {
			window.open(`lightning:${resolvedLightningAddress}`, '_blank');
		}
	}

	async function handlePayment() {
		if (!resolvedLightningAddress) {
			paymentError = 'No lightning address available for this seller';
			paymentState = 'error';
			return;
		}
		if (!product?.price) {
			paymentError = 'Product has no price set';
			paymentState = 'error';
			return;
		}

		paymentState = 'loading';
		paymentError = '';

		try {
			let amountSats: number;
			if (paymentSats) {
				amountSats = paymentSats;
			} else {
				const converted = await convertToSats(product.price, product.currency);
				if (!converted) throw new Error('Unable to convert price to sats.');
				amountSats = converted;
			}

			const { invoice, verify } = await getInvoiceFromLightningAddress(
				resolvedLightningAddress,
				amountSats
			);

			if (hasInAppWallet) {
				const result = await sendPayment(invoice, {
					amount: amountSats,
					description: `Purchase: ${product.title}`,
					pubkey: product.pubkey
				});

				if (result.success) {
					paymentState = 'success';
					setTimeout(() => {
						dmMessage = postPurchaseDmMessage;
					}, 1000);
				} else {
					throw new Error(result.error || 'Payment failed');
				}
			} else {
				open = false;
				await lightningService.launchPayment({
					invoice,
					verify,
					onPaid: () => {
						open = true;
						paymentState = 'success';
						dmMessage = postPurchaseDmMessage;
					},
					onCancelled: () => {
						open = true;
						paymentState = 'idle';
					}
				});
			}
		} catch (e) {
			paymentError = e instanceof Error ? e.message : 'Payment failed';
			paymentState = 'error';
		}
	}

	async function sendDm() {
		if (!product?.pubkey || !dmMessage.trim()) return;

		sendingDm = true;
		dmError = '';

		try {
			if (sendProtocol === 'nip17') {
				await sendDirectMessage(product.pubkey, dmMessage.trim());
			} else {
				await sendNip04DirectMessage(product.pubkey, dmMessage.trim());
			}
			dmSent = true;
			dmMessage = '';
		} catch (e) {
			dmError = e instanceof Error ? e.message : 'Failed to send message';
		} finally {
			sendingDm = false;
		}
	}

<<<<<<< feat/marketplace-commerce-state-v2
=======
	function openDmForm() {
		showDmForm = true;
		if (!dmMessage) {
			dmMessage = inquiryDmMessage;
		}
	}

>>>>>>> main
	async function recheckEncryption() {
		const encryptionService = await import('$lib/encryptionService');
		hasEncryptionSupport = encryptionService.hasEncryptionSupport;

		const ndkModule = await import('$lib/nostr');
		const { get } = await import('svelte/store');
		const ndkInstance = get(ndkModule.ndk);
		const signer = ndkInstance?.signer;
		const nostr = (window as any).nostr;

		encryptionDebugInfo = {
			signerType: signer?.constructor?.name || 'none',
			hasWindowNostr: !!nostr,
			hasPrivateKey: !!localStorage.getItem('nostrcooking_privateKey'),
			hasNip04: !!(nostr?.nip04?.encrypt),
			hasNip44: !!(nostr?.nip44?.encrypt)
		};
	}
</script>

<Modal bind:open>
	<span slot="title"></span>

	<div class="flex flex-col gap-4">

		<!-- ═══ Seller ═══ -->
		<div class="flex items-center gap-3">
			<CustomAvatar pubkey={product?.pubkey || ''} size={44} className="flex-shrink-0" />
			<div class="flex flex-col flex-1 min-w-0">
				<span class="font-semibold truncate" style="color: var(--color-text-primary)">
					<CustomName pubkey={product?.pubkey || ''} />
				</span>
				<span class="text-xs" style="color: var(--color-text-secondary)">Seller</span>
			</div>
			<TrustBadge rank={trustRank} {personalized} />
		</div>

		<!-- ═══ Product summary card ═══ -->
		<div class="flex gap-3 p-3 rounded-xl" style="background-color: var(--color-bg-tertiary);">
			<img
				src={imageUrl}
				alt={product?.title}
				class="w-16 h-16 rounded-lg object-cover flex-shrink-0"
			/>
			<div class="flex flex-col justify-center min-w-0 flex-1">
				<span class="text-sm font-semibold leading-tight line-clamp-2" style="color: var(--color-text-primary)">
					{product?.title}
				</span>
				{#if product && product.price > 0}
					<PriceDisplay price={product.price} currency={product.currency} size="xs" />
				{/if}
			</div>
		</div>

		<!-- ═══ Message area (primary focus) ═══ -->
		{#if dmSent}
			<div class="flex flex-col items-center gap-3 py-6">
				<div class="w-14 h-14 rounded-full flex items-center justify-center bg-emerald-500/20">
					<CheckIcon size={28} weight="bold" class="text-emerald-400" />
				</div>
				<p class="text-sm font-medium text-emerald-400">Message sent!</p>
			</div>
		{:else if canSendDm}
			<div class="flex flex-col gap-2">
				<textarea
					bind:this={messageInput}
					bind:value={dmMessage}
					rows="3"
					class="w-full p-3 rounded-xl text-sm resize-none"
					style="background-color: var(--color-bg-secondary); color: var(--color-text-primary); border: 1px solid rgba(249, 115, 22, 0.25);"
					placeholder="Write a message..."
				/>

				{#if dmError}
					<p class="text-xs text-red-400">{dmError}</p>
				{/if}

				<!-- Send button (primary CTA) -->
				<Button on:click={sendDm} disabled={sendingDm || !dmMessage.trim()} class="w-full py-3">
					{#if sendingDm}
						<span class="flex items-center justify-center gap-2">
							<svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
							</svg>
							Sending...
						</span>
					{:else}
						<span class="flex items-center justify-center gap-2">
							<PaperPlaneTiltIcon size={18} weight="fill" />
							Send Message
						</span>
					{/if}
				</Button>

				<!-- Protocol toggle (tucked away) -->
				<div class="flex items-center justify-between px-1">
					<div class="flex items-center gap-1.5">
						{#if sendProtocol === 'nip17'}
							<LockSimpleIcon class="w-3 h-3" weight="bold" style="color: rgba(167, 139, 250, 0.8);" />
							<span class="text-[10px]" style="color: rgba(167, 139, 250, 0.8);">Private</span>
						{:else}
							<LockSimpleOpenIcon class="w-3 h-3" weight="bold" style="color: rgba(249, 115, 22, 0.5);" />
							<span class="text-[10px]" style="color: rgba(249, 115, 22, 0.5);">Compatible</span>
						{/if}
					</div>
					<button
						type="button"
						on:click|stopPropagation={toggleProtocol}
						class="relative flex items-center w-[60px] h-6 rounded-full cursor-pointer transition-colors duration-200"
						style={sendProtocol === 'nip17'
							? 'background-color: rgba(124, 58, 237, 0.25);'
							: 'background-color: rgba(249, 115, 22, 0.15);'}
						disabled={!nip17Available && sendProtocol === 'nip04'}
					>
						<span
							class="absolute top-0.5 h-5 w-[28px] rounded-full transition-all duration-200 shadow-sm"
							style="left: {sendProtocol === 'nip17' ? '30px' : '2px'};
								background-color: {sendProtocol === 'nip17'
								? 'rgba(124, 58, 237, 0.9)'
								: 'rgba(249, 115, 22, 0.8)'};"
						></span>
						<span class="relative z-10 w-1/2 text-center text-[8px] font-semibold"
							style="color: {sendProtocol === 'nip04' ? '#fff' : 'rgba(249, 115, 22, 0.5)'};">04</span>
						<span class="relative z-10 w-1/2 text-center text-[8px] font-semibold"
							style="color: {sendProtocol === 'nip17' ? '#fff' : 'rgba(167, 139, 250, 0.5)'};">17</span>
					</button>
				</div>
			</div>
		{:else}
			<!-- Not logged in / no encryption -->
			<div class="text-sm p-4 rounded-xl" style="background-color: var(--color-bg-tertiary); color: var(--color-text-secondary);">
				{#if !$userPublickey}
					<p>Log in to message this seller.</p>
				{:else if !encryptionServiceLoaded}
					<p>Loading...</p>
				{:else}
					<p class="mb-2">Unable to send encrypted messages from this session.</p>
					<button
						type="button"
						on:click={recheckEncryption}
						class="text-xs text-orange-500 hover:text-orange-400 underline"
					>
						Retry
					</button>
				{/if}
			</div>
		{/if}

		<!-- ═══ Payment (instant buy) ═══ -->
		{#if canInstantBuy && (paymentState === 'idle' || paymentState === 'loading')}
			<Button
				class="w-full py-3"
				on:click={handlePayment}
				disabled={paymentState === 'loading' || resolvingLightning || !resolvedLightningAddress}
			>
				<span class="flex items-center justify-center gap-2">
					{#if resolvingLightning || paymentState === 'loading'}
						<svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
					{:else}
						<LightningIcon size={20} weight="fill" />
						Pay {paymentLabel}
					{/if}
				</span>
			</Button>

			{#if resolvedLightningAddress}
				<button
					type="button"
					on:click={copyLightning}
					class="flex items-center justify-center gap-2 py-1.5 text-xs transition-colors hover:opacity-80"
					style="color: var(--color-text-secondary);"
				>
					{#if copiedLightning}
						<CheckIcon size={12} class="text-emerald-400" />
						<span class="text-emerald-400">Copied!</span>
					{:else}
						<CopyIcon size={12} />
						Copy Lightning address
					{/if}
				</button>
			{/if}
		{/if}

		{#if paymentState === 'success'}
			<div class="flex flex-col items-center gap-3 py-4 rounded-xl" style="background-color: var(--color-bg-tertiary);">
				<div class="w-12 h-12 rounded-full flex items-center justify-center bg-emerald-500/20">
					<CheckIcon size={24} weight="bold" class="text-emerald-400" />
				</div>
				<p class="text-sm font-medium" style="color: var(--color-text-primary)">Payment sent!</p>
				<p class="text-xs" style="color: var(--color-text-secondary)">{paymentLabel}</p>
			</div>
		{:else if paymentState === 'error'}
			<div class="flex flex-col items-center gap-3 py-4 rounded-xl" style="background-color: rgba(239, 68, 68, 0.1);">
				<XIcon size={24} weight="bold" class="text-red-400" />
				<p class="text-sm text-red-400">{paymentError}</p>
				<Button on:click={() => (paymentState = 'idle')}>Try Again</Button>
			</div>
		{/if}

<<<<<<< feat/marketplace-commerce-state-v2
		<!-- ═══ View full details (expandable) ═══ -->
		<button
			type="button"
			on:click={() => (showFullDetails = !showFullDetails)}
			class="flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors"
			style="color: var(--color-text-secondary);"
		>
			{showFullDetails ? 'Hide details' : 'View full details'}
			<CaretDownIcon
				size={12}
				class="transition-transform duration-200"
				style="transform: rotate({showFullDetails ? '180deg' : '0deg'});"
			/>
		</button>

		{#if showFullDetails}
			<div class="flex flex-col gap-4 pt-1">
				<!-- Full image -->
				{#if product?.images?.length}
					<div class="relative aspect-video rounded-xl overflow-hidden" style="background-color: var(--color-bg-tertiary);">
						<img
							src={imageUrl}
							alt={product?.title}
							class="w-full h-full object-cover"
						/>
					</div>
				{/if}

				{#if product?.summary}
					<p class="text-sm" style="color: var(--color-text-secondary)">{product.summary}</p>
				{/if}

				{#if product?.description}
					<div class="text-sm whitespace-pre-wrap" style="color: var(--color-text-primary)">
						{product.description}
					</div>
				{/if}

				{#if product?.location}
					<p class="text-xs" style="color: var(--color-text-secondary)">Ships from {product.location}</p>
=======
		<!-- DM Form (shown when expanded or after payment) -->
		{#if showDmForm || paymentState === 'success'}
			<div class="flex flex-col gap-3 p-4 rounded-xl" style="background-color: var(--color-bg-tertiary);">
				<h3 class="font-semibold flex items-center gap-2" style="color: var(--color-text-primary)">
					<ChatCircleIcon size={20} weight="fill" class="text-orange-500" />
					{paymentState === 'success' ? 'Send Order Details to Seller' : 'Message Seller'}
				</h3>

				{#if dmSent}
					<div class="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/20 text-emerald-400">
						<CheckIcon size={18} />
						<span class="text-sm font-medium">Message sent to seller!</span>
					</div>
				{:else if canSendDm}
					<!-- Protocol toggle -->
					<div class="flex items-center justify-between px-0.5">
						<div class="flex items-center gap-1.5">
							{#if sendProtocol === 'nip17'}
								<LockSimpleIcon
									class="w-3 h-3 flex-shrink-0"
									weight="bold"
									style="color: rgba(167, 139, 250, 0.8);"
								/>
								<span class="text-[10px]" style="color: rgba(167, 139, 250, 0.8);">More private</span>
							{:else}
								<LockSimpleOpenIcon
									class="w-3 h-3 flex-shrink-0"
									weight="bold"
									style="color: rgba(249, 115, 22, 0.6);"
								/>
								<span class="text-[10px]" style="color: rgba(249, 115, 22, 0.6);">More compatible</span>
							{/if}
						</div>
						<div class="flex items-center gap-1.5">
							<span
								class="text-[8px] font-semibold uppercase tracking-[0.15em]"
								style="color: var(--color-text-secondary); opacity: 0.7;">NIP</span
							>
							<button
								type="button"
								on:click|stopPropagation={toggleProtocol}
								class="relative flex items-center w-[72px] h-7 rounded-full cursor-pointer transition-colors duration-200"
								style={sendProtocol === 'nip17'
									? 'background-color: rgba(124, 58, 237, 0.25);'
									: 'background-color: rgba(249, 115, 22, 0.18);'}
								title={sendProtocol === 'nip17'
									? 'More private (less compatible)'
									: 'More compatible (less private)'}
								disabled={!nip17Available && sendProtocol === 'nip04'}
							>
								<span
									class="absolute top-0.5 h-6 w-9 rounded-full transition-all duration-200 shadow-sm"
									style="left: {sendProtocol === 'nip17' ? '33px' : '2px'};
										background-color: {sendProtocol === 'nip17'
										? 'rgba(124, 58, 237, 0.9)'
										: 'rgba(249, 115, 22, 0.9)'};"
								></span>
								<span
									class="relative z-10 w-1/2 text-center text-[9px] font-semibold transition-colors duration-200"
									style="color: {sendProtocol === 'nip04' ? '#fff' : 'rgba(249, 115, 22, 0.6)'};">04</span
								>
								<span
									class="relative z-10 w-1/2 text-center text-[9px] font-semibold transition-colors duration-200"
									style="color: {sendProtocol === 'nip17' ? '#fff' : 'rgba(167, 139, 250, 0.6)'};"
									>17</span
								>
							</button>
						</div>
					</div>
					<textarea
						bind:value={dmMessage}
						rows="4"
						class="w-full p-3 rounded-lg text-sm resize-none transition-colors duration-200"
						style="background-color: var(--color-bg-secondary); color: var(--color-text-primary); border: 1px solid {sendProtocol === 'nip17' ? 'rgba(124, 58, 237, 0.35)' : 'rgba(249, 115, 22, 0.35)'};"
						placeholder="Write your message..."
					/>
					{#if dmError}
						<p class="text-xs text-red-400">{dmError}</p>
					{/if}
					<Button on:click={sendDm} disabled={sendingDm || !dmMessage.trim()}>
						{#if sendingDm}
							<span class="flex items-center gap-2">
								<svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
								Sending...
							</span>
						{:else}
							<span class="flex items-center gap-2">
								<PaperPlaneTiltIcon size={16} weight="fill" />
								Send Message
							</span>
						{/if}
					</Button>
				{:else}
					<div class="text-sm" style="color: var(--color-text-secondary)">
						{#if !$userPublickey}
							<p>Log in to send a direct message to the seller.</p>
						{:else if !encryptionServiceLoaded}
							<p>Loading encryption service...</p>
						{:else}
							<p class="mb-2">Unable to send encrypted DM from this session.</p>
							{#if encryptionDebugInfo}
								{#if encryptionDebugInfo.signerType.includes('Nip07Signer') && !encryptionDebugInfo.hasNip04 && !encryptionDebugInfo.hasNip44}
									<p class="text-xs mb-2">Your browser extension doesn't support encryption. Try unlocking it, then click retry.</p>
								{:else if encryptionDebugInfo.signerType.includes('PrivateKeySigner') && !encryptionDebugInfo.hasPrivateKey}
									<p class="text-xs mb-2">Private key not found. Try logging in again.</p>
								{:else if encryptionDebugInfo.signerType === 'none' && !encryptionDebugInfo.hasPrivateKey}
									<p class="text-xs mb-2">No signing method available. Try logging in again.</p>
								{/if}
							{/if}
							<div class="flex flex-col gap-2 mt-3">
								<button
									type="button"
									on:click={recheckEncryption}
									class="text-xs text-orange-500 hover:text-orange-400 underline"
								>
									Retry encryption check
								</button>
								<p class="text-xs">Or copy the seller's npub above and message them using your preferred Nostr client.</p>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/if}

		<!-- Primary + Secondary CTAs (idle state) -->
		{#if paymentState !== 'success' && paymentState !== 'error'}
			<div class="flex flex-col gap-3">
				<!-- Trust reinforcement near CTA -->
				{#if trustRank !== undefined && trustRank >= 20}
					<div class="flex items-center justify-center gap-2 py-1.5">
						<CustomAvatar pubkey={product?.pubkey || ''} size={18} className="flex-shrink-0" interactive={false} />
						<span class="text-xs" style="color: var(--color-text-secondary)">
							<CustomName pubkey={product?.pubkey || ''} />
						</span>
						<TrustBadge rank={trustRank} {personalized} />
					</div>
				{/if}

				{#if canInstantBuy}
					<!-- ═══ Instant Checkout Flow ═══ -->
					<Button
						class="w-full py-3 text-lg"
						on:click={handlePayment}
						disabled={paymentState === 'loading' || resolvingLightning || !resolvedLightningAddress}
					>
						<span class="flex items-center justify-center gap-2">
							{#if resolvingLightning}
								<svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
								Loading...
							{:else if paymentState === 'loading'}
								<svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
								Getting Invoice...
							{:else}
								<LightningIcon size={20} weight="fill" />
								Pay {product?.priceSats?.toLocaleString()} sats
							{/if}
						</span>
					</Button>

					{#if !showDmForm}
						<button
							type="button"
							on:click={openDmForm}
							class="w-full py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2"
							style="border: 1px solid var(--color-text-secondary); color: var(--color-text-secondary); background: transparent;"
						>
							<ChatCircleIcon size={16} weight="fill" />
							Message seller
						</button>
					{/if}

					<!-- Copy Lightning address -->
					{#if resolvedLightningAddress}
						<button
							type="button"
							on:click={copyLightning}
							class="flex items-center justify-center gap-2 p-2.5 rounded-lg text-xs transition-colors hover:bg-white/5"
							style="color: var(--color-text-secondary);"
						>
							{#if copiedLightning}
								<CheckIcon size={14} class="text-emerald-400" />
								<span class="text-emerald-400">Copied!</span>
							{:else}
								<CopyIcon size={14} />
								Copy Lightning address
							{/if}
						</button>
					{/if}
				{:else}
					<!-- ═══ Message-First Flow ═══ -->
					<!-- No payment UI. No sats button. No lightning copy. -->
					{#if !showDmForm}
						<Button
							class="w-full py-3 text-lg"
							on:click={openDmForm}
						>
							<span class="flex items-center justify-center gap-2">
								<ChatCircleIcon size={20} weight="fill" />
								Message seller
							</span>
						</Button>
						<p class="text-xs text-center" style="color: var(--color-text-secondary); opacity: 0.7;">
							Confirm price, shipping, and availability before purchase
						</p>
					{/if}
>>>>>>> main
				{/if}
			</div>
		{/if}
	</div>
</Modal>
