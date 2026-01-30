<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ndk, userPublickey } from '$lib/nostr';
	import { publishProduct } from '$lib/marketplace/products';
	import type { ProductFormData } from '$lib/marketplace/types';
	import ProductForm from '../../../components/marketplace/ProductForm.svelte';
	import PanLoader from '../../../components/PanLoader.svelte';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeft';
	import LockIcon from 'phosphor-svelte/lib/Lock';

	let checkingMembership = true;
	let hasActiveMembership = false;
	let isSubmitting = false;
	let error: string | null = null;

	onMount(async () => {
		// Check if logged in
		if (!$userPublickey) {
			goto('/login');
			return;
		}

		// Check membership status
		await checkMembership();
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
			console.error('[NewProduct] Failed to check membership:', e);
		} finally {
			checkingMembership = false;
		}
	}

	async function handleSubmit(event: CustomEvent<ProductFormData>) {
		const formData = event.detail;
		isSubmitting = true;
		error = null;

		try {
			const result = await publishProduct($ndk, formData);

			if (result.success) {
				// Redirect to my-store dashboard
				goto('/my-store');
			} else {
				error = result.error || 'Failed to publish product';
			}
		} catch (e) {
			console.error('[NewProduct] Failed to publish:', e);
			error = e instanceof Error ? e.message : 'Failed to publish product';
		} finally {
			isSubmitting = false;
		}
	}

	function handleCancel() {
		goto('/my-store');
	}
</script>

<svelte:head>
	<title>New Product | zap.cooking</title>
</svelte:head>

<div class="new-product-page max-w-2xl mx-auto px-4 py-6">
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
		Create New Product
	</h1>

	<!-- Loading membership check -->
	{#if checkingMembership}
		<div class="flex justify-center py-12">
			<PanLoader size="md" />
		</div>

	<!-- Not a member -->
	{:else if !hasActiveMembership}
		<div class="membership-gate text-center py-12 px-6 rounded-2xl" style="background-color: var(--color-bg-secondary);">
			<LockIcon size={64} weight="duotone" class="mx-auto mb-4 text-orange-500" />
			<h2 class="text-xl font-bold mb-2" style="color: var(--color-text-primary)">
				Membership Required
			</h2>
			<p class="text-sm mb-6" style="color: var(--color-text-secondary)">
				You need an active membership to list products.
			</p>
			<a
				href="/membership"
				class="inline-block px-6 py-3 rounded-xl font-semibold"
				style="background: linear-gradient(135deg, #f97316, #fb923c); color: white;"
			>
				View Membership Plans
			</a>
		</div>

	<!-- Has membership - show form -->
	{:else}
		{#if error}
			<div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
				<p class="text-red-500 text-sm">{error}</p>
			</div>
		{/if}

		<ProductForm
			{isSubmitting}
			on:submit={handleSubmit}
			on:cancel={handleCancel}
		/>
	{/if}
</div>
