<script lang="ts">
	import Modal from '../../../components/Modal.svelte';
	import { addGroupMember } from '$lib/nip29';
	import { nip19 } from 'nostr-tools';
	import CheckIcon from 'phosphor-svelte/lib/Check';

	export let open = false;
	export let groupId: string;

	let pubkeyInput = '';
	let adding = false;
	let error = '';
	let success = '';

	function cleanup() {
		pubkeyInput = '';
		adding = false;
		error = '';
		success = '';
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

	async function handleAdd() {
		if (!pubkeyInput.trim() || adding) return;

		adding = true;
		error = '';
		success = '';

		try {
			const pubkey = resolvePubkey(pubkeyInput);
			await addGroupMember(groupId, pubkey);
			success = 'Member added successfully';
			pubkeyInput = '';
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
				Pubkey
			</label>
			<input
				id="member-pubkey"
				type="text"
				bind:value={pubkeyInput}
				placeholder="npub1... or hex pubkey"
				class="input w-full text-sm"
				style="background-color: var(--color-input-bg);"
				disabled={adding}
			/>
			<p class="text-xs mt-1" style="color: var(--color-caption);">
				Enter the member's npub or hex public key
			</p>
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
