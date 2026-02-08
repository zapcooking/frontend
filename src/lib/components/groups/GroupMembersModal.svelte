<script lang="ts">
	import { goto } from '$app/navigation';
	import { nip19 } from 'nostr-tools';
	import Modal from '../../../components/Modal.svelte';
	import CustomAvatar from '../../../components/CustomAvatar.svelte';
	import CustomName from '../../../components/CustomName.svelte';
	import UsersIcon from 'phosphor-svelte/lib/Users';

	export let open = false;
	export let members: string[] = [];

	function truncatedNpub(pubkey: string): string {
		const npub = nip19.npubEncode(pubkey);
		return npub.slice(0, 12) + '...' + npub.slice(-6);
	}

	function goToUser(pubkey: string) {
		open = false;
		goto(`/user/${pubkey}`);
	}
</script>

<Modal bind:open>
	<span slot="title" class="flex items-center gap-2">
		<UsersIcon size={20} />
		{members.length} {members.length === 1 ? 'Member' : 'Members'}
	</span>

	<div class="space-y-1 max-h-96 overflow-y-auto">
		{#each members as pubkey (pubkey)}
			<button
				class="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-accent-gray transition-colors cursor-pointer text-left"
				on:click={() => goToUser(pubkey)}
			>
				<CustomAvatar {pubkey} size={40} />
				<div class="flex-1 min-w-0">
					<div class="font-medium text-sm truncate" style="color: var(--color-text-primary);">
						<CustomName {pubkey} />
					</div>
					<div class="text-xs truncate" style="color: var(--color-caption);">
						{truncatedNpub(pubkey)}
					</div>
				</div>
			</button>
		{/each}
	</div>
</Modal>
