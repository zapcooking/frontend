<script lang="ts">
	import { nip19 } from 'nostr-tools';
	import { ndk } from '$lib/nostr';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import Modal from '../Modal.svelte';
	import Button from '../Button.svelte';
	import CustomAvatar from '../CustomAvatar.svelte';
	import CustomName from '../CustomName.svelte';
	import LightningIcon from 'phosphor-svelte/lib/Lightning';
	import CopyIcon from 'phosphor-svelte/lib/Copy';
	import CheckIcon from 'phosphor-svelte/lib/Check';
	import PackageIcon from 'phosphor-svelte/lib/Package';
	import CloudArrowDownIcon from 'phosphor-svelte/lib/CloudArrowDown';
	import ChatCircleIcon from 'phosphor-svelte/lib/ChatCircle';
	import PaperPlaneTiltIcon from 'phosphor-svelte/lib/PaperPlaneTilt';
	import XIcon from 'phosphor-svelte/lib/X';
	import LockSimpleIcon from 'phosphor-svelte/lib/LockSimple';
	import LockSimpleOpenIcon from 'phosphor-svelte/lib/LockSimpleOpen';
	import StorefrontIcon from 'phosphor-svelte/lib/Storefront';
	import TrustBadge from './TrustBadge.svelte';
	import type { Product } from '$lib/marketplace/types';
	import { getImageOrPlaceholder } from '$lib/placeholderImages';
	import { getInvoiceFromLightningAddress } from '$lib/marketplace/products';
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
		// Dynamically import encryption service only in browser
		const encryptionService = await import('$lib/encryptionService');
		hasEncryptionSupport = encryptionService.hasEncryptionSupport;
		encryptionServiceLoaded = true;

		// Gather debug info for better error messages
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

		console.log('[DM] Encryption debug info:', encryptionDebugInfo);
	});

	export let open = false;
	export let product: Product;
	export let trustRank: number | undefined = undefined;

	// Copy states
	let copiedLightning = false;
	let copiedNpub = false;

	// Payment states
	type PaymentState = 'idle' | 'loading' | 'success' | 'error';
	let paymentState: PaymentState = 'idle';
	let paymentError: string = '';

	// DM states
	let showDmForm = false;
	let dmMessage = '';
	let sendingDm = false;
	let dmSent = false;
	let dmError = '';
	let sendProtocol: 'nip04' | 'nip17' = 'nip04';

	$: nip17Available = isNip17Supported().supported;

	function toggleProtocol() {
		sendProtocol = sendProtocol === 'nip04' ? 'nip17' : 'nip04';
	}

	$: npub = product?.pubkey ? nip19.npubEncode(product.pubkey) : '';
	$: kitchenUrl = npub ? `/marketplace/kitchen/${npub}` : '';
	$: imageUrl = product?.images?.[0]
		? getImageOrPlaceholder(product.images[0], product.id)
		: getImageOrPlaceholder(undefined, product.id);
	$: hasInAppWallet = $activeWallet && ($activeWallet.kind === 3 || $activeWallet.kind === 4);
	$: canSendDm = browser && $userPublickey && encryptionServiceLoaded && hasEncryptionSupport?.();

	// Generate default DM template
	$: defaultDmMessage = `Hi! I just purchased "${product?.title}" (${product?.priceSats?.toLocaleString()} sats).${product?.requiresShipping ? `\n\nMy shipping address:\n[Your address here]` : ''}\n\nThanks!`;

	// Reset states when modal closes
	$: if (!open) {
		paymentState = 'idle';
		paymentError = '';
		showDmForm = false;
		dmMessage = '';
		dmSent = false;
		dmError = '';
	}

	async function copyLightning() {
		if (!product?.lightningAddress) return;
		try {
			await navigator.clipboard.writeText(product.lightningAddress);
			copiedLightning = true;
			setTimeout(() => (copiedLightning = false), 2000);
		} catch {
			window.open(`lightning:${product.lightningAddress}`, '_blank');
		}
	}

	async function copyNpub() {
		if (!npub) return;
		try {
			await navigator.clipboard.writeText(npub);
			copiedNpub = true;
			setTimeout(() => (copiedNpub = false), 2000);
		} catch (e) {
			console.error('Failed to copy npub:', e);
		}
	}

	async function handlePayment() {
		if (!product?.lightningAddress || !product?.priceSats) return;

		paymentState = 'loading';
		paymentError = '';

		try {
			// Get invoice from Lightning address
			const { invoice, verify } = await getInvoiceFromLightningAddress(
				product.lightningAddress,
				product.priceSats
			);

			if (hasInAppWallet) {
				// Pay with in-app wallet
				const result = await sendPayment(invoice, {
					amount: product.priceSats,
					description: `Purchase: ${product.title}`,
					pubkey: product.pubkey
				});

				if (result.success) {
					paymentState = 'success';
					// Show DM form after successful payment
					setTimeout(() => {
						showDmForm = true;
						dmMessage = defaultDmMessage;
					}, 1500);
				} else {
					throw new Error(result.error || 'Payment failed');
				}
			} else {
				// Use external wallet via Bitcoin Connect
				open = false;
				await lightningService.launchPayment({
					invoice,
					verify,
					onPaid: () => {
						open = true;
						paymentState = 'success';
						showDmForm = true;
						dmMessage = defaultDmMessage;
					},
					onCancelled: () => {
						open = true;
						paymentState = 'idle';
					}
				});
			}
		} catch (e) {
			console.error('Payment failed:', e);
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
			console.error('[DM] Failed to send:', e);
			dmError = e instanceof Error ? e.message : 'Failed to send message';
		} finally {
			sendingDm = false;
		}
	}

	function openDmForm() {
		showDmForm = true;
		if (!dmMessage) {
			dmMessage = defaultDmMessage;
		}
	}

	async function recheckEncryption() {
		// Re-import and re-check encryption support
		const encryptionService = await import('$lib/encryptionService');
		hasEncryptionSupport = encryptionService.hasEncryptionSupport;

		// Re-gather debug info
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

		console.log('[DM] Re-checked encryption support:', {
			hasSupport: hasEncryptionSupport?.(),
			debugInfo: encryptionDebugInfo
		});
	}
</script>

<Modal bind:open>
	<h2 slot="title" class="line-clamp-1">{product?.title || 'Product Details'}</h2>

	<div class="flex flex-col gap-5">
		<!-- Product Image -->
		<div class="relative aspect-video rounded-xl overflow-hidden" style="background-color: var(--color-bg-tertiary);">
			<img
				src={imageUrl}
				alt={product?.title}
				class="w-full h-full object-cover"
			/>
		</div>

		<!-- Price & Shipping -->
		<div class="flex items-center justify-between">
			<div class="flex items-baseline gap-2">
				<span class="text-3xl font-bold text-orange-500">
					{product?.priceSats?.toLocaleString()}
				</span>
				<span class="text-base" style="color: var(--color-text-secondary)">sats</span>
			</div>
			<div class="flex items-center gap-1.5 text-sm {product?.requiresShipping ? '' : 'text-emerald-400'}">
				{#if product?.requiresShipping}
					<PackageIcon size={18} />
					<span style="color: var(--color-text-secondary)">Requires shipping</span>
				{:else}
					<CloudArrowDownIcon size={18} />
					<span>Instant delivery</span>
				{/if}
			</div>
		</div>

		<!-- Seller -->
		<div class="flex items-center gap-3 p-3 rounded-xl" style="background-color: var(--color-bg-tertiary);">
			<CustomAvatar pubkey={product?.pubkey || ''} size={40} className="flex-shrink-0" />
			<div class="flex flex-col flex-1">
				<span class="text-sm" style="color: var(--color-text-secondary)">Sold by</span>
				<span class="flex items-center gap-1.5 font-semibold" style="color: var(--color-text-primary)">
					<CustomName pubkey={product?.pubkey || ''} />
					<TrustBadge rank={trustRank} />
				</span>
			</div>
			<!-- Visit Kitchen link -->
			{#if kitchenUrl}
				<a
					href={kitchenUrl}
					on:click={() => (open = false)}
					class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-white/10"
					style="color: var(--color-text-secondary);"
					title="Visit Store"
				>
					<StorefrontIcon size={16} />
					<span class="hidden sm:inline">Store</span>
				</a>
			{/if}
			<!-- Copy npub button -->
			<button
				type="button"
				on:click={copyNpub}
				class="p-2 rounded-lg transition-colors hover:bg-white/10"
				title="Copy seller npub"
			>
				{#if copiedNpub}
					<CheckIcon size={18} class="text-emerald-400" />
				{:else}
					<CopyIcon size={18} style="color: var(--color-text-secondary)" />
				{/if}
			</button>
		</div>

		<!-- Description -->
		{#if product?.summary}
			<p class="text-sm" style="color: var(--color-text-secondary)">
				{product.summary}
			</p>
		{/if}

		<!-- Payment Section -->
		{#if paymentState === 'success'}
			<!-- Success State -->
			<div class="flex flex-col items-center gap-4 p-6 rounded-xl" style="background-color: var(--color-bg-tertiary);">
				<div class="w-16 h-16 rounded-full flex items-center justify-center bg-emerald-500/20">
					<CheckIcon size={32} weight="bold" class="text-emerald-400" />
				</div>
				<div class="text-center">
					<h3 class="text-lg font-semibold" style="color: var(--color-text-primary)">Payment Sent!</h3>
					<p class="text-sm mt-1" style="color: var(--color-text-secondary)">
						{product.priceSats?.toLocaleString()} sats sent to seller
					</p>
				</div>
			</div>
		{:else if paymentState === 'error'}
			<!-- Error State -->
			<div class="flex flex-col items-center gap-4 p-6 rounded-xl" style="background-color: rgba(239, 68, 68, 0.1);">
				<div class="w-16 h-16 rounded-full flex items-center justify-center bg-red-500/20">
					<XIcon size={32} weight="bold" class="text-red-400" />
				</div>
				<div class="text-center">
					<h3 class="text-lg font-semibold text-red-400">Payment Failed</h3>
					<p class="text-sm mt-1" style="color: var(--color-text-secondary)">{paymentError}</p>
				</div>
				<Button on:click={() => (paymentState = 'idle')}>Try Again</Button>
			</div>
		{:else}
			<!-- Payment Actions -->
			<div class="flex flex-col gap-3">
				<!-- Pay Button -->
				<Button
					class="w-full py-3 text-lg"
					on:click={handlePayment}
					disabled={paymentState === 'loading'}
				>
					{#if paymentState === 'loading'}
						<span class="flex items-center justify-center gap-2">
							<svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
							</svg>
							Getting Invoice...
						</span>
					{:else}
						<span class="flex items-center justify-center gap-2">
							<LightningIcon size={20} weight="fill" />
							Pay {product?.priceSats?.toLocaleString()} sats
						</span>
					{/if}
				</Button>

				<!-- Wallet indicator -->
				<div class="text-center">
					{#if hasInAppWallet && $activeWallet}
						<span class="text-xs" style="color: var(--color-text-secondary)">
							Paying with {$activeWallet.name}
						</span>
					{:else}
						<span class="text-xs" style="color: var(--color-text-secondary)">
							Scan QR or connect wallet to pay
						</span>
					{/if}
				</div>

				<!-- Copy Lightning address -->
				<button
					type="button"
					on:click={copyLightning}
					class="flex items-center justify-center gap-2 p-3 rounded-lg text-sm transition-colors hover:bg-white/5"
					style="background-color: var(--color-bg-tertiary);"
				>
					{#if copiedLightning}
						<CheckIcon size={16} class="text-emerald-400" />
						<span class="text-emerald-400">Copied!</span>
					{:else}
						<CopyIcon size={16} style="color: var(--color-text-secondary)" />
						<span style="color: var(--color-text-secondary)">Copy Lightning address</span>
					{/if}
				</button>
			</div>
		{/if}

		<!-- DM Section -->
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
						rows="5"
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
		{:else if paymentState === 'idle'}
			<!-- Show DM button when not in payment flow -->
			<button
				type="button"
				on:click={openDmForm}
				class="flex items-center justify-center gap-2 p-3 rounded-lg text-sm transition-colors hover:bg-white/5"
				style="background-color: var(--color-bg-tertiary);"
			>
				<ChatCircleIcon size={16} style="color: var(--color-text-secondary)" />
				<span style="color: var(--color-text-secondary)">Message Seller</span>
			</button>
		{/if}

		<!-- Info Note -->
		{#if product?.requiresShipping && paymentState !== 'success'}
			<p class="text-xs text-center" style="color: var(--color-text-secondary)">
				After paying, send your shipping address to the seller via DM.
			</p>
		{/if}
	</div>
</Modal>
