/**
 * Message Store — NIP-17 conversation state management.
 *
 * Stores decrypted messages in memory only (never persisted).
 * Groups messages by conversation partner, tracks unread counts,
 * and provides derived stores for the UI.
 */

import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import type NDK from '@nostr-dev-kit/ndk';
import type { DecryptedMessage } from '$lib/nip17';
import {
	subscribeToGiftWraps,
	fetchHistoricalMessages,
	decryptNip04Event
} from '$lib/nip17';
import { hasEncryptionSupport, getBestEncryptionMethod } from '$lib/encryptionService';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ChatMessage {
	id: string;
	sender: string;
	content: string;
	tags: string[][];
	created_at: number;
	protocol: 'nip17' | 'nip04';
}

export interface Conversation {
	pubkey: string;
	messages: ChatMessage[];
	lastMessageAt: number;
	unreadCount: number;
}

// ═══════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════

const conversations = writable<Map<string, Conversation>>(new Map());

// Track seen message IDs for deduplication
const seenMessageIds = new Set<string>();

// Track which conversation is currently open (for unread management)
const activeConversationPubkey = writable<string | null>(null);

// Track initialization state
export const messagesLoading = writable(false);
export const messagesInitialized = writable(false);

// ═══════════════════════════════════════════════════════════════
// DERIVED STORES
// ═══════════════════════════════════════════════════════════════

/** Sorted conversation list (newest first). */
export const sortedConversations = derived(conversations, ($convos) => {
	return Array.from($convos.values()).sort((a, b) => b.lastMessageAt - a.lastMessageAt);
});

/** Total unread message count across all conversations. */
export const totalUnreadCount = derived(conversations, ($convos) => {
	let total = 0;
	for (const convo of $convos.values()) {
		total += convo.unreadCount;
	}
	return total;
});

/** Get a specific conversation reactively. */
export function getConversation(partnerPubkey: string) {
	return derived(conversations, ($convos) => $convos.get(partnerPubkey) || null);
}

// ═══════════════════════════════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Add a decrypted message to the correct conversation.
 * Handles deduplication and unread count management.
 */
export function addMessage(message: DecryptedMessage, currentUserPubkey: string) {
	// Deduplicate
	if (seenMessageIds.has(message.id)) return;
	seenMessageIds.add(message.id);

	// Determine the conversation partner
	const partnerPubkey =
		message.sender === currentUserPubkey
			? getRecipientFromTags(message.tags) || message.sender
			: message.sender;

	if (!partnerPubkey) return;

	const chatMessage: ChatMessage = {
		id: message.id,
		sender: message.sender,
		content: message.content,
		tags: message.tags,
		created_at: message.created_at,
		protocol: message.protocol
	};

	const currentActive = get(activeConversationPubkey);
	const isActiveConvo = currentActive === partnerPubkey;
	const isSentByMe = message.sender === currentUserPubkey;

	conversations.update(($convos) => {
		const existing = $convos.get(partnerPubkey);

		if (existing) {
			// Check for duplicate within conversation
			if (existing.messages.some((m) => m.id === message.id)) {
				return $convos;
			}

			existing.messages.push(chatMessage);
			existing.messages.sort((a, b) => a.created_at - b.created_at);
			existing.lastMessageAt = Math.max(existing.lastMessageAt, message.created_at);

			// Only increment unread if: not sent by me AND conversation is not active
			if (!isSentByMe && !isActiveConvo) {
				existing.unreadCount++;
			}
		} else {
			$convos.set(partnerPubkey, {
				pubkey: partnerPubkey,
				messages: [chatMessage],
				lastMessageAt: message.created_at,
				unreadCount: !isSentByMe && !isActiveConvo ? 1 : 0
			});
		}

		return new Map($convos);
	});
}

/**
 * Add multiple messages at once (used for historical message loading).
 */
export function addMessages(messages: DecryptedMessage[], currentUserPubkey: string) {
	for (const msg of messages) {
		// For historical messages, mark all as read
		if (seenMessageIds.has(msg.id)) continue;
		seenMessageIds.add(msg.id);

		const partnerPubkey =
			msg.sender === currentUserPubkey
				? getRecipientFromTags(msg.tags) || msg.sender
				: msg.sender;

		if (!partnerPubkey) continue;

		const chatMessage: ChatMessage = {
			id: msg.id,
			sender: msg.sender,
			content: msg.content,
			tags: msg.tags,
			created_at: msg.created_at,
			protocol: msg.protocol
		};

		conversations.update(($convos) => {
			const existing = $convos.get(partnerPubkey);
			if (existing) {
				if (!existing.messages.some((m) => m.id === msg.id)) {
					existing.messages.push(chatMessage);
				}
				existing.lastMessageAt = Math.max(existing.lastMessageAt, msg.created_at);
			} else {
				$convos.set(partnerPubkey, {
					pubkey: partnerPubkey,
					messages: [chatMessage],
					lastMessageAt: msg.created_at,
					unreadCount: 0 // Historical messages are marked as read
				});
			}
			return new Map($convos);
		});
	}

	// Sort all conversations' messages
	conversations.update(($convos) => {
		for (const convo of $convos.values()) {
			convo.messages.sort((a, b) => a.created_at - b.created_at);
		}
		return new Map($convos);
	});
}

/** Mark a conversation as read. */
export function markConversationAsRead(partnerPubkey: string) {
	conversations.update(($convos) => {
		const convo = $convos.get(partnerPubkey);
		if (convo && convo.unreadCount > 0) {
			convo.unreadCount = 0;
			return new Map($convos);
		}
		return $convos;
	});
}

/** Set the active conversation (for unread management). */
export function setActiveConversation(partnerPubkey: string | null) {
	activeConversationPubkey.set(partnerPubkey);
	if (partnerPubkey) {
		markConversationAsRead(partnerPubkey);
	}
}

/** Clear all message state (on logout). */
export function clearMessages() {
	conversations.set(new Map());
	seenMessageIds.clear();
	activeConversationPubkey.set(null);
	messagesInitialized.set(false);
}

// ═══════════════════════════════════════════════════════════════
// SUBSCRIPTION MANAGEMENT
// ═══════════════════════════════════════════════════════════════

let activeSub: { stop: () => void } | null = null;
let activeNip04Sub: { stop: () => void } | null = null;

/**
 * Initialize message subscription and load historical messages.
 * Call once from the app layout when user is authenticated.
 *
 * Starts live subscriptions for both NIP-17 (kind 1059) and NIP-04 (kind 4),
 * then loads historical messages in the background.
 */
export async function initMessageSubscription(ndkInstance: NDK, userPubkey: string) {
	console.log('[Messages] initMessageSubscription called', {
		browser,
		userPubkey: userPubkey?.slice(0, 8),
		hasSigner: !!ndkInstance?.signer
	});

	if (!browser) return;
	if (!userPubkey) return;

	if (!hasEncryptionSupport()) {
		console.log('[Messages] No encryption support available');
		return;
	}

	// Prevent duplicate initialization
	if (get(messagesInitialized) || get(messagesLoading)) {
		console.log('[Messages] Already initialized or loading, skipping');
		return;
	}

	// Stop any existing subscriptions
	stopMessageSubscription();

	messagesLoading.set(true);

	const bestMethod = getBestEncryptionMethod();

	try {
		// 1. Start NIP-17 gift wrap subscription (if NIP-44 is available)
		if (bestMethod === 'nip44') {
			activeSub = subscribeToGiftWraps(ndkInstance, userPubkey, (message, giftWrapId) => {
				console.log('[Messages] Live NIP-17 message received from', message.sender.slice(0, 8));
				addMessage(message, userPubkey);
			});
			console.log('[Messages] NIP-17 live subscription active');
		}

		// 2. Start NIP-04 kind 4 subscription (received + sent)
		const nip04SeenIds = new Set<string>();

		const nip04ReceivedSub = ndkInstance.subscribe(
			{ kinds: [4 as number], '#p': [userPubkey] },
			{ closeOnEose: false }
		);

		const nip04SentSub = ndkInstance.subscribe(
			{ kinds: [4 as number], authors: [userPubkey] },
			{ closeOnEose: false }
		);

		const handleNip04Event = async (event: import('@nostr-dev-kit/ndk').NDKEvent) => {
			if (nip04SeenIds.has(event.id)) return;
			nip04SeenIds.add(event.id);

			const message = await decryptNip04Event(event, userPubkey);
			if (message) {
				console.log('[Messages] Live NIP-04 message from', message.sender.slice(0, 8));
				addMessage(message, userPubkey);
			}
		};

		nip04ReceivedSub.on('event', handleNip04Event);
		nip04SentSub.on('event', handleNip04Event);

		activeNip04Sub = {
			stop: () => {
				nip04ReceivedSub.stop();
				nip04SentSub.stop();
				nip04SeenIds.clear();
			}
		};
		console.log('[Messages] NIP-04 live subscription active');

		messagesInitialized.set(true);

		// 3. Load historical messages in background
		const historicalPromises: Promise<void>[] = [];

		// NIP-17 historical
		if (bestMethod === 'nip44') {
			historicalPromises.push(
				fetchHistoricalMessages(ndkInstance, userPubkey, (message) => {
					addMessage(message, userPubkey);
				}).then((historical) => {
					console.log('[Messages] NIP-17 historical load complete:', historical.length, 'messages');
				})
			);
		}

		// NIP-04 historical
		historicalPromises.push(
			fetchHistoricalNip04Messages(ndkInstance, userPubkey).then((messages) => {
				console.log('[Messages] NIP-04 historical load complete:', messages.length, 'messages');
			})
		);

		Promise.all(historicalPromises)
			.catch((e) => {
				console.warn('[Messages] Historical fetch failed:', e);
			})
			.finally(() => {
				messagesLoading.set(false);
			});
	} catch (e) {
		console.error('[Messages] Failed to initialize:', e);
		messagesLoading.set(false);
	}
}

/**
 * Fetch historical NIP-04 (kind 4) messages for the user.
 */
async function fetchHistoricalNip04Messages(
	ndkInstance: NDK,
	userPubkey: string
): Promise<DecryptedMessage[]> {
	const sinceTimestamp = Math.round(Date.now() / 1000) - 3 * 24 * 60 * 60;

	console.log('[NIP-04] Fetching historical messages since', new Date(sinceTimestamp * 1000).toISOString());

	let receivedEvents: Set<import('@nostr-dev-kit/ndk').NDKEvent>;
	let sentEvents: Set<import('@nostr-dev-kit/ndk').NDKEvent>;

	try {
		[receivedEvents, sentEvents] = await Promise.race([
			Promise.all([
				ndkInstance.fetchEvents({
					kinds: [4 as number],
					'#p': [userPubkey],
					since: sinceTimestamp
				}),
				ndkInstance.fetchEvents({
					kinds: [4 as number],
					authors: [userPubkey],
					since: sinceTimestamp
				})
			]),
			new Promise<[Set<import('@nostr-dev-kit/ndk').NDKEvent>, Set<import('@nostr-dev-kit/ndk').NDKEvent>]>((_, reject) =>
				setTimeout(() => reject(new Error('NIP-04 fetch timeout after 15s')), 15000)
			)
		]);
	} catch (e) {
		console.warn('[NIP-04] Historical fetch timed out or failed:', e);
		return [];
	}

	const allEvents = new Map<string, import('@nostr-dev-kit/ndk').NDKEvent>();
	for (const event of receivedEvents) allEvents.set(event.id, event);
	for (const event of sentEvents) allEvents.set(event.id, event);

	console.log('[NIP-04] Found', allEvents.size, 'kind 4 events');

	const messages: DecryptedMessage[] = [];

	for (const event of allEvents.values()) {
		try {
			const message = await decryptNip04Event(event, userPubkey);
			if (message) {
				messages.push(message);
				addMessage(message, userPubkey);
			}
		} catch {
			// Skip messages we can't decrypt
		}
	}

	console.log('[NIP-04] Decrypted', messages.length, 'messages');
	return messages;
}

/** Stop the active message subscriptions. */
export function stopMessageSubscription() {
	if (activeSub) {
		activeSub.stop();
		activeSub = null;
	}
	if (activeNip04Sub) {
		activeNip04Sub.stop();
		activeNip04Sub = null;
	}
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

/** Extract the recipient pubkey from a kind 14 event's p tags. */
function getRecipientFromTags(tags: string[][]): string | null {
	const pTag = tags.find((t) => t[0] === 'p');
	return pTag ? pTag[1] : null;
}
