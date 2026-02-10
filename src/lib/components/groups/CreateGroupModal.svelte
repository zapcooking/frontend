<script lang="ts">
	import Modal from '../../../components/Modal.svelte';
	import { createGroup } from '$lib/nip29';
	import { setGroupMetadata } from '$lib/stores/groups';
	import { createEventDispatcher } from 'svelte';

	const dispatch = createEventDispatcher<{
		created: { groupId: string };
	}>();

	export let open = false;

	let name = '';
	let about = '';
	let creating = false;
	let error = '';

	function cleanup() {
		name = '';
		about = '';
		creating = false;
		error = '';
	}

	async function handleCreate() {
		if (!name.trim() || creating) return;

		creating = true;
		error = '';

		try {
			const groupId = await createGroup(name.trim(), about.trim() || undefined);

			// Add to local store immediately
			setGroupMetadata({
				id: groupId,
				name: name.trim(),
				picture: '',
				about: about.trim(),
				isPrivate: false,
				isClosed: false,
				isRestricted: false
			});

			dispatch('created', { groupId });
			open = false;
			cleanup();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to create group';
			console.error('[Groups] Create error:', e);
		} finally {
			creating = false;
		}
	}
</script>

<Modal bind:open {cleanup}>
	<span slot="title">Create Group</span>

	<div class="flex flex-col gap-4">
		<div>
			<label
				for="group-name"
				class="block text-sm font-medium mb-1"
				style="color: var(--color-text-primary);"
			>
				Group Name
			</label>
			<input
				id="group-name"
				type="text"
				bind:value={name}
				placeholder="e.g. Sourdough Club"
				class="input w-full text-sm"
				style="background-color: var(--color-input-bg);"
				maxlength="100"
				disabled={creating}
			/>
		</div>

		<div>
			<label
				for="group-about"
				class="block text-sm font-medium mb-1"
				style="color: var(--color-text-primary);"
			>
				Description <span class="font-normal" style="color: var(--color-caption);">(optional)</span>
			</label>
			<textarea
				id="group-about"
				bind:value={about}
				placeholder="What's this group about?"
				rows="2"
				class="input w-full text-sm resize-none"
				style="background-color: var(--color-input-bg);"
				maxlength="300"
				disabled={creating}
			></textarea>
		</div>

		{#if error}
			<p class="text-xs text-danger">{error}</p>
		{/if}

		<button
			on:click={handleCreate}
			disabled={!name.trim() || creating}
			class="w-full py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer disabled:opacity-40"
			style="background-color: var(--color-primary); color: #ffffff;"
		>
			{#if creating}
				Creating...
			{:else}
				Create Group
			{/if}
		</button>
	</div>
</Modal>
