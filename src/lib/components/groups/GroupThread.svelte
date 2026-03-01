<script lang="ts">
	import { onMount, afterUpdate, createEventDispatcher } from 'svelte';
	import { userPublickey } from '$lib/nostr';
	import {
		getGroup,
		setActiveGroup,
		addGroupMessage,
		addOptimisticMessage,
		confirmOptimisticMessage,
		markMessageFailed,
		removeOptimisticMessage,
		groupsSyncing,
		groupsLoading
	} from '$lib/stores/groups';
	import { sendGroupMessage, uploadGroupPicture } from '$lib/nip29';
	import { copyToClipboard } from '$lib/utils/share';
	import { groupCache } from '$lib/groupCacheStorage';
	import GroupMessage from './GroupMessage.svelte';
	import AddMemberModal from './AddMemberModal.svelte';
	import GroupMembersModal from './GroupMembersModal.svelte';
	import CustomAvatar from '../../../components/CustomAvatar.svelte';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeft';
	import PaperPlaneTiltIcon from 'phosphor-svelte/lib/PaperPlaneTilt';
	import UserPlusIcon from 'phosphor-svelte/lib/UserPlus';
	import ImageIcon from 'phosphor-svelte/lib/Image';
	import LinkIcon from 'phosphor-svelte/lib/Link';
	import CheckIcon from 'phosphor-svelte/lib/Check';
	import ChatCircleDotsIcon from 'phosphor-svelte/lib/ChatCircleDots';
	import LockIcon from 'phosphor-svelte/lib/Lock';

	export let groupId: string;
	export let isLoggedIn: boolean = false;


	const dispatch = createEventDispatcher<{ back: void }>();

	let messageInput = '';
	let sending = false;
	let sendError = '';
	let scrollContainer: HTMLDivElement;
	let shouldAutoScroll = true;
	let showAddMember = false;
	let showMembers = false;
	let uploading = false;
	let showCopied = false;
	let fileInput: HTMLInputElement;

	const MAX_VISIBLE_AVATARS = 5;

	$: group = getGroup(groupId);
	$: messages = $group?.messages || [];
	$: groupName = $group?.name || groupId;
	$: members = $group?.members || [];
	$: visibleMembers = members.slice(0, MAX_VISIBLE_AVATARS);
	$: hiddenCount = Math.max(0, members.length - MAX_VISIBLE_AVATARS);

	$: {
		if (groupId) {
			setActiveGroup(groupId);
		}
	}

	onMount(() => {
		setActiveGroup(groupId);
		scrollToBottom();

		// Load pending messages from cache
		loadPendingMessages();

		return () => setActiveGroup(null);
	});

	let rafPending = false;
	afterUpdate(() => {
		if (shouldAutoScroll && !rafPending) {
			rafPending = true;
			requestAnimationFrame(() => {
				rafPending = false;
				scrollToBottom();
			});
		}
	});

	async function loadPendingMessages() {
		try {
			const pending = await groupCache.getPendingMessages(groupId);
			for (const pm of pending) {
				addOptimisticMessage(groupId, pm.tempId, pm.content, $userPublickey || '');
				if (pm.status === 'failed') {
					markMessageFailed(groupId, pm.tempId);
				}
			}
		} catch {
			// ignore cache errors
		}
	}

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

		// Generate temp ID
		const tempId = `pending-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

		// 1. Add optimistic message immediately
		addOptimisticMessage(groupId, tempId, text, $userPublickey || '');
		messageInput = '';
		shouldAutoScroll = true;

		// 2. Save to pending cache
		groupCache
			.savePendingMessage({
				tempId,
				groupId,
				content: text,
				created_at: Math.floor(Date.now() / 1000),
				status: 'pending',
				retryCount: 0
			})
			.catch(() => {});

		// 3. Send to relay with timeout
		try {
			const timeoutPromise = new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('Send timeout')), 10000)
			);
			const msg = await Promise.race([sendGroupMessage(groupId, text), timeoutPromise]);

			// 4. On success: confirm and update cache
			confirmOptimisticMessage(groupId, tempId, msg.id);
			groupCache.removePendingMessage(tempId).catch(() => {});
			groupCache
				.saveMessages([
					{
						id: msg.id,
						groupId: msg.groupId,
						sender: msg.sender,
						content: msg.content,
						created_at: msg.created_at,
						cachedAt: Date.now()
					}
				])
				.catch(() => {});
		} catch (e) {
			// 5. On failure: mark as failed
			markMessageFailed(groupId, tempId);
			groupCache
				.savePendingMessage({
					tempId,
					groupId,
					content: text,
					created_at: Math.floor(Date.now() / 1000),
					status: 'failed',
					retryCount: 0
				})
				.catch(() => {});
			sendError = e instanceof Error ? e.message : 'Failed to send message';
			console.error('[Groups] Send error:', e);
		} finally {
			sending = false;
		}
	}

	async function handleRetry(retryTempId: string, content: string) {
		// Remove failed message
		removeOptimisticMessage(groupId, retryTempId);
		groupCache.removePendingMessage(retryTempId).catch(() => {});

		// Re-send as new optimistic message
		messageInput = content;
		await handleSend();
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	}

	async function handleImageUpload(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		if (!file.type.startsWith('image/')) {
			sendError = 'Please select an image file';
			input.value = '';
			return;
		}

		uploading = true;
		sendError = '';

		try {
			const url = await uploadGroupPicture(file);
			if (messageInput.trim()) {
				messageInput = messageInput.trimEnd() + '\n' + url;
			} else {
				messageInput = url;
			}
		} catch (e) {
			sendError = e instanceof Error ? e.message : 'Failed to upload image';
			console.error('[Groups] Upload error:', e);
		} finally {
			uploading = false;
			input.value = '';
		}
	}

	async function handleShare() {
		const shareUrl = `${window.location.origin}/groups/join?group=${encodeURIComponent(groupId)}`;
		const ok = await copyToClipboard(shareUrl);
		if (ok) {
			showCopied = true;
			setTimeout(() => (showCopied = false), 2000);
		}
	}
</script>

<div class="relative h-full overflow-hidden">
	<!-- Header (frosted glass, floats over messages) -->
	<div
		class="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 px-4 h-[68px]"
		style="background-color: color-mix(in srgb, var(--color-bg-secondary) 70%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);"
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
		{#if members.length > 0}
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
		<button
			class="p-1.5 rounded-lg transition-colors hover:bg-accent-gray cursor-pointer relative"
			style="color: var(--color-text-primary);"
			title={showCopied ? 'Copied!' : 'Share group link'}
			on:click={handleShare}
		>
			{#if showCopied}
				<CheckIcon size={20} weight="bold" />
			{:else}
				<LinkIcon size={20} />
			{/if}
		</button>
		{#if isLoggedIn}
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

	<!-- Syncing indicator -->
	{#if $groupsSyncing}
		<div
			class="absolute top-[68px] left-0 right-0 z-10 flex items-center gap-2 px-4 py-1.5"
			style="background-color: color-mix(in srgb, var(--color-bg-secondary) 85%, transparent); backdrop-filter: blur(8px);"
		>
			<div
				class="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin flex-shrink-0"
				style="border-color: var(--color-primary); border-top-color: transparent;"
			></div>
			<span class="text-[11px]" style="color: var(--color-caption);">Syncing...</span>
		</div>
	{/if}

	<!-- Messages (full height, padded top/bottom for header/input) -->
	<div
		bind:this={scrollContainer}
		on:scroll={handleScroll}
		class="h-full overflow-y-auto px-4 {isLoggedIn ? 'pb-[80px]' : 'pb-4'}"
		style="padding-top: {$groupsSyncing ? '100px' : '84px'};"
	>
		{#if !isLoggedIn && ($group?.isPrivate || $group?.isRestricted)}
			<div class="flex flex-col items-center justify-center h-full text-center px-4">
				<LockIcon size={44} weight="light" style="color: var(--color-caption); opacity: 0.4;" />
				<p class="text-sm font-medium mt-3" style="color: var(--color-text-primary);">This is a private group</p>
				<p class="text-xs mt-1 max-w-[220px]" style="color: var(--color-caption);">Sign in to view messages and participate.</p>
				<a href="/login" class="mt-4 px-5 py-2 rounded-xl text-sm font-medium" style="background-color: var(--color-primary); color: #ffffff;">Sign In</a>
			</div>
		{:else if messages.length === 0 && !$groupsSyncing && !$groupsLoading}
			<div class="flex flex-col items-center justify-center h-full text-center px-4">
				<div class="mb-3" style="color: var(--color-caption); opacity: 0.4;">
					<ChatCircleDotsIcon size={44} weight="light" />
				</div>
				{#if isLoggedIn}
					<p class="text-sm font-medium" style="color: var(--color-text-primary);">
						No messages yet — say hello!
					</p>
					<p class="text-xs mt-1 max-w-[220px]" style="color: var(--color-caption);">
						Be the first to start the conversation in this group.
					</p>
				{:else}
					<p class="text-sm font-medium" style="color: var(--color-text-primary);">
						No messages yet
					</p>
					<p class="text-xs mt-1 max-w-[220px]" style="color: var(--color-caption);">
						Sign in to participate in this group.
					</p>
					<a href="/login" class="mt-4 px-5 py-2 rounded-xl text-sm font-medium" style="background-color: var(--color-primary); color: #ffffff;">Sign In</a>
				{/if}
			</div>
		{:else if messages.length === 0}
			<div class="flex items-center justify-center h-full">
				<div
					class="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
					style="border-color: var(--color-primary); border-top-color: transparent;"
				></div>
			</div>
		{:else}
			{#each messages as msg (msg.id)}
				<GroupMessage
					id={msg.id}
					sender={msg.sender}
					content={msg.content}
					created_at={msg.created_at}
					status={msg.status}
					tempId={msg.tempId}
					onRetry={handleRetry}
				/>
			{/each}
		{/if}
	</div>

	<!-- Input (frosted glass, floats over messages) -->
	{#if isLoggedIn}
		<input
			bind:this={fileInput}
			type="file"
			accept="image/*"
			class="hidden"
			on:change={handleImageUpload}
		/>
		<div
			class="absolute bottom-0 left-0 right-0 z-10 p-3"
			style="background-color: color-mix(in srgb, var(--color-bg-secondary) 70%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);"
		>
			{#if sendError}
				<div class="pb-2">
					<p class="text-xs text-danger">{sendError}</p>
				</div>
			{/if}
			<div class="flex items-end">
				<button
					on:click={() => fileInput?.click()}
					disabled={uploading}
					class="p-2.5 rounded-xl transition-colors cursor-pointer disabled:opacity-40 self-stretch"
					style="color: var(--color-caption);"
					title="Attach image"
				>
					{#if uploading}
						<div
							class="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin"
						></div>
					{:else}
						<ImageIcon size={20} />
					{/if}
				</button>
				<textarea
					bind:value={messageInput}
					on:keydown={handleKeyDown}
					placeholder="Type a message..."
					rows="1"
					class="input flex-1 resize-none text-sm min-h-[42px] max-h-32"
					style="background-color: var(--color-input-bg); border-radius: 0.75rem 0 0 0.75rem; border: 1px solid rgba(249, 115, 22, 0.35); border-right: none;"
					disabled={sending}
				></textarea>
				<button
					on:click={handleSend}
					disabled={(!messageInput.trim() && !uploading) || sending}
					class="p-2.5 rounded-l-none rounded-r-xl transition-colors cursor-pointer disabled:opacity-40 self-stretch"
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

{#if isLoggedIn}
	<AddMemberModal bind:open={showAddMember} {groupId} />
{/if}
<GroupMembersModal bind:open={showMembers} {members} />
