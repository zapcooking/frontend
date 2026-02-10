<script lang="ts">
	import Modal from '../../../components/Modal.svelte';
	import CustomAvatar from '../../../components/CustomAvatar.svelte';
	import { searchProfiles, getDisplayName, formatNpub, type SearchProfile } from '$lib/profileSearchService';
	import { createEventDispatcher } from 'svelte';

	export let open = false;

	const dispatch = createEventDispatcher<{
		select: { pubkey: string };
	}>();

	let input = '';
	let error = '';
	let searching = false;
	let results: SearchProfile[] = [];
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let selectedIndex = -1;

	function cleanup() {
		input = '';
		error = '';
		searching = false;
		results = [];
		selectedIndex = -1;
		if (debounceTimer) clearTimeout(debounceTimer);
	}

	function selectUser(pubkey: string) {
		open = false;
		cleanup();
		dispatch('select', { pubkey });
	}

	function handleInput() {
		error = '';
		selectedIndex = -1;

		if (debounceTimer) clearTimeout(debounceTimer);

		const query = input.trim();
		if (!query) {
			results = [];
			searching = false;
			return;
		}

		searching = true;
		debounceTimer = setTimeout(async () => {
			try {
				results = await searchProfiles(query, 8);
				// If the search resolved a direct identifier (npub/hex/nip05) to exactly 1 result, keep it
				// Otherwise show the dropdown
			} catch {
				results = [];
			} finally {
				searching = false;
			}
		}, 300);
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (results.length > 0) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				selectedIndex = Math.min(selectedIndex + 1, results.length - 1);
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				selectedIndex = Math.max(selectedIndex - 1, -1);
				return;
			}
			if (e.key === 'Enter' && selectedIndex >= 0) {
				e.preventDefault();
				selectUser(results[selectedIndex].pubkey);
				return;
			}
		}
		// Enter with single result auto-selects it
		if (e.key === 'Enter' && results.length === 1) {
			e.preventDefault();
			selectUser(results[0].pubkey);
		}
	}
</script>

<Modal bind:open {cleanup} compact>
	<span slot="title">New Message</span>

	<div class="flex flex-col gap-3">
		<div>
			<label
				for="recipient-input"
				class="block text-sm font-medium mb-1.5"
				style="color: var(--color-text-secondary);"
			>
				To
			</label>
			<input
				id="recipient-input"
				bind:value={input}
				on:input={handleInput}
				on:keydown={handleKeyDown}
				placeholder="Search by name, npub, or NIP-05..."
				class="input w-full text-sm"
				style="background-color: var(--color-input-bg);"
				autocomplete="off"
			/>
		</div>

		{#if error}
			<p class="text-xs text-danger">{error}</p>
		{/if}

		<!-- Search results -->
		{#if searching && results.length === 0}
			<div class="flex items-center gap-2 py-3 px-1" style="color: var(--color-caption);">
				<div
					class="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin flex-shrink-0"
					style="border-color: var(--color-primary); border-top-color: transparent;"
				></div>
				<span class="text-xs">Searching...</span>
			</div>
		{/if}

		{#if results.length > 0}
			<div
				class="flex flex-col max-h-64 overflow-y-auto rounded-xl border"
				style="border-color: var(--color-input-border);"
			>
				{#each results as profile, i (profile.pubkey)}
					<button
						class="flex items-center gap-3 px-3 py-2.5 text-left transition-colors cursor-pointer"
						class:bg-input={selectedIndex === i}
						style="color: var(--color-text-primary); {i > 0 ? `border-top: 1px solid var(--color-input-border);` : ''}"
						on:click={() => selectUser(profile.pubkey)}
						on:mouseenter={() => (selectedIndex = i)}
					>
						<div class="flex-shrink-0">
							<CustomAvatar pubkey={profile.pubkey} size={36} />
						</div>
						<div class="flex-1 min-w-0">
							<p class="text-sm font-medium truncate">
								{getDisplayName(profile)}
							</p>
							<p class="text-xs truncate" style="color: var(--color-caption);">
								{profile.nip05 || formatNpub(profile.pubkey)}
							</p>
						</div>
					</button>
				{/each}
			</div>
		{/if}

		{#if input.trim() && !searching && results.length === 0}
			<p class="text-xs py-2" style="color: var(--color-caption);">
				No users found. Try a name, npub, or NIP-05 address.
			</p>
		{/if}
	</div>
</Modal>
