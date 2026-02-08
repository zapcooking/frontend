<script lang="ts">
	import { sortedConversations, messagesLoading } from '$lib/stores/messages';
	import { userPublickey } from '$lib/nostr';
	import CustomAvatar from '../../../components/CustomAvatar.svelte';
	import CustomName from '../../../components/CustomName.svelte';
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
	import { createEventDispatcher } from 'svelte';

	const dispatch = createEventDispatcher<{
		select: { pubkey: string };
		newMessage: void;
	}>();

	export let selectedPubkey: string | null = null;

	function truncate(text: string, maxLen: number): string {
		if (!text) return '';
		return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
	}

	function formatRelativeTime(ts: number): string {
		const now = Date.now() / 1000;
		const diff = now - ts;
		if (diff < 60) return 'now';
		if (diff < 3600) return `${Math.floor(diff / 60)}m`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
		if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
		return new Date(ts * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' });
	}

	function getLastMessage(messages: { sender: string; content: string }[]) {
		if (messages.length === 0) return '';
		const last = messages[messages.length - 1];
		const prefix = last.sender === $userPublickey ? 'You: ' : '';
		return prefix + truncate(last.content, 40);
	}

	function getLastProtocol(messages: { protocol?: string }[]): string | null {
		if (messages.length === 0) return null;
		const last = messages[messages.length - 1];
		return last.protocol === 'nip17' ? 'NIP-17' : 'NIP-04';
	}
</script>

<div class="flex flex-col h-full">
	<!-- Header -->
	<div
		class="flex items-center justify-between p-4 border-b"
		style="border-color: var(--color-input-border);"
	>
		<h2 class="text-lg font-semibold" style="color: var(--color-text-primary);">Messages</h2>
		<button
			class="p-2 rounded-xl transition-colors hover:bg-accent-gray cursor-pointer"
			style="color: var(--color-text-primary);"
			on:click={() => dispatch('newMessage')}
			title="New message"
		>
			<PencilSimpleIcon size={20} />
		</button>
	</div>

	<!-- Conversation list -->
	<div class="flex-1 overflow-y-auto">
		{#if $messagesLoading && $sortedConversations.length === 0}
			<!-- Loading indicator while fetching historical messages -->
			<div class="flex items-center gap-2 px-4 py-3" style="color: var(--color-caption);">
				<div
					class="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin flex-shrink-0"
					style="border-color: var(--color-primary); border-top-color: transparent;"
				></div>
				<span class="text-xs">Loading messages...</span>
			</div>
		{/if}
		{#if $sortedConversations.length === 0 && !$messagesLoading}
			<div class="flex flex-col items-center justify-center py-12 px-4 text-center">
				<p class="text-sm mb-1" style="color: var(--color-caption);">No messages yet</p>
				<p class="text-xs" style="color: var(--color-caption);">
					Start a conversation by tapping the compose button.
				</p>
			</div>
		{:else}
			{#each $sortedConversations as convo (convo.pubkey)}
				<button
					class="w-full flex items-center gap-3 px-4 py-3 transition-colors cursor-pointer text-left"
					class:bg-input={selectedPubkey === convo.pubkey}
					style="border-bottom: 1px solid var(--color-input-border);"
					on:click={() => dispatch('select', { pubkey: convo.pubkey })}
				>
					<div class="flex-shrink-0">
						<CustomAvatar pubkey={convo.pubkey} size={44} />
					</div>
					<div class="flex-1 min-w-0">
						<div class="flex items-center justify-between">
							<span
								class="font-medium text-sm truncate"
								style="color: var(--color-text-primary);"
							>
								<CustomName pubkey={convo.pubkey} />
							</span>
							<span class="flex-shrink-0 ml-2 flex items-center gap-1.5">
								{#if getLastProtocol(convo.messages)}
									{@const proto = getLastProtocol(convo.messages)}
									<span
										class="text-[9px] px-1 py-0.5 rounded font-medium"
										style={proto === 'NIP-17'
											? 'background-color: rgba(124, 58, 237, 0.15); color: rgba(167, 139, 250, 1);'
											: 'background-color: rgba(249, 115, 22, 0.12); color: rgba(249, 115, 22, 0.8);'}
									>{proto}</span>
								{/if}
								<span class="text-xs" style="color: var(--color-caption);">
									{formatRelativeTime(convo.lastMessageAt)}
								</span>
							</span>
						</div>
						<div class="flex items-center justify-between mt-0.5">
							<p class="text-xs truncate" style="color: var(--color-caption);">
								{getLastMessage(convo.messages)}
							</p>
							{#if convo.unreadCount > 0}
								<span
									class="flex-shrink-0 ml-2 min-w-[20px] h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1.5"
								>
									{convo.unreadCount > 99 ? '99+' : convo.unreadCount}
								</span>
							{/if}
						</div>
					</div>
				</button>
			{/each}
			{#if $messagesLoading}
				<!-- Subtle indicator at bottom while more messages are loading -->
				<div class="flex items-center justify-center py-2">
					<span class="text-xs" style="color: var(--color-caption);">Loading more...</span>
				</div>
			{/if}
		{/if}
	</div>
</div>
