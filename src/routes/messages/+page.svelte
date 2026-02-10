<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { ndk, userPublickey } from '$lib/nostr';
	import { hasEncryptionSupport } from '$lib/encryptionService';
	import {
		initMessageSubscription,
		messagesInitialized,
		messagesLoading,
		setActiveConversation
	} from '$lib/stores/messages';
	import ConversationList from '$lib/components/messages/ConversationList.svelte';
	import MessageThread from '$lib/components/messages/MessageThread.svelte';
	import NewMessageModal from '$lib/components/messages/NewMessageModal.svelte';
	import LockIcon from 'phosphor-svelte/lib/Lock';

	let selectedPubkey: string | null = null;
	let newMessageOpen = false;

	// Mobile: show thread or list
	$: showThread = selectedPubkey !== null;

	// Check auth and encryption support
	$: isLoggedIn = !!$userPublickey;
	$: canEncrypt = isLoggedIn && hasEncryptionSupport();

	// Check URL params for deep-linking (e.g., /messages?pubkey=abc123)
	$: {
		const urlPubkey = $page.url.searchParams.get('pubkey');
		if (urlPubkey && /^[0-9a-fA-F]{64}$/.test(urlPubkey)) {
			selectedPubkey = urlPubkey;
		}
	}

	onMount(async () => {
		if (!browser) return;

		if (!$userPublickey) return;

		// Initialize messages if not already done
		if (!$messagesInitialized && !$messagesLoading) {
			await initMessageSubscription($ndk, $userPublickey);
		}
	});

	onDestroy(() => {
		setActiveConversation(null);
	});

	function handleSelectConversation(e: CustomEvent<{ pubkey: string }>) {
		selectedPubkey = e.detail.pubkey;
	}

	function handleBack() {
		selectedPubkey = null;
		setActiveConversation(null);
	}

	function handleNewMessage() {
		newMessageOpen = true;
	}

	function handleNewMessageSelect(e: CustomEvent<{ pubkey: string }>) {
		selectedPubkey = e.detail.pubkey;
	}
</script>

<svelte:head>
	<title>Messages - Zap Cooking</title>
</svelte:head>

{#if !isLoggedIn}
	<!-- Not logged in -->
	<div class="flex flex-col items-center justify-center py-20 px-4 text-center">
		<LockIcon size={48} weight="light" style="color: var(--color-caption);" />
		<h2 class="text-lg font-semibold mt-4" style="color: var(--color-text-primary);">
			Sign in to use Messages
		</h2>
		<p class="text-sm mt-2 max-w-sm" style="color: var(--color-caption);">
			Private messages require authentication. Sign in with your Nostr key to send and receive
			encrypted messages.
		</p>
		<a
			href="/login"
			class="mt-4 px-6 py-2.5 rounded-xl text-sm font-medium transition-colors"
			style="background-color: var(--color-primary); color: #ffffff;"
		>
			Sign In
		</a>
	</div>
{:else if !canEncrypt}
	<!-- Signer doesn't support encryption -->
	<div class="flex flex-col items-center justify-center py-20 px-4 text-center">
		<LockIcon size={48} weight="light" style="color: var(--color-caption);" />
		<h2 class="text-lg font-semibold mt-4" style="color: var(--color-text-primary);">
			Encryption Not Available
		</h2>
		<p class="text-sm mt-2 max-w-sm" style="color: var(--color-caption);">
			Your login method does not support encryption. Please use a private key (nsec) or a browser extension that supports NIP-04 or NIP-44.
		</p>
	</div>
{:else}
	<!-- Messages UI -->
	<div
		class="flex h-[calc(100vh-8rem)] lg:h-[calc(100vh-6rem)] -mx-4 rounded-xl overflow-hidden border"
		style="border-color: var(--color-input-border); background-color: var(--color-bg-secondary);"
	>
		<!-- Conversation List (left panel) -->
		<div
			class="w-full lg:w-80 xl:w-96 flex-shrink-0 border-r {showThread
				? 'hidden lg:block'
				: 'block'}"
			style="border-color: var(--color-input-border); background-color: var(--color-bg-primary);"
		>
			<ConversationList
				{selectedPubkey}
				on:select={handleSelectConversation}
				on:newMessage={handleNewMessage}
			/>
		</div>

		<!-- Message Thread (right panel) -->
		<div
			class="flex-1 min-w-0 {showThread ? 'block' : 'hidden lg:block'}"
			style="background-color: var(--color-bg-primary);"
		>
			{#if selectedPubkey}
				<MessageThread partnerPubkey={selectedPubkey} on:back={handleBack} />
			{:else}
				<div class="flex items-center justify-center h-full">
					<p class="text-sm" style="color: var(--color-caption);">
						Select a conversation or start a new one.
					</p>
				</div>
			{/if}
		</div>
	</div>

	<!-- New message modal -->
	<NewMessageModal bind:open={newMessageOpen} on:select={handleNewMessageSelect} />
{/if}
