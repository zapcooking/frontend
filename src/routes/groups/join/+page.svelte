<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { ndk, userPublickey } from '$lib/nostr';
	import { joinGroup, fetchGroups } from '$lib/nip29';
	import UsersThreeIcon from 'phosphor-svelte/lib/UsersThree';
	import LockIcon from 'phosphor-svelte/lib/Lock';

	let groupId = '';
	let inviteCode = '';
	let groupName = '';
	let loading = true;
	let joining = false;
	let error = '';
	let success = false;

	$: isLoggedIn = !!$userPublickey;

	onMount(async () => {
		if (!browser) return;

		groupId = $page.url.searchParams.get('group') || '';
		inviteCode = $page.url.searchParams.get('code') || '';

		if (!groupId) {
			error = 'Invalid invite link — missing group ID.';
			loading = false;
			return;
		}

		// Try to fetch group metadata to show the group name
		try {
			const groups = await fetchGroups($ndk);
			const match = groups.find((g) => g.id === groupId);
			if (match) {
				groupName = match.name;
			}
		} catch {
			// Silently fail — we'll just show the group ID
		}

		loading = false;
	});

	async function handleJoin() {
		if (joining) return;
		joining = true;
		error = '';

		try {
			await joinGroup(groupId, inviteCode || undefined);
			success = true;
			// Redirect to groups page after a short delay
			setTimeout(() => {
				goto('/groups');
			}, 1500);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to join group';
			console.error('[Groups] Join error:', e);
		} finally {
			joining = false;
		}
	}
</script>

<svelte:head>
	<title>Join Group - Zap Cooking</title>
</svelte:head>

<div class="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
	{#if loading}
		<div
			class="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
			style="border-color: var(--color-primary); border-top-color: transparent;"
		></div>
	{:else if !isLoggedIn}
		<LockIcon size={48} weight="light" style="color: var(--color-caption);" />
		<h2 class="text-lg font-semibold mt-4" style="color: var(--color-text-primary);">
			Sign in to join this group
		</h2>
		<p class="text-sm mt-2 max-w-sm" style="color: var(--color-caption);">
			You need to sign in with your Nostr key before joining a group.
		</p>
		<a
			href="/login"
			class="mt-4 px-6 py-2.5 rounded-xl text-sm font-medium transition-colors"
			style="background-color: var(--color-primary); color: #ffffff;"
		>
			Sign In
		</a>
	{:else if success}
		<div class="mb-3" style="color: #22c55e;">
			<UsersThreeIcon size={48} weight="fill" />
		</div>
		<h2 class="text-lg font-semibold" style="color: var(--color-text-primary);">
			Joined!
		</h2>
		<p class="text-sm mt-2" style="color: var(--color-caption);">
			Redirecting to groups...
		</p>
	{:else}
		<div class="mb-4" style="color: var(--color-primary);">
			<UsersThreeIcon size={48} weight="light" />
		</div>
		<h2 class="text-lg font-semibold" style="color: var(--color-text-primary);">
			{#if groupName}
				Join "{groupName}"
			{:else}
				Join Group
			{/if}
		</h2>
		{#if inviteCode}
			<p class="text-sm mt-2 max-w-sm" style="color: var(--color-caption);">
				You've been invited to join this group on Zap.Cooking.
			</p>
		{:else}
			<p class="text-sm mt-2 max-w-sm" style="color: var(--color-caption);">
				Request to join this group on Zap.Cooking.
			</p>
		{/if}

		{#if error}
			<p class="text-xs text-danger mt-3">{error}</p>
		{/if}

		<button
			on:click={handleJoin}
			disabled={joining}
			class="mt-5 px-6 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer disabled:opacity-40"
			style="background-color: var(--color-primary); color: #ffffff;"
		>
			{#if joining}
				Joining...
			{:else}
				Join Group
			{/if}
		</button>
	{/if}
</div>
