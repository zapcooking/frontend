<script lang="ts">
	import { onMount, afterUpdate, createEventDispatcher } from 'svelte';
	import { userPublickey } from '$lib/nostr';
	import { getConversation, setActiveConversation, addMessage } from '$lib/stores/messages';
	import { sendDirectMessage, sendNip04DirectMessage } from '$lib/nip17';
	import MessageBubble from './MessageBubble.svelte';
	import CustomAvatar from '../../../components/CustomAvatar.svelte';
	import CustomName from '../../../components/CustomName.svelte';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeft';
	import PaperPlaneTiltIcon from 'phosphor-svelte/lib/PaperPlaneTilt';
	import LockSimpleIcon from 'phosphor-svelte/lib/LockSimple';
	import LockSimpleOpenIcon from 'phosphor-svelte/lib/LockSimpleOpen';
	import { nip19 } from 'nostr-tools';

	export let partnerPubkey: string;

	const dispatch = createEventDispatcher<{ back: void }>();

	let messageInput = '';
	let sending = false;
	let sendError = '';
	let scrollContainer: HTMLDivElement;
	let shouldAutoScroll = true;
	let sendProtocol: 'nip04' | 'nip17' = 'nip04';

	$: conversation = getConversation(partnerPubkey);
	$: messages = $conversation?.messages || [];
	$: npub = nip19.npubEncode(partnerPubkey);

	// Mark as active on mount / when partner changes
	$: {
		if (partnerPubkey) {
			setActiveConversation(partnerPubkey);
		}
	}

	onMount(() => {
		setActiveConversation(partnerPubkey);
		scrollToBottom();
		return () => setActiveConversation(null);
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

	function toggleProtocol() {
		sendProtocol = sendProtocol === 'nip04' ? 'nip17' : 'nip04';
	}

	async function handleSend() {
		const text = messageInput.trim();
		if (!text || sending) return;

		sending = true;
		sendError = '';

		try {
			const msg = sendProtocol === 'nip04'
				? await sendNip04DirectMessage(partnerPubkey, text)
				: await sendDirectMessage(partnerPubkey, text);
			addMessage(msg, $userPublickey);
			messageInput = '';
			shouldAutoScroll = true;
		} catch (e) {
			sendError = e instanceof Error ? e.message : 'Failed to send message';
			console.error('[Messages] Send error:', e);
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
		<a href="/user/{npub}" class="flex items-center gap-3 min-w-0">
			<CustomAvatar pubkey={partnerPubkey} size={36} />
			<div class="min-w-0">
				<span class="font-medium text-sm truncate block" style="color: var(--color-text-primary);">
					<CustomName pubkey={partnerPubkey} />
				</span>
			</div>
		</a>
	</div>

	<!-- Messages -->
	<div
		bind:this={scrollContainer}
		on:scroll={handleScroll}
		class="flex-1 overflow-y-auto px-4 py-3"
	>
		{#if messages.length === 0}
			<div class="flex items-center justify-center h-full">
				<p class="text-sm" style="color: var(--color-caption);">
					Send a message to start the conversation.
				</p>
			</div>
		{:else}
			{#each messages as msg (msg.id)}
				<MessageBubble sender={msg.sender} content={msg.content} created_at={msg.created_at} protocol={msg.protocol} />
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
		<div class="flex items-center gap-1.5 mb-1.5 px-0.5 transition-all duration-200">
			{#if sendProtocol === 'nip17'}
				<LockSimpleIcon class="w-3 h-3 flex-shrink-0" weight="bold" style="color: rgba(167, 139, 250, 0.8);" />
				<span class="text-[10px]" style="color: rgba(167, 139, 250, 0.8);">Private — metadata hidden</span>
			{:else}
				<LockSimpleOpenIcon class="w-3 h-3 flex-shrink-0" weight="bold" style="color: rgba(249, 115, 22, 0.6);" />
				<span class="text-[10px]" style="color: rgba(249, 115, 22, 0.6);">Compatible — metadata visible</span>
			{/if}
		</div>
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
				on:click={toggleProtocol}
				class="relative flex items-center w-[72px] h-7 rounded-full cursor-pointer transition-colors duration-200 flex-shrink-0"
				style={sendProtocol === 'nip17'
					? 'background-color: rgba(124, 58, 237, 0.25);'
					: 'background-color: rgba(249, 115, 22, 0.18);'}
				title={sendProtocol === 'nip17'
					? 'Private — metadata hidden (less compatible)'
					: 'Compatible — metadata visible (less private)'}
			>
				<span
					class="absolute top-0.5 h-6 w-9 rounded-full transition-all duration-200 shadow-sm"
					style="left: {sendProtocol === 'nip17' ? '33px' : '2px'};
						background-color: {sendProtocol === 'nip17' ? 'rgba(124, 58, 237, 0.9)' : 'rgba(249, 115, 22, 0.9)'};"
				></span>
				<span
					class="relative z-10 w-1/2 text-center text-[9px] font-semibold transition-colors duration-200"
					style="color: {sendProtocol === 'nip04' ? '#fff' : 'rgba(249, 115, 22, 0.6)'};"
				>04</span>
				<span
					class="relative z-10 w-1/2 text-center text-[9px] font-semibold transition-colors duration-200"
					style="color: {sendProtocol === 'nip17' ? '#fff' : 'rgba(167, 139, 250, 0.6)'};"
				>17</span>
			</button>
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
</div>
