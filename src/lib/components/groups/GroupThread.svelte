<script lang="ts">
	import { onMount, afterUpdate, createEventDispatcher } from 'svelte';
	import { userPublickey } from '$lib/nostr';
	import { getGroup, setActiveGroup, addGroupMessage } from '$lib/stores/groups';
	import { sendGroupMessage } from '$lib/nip29';
	import GroupMessage from './GroupMessage.svelte';
	import AddMemberModal from './AddMemberModal.svelte';
	import GroupMembersModal from './GroupMembersModal.svelte';
	import CustomAvatar from '../../../components/CustomAvatar.svelte';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeft';
	import PaperPlaneTiltIcon from 'phosphor-svelte/lib/PaperPlaneTilt';
	import UserPlusIcon from 'phosphor-svelte/lib/UserPlus';
	import LockIcon from 'phosphor-svelte/lib/Lock';

	export let groupId: string;
	export let hasActiveMembership: boolean = false;

	const dispatch = createEventDispatcher<{ back: void }>();

	let messageInput = '';
	let sending = false;
	let sendError = '';
	let scrollContainer: HTMLDivElement;
	let shouldAutoScroll = true;
	let showAddMember = false;
	let showMembers = false;

	const MAX_VISIBLE_AVATARS = 5;

	$: group = getGroup(groupId);
	$: messages = $group?.messages || [];
	$: groupName = $group?.name || groupId;
	$: members = $group?.members || [];
	$: visibleMembers = members.slice(0, MAX_VISIBLE_AVATARS);
	$: hiddenCount = Math.max(0, members.length - MAX_VISIBLE_AVATARS);
	$: isMembersOnly = !!($group?.isPrivate || $group?.isRestricted);
	$: isMemberOfGroup = !!$userPublickey && members.includes($userPublickey);
	$: isLockedOut = isMembersOnly && !hasActiveMembership && !isMemberOfGroup;

	$: {
		if (groupId) {
			setActiveGroup(groupId);
		}
	}

	onMount(() => {
		setActiveGroup(groupId);
		scrollToBottom();
		return () => setActiveGroup(null);
	});

	afterUpdate(() => {
		if (shouldAutoScroll) {
			scrollToBottom();
		}
	});

	function scrollToBottom() {
		if (scrollContainer) {
			scrollContainer.scrollTop = scrollContainer.scrollHeight;
		}
	}

	function handleScroll() {
		if (!scrollContainer) return;
		const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
		shouldAutoScroll = scrollHeight - scrollTop - clientHeight < 100;
	}

	async function handleSend() {
		const text = messageInput.trim();
		if (!text || sending) return;

		sending = true;
		sendError = '';

		try {
			const msg = await sendGroupMessage(groupId, text);
			addGroupMessage(msg);
			messageInput = '';
			shouldAutoScroll = true;
		} catch (e) {
			sendError = e instanceof Error ? e.message : 'Failed to send message';
			console.error('[Groups] Send error:', e);
		} finally {
			sending = false;
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	}
</script>

<div class="flex flex-col h-full">
	<!-- Header -->
	<div
		class="flex items-center gap-3 p-4 border-b"
		style="border-color: var(--color-input-border);"
	>
		<button
			class="lg:hidden p-1 rounded-lg transition-colors hover:bg-accent-gray cursor-pointer"
			style="color: var(--color-text-primary);"
			on:click={() => dispatch('back')}
		>
			<ArrowLeftIcon size={20} />
		</button>
		<div class="min-w-0 flex-1">
			<span class="font-medium text-sm truncate block" style="color: var(--color-text-primary);">
				{groupName}
			</span>
			{#if $group?.about}
				<span class="text-xs truncate block" style="color: var(--color-caption);">
					{$group.about}
				</span>
			{/if}
		</div>
		{#if !isLockedOut && members.length > 0}
			<button
				class="flex items-center gap-0.5 cursor-pointer rounded-lg p-1 hover:bg-accent-gray transition-colors"
				title="{members.length} members"
				on:click={() => (showMembers = true)}
			>
				<div class="flex items-center">
					{#each visibleMembers as pubkey, i (pubkey)}
						<div class="rounded-full border-2 border-white dark:border-gray-900" style:margin-left="{i > 0 ? '-8px' : '0'}">
							<CustomAvatar {pubkey} size={24} />
						</div>
					{/each}
				</div>
				{#if hiddenCount > 0}
					<span
						class="flex items-center h-6 px-1.5 rounded-full text-xs"
						style="color: var(--color-caption);"
					>
						+{hiddenCount}
					</span>
				{/if}
			</button>
		{/if}
		{#if !isLockedOut}
			<button
				class="p-1.5 rounded-lg transition-colors hover:bg-accent-gray cursor-pointer"
				style="color: var(--color-text-primary);"
				title="Add member"
				on:click={() => (showAddMember = true)}
			>
				<UserPlusIcon size={20} />
			</button>
		{/if}
	</div>

	{#if isLockedOut}
		<!-- Locked out: members-only group for non-members -->
		<div class="flex-1 flex flex-col items-center justify-center px-4 text-center">
			<LockIcon size={40} weight="light" style="color: var(--color-caption);" />
			<p class="text-sm font-medium mt-3" style="color: var(--color-text-primary);">
				Members Only
			</p>
			<p class="text-xs mt-1 max-w-xs" style="color: var(--color-caption);">
				This group is restricted to Zap.Cooking members. Upgrade your membership to view and participate in the conversation.
			</p>
			<a
				href="/membership"
				class="mt-4 px-5 py-2 rounded-xl text-sm font-medium transition-colors"
				style="background-color: var(--color-primary); color: #ffffff;"
			>
				View Membership
			</a>
		</div>
	{:else}
		<!-- Messages -->
		<div
			bind:this={scrollContainer}
			on:scroll={handleScroll}
			class="flex-1 overflow-y-auto px-4 py-3"
		>
			{#if messages.length === 0}
				<div class="flex items-center justify-center h-full">
					<p class="text-sm" style="color: var(--color-caption);">
						No messages yet. Say something!
					</p>
				</div>
			{:else}
				{#each messages as msg (msg.id)}
					<GroupMessage sender={msg.sender} content={msg.content} created_at={msg.created_at} />
				{/each}
			{/if}
		</div>

		<!-- Error -->
		{#if sendError}
			<div class="px-4 py-2">
				<p class="text-xs text-danger">{sendError}</p>
			</div>
		{/if}

		<!-- Input -->
		<div
			class="p-3 border-t"
			style="border-color: var(--color-input-border);"
		>
			<div class="flex items-end gap-2">
				<textarea
					bind:value={messageInput}
					on:keydown={handleKeyDown}
					placeholder="Type a message..."
					rows="1"
					class="input flex-1 resize-none text-sm min-h-[42px] max-h-32"
					style="background-color: var(--color-input-bg);"
					disabled={sending}
				></textarea>
				<button
					on:click={handleSend}
					disabled={!messageInput.trim() || sending}
					class="p-2.5 rounded-xl transition-colors cursor-pointer disabled:opacity-40"
					style="background-color: var(--color-primary); color: #ffffff;"
				>
					{#if sending}
						<div
							class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"
						></div>
					{:else}
						<PaperPlaneTiltIcon size={20} weight="fill" />
					{/if}
				</button>
			</div>
		</div>
	{/if}
</div>

<AddMemberModal bind:open={showAddMember} {groupId} />
<GroupMembersModal bind:open={showMembers} {members} />
