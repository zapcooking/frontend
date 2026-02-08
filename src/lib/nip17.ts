/**
 * NIP-17 Private Direct Messages
 *
 * Implements the three-layer encryption model:
 * 1. Kind 14 (Rumor) - unsigned chat message
 * 2. Kind 13 (Seal) - encrypts the rumor with NIP-44, signed by sender
 * 3. Kind 1059 (Gift Wrap) - encrypts the seal with NIP-44, signed by ephemeral key
 *
 * Uses NIP-44 encryption (via encryptionService) and NIP-59 gift wrapping.
 * DM relay preferences use kind 10050 per NIP-17 spec.
 */

import { get } from 'svelte/store';
import { ndk, userPublickey } from '$lib/nostr';
import { encrypt, decrypt, getBestEncryptionMethod } from '$lib/encryptionService';
import { generateSecretKey, getPublicKey, finalizeEvent, getEventHash, type VerifiedEvent } from 'nostr-tools';
import * as nip44 from 'nostr-tools/nip44';
import type NDK from '@nostr-dev-kit/ndk';
import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk';

const TWO_DAYS = 2 * 24 * 60 * 60;

const FALLBACK_DM_RELAYS = [
	'wss://relay.damus.io',
	'wss://nos.lol',
	'wss://relay.primal.net'
];

function now(): number {
	return Math.round(Date.now() / 1000);
}

function randomTimestamp(): number {
	return Math.round(now() - Math.random() * TWO_DAYS);
}

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface DecryptedMessage {
	id: string;
	sender: string;
	content: string;
	tags: string[][];
	created_at: number;
	protocol: 'nip17' | 'nip04';
}

// ═══════════════════════════════════════════════════════════════
// SIGNER COMPATIBILITY
// ═══════════════════════════════════════════════════════════════

/**
 * Check if the current signer supports NIP-17 messaging (requires NIP-44).
 */
export function isNip17Supported(): { supported: boolean; reason?: string } {
	const method = getBestEncryptionMethod();
	if (method === 'nip44') {
		return { supported: true };
	}
	if (method === 'nip04') {
		return {
			supported: false,
			reason:
				'Your login method only supports older encryption. Private messages require NIP-44 support. Please use a private key (nsec) or an updated browser extension.'
		};
	}
	return {
		supported: false,
		reason: 'Please log in to use private messages.'
	};
}

// ═══════════════════════════════════════════════════════════════
// RELAY DISCOVERY
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch a user's preferred DM relays from their kind 10050 event.
 */
async function getDMRelays(ndkInstance: NDK, pubkey: string): Promise<string[]> {
	try {
		const events = await ndkInstance.fetchEvents({
			kinds: [10050 as number],
			authors: [pubkey],
			limit: 1
		});
		if (events.size === 0) return [];

		const event = Array.from(events)[0];
		return event.tags.filter((t) => t[0] === 'relay' && t[1]).map((t) => t[1]);
	} catch (e) {
		console.error('[NIP-17] Error fetching DM relays for', pubkey, e);
		return [];
	}
}

/**
 * Fetch a user's read relays from their kind 10002 event (NIP-65 fallback).
 */
async function getReadRelays(ndkInstance: NDK, pubkey: string): Promise<string[]> {
	try {
		const events = await ndkInstance.fetchEvents({
			kinds: [10002 as number],
			authors: [pubkey],
			limit: 1
		});
		if (events.size === 0) return [];

		const event = Array.from(events)[0];
		return event.tags
			.filter((t) => t[0] === 'r' && t[1] && (!t[2] || t[2] === 'read'))
			.map((t) => t[1]);
	} catch (e) {
		console.error('[NIP-17] Error fetching read relays for', pubkey, e);
		return [];
	}
}

/**
 * Get the best relays to deliver a message to a user.
 * Priority: kind 10050 DM relays > kind 10002 read relays > fallback relays.
 */
export async function getRecipientRelays(
	ndkInstance: NDK,
	pubkey: string
): Promise<string[]> {
	let relays = await getDMRelays(ndkInstance, pubkey);
	if (relays.length > 0) return relays;

	relays = await getReadRelays(ndkInstance, pubkey);
	if (relays.length > 0) return relays;

	return FALLBACK_DM_RELAYS;
}

// ═══════════════════════════════════════════════════════════════
// MESSAGE CREATION PIPELINE
// ═══════════════════════════════════════════════════════════════

/**
 * Create a kind 14 chat message rumor (unsigned, with computed id).
 */
function createRumor(
	senderPubkey: string,
	recipientPubkey: string,
	content: string,
	extraTags?: string[][]
): Record<string, unknown> {
	const rumor: Record<string, unknown> = {
		kind: 14,
		pubkey: senderPubkey,
		created_at: now(),
		tags: [['p', recipientPubkey], ...(extraTags || [])],
		content
	};
	rumor.id = getEventHash(rumor as any);
	return rumor;
}

/**
 * Create a kind 13 seal: encrypts the rumor with NIP-44, signed by the sender.
 * Uses the NDK signer (works with NIP-07, NIP-46, nsec).
 */
async function createSeal(
	rumor: Record<string, unknown>,
	recipientPubkey: string
): Promise<NDKEvent> {
	const ndkInstance = get(ndk);

	// Encrypt the rumor JSON to the recipient using the sender's key
	const { ciphertext } = await encrypt(recipientPubkey, JSON.stringify(rumor), 'nip44');

	const sealEvent = new NDKEvent(ndkInstance);
	sealEvent.kind = 13;
	sealEvent.content = ciphertext;
	sealEvent.created_at = randomTimestamp();
	sealEvent.tags = []; // Seal MUST have empty tags per NIP-59

	await sealEvent.sign();
	return sealEvent;
}

/**
 * Create a kind 1059 gift wrap: encrypts the seal with NIP-44 using an ephemeral key.
 * Does not require the user's signer — uses a locally generated throwaway keypair.
 */
function createGiftWrap(
	sealEvent: NDKEvent,
	recipientPubkey: string
): VerifiedEvent {
	const randomKey = generateSecretKey();
	const conversationKey = nip44.v2.utils.getConversationKey(randomKey, recipientPubkey);

	const sealJSON = JSON.stringify(sealEvent.rawEvent());
	const encryptedSeal = nip44.v2.encrypt(sealJSON, conversationKey);

	return finalizeEvent(
		{
			kind: 1059,
			content: encryptedSeal,
			created_at: randomTimestamp(),
			tags: [['p', recipientPubkey]]
		},
		randomKey
	);
}

// ═══════════════════════════════════════════════════════════════
// SEND
// ═══════════════════════════════════════════════════════════════

/**
 * Full send pipeline: create rumor → seal → gift wrap → publish.
 * Sends a gift wrap to the recipient AND a self-copy to the sender's relays
 * so sent messages appear on the sender's other clients.
 */
export async function sendDirectMessage(
	recipientPubkey: string,
	content: string,
	extraTags?: string[][]
): Promise<DecryptedMessage> {
	const ndkInstance = get(ndk);
	const senderPubkey = get(userPublickey);

	if (!senderPubkey) throw new Error('Not logged in');
	if (!content.trim()) throw new Error('Message cannot be empty');

	const { supported, reason } = isNip17Supported();
	if (!supported) throw new Error(reason || 'NIP-17 not supported');

	// 1. Create the rumor (kind 14, unsigned)
	const rumor = createRumor(senderPubkey, recipientPubkey, content, extraTags);

	// 2. Seal + gift wrap for recipient
	const seal = await createSeal(rumor, recipientPubkey);
	const giftWrap = createGiftWrap(seal, recipientPubkey);

	// 3. Resolve relay targets for recipient
	const recipientRelays = await getRecipientRelays(ndkInstance, recipientPubkey);

	// 4. Publish gift wrap to recipient's relays
	const ndkEvent = new NDKEvent(ndkInstance, giftWrap as any);
	const relaySet = NDKRelaySet.fromRelayUrls(recipientRelays, ndkInstance, true);
	await ndkEvent.publish(relaySet);

	console.log('[NIP-17] Message sent to', recipientPubkey.slice(0, 8));

	// 5. Self-copy: seal + gift wrap targeting the sender's own pubkey
	try {
		const selfSeal = await createSeal(rumor, senderPubkey);
		const selfGiftWrap = createGiftWrap(selfSeal, senderPubkey);
		const senderRelays = await getRecipientRelays(ndkInstance, senderPubkey);
		const selfNdkEvent = new NDKEvent(ndkInstance, selfGiftWrap as any);
		const selfRelaySet = NDKRelaySet.fromRelayUrls(senderRelays, ndkInstance, true);
		await selfNdkEvent.publish(selfRelaySet);
		console.log('[NIP-17] Self-copy published to', senderRelays.length, 'relays');
	} catch (e) {
		console.warn('[NIP-17] Failed to publish self-copy (non-fatal):', e);
	}

	// Return the decrypted message for immediate local UI update
	return {
		id: rumor.id as string,
		sender: senderPubkey,
		content,
		tags: rumor.tags as string[][],
		created_at: rumor.created_at as number,
		protocol: 'nip17'
	};
}

// ═══════════════════════════════════════════════════════════════
// RECEIVE / UNWRAP
// ═══════════════════════════════════════════════════════════════

/**
 * Unwrap a received kind 1059 gift wrap event.
 * Decrypts gift wrap → seal → rumor, with impersonation check.
 */
export async function unwrapGiftWrap(event: NDKEvent): Promise<DecryptedMessage | null> {
	try {
		// Step 1: Decrypt the gift wrap to get the seal
		// Uses: ECDH(myPrivateKey, giftWrap.pubkey) where giftWrap.pubkey is the ephemeral key
		console.log('[NIP-17] Unwrapping gift wrap', event.id.slice(0, 8), 'from ephemeral key', event.pubkey.slice(0, 8));
		const sealJSON = await decrypt(event.pubkey, event.content, 'nip44');
		const seal = JSON.parse(sealJSON);

		if (seal.kind !== 13) {
			console.warn('[NIP-17] Unexpected kind inside gift wrap:', seal.kind);
			return null;
		}

		// Step 2: Decrypt the seal to get the rumor
		// Uses: ECDH(myPrivateKey, seal.pubkey) where seal.pubkey is the sender's real key
		console.log('[NIP-17] Decrypting seal from', seal.pubkey.slice(0, 8));
		const rumorJSON = await decrypt(seal.pubkey, seal.content, 'nip44');
		const rumor = JSON.parse(rumorJSON);

		// Step 3: Verify the rumor pubkey matches the seal pubkey (anti-impersonation)
		if (rumor.pubkey !== seal.pubkey) {
			console.warn('[NIP-17] Pubkey mismatch: seal.pubkey !== rumor.pubkey');
			return null;
		}

		console.log('[NIP-17] Message decrypted from', rumor.pubkey.slice(0, 8));
		return {
			id: rumor.id || event.id,
			sender: rumor.pubkey,
			content: rumor.content || '',
			tags: rumor.tags || [],
			created_at: rumor.created_at || event.created_at || now(),
			protocol: 'nip17'
		};
	} catch (e) {
		console.error('[NIP-17] Failed to unwrap gift wrap:', (e as Error)?.message || e);
		return null;
	}
}

// ═══════════════════════════════════════════════════════════════
// SUBSCRIPTION
// ═══════════════════════════════════════════════════════════════

/**
 * Subscribe to incoming kind 1059 gift wrap events for the current user.
 * Calls onMessage for each successfully decrypted message.
 */
export function subscribeToGiftWraps(
	ndkInstance: NDK,
	userPubkey: string,
	onMessage: (message: DecryptedMessage, giftWrapId: string) => void
): { stop: () => void } {
	const seenIds = new Set<string>();

	console.log('[NIP-17] Starting gift wrap subscription for', userPubkey.slice(0, 8));

	const sub = ndkInstance.subscribe(
		{ kinds: [1059 as number], '#p': [userPubkey] },
		{ closeOnEose: false }
	);

	sub.on('event', async (event: NDKEvent) => {
		// Deduplicate (same gift wrap from multiple relays)
		if (seenIds.has(event.id)) return;
		seenIds.add(event.id);

		console.log('[NIP-17] Received gift wrap event', event.id.slice(0, 8));
		const message = await unwrapGiftWrap(event);
		if (message) {
			onMessage(message, event.id);
		}
	});

	sub.on('eose', () => {
		console.log('[NIP-17] Subscription EOSE received, seen', seenIds.size, 'events');
	});

	return {
		stop: () => {
			sub.stop();
			seenIds.clear();
		}
	};
}

/**
 * Fetch historical gift wraps for the current user.
 * Calls onMessage for each successfully decrypted message as it's processed.
 * Has a timeout to prevent hanging on unresponsive relays.
 */
export async function fetchHistoricalMessages(
	ndkInstance: NDK,
	userPubkey: string,
	onMessage?: (message: DecryptedMessage) => void,
	since?: number
): Promise<DecryptedMessage[]> {
	const sinceTimestamp = since || now() - 3 * 24 * 60 * 60; // Default: 3 days

	console.log(
		'[NIP-17] Fetching historical messages since',
		new Date(sinceTimestamp * 1000).toISOString()
	);

	let events: Set<NDKEvent>;
	try {
		events = await Promise.race([
			ndkInstance.fetchEvents({
				kinds: [1059 as number],
				'#p': [userPubkey],
				since: sinceTimestamp
			}),
			new Promise<Set<NDKEvent>>((_, reject) =>
				setTimeout(() => reject(new Error('Fetch timeout after 15s')), 15000)
			)
		]);
	} catch (e) {
		console.warn('[NIP-17] Historical fetch timed out or failed:', e);
		return [];
	}

	console.log('[NIP-17] Found', events.size, 'gift wraps');

	const messages: DecryptedMessage[] = [];
	const seenRumorIds = new Set<string>();

	for (const event of events) {
		try {
			const message = await unwrapGiftWrap(event);
			if (message && !seenRumorIds.has(message.id)) {
				seenRumorIds.add(message.id);
				messages.push(message);
				// Stream each message to the caller as it's decrypted
				if (onMessage) {
					onMessage(message);
				}
			}
		} catch {
			// Skip messages we can't decrypt
		}
	}

	console.log('[NIP-17] Decrypted', messages.length, 'messages');
	return messages.sort((a, b) => a.created_at - b.created_at);
}

// ═══════════════════════════════════════════════════════════════
// NIP-04 SUPPORT
// ═══════════════════════════════════════════════════════════════

/**
 * Send a NIP-04 (kind 4) direct message.
 * Creates a kind 4 event with NIP-04 encrypted content, signs and publishes.
 */
export async function sendNip04DirectMessage(
	recipientPubkey: string,
	content: string
): Promise<DecryptedMessage> {
	const ndkInstance = get(ndk);
	const senderPubkey = get(userPublickey);

	if (!senderPubkey) throw new Error('Not logged in');
	if (!content.trim()) throw new Error('Message cannot be empty');

	const { ciphertext } = await encrypt(recipientPubkey, content, 'nip04');

	const event = new NDKEvent(ndkInstance);
	event.kind = 4;
	event.content = ciphertext;
	event.tags = [['p', recipientPubkey]];

	await event.sign();
	await event.publish();

	console.log('[NIP-04] Message sent to', recipientPubkey.slice(0, 8));

	return {
		id: event.id,
		sender: senderPubkey,
		content,
		tags: [['p', recipientPubkey]],
		created_at: event.created_at || now(),
		protocol: 'nip04'
	};
}

/**
 * Decrypt a received NIP-04 (kind 4) event.
 */
export async function decryptNip04Event(
	event: NDKEvent,
	currentUserPubkey: string
): Promise<DecryptedMessage | null> {
	try {
		// Determine the other party for decryption
		const isSentByMe = event.pubkey === currentUserPubkey;
		const pTag = event.tags.find((t) => t[0] === 'p');
		const otherPubkey = isSentByMe ? pTag?.[1] : event.pubkey;

		if (!otherPubkey) {
			console.warn('[NIP-04] No counterparty pubkey found');
			return null;
		}

		const plaintext = await decrypt(otherPubkey, event.content, 'nip04');

		return {
			id: event.id,
			sender: event.pubkey,
			content: plaintext,
			tags: event.tags.map((t) => [...t]),
			created_at: event.created_at || now(),
			protocol: 'nip04'
		};
	} catch (e) {
		console.error('[NIP-04] Failed to decrypt:', (e as Error)?.message || e);
		return null;
	}
}
