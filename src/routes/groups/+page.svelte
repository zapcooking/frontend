<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { ndk, userPublickey } from '$lib/nostr';
	import {
		initGroupSubscription,
		groupsInitialized,
		groupsLoading,
		groupsSyncing,
		groupsInitAnonymous,
		setActiveGroup,
		clearGroups
	} from '$lib/stores/groups';
	import GroupList from '$lib/components/groups/GroupList.svelte';
	import GroupThread from '$lib/components/groups/GroupThread.svelte';
	import CreateGroupModal from '$lib/components/groups/CreateGroupModal.svelte';

	let selectedGroupId: string | null = null;
	let createGroupOpen = false;

	// Mobile: show thread or list
	$: showThread = selectedGroupId !== null;

	$: isLoggedIn = !!$userPublickey;

	onMount(async () => {
		if (!browser) return;

		if (!$groupsInitialized && !$groupsLoading) {
			await initGroupSubscription($ndk, $userPublickey || undefined);
		}
	});

	// Re-initialize when user logs in after anonymous browsing
	$: if (browser && isLoggedIn && $groupsInitialized && $groupsInitAnonymous) {
		clearGroups();
		initGroupSubscription($ndk, $userPublickey!);
	}

	onDestroy(() => {
		setActiveGroup(null);
	});

	function handleSelectGroup(e: CustomEvent<{ groupId: string }>) {
		selectedGroupId = e.detail.groupId;
	}

	function handleBack() {
		selectedGroupId = null;
		setActiveGroup(null);
	}

	function handleCreateGroup() {
		createGroupOpen = true;
	}

	function handleGroupCreated(e: CustomEvent<{ groupId: string }>) {
		selectedGroupId = e.detail.groupId;
	}
</script>

<svelte:head>
	<title>Groups - Zap Cooking</title>
</svelte:head>

<!-- Groups UI -->
<div
	class="flex h-[calc(100vh-8rem)] lg:h-[calc(100vh-6rem)] rounded-xl overflow-hidden border"
	style="border-color: var(--color-input-border); background-color: var(--color-bg-secondary);"
>
	<!-- Group List (left panel) -->
	<div
		class="w-full lg:w-80 xl:w-96 flex-shrink-0 border-r {showThread
			? 'hidden lg:block'
			: 'block'}"
		style="border-color: var(--color-input-border); background-color: var(--color-bg-primary);"
	>
		<GroupList
			{selectedGroupId}
			{isLoggedIn}
			on:select={handleSelectGroup}
			on:createGroup={handleCreateGroup}
		/>
	</div>

	<!-- Group Thread (right panel) -->
	<div
		class="flex-1 min-w-0 {showThread ? 'block' : 'hidden lg:block'}"
		style="background-color: var(--color-bg-primary);"
	>
		{#if selectedGroupId}
			<GroupThread groupId={selectedGroupId} {isLoggedIn} on:back={handleBack} />
		{:else}
			<div class="flex items-center justify-center h-full">
				<p class="text-sm" style="color: var(--color-caption);">
					{isLoggedIn ? 'Select a group or create a new one.' : 'Select a group to view.'}
				</p>
			</div>
		{/if}
	</div>
</div>

{#if isLoggedIn}
	<CreateGroupModal bind:open={createGroupOpen} on:created={handleGroupCreated} />
{/if}
