<script lang="ts">
	import { writable, type Writable } from 'svelte/store';
	import { createEventDispatcher } from 'svelte';
	import MediaUploader from '../MediaUploader.svelte';
	import Button from '../Button.svelte';
	import {
		PRODUCT_CATEGORIES,
		CATEGORY_LABELS,
		CATEGORY_EMOJIS,
		type ProductCategory,
		type ProductFormData,
		isValidLightningAddress
	} from '$lib/marketplace/types';

	const dispatch = createEventDispatcher<{
		submit: ProductFormData;
		cancel: void;
	}>();

	// Form state
	export let initialData: Partial<ProductFormData> = {};
	export let isSubmitting = false;

	let title = initialData.title || '';
	let summary = initialData.summary || '';
	let description = initialData.description || '';
	let priceSats = initialData.priceSats || 0;
	let priceInput = priceSats > 0 ? priceSats.toString() : '';
	let category: ProductCategory = initialData.category || 'ingredients';
	let lightningAddress = initialData.lightningAddress || '';
	let requiresShipping = initialData.requiresShipping ?? true;
	let location = initialData.location || '';
	let images: Writable<string[]> = writable(initialData.images || []);

	// Validation
	let errors: Record<string, string> = {};

	$: {
		errors = {};
		if (!title.trim()) errors.title = 'Title is required';
		if (!summary.trim()) errors.summary = 'Summary is required';
		if (!priceInput || parseInt(priceInput, 10) <= 0) errors.price = 'Price must be greater than 0';
		if (!lightningAddress.trim()) {
			errors.lightning = 'Lightning address is required';
		} else if (!isValidLightningAddress(lightningAddress)) {
			errors.lightning = 'Invalid Lightning address format';
		}
		if ($images.length === 0) errors.images = 'At least one image is required';
	}

	$: canSubmit =
		title.trim() &&
		summary.trim() &&
		parseInt(priceInput, 10) > 0 &&
		lightningAddress.trim() &&
		isValidLightningAddress(lightningAddress) &&
		$images.length > 0 &&
		!isSubmitting;

	function handleSubmit() {
		if (!canSubmit) return;

		const formData: ProductFormData = {
			title: title.trim(),
			summary: summary.trim(),
			description: description.trim(),
			priceSats: parseInt(priceInput, 10),
			images: $images,
			category,
			lightningAddress: lightningAddress.trim(),
			requiresShipping,
			location: location.trim() || undefined
		};

		dispatch('submit', formData);
	}

	function handleCancel() {
		dispatch('cancel');
	}
</script>

<form on:submit|preventDefault={handleSubmit} class="flex flex-col gap-6">
	<!-- Title -->
	<div class="flex flex-col gap-2">
		<label for="title" class="font-medium" style="color: var(--color-text-primary)">
			Title <span class="text-red-500">*</span>
		</label>
		<input
			id="title"
			type="text"
			bind:value={title}
			placeholder="e.g., Homemade Sourdough Starter"
			class="input"
			class:input-error={errors.title}
		/>
		{#if errors.title}
			<span class="text-xs text-red-500">{errors.title}</span>
		{/if}
	</div>

	<!-- Summary -->
	<div class="flex flex-col gap-2">
		<label for="summary" class="font-medium" style="color: var(--color-text-primary)">
			Short Summary <span class="text-red-500">*</span>
		</label>
		<input
			id="summary"
			type="text"
			bind:value={summary}
			placeholder="Brief description shown in listings"
			class="input"
			maxlength="150"
			class:input-error={errors.summary}
		/>
		<span class="text-xs" style="color: var(--color-text-secondary)">{summary.length}/150</span>
	</div>

	<!-- Description -->
	<div class="flex flex-col gap-2">
		<label for="description" class="font-medium" style="color: var(--color-text-primary)">
			Full Description
		</label>
		<textarea
			id="description"
			bind:value={description}
			placeholder="Detailed product description (supports markdown)"
			class="input min-h-[120px]"
			rows="5"
		/>
	</div>

	<!-- Price -->
	<div class="flex flex-col gap-2">
		<label for="price" class="font-medium" style="color: var(--color-text-primary)">
			Price (sats) <span class="text-red-500">*</span>
		</label>
		<div class="relative">
			<input
				id="price"
				type="number"
				bind:value={priceInput}
				placeholder="e.g., 5000"
				min="1"
				class="input pr-14"
				class:input-error={errors.price}
			/>
			<span
				class="absolute right-3 top-1/2 -translate-y-1/2 text-sm"
				style="color: var(--color-text-secondary)"
			>
				sats
			</span>
		</div>
		{#if errors.price}
			<span class="text-xs text-red-500">{errors.price}</span>
		{/if}
		{#if requiresShipping}
			<div class="flex items-start gap-2 p-2 rounded-lg" style="background-color: rgba(249, 115, 22, 0.1);">
				<span class="text-orange-500 mt-0.5">💡</span>
				<span class="text-xs" style="color: var(--color-text-secondary)">
					<strong style="color: var(--color-text-primary)">Tip:</strong> Include shipping costs in your price. Buyers pay the full amount upfront, then DM you their shipping address.
				</span>
			</div>
		{/if}
	</div>

	<!-- Category -->
	<div class="flex flex-col gap-2">
		<label class="font-medium" style="color: var(--color-text-primary)">
			Category <span class="text-red-500">*</span>
		</label>
		<div class="flex flex-wrap gap-2">
			{#each PRODUCT_CATEGORIES as cat}
				<button
					type="button"
					on:click={() => (category = cat)}
					class="category-btn {category === cat ? 'active' : ''}"
				>
					<span>{CATEGORY_EMOJIS[cat]}</span>
					<span>{CATEGORY_LABELS[cat]}</span>
				</button>
			{/each}
		</div>
	</div>

	<!-- Images -->
	<div class="flex flex-col gap-2">
		<label class="font-medium" style="color: var(--color-text-primary)">
			Images <span class="text-red-500">*</span>
		</label>
		<span class="text-xs" style="color: var(--color-text-secondary)">
			First image will be your cover photo
		</span>
		<MediaUploader uploadedImages={images} />
		{#if errors.images}
			<span class="text-xs text-red-500">{errors.images}</span>
		{/if}
	</div>

	<!-- Lightning Address -->
	<div class="flex flex-col gap-2">
		<label for="lightning" class="font-medium" style="color: var(--color-text-primary)">
			Lightning Address <span class="text-red-500">*</span>
		</label>
		<input
			id="lightning"
			type="text"
			bind:value={lightningAddress}
			placeholder="e.g., you@getalby.com"
			class="input"
			class:input-error={errors.lightning}
		/>
		<span class="text-xs" style="color: var(--color-text-secondary)">
			Buyers will pay directly to this address
		</span>
		{#if errors.lightning}
			<span class="text-xs text-red-500">{errors.lightning}</span>
		{/if}
	</div>

	<!-- Requires Shipping -->
	<label class="shipping-checkbox flex items-center gap-3 p-4 rounded-xl cursor-pointer" style="background-color: var(--color-bg-secondary);">
		<input
			type="checkbox"
			bind:checked={requiresShipping}
			class="w-5 h-5 rounded accent-orange-500"
		/>
		<div class="flex flex-col">
			<span class="font-medium" style="color: var(--color-text-primary)">Requires shipping</span>
			<span class="text-sm" style="color: var(--color-text-secondary)">
				{requiresShipping ? 'Physical item that needs to be shipped' : 'Digital product with instant delivery'}
			</span>
		</div>
	</label>

	<!-- Location (optional, shown if shipping required) -->
	{#if requiresShipping}
		<div class="flex flex-col gap-2">
			<label for="location" class="font-medium" style="color: var(--color-text-primary)">
				Ships From <span class="text-xs font-normal" style="color: var(--color-text-secondary)">(optional)</span>
			</label>
			<input
				id="location"
				type="text"
				bind:value={location}
				placeholder="e.g., USA, Europe, Worldwide"
				class="input"
			/>
		</div>
	{/if}

	<!-- Actions -->
	<div class="flex justify-end gap-3 pt-4">
		<button
			type="button"
			on:click={handleCancel}
			class="px-4 py-2 rounded-lg font-medium"
			style="background-color: var(--color-bg-secondary); color: var(--color-text-primary);"
		>
			Cancel
		</button>
		<Button type="submit" disabled={!canSubmit}>
			{#if isSubmitting}
				Publishing...
			{:else}
				Publish Product
			{/if}
		</Button>
	</div>
</form>

<style lang="postcss">
	@reference "../../app.css";

	.input {
		@apply w-full px-4 py-3 rounded-xl text-base;
		background-color: var(--color-bg-secondary);
		color: var(--color-text-primary);
		border: 1px solid transparent;
	}

	.input:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	.input-error {
		border-color: #ef4444 !important;
	}

	.category-btn {
		@apply flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all;
		background-color: var(--color-bg-secondary);
		color: var(--color-text-secondary);
		border: 1px solid transparent;
	}

	.category-btn:hover {
		color: var(--color-text-primary);
	}

	.category-btn.active {
		background-color: var(--color-accent);
		color: white;
		border-color: var(--color-accent);
	}
</style>
