<script lang="ts">
	import { onMount } from 'svelte';
	import type { SearchProfile } from '$lib/profileSearchService';
	import { getDisplayName, formatNpub } from '$lib/profileSearchService';

	export let items: SearchProfile[] = [];
	export let command: (item: { id: string; label: string }) => void;
	export let loading: boolean = false;

	let selectedIndex = 0;

	$: if (items) {
		selectedIndex = 0;
	}

	export function onKeyDown(event: KeyboardEvent): boolean {
		if (event.key === 'ArrowUp') {
			selectedIndex = (selectedIndex + items.length - 1) % items.length;
			return true;
		}
		if (event.key === 'ArrowDown') {
			selectedIndex = (selectedIndex + 1) % items.length;
			return true;
		}
		if (event.key === 'Enter') {
			selectItem(selectedIndex);
			return true;
		}
		return false;
	}

	function selectItem(index: number) {
		const item = items[index];
		if (item) {
			command({
				id: item.npub,
				label: getDisplayName(item)
			});
		}
	}
</script>

<div class="mention-dropdown">
	{#if loading}
		<div class="mention-item loading">Searching...</div>
	{:else if items.length === 0}
		<div class="mention-item empty">No users found</div>
	{:else}
		{#each items as item, index}
			<button
				type="button"
				class="mention-item"
				class:selected={index === selectedIndex}
				on:click={() => selectItem(index)}
				on:mouseenter={() => (selectedIndex = index)}
			>
				{#if item.picture}
					<img src={item.picture} alt="" class="mention-avatar" />
				{:else}
					<div class="mention-avatar placeholder">
						{(item.displayName || item.name || '?').charAt(0).toUpperCase()}
					</div>
				{/if}
				<div class="mention-info">
					<span class="mention-name">{getDisplayName(item)}</span>
					{#if item.nip05}
						<span class="mention-nip05">{item.nip05}</span>
					{:else}
						<span class="mention-npub">{formatNpub(item.pubkey)}</span>
					{/if}
				</div>
			</button>
		{/each}
	{/if}
</div>

<style>
	.mention-dropdown {
		background: var(--color-bg-secondary, #fff);
		border: 1px solid var(--color-input-border, #e5e7eb);
		border-radius: 0.5rem;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
		overflow: hidden;
		max-height: 280px;
		overflow-y: auto;
		min-width: 240px;
		z-index: 100;
	}

	.mention-item {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.5rem 0.75rem;
		cursor: pointer;
		transition: background 0.1s ease;
		width: 100%;
		text-align: left;
		border: none;
		background: none;
		font-size: 0.875rem;
		color: var(--color-text-primary, #111);
	}

	.mention-item:hover,
	.mention-item.selected {
		background: var(--color-accent-gray, #f3f4f6);
	}

	.mention-item.loading,
	.mention-item.empty {
		color: var(--color-text-secondary, #6b7280);
		cursor: default;
		justify-content: center;
		padding: 0.75rem;
	}

	.mention-avatar {
		width: 2rem;
		height: 2rem;
		border-radius: 9999px;
		object-fit: cover;
		flex-shrink: 0;
	}

	.mention-avatar.placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-primary, #f97316);
		color: white;
		font-weight: 600;
		font-size: 0.875rem;
	}

	.mention-info {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.mention-name {
		font-weight: 500;
		color: var(--color-text-primary, #111);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mention-nip05,
	.mention-npub {
		font-size: 0.75rem;
		color: var(--color-text-secondary, #6b7280);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
