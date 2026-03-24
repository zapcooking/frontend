<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ndk, userPublickey } from '$lib/nostr';
	import { fetchKitchenByPubkey, publishKitchen } from '$lib/marketplace/kitchens';
	import type { Kitchen, KitchenFormData } from '$lib/marketplace/types';
	import KitchenForm from '../../../components/marketplace/KitchenForm.svelte';
	import SellerAcknowledgmentModal from '../../../components/marketplace/SellerAcknowledgmentModal.svelte';
	import PanLoader from '../../../components/PanLoader.svelte';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeft';
	import LockIcon from 'phosphor-svelte/lib/Lock';

	const SELLER_ACK_KEY = 'zc_seller_ack';

	let checkingMembership = true;
	let hasActiveMembership = false;
	let needsAcknowledgment = false;
	let loadingKitchen = true;
	let existingKitchen: Kitchen | null = null;
	let isSubmitting = false;
	let error: string | null = null;

	onMount(async () => {
		if (!$userPublickey) {
			goto('/login');
			return;
		}

		await checkMembership();

		if (hasActiveMembership) {
			// Check if seller has already acknowledged marketplace terms (only for new stores)
			const ack = localStorage.getItem(SELLER_ACK_KEY);
			if (!ack) {
				needsAcknowledgment = true;
			}
			await loadExistingKitchen();
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
			}
		} catch (e) {
			console.error('[Kitchen] Failed to check membership:', e);
		} finally {
			checkingMembership = false;
		}
	}

	async function loadExistingKitchen() {
		loadingKitchen = true;
		try {
			existingKitchen = await fetchKitchenByPubkey($ndk, $userPublickey);
		} catch (e) {
			console.error('[Kitchen] Failed to load existing kitchen:', e);
		} finally {
			loadingKitchen = false;
		}
	}

	$: initialData = existingKitchen
		? {
				name: existingKitchen.name,
				description: existingKitchen.description,
				banner: existingKitchen.banner,
				avatar: existingKitchen.avatar,
				location: existingKitchen.location,
				lightningAddress: existingKitchen.lightningAddress,
				defaultCurrency: existingKitchen.defaultCurrency
			}
		: {};

	async function handleSubmit(event: CustomEvent<KitchenFormData>) {
		const formData = event.detail;
		isSubmitting = true;
		error = null;

		try {
			const result = await publishKitchen(
				$ndk,
				formData,
				existingKitchen?.id
			);

			if (result.success) {
				goto('/my-store');
			} else {
				error = result.error || 'Failed to publish kitchen';
			}
		} catch (e) {
			console.error('[Kitchen] Failed to publish:', e);
			error = e instanceof Error ? e.message : 'Failed to publish kitchen';
		} finally {
			isSubmitting = false;
		}
	}

	function handleCancel() {
		goto('/my-store');
	}
</script>

<svelte:head>
	<title>{existingKitchen ? 'Edit Store' : 'Create Store'} | zap.cooking</title>
</svelte:head>

<div class="kitchen-edit-page max-w-2xl mx-auto px-4 py-6">
	<!-- Back link -->
	<a
		href="/my-store"
		class="inline-flex items-center gap-2 mb-6 text-sm hover:underline"
		style="color: var(--color-text-secondary)"
	>
		<ArrowLeftIcon size={16} />
		Back to My Store
	</a>

	<!-- Header -->
	<h1 class="text-2xl font-bold mb-6" style="color: var(--color-text-primary)">
		{existingKitchen ? 'Edit Store' : 'Create Store'}
	</h1>

	{#if checkingMembership || (hasActiveMembership && loadingKitchen)}
		<div class="flex justify-center py-12">
			<PanLoader size="md" />
		</div>
	{:else if !hasActiveMembership}
		<div class="membership-gate text-center py-12 px-6 rounded-2xl" style="background-color: var(--color-bg-secondary);">
			<LockIcon size={64} weight="duotone" class="mx-auto mb-4 text-orange-500" />
			<h2 class="text-xl font-bold mb-2" style="color: var(--color-text-primary)">
				Membership Required
			</h2>
			<p class="text-sm mb-6" style="color: var(--color-text-secondary)">
				You need an active membership to create a store.
			</p>
			<a
				href="/membership"
				class="inline-block px-6 py-3 rounded-xl font-semibold"
				style="background: linear-gradient(135deg, #f97316, #fb923c); color: white;"
			>
				View Membership Plans
			</a>
		</div>
	{:else if needsAcknowledgment && !existingKitchen}
		<SellerAcknowledgmentModal on:accept={() => {
			const record = JSON.stringify({ npub: $userPublickey, timestamp: Date.now() });
			localStorage.setItem(SELLER_ACK_KEY, record);
			needsAcknowledgment = false;
		}} />

	{:else}
		{#if error}
			<div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
				<p class="text-red-500 text-sm">{error}</p>
			</div>
		{/if}

		<KitchenForm
			{initialData}
			{isSubmitting}
			on:submit={handleSubmit}
			on:cancel={handleCancel}
		/>
	{/if}
</div>
