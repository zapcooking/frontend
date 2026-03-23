<script lang="ts">
	import { writable, type Writable } from 'svelte/store';
	import { createEventDispatcher } from 'svelte';
	import MediaUploader from '../MediaUploader.svelte';
	import Button from '../Button.svelte';
	import type { KitchenFormData } from '$lib/marketplace/types';
	import { SUPPORTED_CURRENCIES, type CurrencyCode } from '$lib/currencyStore';

	const dispatch = createEventDispatcher<{
		submit: KitchenFormData;
		cancel: void;
	}>();

	export let initialData: Partial<KitchenFormData> = {};
	export let isSubmitting = false;

	let name = initialData.name || '';
	let description = initialData.description || '';
	let location = initialData.location || '';
	let lightningAddress = initialData.lightningAddress || '';
	let defaultCurrency: CurrencyCode = initialData.defaultCurrency || 'USD';

	let bannerImages: Writable<string[]> = writable(initialData.banner ? [initialData.banner] : []);
	let avatarImages: Writable<string[]> = writable(initialData.avatar ? [initialData.avatar] : []);

	// Validation
	$: canSubmit = name.trim().length > 0 && !isSubmitting;

	function handleSubmit() {
		if (!canSubmit) return;

		const formData: KitchenFormData = {
			name: name.trim(),
			description: description.trim(),
			banner: $bannerImages[0] || undefined,
			avatar: $avatarImages[0] || undefined,
			location: location.trim() || undefined,
			lightningAddress: lightningAddress.trim() || undefined,
			defaultCurrency
		};

		dispatch('submit', formData);
	}

	function handleCancel() {
		dispatch('cancel');
	}
</script>

<form on:submit|preventDefault={handleSubmit} class="flex flex-col gap-6">
	<!-- Name -->
	<div class="flex flex-col gap-2">
		<label for="kitchen-name" class="font-medium" style="color: var(--color-text-primary)">
			Store Name <span class="text-red-500">*</span>
		</label>
		<input
			id="kitchen-name"
			type="text"
			bind:value={name}
			placeholder="e.g., Chef Maria's Store"
			class="input"
		/>
	</div>

	<!-- Description -->
	<div class="flex flex-col gap-2">
		<label for="kitchen-description" class="font-medium" style="color: var(--color-text-primary)">
			Description
		</label>
		<textarea
			id="kitchen-description"
			bind:value={description}
			placeholder="Tell customers about your store..."
			class="input min-h-[100px]"
			rows="4"
		/>
	</div>

	<!-- Banner Image -->
	<div class="flex flex-col gap-2">
		<label class="font-medium" style="color: var(--color-text-primary)">
			Banner Image
		</label>
		<span class="text-xs" style="color: var(--color-text-secondary)">
			Recommended: 1200x400 or 3:1 aspect ratio
		</span>
		<MediaUploader uploadedImages={bannerImages} limit={1} />
	</div>

	<!-- Avatar Image -->
	<div class="flex flex-col gap-2">
		<label class="font-medium" style="color: var(--color-text-primary)">
			Avatar / Logo
		</label>
		<span class="text-xs" style="color: var(--color-text-secondary)">
			Recommended: Square image, at least 200x200
		</span>
		<MediaUploader uploadedImages={avatarImages} limit={1} />
	</div>

	<!-- Location -->
	<div class="flex flex-col gap-2">
		<label for="kitchen-location" class="font-medium" style="color: var(--color-text-primary)">
			Location <span class="text-xs font-normal" style="color: var(--color-text-secondary)">(optional)</span>
		</label>
		<input
			id="kitchen-location"
			type="text"
			bind:value={location}
			placeholder="e.g., Austin, TX"
			class="input"
		/>
	</div>

	<!-- Lightning Address -->
	<div class="flex flex-col gap-2">
		<label for="kitchen-lightning" class="font-medium" style="color: var(--color-text-primary)">
			Lightning Address <span class="text-xs font-normal" style="color: var(--color-text-secondary)">(optional)</span>
		</label>
		<input
			id="kitchen-lightning"
			type="text"
			bind:value={lightningAddress}
			placeholder="e.g., you@getalby.com"
			class="input"
		/>
	</div>

	<!-- Default Currency -->
	<div class="flex flex-col gap-2">
		<label for="kitchen-currency" class="font-medium" style="color: var(--color-text-primary)">
			Default Currency <span class="text-xs font-normal" style="color: var(--color-text-secondary)">(for new products)</span>
		</label>
		<select
			id="kitchen-currency"
			bind:value={defaultCurrency}
			class="input"
		>
			{#each SUPPORTED_CURRENCIES as cur}
				<option value={cur.code}>
					{cur.code === 'SATS' ? 'Satoshis (SATS)' : `${cur.name} (${cur.symbol})`}
				</option>
			{/each}
		</select>
		<span class="text-xs" style="color: var(--color-text-secondary)">
			New products will default to this currency. Each product can override it.
		</span>
	</div>

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
				{initialData.name ? 'Update Store' : 'Create Store'}
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
</style>
