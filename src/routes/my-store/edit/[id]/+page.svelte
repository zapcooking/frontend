<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { ndk, userPublickey } from '$lib/nostr';
	import { fetchSellerProducts, publishProduct } from '$lib/marketplace/products';
	import type { Product, ProductFormData } from '$lib/marketplace/types';
	import ProductForm from '../../../../components/marketplace/ProductForm.svelte';
	import PanLoader from '../../../../components/PanLoader.svelte';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeft';

	let product: Product | null = null;
	let loading = true;
	let isSubmitting = false;
	let error: string | null = null;

	$: productId = $page.params.id;

	onMount(async () => {
		if (!$userPublickey) {
			goto('/login');
			return;
		}

		await loadProduct();
	});

	async function loadProduct() {
		loading = true;
		error = null;

		try {
			const products = await fetchSellerProducts($ndk, $userPublickey);
			product = products.find((p) => p.id === productId) || null;

			if (!product) {
				error = 'Product not found or you do not own this listing.';
			}
		} catch (e) {
			console.error('[EditProduct] Failed to load product:', e);
			error = 'Failed to load product.';
		} finally {
			loading = false;
		}
	}

	function productToFormData(p: Product): Partial<ProductFormData> {
		return {
			title: p.title,
			summary: p.summary,
			description: p.description,
			priceSats: p.priceSats,
			category: p.category,
			lightningAddress: p.lightningAddress,
			requiresShipping: p.requiresShipping,
			location: p.location,
			images: [...p.images]
		};
	}

	async function handleSubmit(event: CustomEvent<ProductFormData>) {
		const formData = event.detail;
		isSubmitting = true;
		error = null;

		try {
			// Publish with the same d-tag to replace the existing event
			const result = await publishProduct($ndk, formData, productId);

			if (result.success) {
				goto('/my-store');
			} else {
				error = result.error || 'Failed to update product';
			}
		} catch (e) {
			console.error('[EditProduct] Failed to update:', e);
			error = e instanceof Error ? e.message : 'Failed to update product';
		} finally {
			isSubmitting = false;
		}
	}

	function handleCancel() {
		goto('/my-store');
	}
</script>

<svelte:head>
	<title>Edit Product | zap.cooking</title>
</svelte:head>

<div class="edit-product-page max-w-2xl mx-auto px-4 py-6">
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
		Edit Product
	</h1>

	{#if loading}
		<div class="flex justify-center py-12">
			<PanLoader size="md" />
		</div>
	{:else if error && !product}
		<div class="text-center py-12">
			<p class="text-red-500 mb-4">{error}</p>
			<a href="/my-store" class="text-orange-500 hover:underline">Back to My Store</a>
		</div>
	{:else if product}
		{#if error}
			<div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
				<p class="text-red-500 text-sm">{error}</p>
			</div>
		{/if}

		<ProductForm
			initialData={productToFormData(product)}
			{isSubmitting}
			on:submit={handleSubmit}
			on:cancel={handleCancel}
		/>
	{/if}
</div>
