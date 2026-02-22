<script lang="ts">
	import Modal from '../../../components/Modal.svelte';
	import { createInvite } from '$lib/nip29';
	import { copyToClipboard } from '$lib/utils/share';
	import LinkIcon from 'phosphor-svelte/lib/Link';
	import CheckIcon from 'phosphor-svelte/lib/Check';

	export let open = false;
	export let groupId = '';

	let inviteLink = '';
	let generating = false;
	let error = '';
	let copied = false;

	$: if (open && groupId) {
		generateInvite();
	}

	function cleanup() {
		inviteLink = '';
		generating = false;
		error = '';
		copied = false;
	}

	async function generateInvite() {
		if (generating || inviteLink) return;
		generating = true;
		error = '';

		try {
			const code = await createInvite(groupId);
			inviteLink = `${window.location.origin}/groups/join?group=${encodeURIComponent(groupId)}&code=${encodeURIComponent(code)}`;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to generate invite';
			console.error('[Groups] Invite error:', e);
		} finally {
			generating = false;
		}
	}

	async function handleCopy() {
		if (!inviteLink) return;
		const ok = await copyToClipboard(inviteLink);
		if (ok) {
			copied = true;
			setTimeout(() => (copied = false), 2000);
		}
	}
</script>

<Modal bind:open {cleanup}>
	<span slot="title">Invite Link</span>

	<div class="flex flex-col gap-4">
		{#if generating}
			<div class="flex items-center justify-center py-6">
				<div
					class="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
					style="border-color: var(--color-primary); border-top-color: transparent;"
				></div>
				<span class="ml-3 text-sm" style="color: var(--color-caption);">Generating invite...</span>
			</div>
		{:else if error}
			<p class="text-xs text-danger">{error}</p>
		{:else if inviteLink}
			<div class="flex flex-col gap-3">
				<p class="text-sm" style="color: var(--color-caption);">
					Share this link to invite people to the group:
				</p>
				<div
					class="flex items-center gap-2 p-3 rounded-xl text-xs break-all"
					style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
				>
					<LinkIcon size={16} class="flex-shrink-0" />
					<span class="flex-1">{inviteLink}</span>
				</div>
				<button
					on:click={handleCopy}
					class="w-full py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer flex items-center justify-center gap-2"
					style="background-color: var(--color-primary); color: #ffffff;"
				>
					{#if copied}
						<CheckIcon size={16} weight="bold" />
						Copied!
					{:else}
						Copy Link
					{/if}
				</button>
			</div>
		{/if}
	</div>
</Modal>
