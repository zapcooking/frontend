<script lang="ts">
	import Modal from '../../../components/Modal.svelte';
	import { createGroup } from '$lib/nip29';
	import { setGroupMetadata } from '$lib/stores/groups';
	import { createEventDispatcher } from 'svelte';
	import GlobeSimpleIcon from 'phosphor-svelte/lib/GlobeSimple';
	import LockIcon from 'phosphor-svelte/lib/Lock';

	const dispatch = createEventDispatcher<{
		created: { groupId: string };
	}>();

	export let open = false;

	let name = '';
	let about = '';
	let visibility: 'public' | 'private' = 'public';
	let creating = false;
	let error = '';

	function cleanup() {
		name = '';
		about = '';
		visibility = 'public';
		creating = false;
		error = '';
	}

	async function handleCreate() {
		if (!name.trim() || creating) return;

		creating = true;
		error = '';

		try {
			const groupId = await createGroup(name.trim(), about.trim() || undefined, visibility);

			// Add to local store immediately
			setGroupMetadata({
				id: groupId,
				name: name.trim(),
				picture: '',
				about: about.trim(),
				isPrivate: visibility === 'private',
				isClosed: false,
				isRestricted: visibility === 'private'
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

		<div>
			<span
				class="block text-sm font-medium mb-2"
				style="color: var(--color-text-primary);"
			>
				Access Level
			</span>
			<div class="flex flex-col gap-2">
				<label
					class="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-colors"
					style="border: 1px solid {visibility === 'public' ? 'var(--color-primary)' : 'var(--color-input-border)'}; background-color: {visibility === 'public' ? 'color-mix(in srgb, var(--color-primary) 8%, transparent)' : 'transparent'};"
				>
					<input type="radio" bind:group={visibility} value="public" class="sr-only" disabled={creating} />
					<span style="color: {visibility === 'public' ? 'var(--color-primary)' : 'var(--color-caption)'};">
						<GlobeSimpleIcon size={18} />
					</span>
					<div class="flex-1 min-w-0">
						<span class="text-sm font-medium block" style="color: var(--color-text-primary);">Public</span>
						<span class="text-xs" style="color: var(--color-caption);">Anyone can join and read</span>
					</div>
				</label>

				<label
					class="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-colors"
					style="border: 1px solid {visibility === 'private' ? 'var(--color-primary)' : 'var(--color-input-border)'}; background-color: {visibility === 'private' ? 'color-mix(in srgb, var(--color-primary) 8%, transparent)' : 'transparent'};"
				>
					<input type="radio" bind:group={visibility} value="private" class="sr-only" disabled={creating} />
					<span style="color: {visibility === 'private' ? 'var(--color-primary)' : 'var(--color-caption)'};">
						<LockIcon size={18} />
					</span>
					<div class="flex-1 min-w-0">
						<span class="text-sm font-medium block" style="color: var(--color-text-primary);">Private</span>
						<span class="text-xs" style="color: var(--color-caption);">Only invited members can join</span>
					</div>
				</label>
			</div>
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
