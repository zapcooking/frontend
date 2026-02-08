<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { ndk, userPublickey } from '$lib/nostr';
	import {
		initGroupSubscription,
		groupsInitialized,
		groupsLoading,
		setActiveGroup
	} from '$lib/stores/groups';
	import GroupList from '$lib/components/groups/GroupList.svelte';
	import GroupThread from '$lib/components/groups/GroupThread.svelte';
	import CreateGroupModal from '$lib/components/groups/CreateGroupModal.svelte';
	import LockIcon from 'phosphor-svelte/lib/Lock';

	let selectedGroupId: string | null = null;
	let createGroupOpen = false;

	// Membership gate
	let hasActiveMembership = false;
	let checkingMembership = false;

	// Mobile: show thread or list
	$: showThread = selectedGroupId !== null;

	$: isLoggedIn = !!$userPublickey;

	async function checkMembership() {
		if (!$userPublickey || checkingMembership) return;

		checkingMembership = true;
		try {
			const res = await fetch('/api/membership/check-status', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ pubkey: $userPublickey })
			});

			if (res.ok) {
				const data = await res.json();
				hasActiveMembership = data.isActive === true;
			}
		} catch (err) {
			console.error('Failed to check membership:', err);
		} finally {
			checkingMembership = false;
		}
	}

	onMount(async () => {
		if (!browser) return;
		if (!$userPublickey) return;

		// Always fetch groups so non-members can see public groups
		if (!$groupsInitialized && !$groupsLoading) {
			await initGroupSubscription($ndk, $userPublickey);
		}

		await checkMembership();
	});

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

{#if !isLoggedIn}
	<!-- Not logged in -->
	<div class="flex flex-col items-center justify-center py-20 px-4 text-center">
		<LockIcon size={48} weight="light" style="color: var(--color-caption);" />
		<h2 class="text-lg font-semibold mt-4" style="color: var(--color-text-primary);">
			Sign in to use Groups
		</h2>
		<p class="text-sm mt-2 max-w-sm" style="color: var(--color-caption);">
			Group chat requires authentication. Sign in with your Nostr key to join group conversations.
		</p>
		<a
			href="/login"
			class="mt-4 px-6 py-2.5 rounded-xl text-sm font-medium transition-colors"
			style="background-color: var(--color-primary); color: #ffffff;"
		>
			Sign In
		</a>
	</div>
{:else}
	<!-- Groups UI -->
	<div
		class="flex h-[calc(100vh-8rem)] lg:h-[calc(100vh-6rem)] -mx-4 rounded-xl overflow-hidden border"
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
				{hasActiveMembership}
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
				<GroupThread groupId={selectedGroupId} {hasActiveMembership} on:back={handleBack} />
			{:else}
				<div class="flex items-center justify-center h-full">
					<p class="text-sm" style="color: var(--color-caption);">
						Select a group or create a new one.
					</p>
				</div>
			{/if}
		</div>
	</div>

	<!-- Create group modal (members only) -->
	{#if hasActiveMembership}
		<CreateGroupModal bind:open={createGroupOpen} on:created={handleGroupCreated} />
	{/if}
{/if}
