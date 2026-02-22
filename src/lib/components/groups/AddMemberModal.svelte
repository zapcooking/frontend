<script lang="ts">
	import Modal from '../../../components/Modal.svelte';
	import CustomAvatar from '../../../components/CustomAvatar.svelte';
	import { addGroupMember } from '$lib/nip29';
	import { nip19 } from 'nostr-tools';
	import {
		searchProfiles,
		getDisplayName,
		formatNpub,
		type SearchProfile
	} from '$lib/profileSearchService';
	import CheckIcon from 'phosphor-svelte/lib/Check';

	export let open = false;
	export let groupId: string;

	let pubkeyInput = '';
	let adding = false;
	let error = '';
	let success = '';

	// Search state
	let searching = false;
	let results: SearchProfile[] = [];
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let selectedIndex = -1;
	let selectedProfile: SearchProfile | null = null;

	function cleanup() {
		pubkeyInput = '';
		adding = false;
		error = '';
		success = '';
		searching = false;
		results = [];
		selectedIndex = -1;
		selectedProfile = null;
		if (debounceTimer) clearTimeout(debounceTimer);
	}

	function resolvePubkey(input: string): string {
		const trimmed = input.trim();

		// Already a 64-char hex pubkey
		if (/^[0-9a-f]{64}$/i.test(trimmed)) {
			return trimmed.toLowerCase();
		}

		// npub or nprofile
		try {
			const decoded = nip19.decode(trimmed);
			if (decoded.type === 'npub') {
				return decoded.data as string;
			}
			if (decoded.type === 'nprofile') {
				return (decoded.data as { pubkey: string }).pubkey;
			}
		} catch {
			// not a valid nip19 identifier
		}

		throw new Error('Invalid pubkey. Enter a hex pubkey or npub.');
	}

	function handleInput() {
		error = '';
		selectedIndex = -1;
		selectedProfile = null;

		if (debounceTimer) clearTimeout(debounceTimer);

		const query = pubkeyInput.trim();
		if (!query) {
			results = [];
			searching = false;
			return;
		}

		searching = true;
		debounceTimer = setTimeout(async () => {
			try {
				results = await searchProfiles(query, 8);
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
				selectUser(results[selectedIndex]);
				return;
			}
		}
		if (e.key === 'Enter' && results.length === 1) {
			e.preventDefault();
			selectUser(results[0]);
		}
	}

	function selectUser(profile: SearchProfile) {
		pubkeyInput = profile.pubkey;
		selectedProfile = profile;
		results = [];
		selectedIndex = -1;
	}

	function clearSelection() {
		pubkeyInput = '';
		selectedProfile = null;
		results = [];
	}

	async function handleAdd() {
		if (!pubkeyInput.trim() || adding) return;

		adding = true;
		error = '';
		success = '';

		try {
			const pubkey = selectedProfile ? selectedProfile.pubkey : resolvePubkey(pubkeyInput);
			await addGroupMember(groupId, pubkey);
			success = 'Member added successfully';
			pubkeyInput = '';
			selectedProfile = null;
			setTimeout(() => { open = false; }, 1000);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to add member';
			console.error('[Groups] Add member error:', e);
		} finally {
			adding = false;
		}
	}
</script>

<Modal bind:open {cleanup}>
	<span slot="title">Add Member</span>

	<div class="flex flex-col gap-4">
		<div>
			<label
				for="member-pubkey"
				class="block text-sm font-medium mb-1"
				style="color: var(--color-text-primary);"
			>
				Find User
			</label>

			{#if selectedProfile}
				<!-- Selected user chip -->
				<div
					class="flex items-center gap-3 p-3 rounded-xl border"
					style="background-color: var(--color-input-bg); border-color: var(--color-input-border);"
				>
					<div class="flex-shrink-0">
						<CustomAvatar pubkey={selectedProfile.pubkey} size={36} />
					</div>
					<div class="flex-1 min-w-0">
						<p class="text-sm font-medium truncate" style="color: var(--color-text-primary);">
							{getDisplayName(selectedProfile)}
						</p>
						<p class="text-xs truncate" style="color: var(--color-caption);">
							{selectedProfile.nip05 || formatNpub(selectedProfile.pubkey)}
						</p>
					</div>
					<button
						class="text-xs px-2 py-1 rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
						style="color: var(--color-caption);"
						on:click={clearSelection}
						disabled={adding}
					>
						Change
					</button>
				</div>
			{:else}
				<input
					id="member-pubkey"
					type="text"
					bind:value={pubkeyInput}
					on:input={handleInput}
					on:keydown={handleKeyDown}
					placeholder="Search by name, npub, or NIP-05..."
					class="input w-full text-sm"
					style="background-color: var(--color-input-bg);"
					disabled={adding}
					autocomplete="off"
				/>

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
						class="flex flex-col max-h-64 overflow-y-auto rounded-xl border mt-1"
						style="border-color: var(--color-input-border);"
					>
						{#each results as profile, i (profile.pubkey)}
							<button
								class="flex items-center gap-3 px-3 py-2.5 text-left transition-colors cursor-pointer"
								class:bg-input={selectedIndex === i}
								style="color: var(--color-text-primary); {i > 0
									? `border-top: 1px solid var(--color-input-border);`
									: ''}"
								on:click={() => selectUser(profile)}
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

				{#if pubkeyInput.trim() && !searching && results.length === 0}
					<p class="text-xs py-2" style="color: var(--color-caption);">
						No users found. You can also paste an npub or hex pubkey directly.
					</p>
				{/if}
			{/if}
		</div>

		{#if error}
			<p class="text-xs text-danger">{error}</p>
		{/if}

		{#if success}
			<p class="text-xs flex items-center gap-1 text-green-600">
				<CheckIcon size={14} weight="bold" />
				{success}
			</p>
		{/if}

		<button
			on:click={handleAdd}
			disabled={!pubkeyInput.trim() || adding}
			class="w-full py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer disabled:opacity-40"
			style="background-color: var(--color-primary); color: #ffffff;"
		>
			{#if adding}
				Adding...
			{:else}
				Add Member
			{/if}
		</button>
	</div>
</Modal>
