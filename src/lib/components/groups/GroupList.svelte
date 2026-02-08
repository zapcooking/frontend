<script lang="ts">
	import { sortedGroups, groupsLoading } from '$lib/stores/groups';
	import PlusIcon from 'phosphor-svelte/lib/Plus';
	import { createEventDispatcher } from 'svelte';

	const dispatch = createEventDispatcher<{
		select: { groupId: string };
		createGroup: void;
	}>();

	export let selectedGroupId: string | null = null;

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
</script>

<div class="flex flex-col h-full">
	<!-- Header -->
	<div
		class="flex items-center justify-between p-4 border-b"
		style="border-color: var(--color-input-border);"
	>
		<h2 class="text-lg font-semibold" style="color: var(--color-text-primary);">Groups</h2>
		<button
			class="p-2 rounded-xl transition-colors hover:bg-accent-gray cursor-pointer"
			style="color: var(--color-text-primary);"
			on:click={() => dispatch('createGroup')}
			title="Create group"
		>
			<PlusIcon size={20} />
		</button>
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
				<button
					class="w-full flex items-center gap-3 px-4 py-3 transition-colors cursor-pointer text-left"
					class:bg-input={selectedGroupId === group.id}
					style="border-bottom: 1px solid var(--color-input-border);"
					on:click={() => dispatch('select', { groupId: group.id })}
				>
					<div
						class="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold"
						style="background-color: var(--color-primary); color: #ffffff;"
					>
						{group.name.charAt(0).toUpperCase()}
					</div>
					<div class="flex-1 min-w-0">
						<div class="flex items-center justify-between">
							<span
								class="font-medium text-sm truncate"
								style="color: var(--color-text-primary);"
							>
								{group.name}
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
			{/each}
			{#if $groupsLoading}
				<div class="flex items-center justify-center py-2">
					<span class="text-xs" style="color: var(--color-caption);">Loading more...</span>
				</div>
			{/if}
		{/if}
	</div>
</div>
