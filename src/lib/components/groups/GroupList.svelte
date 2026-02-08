<script lang="ts">
	import { sortedGroups, groupsLoading, setGroupMetadata, removeGroup } from '$lib/stores/groups';
	import { userPublickey } from '$lib/nostr';
	import { editGroupMetadata, deleteGroup, uploadGroupPicture } from '$lib/nip29';
	import { clickOutside } from '$lib/clickOutside';
	import Modal from '../../../components/Modal.svelte';
	import PlusIcon from 'phosphor-svelte/lib/Plus';
	import DotsThreeIcon from 'phosphor-svelte/lib/DotsThree';
	import PencilSimpleLineIcon from 'phosphor-svelte/lib/PencilSimpleLine';
	import TrashIcon from 'phosphor-svelte/lib/Trash';
	import ImageIcon from 'phosphor-svelte/lib/Image';
	import GlobeSimpleIcon from 'phosphor-svelte/lib/GlobeSimple';
	import LockIcon from 'phosphor-svelte/lib/Lock';
	import { createEventDispatcher } from 'svelte';

	const dispatch = createEventDispatcher<{
		select: { groupId: string };
		createGroup: void;
	}>();

	export let selectedGroupId: string | null = null;
	export let hasActiveMembership: boolean = false;

	// Menu state
	let openMenuId: string | null = null;

	// Visibility toggle state
	let togglingVisibility: string | null = null;

	// Edit modal state
	let editModalOpen = false;
	let editGroupId = '';
	let editName = '';
	let editSaving = false;
	let editError = '';

	// Picture modal state
	let pictureModalOpen = false;
	let pictureGroupId = '';
	let pictureUploading = false;
	let pictureError = '';
	let fileInput: HTMLInputElement;

	// Delete modal state
	let deleteModalOpen = false;
	let deleteGroupId = '';
	let deleteGroupName = '';
	let deleteDeleting = false;
	let deleteError = '';

	function truncate(text: string, maxLen: number): string {
		if (!text) return '';
		return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
	}

	function formatRelativeTime(ts: number): string {
		if (!ts) return '';
		const now = Date.now() / 1000;
		const diff = now - ts;
		if (diff < 60) return 'now';
		if (diff < 3600) return `${Math.floor(diff / 60)}m`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
		if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
		return new Date(ts * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' });
	}

	function getLastMessagePreview(messages: { content: string }[]): string {
		if (messages.length === 0) return '';
		return truncate(messages[messages.length - 1].content, 40);
	}

	function toggleMenu(e: MouseEvent, groupId: string) {
		e.stopPropagation();
		openMenuId = openMenuId === groupId ? null : groupId;
	}

	function closeMenu() {
		openMenuId = null;
	}

	// ── Edit ──

	function openEdit(e: MouseEvent, groupId: string, currentName: string) {
		e.stopPropagation();
		editGroupId = groupId;
		editName = currentName;
		editError = '';
		editSaving = false;
		editModalOpen = true;
		closeMenu();
	}

	function editCleanup() {
		editGroupId = '';
		editName = '';
		editError = '';
		editSaving = false;
	}

	async function handleEditSave() {
		if (!editName.trim() || editSaving) return;
		editSaving = true;
		editError = '';
		try {
			await editGroupMetadata(editGroupId, { name: editName.trim() });
			setGroupMetadata({
				id: editGroupId,
				name: editName.trim(),
				picture: $sortedGroups.find((g) => g.id === editGroupId)?.picture || '',
				about: $sortedGroups.find((g) => g.id === editGroupId)?.about || '',
				isPrivate: $sortedGroups.find((g) => g.id === editGroupId)?.isPrivate || false,
				isClosed: $sortedGroups.find((g) => g.id === editGroupId)?.isClosed || false,
				isRestricted: $sortedGroups.find((g) => g.id === editGroupId)?.isRestricted || false
			});
			editModalOpen = false;
		} catch (e) {
			editError = e instanceof Error ? e.message : 'Failed to update name';
		} finally {
			editSaving = false;
		}
	}

	// ── Picture ──

	function openPicture(e: MouseEvent, groupId: string) {
		e.stopPropagation();
		pictureGroupId = groupId;
		pictureError = '';
		pictureUploading = false;
		pictureModalOpen = true;
		closeMenu();
	}

	function pictureCleanup() {
		pictureGroupId = '';
		pictureError = '';
		pictureUploading = false;
	}

	function triggerFileSelect() {
		fileInput?.click();
	}

	async function handleFileSelected(e: Event) {
		const target = e.target as HTMLInputElement;
		if (!target.files?.length) return;
		const file = target.files[0];

		if (!file.type.startsWith('image/')) {
			pictureError = 'Please select an image file';
			return;
		}
		if (file.size > 10 * 1024 * 1024) {
			pictureError = 'Image must be less than 10MB';
			return;
		}

		pictureUploading = true;
		pictureError = '';
		try {
			const imageUrl = await uploadGroupPicture(file);
			await editGroupMetadata(pictureGroupId, { picture: imageUrl });
			const group = $sortedGroups.find((g) => g.id === pictureGroupId);
			if (group) {
				setGroupMetadata({
					id: pictureGroupId,
					name: group.name,
					picture: imageUrl,
					about: group.about,
					isPrivate: group.isPrivate,
					isClosed: group.isClosed,
					isRestricted: group.isRestricted
				});
			}
			pictureModalOpen = false;
		} catch (e) {
			pictureError = e instanceof Error ? e.message : 'Failed to upload picture';
		} finally {
			pictureUploading = false;
			if (target) target.value = '';
		}
	}

	// ── Delete ──

	function openDelete(e: MouseEvent, groupId: string, groupName: string) {
		e.stopPropagation();
		deleteGroupId = groupId;
		deleteGroupName = groupName;
		deleteError = '';
		deleteDeleting = false;
		deleteModalOpen = true;
		closeMenu();
	}

	function deleteCleanup() {
		deleteGroupId = '';
		deleteGroupName = '';
		deleteError = '';
		deleteDeleting = false;
	}

	async function handleDeleteConfirm() {
		if (deleteDeleting) return;
		deleteDeleting = true;
		deleteError = '';
		try {
			await deleteGroup(deleteGroupId);
			removeGroup(deleteGroupId);
			if (selectedGroupId === deleteGroupId) {
				dispatch('select', { groupId: '' });
			}
			deleteModalOpen = false;
		} catch (e) {
			deleteError = e instanceof Error ? e.message : 'Failed to delete group';
		} finally {
			deleteDeleting = false;
		}
	}

	// ── Visibility Toggle ──

	async function handleToggleVisibility(e: MouseEvent, group: { id: string; name: string; picture: string; about: string; isPrivate: boolean; isClosed: boolean; isRestricted: boolean }) {
		e.stopPropagation();
		closeMenu();
		if (togglingVisibility) return;
		togglingVisibility = group.id;

		const isCurrentlyMembersOnly = group.isPrivate || group.isRestricted;
		const newVisibility = isCurrentlyMembersOnly ? 'public' : 'members-only';

		try {
			await editGroupMetadata(group.id, { visibility: newVisibility });
			setGroupMetadata({
				id: group.id,
				name: group.name,
				picture: group.picture,
				about: group.about,
				isPrivate: newVisibility === 'members-only',
				isClosed: group.isClosed,
				isRestricted: newVisibility === 'members-only'
			});
		} catch (err) {
			console.error('Failed to toggle group visibility:', err);
		} finally {
			togglingVisibility = null;
		}
	}
</script>

<div class="flex flex-col h-full">
	<!-- Header -->
	<div
		class="flex items-center justify-between p-4 border-b"
		style="border-color: var(--color-input-border);"
	>
		<h2 class="text-lg font-semibold" style="color: var(--color-text-primary);">Groups</h2>
		{#if hasActiveMembership}
			<button
				class="p-2 rounded-xl transition-colors hover:bg-accent-gray cursor-pointer"
				style="color: var(--color-text-primary);"
				on:click={() => dispatch('createGroup')}
				title="Create group"
			>
				<PlusIcon size={20} />
			</button>
		{/if}
	</div>

	<!-- Group list -->
	<div class="flex-1 overflow-y-auto">
		{#if $groupsLoading && $sortedGroups.length === 0}
			<div class="flex items-center gap-2 px-4 py-3" style="color: var(--color-caption);">
				<div
					class="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin flex-shrink-0"
					style="border-color: var(--color-primary); border-top-color: transparent;"
				></div>
				<span class="text-xs">Loading groups...</span>
			</div>
		{/if}
		{#if $sortedGroups.length === 0 && !$groupsLoading}
			<div class="flex flex-col items-center justify-center py-12 px-4 text-center">
				<p class="text-sm mb-1" style="color: var(--color-caption);">No groups yet</p>
				<p class="text-xs" style="color: var(--color-caption);">
					Create a group to start chatting with members.
				</p>
			</div>
		{:else}
			{#each $sortedGroups as group (group.id)}
				<div
					class="relative flex items-start gap-3 px-4 py-3 transition-colors text-left"
					class:bg-input={selectedGroupId === group.id}
					style="border-bottom: 1px solid var(--color-input-border);"
				>
					<button
						class="flex items-start gap-3 flex-1 min-w-0 cursor-pointer text-left"
						on:click={() => dispatch('select', { groupId: group.id })}
					>
						{#if group.picture}
							<img
								src={group.picture}
								alt={group.name}
								class="flex-shrink-0 w-11 h-11 rounded-full object-cover"
							/>
						{:else}
							<div
								class="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold"
								style="background-color: var(--color-primary); color: #ffffff;"
							>
								{group.name.charAt(0).toUpperCase()}
							</div>
						{/if}
						<div class="flex-1 min-w-0">
							<div class="flex items-center justify-between">
								<span
									class="font-medium text-sm truncate flex items-center gap-1.5"
									style="color: var(--color-text-primary);"
								>
									{group.name}
									{#if group.isPrivate || group.isRestricted}
									{@const isMemberOfGroup = !!$userPublickey && group.members.includes($userPublickey)}
										<span title="Members only" style="color: {hasActiveMembership || isMemberOfGroup ? '#22c55e' : 'var(--color-caption)'};">
											<LockIcon size={12} />
										</span>
									{:else}
										<span title="Public" style="color: #22c55e;">
											<GlobeSimpleIcon size={12} />
										</span>
									{/if}
								</span>
								{#if group.lastMessageAt}
									<span class="text-xs flex-shrink-0 ml-2" style="color: var(--color-caption);">
										{formatRelativeTime(group.lastMessageAt)}
									</span>
								{/if}
							</div>
							<p class="text-xs truncate mt-0.5" style="color: var(--color-caption);">
								{getLastMessagePreview(group.messages) || group.about || ''}
							</p>
						</div>
					</button>

					<!-- Kebab menu (members only) -->
					{#if hasActiveMembership}
					<div class="relative flex-shrink-0">
						<button
							class="p-1 rounded-lg transition-colors hover:bg-accent-gray cursor-pointer"
							style="color: var(--color-caption);"
							title="Group options"
							on:click={(e) => toggleMenu(e, group.id)}
						>
							<DotsThreeIcon size={20} weight="bold" />
						</button>

						{#if openMenuId === group.id}
							<div
								class="absolute top-full right-0 mt-1 rounded-lg shadow-lg py-1 z-50 min-w-[150px]"
								style="background-color: var(--color-input); border: 1px solid var(--color-input-border);"
								use:clickOutside
								on:click_outside={closeMenu}
							>
								<button
									class="w-full px-4 py-2 text-left text-sm hover:bg-accent-gray flex items-center gap-2 cursor-pointer"
									style="color: var(--color-text-primary);"
									on:click={(e) => openEdit(e, group.id, group.name)}
								>
									<PencilSimpleLineIcon size={16} />
									<span>Edit Name</span>
								</button>
								<button
									class="w-full px-4 py-2 text-left text-sm hover:bg-accent-gray flex items-center gap-2 cursor-pointer"
									style="color: var(--color-text-primary);"
									on:click={(e) => openPicture(e, group.id)}
								>
									<ImageIcon size={16} />
									<span>Picture</span>
								</button>
								<button
									class="w-full px-4 py-2 text-left text-sm hover:bg-accent-gray flex items-center gap-2 cursor-pointer"
									style="color: var(--color-text-primary);"
									disabled={togglingVisibility === group.id}
									on:click={(e) => handleToggleVisibility(e, group)}
								>
									{#if group.isPrivate || group.isRestricted}
										<GlobeSimpleIcon size={16} />
										<span>{togglingVisibility === group.id ? 'Updating...' : 'Make Public'}</span>
									{:else}
										<LockIcon size={16} />
										<span>{togglingVisibility === group.id ? 'Updating...' : 'Make Members Only'}</span>
									{/if}
								</button>
								<button
									class="w-full px-4 py-2 text-left text-sm hover:bg-accent-gray flex items-center gap-2 cursor-pointer text-red-500"
									on:click={(e) => openDelete(e, group.id, group.name)}
								>
									<TrashIcon size={16} />
									<span>Delete</span>
								</button>
							</div>
						{/if}
					</div>
					{/if}
				</div>
			{/each}
			{#if $groupsLoading}
				<div class="flex items-center justify-center py-2">
					<span class="text-xs" style="color: var(--color-caption);">Loading more...</span>
				</div>
			{/if}
		{/if}
	</div>
</div>

<!-- Edit Name Modal -->
<Modal bind:open={editModalOpen} cleanup={editCleanup}>
	<span slot="title">Edit Group Name</span>
	<div class="flex flex-col gap-4">
		<div>
			<label
				for="edit-group-name"
				class="block text-sm font-medium mb-1"
				style="color: var(--color-text-primary);"
			>
				Group Name
			</label>
			<input
				id="edit-group-name"
				type="text"
				bind:value={editName}
				class="input w-full text-sm"
				style="background-color: var(--color-input-bg);"
				maxlength="100"
				disabled={editSaving}
			/>
		</div>
		{#if editError}
			<p class="text-xs text-danger">{editError}</p>
		{/if}
		<button
			on:click={handleEditSave}
			disabled={!editName.trim() || editSaving}
			class="w-full py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer disabled:opacity-40"
			style="background-color: var(--color-primary); color: #ffffff;"
		>
			{editSaving ? 'Saving...' : 'Save'}
		</button>
	</div>
</Modal>

<!-- Picture Upload Modal -->
<Modal bind:open={pictureModalOpen} cleanup={pictureCleanup}>
	<span slot="title">Group Picture</span>
	<div class="flex flex-col gap-4">
		{#if $sortedGroups.find((g) => g.id === pictureGroupId)?.picture}
			<div class="flex justify-center">
				<img
					src={$sortedGroups.find((g) => g.id === pictureGroupId)?.picture}
					alt="Current group picture"
					class="w-24 h-24 rounded-full object-cover"
				/>
			</div>
		{/if}
		<input
			bind:this={fileInput}
			type="file"
			accept="image/*"
			class="hidden"
			on:change={handleFileSelected}
		/>
		{#if pictureError}
			<p class="text-xs text-danger">{pictureError}</p>
		{/if}
		<button
			on:click={triggerFileSelect}
			disabled={pictureUploading}
			class="w-full py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer disabled:opacity-40"
			style="background-color: var(--color-primary); color: #ffffff;"
		>
			{#if pictureUploading}
				Uploading...
			{:else}
				Choose Image
			{/if}
		</button>
	</div>
</Modal>

<!-- Delete Confirmation Modal -->
<Modal bind:open={deleteModalOpen} cleanup={deleteCleanup} noHeader>
	<div class="flex flex-col gap-3">
		<h2 class="text-xl font-semibold" style="color: var(--color-text-primary);">
			Delete Group?
		</h2>
		<p class="text-sm" style="color: var(--color-caption);">
			Are you sure you want to delete <strong>{deleteGroupName}</strong>? This action cannot be undone.
		</p>
		{#if deleteError}
			<p class="text-xs text-danger">{deleteError}</p>
		{/if}
		<div class="flex gap-3 justify-end">
			<button
				class="px-4 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer"
				style="color: var(--color-text-primary);"
				on:click={() => (deleteModalOpen = false)}
			>
				Cancel
			</button>
			<button
				class="px-4 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer disabled:opacity-40 text-white bg-red-600 hover:bg-red-700"
				on:click={handleDeleteConfirm}
				disabled={deleteDeleting}
			>
				{deleteDeleting ? 'Deleting...' : 'Delete'}
			</button>
		</div>
	</div>
</Modal>
