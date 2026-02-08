/**
 * NIP-29 Relay-based Groups
 *
 * Implements group chat on the pantry relay (wss://pantry.zap.cooking).
 * Groups are relay-managed: the relay handles membership, metadata, and moderation.
 *
 * Event kinds used:
 * - 9: Chat message (send & receive)
 * - 9007: Create group (send)
 * - 9021: Join request (send)
 * - 39000: Group metadata (receive, signed by relay)
 */

import { get } from 'svelte/store';
import { ndk, userPublickey } from '$lib/nostr';
import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk';
import type NDK from '@nostr-dev-kit/ndk';

const PANTRY_RELAY = 'wss://pantry.zap.cooking';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface GroupMetadata {
	id: string;
	name: string;
	picture: string;
	about: string;
	isPrivate: boolean;
	isClosed: boolean;
	isRestricted: boolean;
}

export interface GroupMessage {
	id: string;
	groupId: string;
	sender: string;
	content: string;
	created_at: number;
}

// ═══════════════════════════════════════════════════════════════
// RELAY CONNECTION
// ═══════════════════════════════════════════════════════════════

// Cached connection promise — reused across all operations
let pantryConnectionPromise: Promise<void> | null = null;
let connectedNdkInstance: NDK | null = null;
let authPolicySet = false;

// Global auth state — tracks NIP-42 auth independently of connection
let pantryAuthPromise: Promise<void> | null = null;
let pantryAuthResolved = false;
let resolveAuthPromise: (() => void) | null = null;
let authedListenerAttached = false;

function getPantryRelaySet(ndkInstance: NDK): NDKRelaySet {
	return NDKRelaySet.fromRelayUrls([PANTRY_RELAY], ndkInstance, true);
}

/**
 * Get the pantry relay instance from NDK's pool.
 */
function getPantryRelay(ndkInstance: NDK): any | null {
	const relaySet = getPantryRelaySet(ndkInstance);
	const relay = Array.from(relaySet.relays)[0];
	return relay || null;
}

/**
 * Initialize the global auth tracking promise.
 */
function initAuthTracking(): void {
	if (pantryAuthPromise && !pantryAuthResolved) return;
	pantryAuthResolved = false;
	pantryAuthPromise = new Promise<void>((resolve) => {
		resolveAuthPromise = () => {
			pantryAuthResolved = true;
			resolve();
		};
	});
}

/**
 * Set NIP-42 auto-sign auth policy on the NDK instance (global default).
 *
 * We use ndk.relayAuthDefaultPolicy instead of relay.authPolicy because
 * NDKRelaySet.fromRelayUrls() may trigger pool auto-connect, causing the
 * AUTH challenge to arrive before we can set relay.authPolicy on the
 * specific relay instance. The global default is checked as a fallback
 * by NDK for all relays (see NDK source: onAuthRequested).
 */
function ensureAuthPolicy(ndkInstance: NDK): void {
	if (authPolicySet) return;
	initAuthTracking();

	const existingPolicy = ndkInstance.relayAuthDefaultPolicy;
	ndkInstance.relayAuthDefaultPolicy = async (relay: any, challenge: string) => {
		const isPantry =
			relay.url === PANTRY_RELAY ||
			relay.url === PANTRY_RELAY + '/' ||
			relay.url?.replace(/\/$/, '') === PANTRY_RELAY;

		if (isPantry) {
			console.log('[NIP-29] NIP-42 auth challenge received, signing...');
		}

		const event = new NDKEvent(ndkInstance);
		event.kind = 22242;
		event.tags = [
			['relay', relay.url],
			['challenge', challenge]
		];
		await event.sign();

		if (isPantry) {
			console.log('[NIP-29] NIP-42 auth event signed');
		}
		return event;
	};

	// If there was an existing policy, we've replaced it with ours which
	// handles all relays. This is fine — auto-signing AUTH is the standard
	// NDK pattern (NDKRelayAuthPolicies.signIn).

	authPolicySet = true;
}

/**
 * Attach 'authed' event listener to the pantry relay instance.
 * This resolves the global auth promise when auth completes.
 */
function attachAuthedListener(relay: any): void {
	if (authedListenerAttached) return;
	relay.on('authed', () => {
		console.log('[NIP-29] NIP-42 auth completed');
		if (resolveAuthPromise) resolveAuthPromise();
	});
	authedListenerAttached = true;
}

/**
 * Wait for NIP-42 auth to complete on the pantry relay.
 * Returns immediately if auth already completed.
 */
async function waitForPantryAuth(timeoutMs = 15000): Promise<boolean> {
	if (pantryAuthResolved) return true;
	if (!pantryAuthPromise) return false;

	return new Promise<boolean>((resolve) => {
		const timer = setTimeout(() => {
			console.warn('[NIP-29] Auth wait timeout after', timeoutMs, 'ms');
			resolve(false);
		}, timeoutMs);

		pantryAuthPromise!.then(() => {
			clearTimeout(timer);
			resolve(true);
		});
	});
}

/**
 * Ensure the pantry relay is connected and authenticated.
 * Caches the connection promise so multiple callers share one attempt.
 */
async function ensurePantryConnected(ndkInstance: NDK): Promise<void> {
	// Reset if NDK instance changed
	if (connectedNdkInstance !== ndkInstance) {
		pantryConnectionPromise = null;
		connectedNdkInstance = null;
		authPolicySet = false;
		pantryAuthPromise = null;
		pantryAuthResolved = false;
		resolveAuthPromise = null;
		authedListenerAttached = false;
	}

	if (pantryConnectionPromise) {
		return pantryConnectionPromise;
	}

	pantryConnectionPromise = doPantryConnect(ndkInstance);

	try {
		await pantryConnectionPromise;
		connectedNdkInstance = ndkInstance;
	} catch (e) {
		pantryConnectionPromise = null;
		connectedNdkInstance = null;
		throw e;
	}
}

async function doPantryConnect(ndkInstance: NDK): Promise<void> {
	console.log('[NIP-29] Connecting to pantry relay...');

	// 1. Set global auth policy BEFORE getting the relay — this avoids the
	//    race condition where the pool auto-connects the relay and the AUTH
	//    challenge arrives before relay.authPolicy is set.
	ensureAuthPolicy(ndkInstance);

	// 2. Get (or create) the relay in NDK's pool
	const relay = getPantryRelay(ndkInstance);
	if (!relay) {
		throw new Error('Could not create pantry relay instance');
	}

	// 3. Attach 'authed' listener on the pool's relay instance
	attachAuthedListener(relay);

	// 4. Check if relay already connected (pool may have auto-connected it)
	const alreadyConnected = relay.connectivity?.status === 1;

	if (alreadyConnected && !pantryAuthResolved) {
		// Relay connected before our policy was set — AUTH challenge was likely
		// dropped. Disconnect and reconnect to get a fresh AUTH challenge.
		console.log('[NIP-29] Relay already connected without auth, reconnecting...');
		try {
			await relay.disconnect();
		} catch {
			// ignore disconnect errors
		}
		await new Promise((r) => setTimeout(r, 200));
	}

	if (!alreadyConnected || !pantryAuthResolved) {
		// Connect (or reconnect)
		try {
			await relay.connect();
		} catch {
			// connect() may throw, we'll poll below
		}

		// Wait for WebSocket open
		await new Promise<void>((resolve, reject) => {
			const timeoutMs = 15000;

			const cleanup = () => {
				clearTimeout(timer);
				clearInterval(poller);
				relay.removeListener('connect', onConnect);
				relay.removeListener('ready', onConnect);
			};

			const onConnect = () => {
				cleanup();
				resolve();
			};

			const timer = setTimeout(() => {
				cleanup();
				if (relay.connectivity?.status === 1) {
					resolve();
				} else {
					reject(new Error('Pantry relay connection timed out'));
				}
			}, timeoutMs);

			const poller = setInterval(() => {
				if (relay.connectivity?.status === 1) {
					cleanup();
					resolve();
				}
			}, 250);

			relay.on('connect', onConnect);
			relay.on('ready', onConnect);

			if (relay.connectivity?.status === 1) {
				cleanup();
				resolve();
			}
		});
	}

	console.log('[NIP-29] Pantry relay connected, waiting for auth...');

	// 5. Wait for NIP-42 auth to complete (should be fast now that
	//    the global policy is in place and NIP-07 isn't contending)
	const authed = await waitForPantryAuth(15000);
	if (authed) {
		console.log('[NIP-29] Pantry relay authenticated and ready');
	} else {
		console.warn('[NIP-29] Auth timeout — proceeding (operations may fail)');
	}
}

/**
 * Ensure connected AND authenticated. Use this before operations that need auth.
 */
async function ensurePantryAuthed(ndkInstance: NDK): Promise<void> {
	await ensurePantryConnected(ndkInstance);
}

/**
 * Reset cached connection (call on logout or relay switch).
 */
export function resetPantryConnection() {
	pantryConnectionPromise = null;
	connectedNdkInstance = null;
	authPolicySet = false;
	pantryAuthPromise = null;
	pantryAuthResolved = false;
	resolveAuthPromise = null;
	authedListenerAttached = false;
}

// ═══════════════════════════════════════════════════════════════
// GROUP DISCOVERY
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch all group metadata (kind 39000) from the pantry relay.
 * Uses a subscription with EOSE + timeout instead of fetchEvents
 * to handle the case where there are zero groups gracefully.
 */
export async function fetchGroups(ndkInstance: NDK): Promise<GroupMetadata[]> {
	await ensurePantryAuthed(ndkInstance);
	const relaySet = getPantryRelaySet(ndkInstance);

	return new Promise((resolve) => {
		const groups: GroupMetadata[] = [];
		const timeoutId = setTimeout(() => {
			console.log('[NIP-29] fetchGroups timeout, returning', groups.length, 'groups');
			sub.stop();
			resolve(groups);
		}, 8000);

		const sub = ndkInstance.subscribe(
			{ kinds: [39000 as number] },
			{ closeOnEose: true },
			relaySet
		);

		sub.on('event', (event: NDKEvent) => {
			const meta = parseGroupMetadata(event);
			if (meta) groups.push(meta);
		});

		sub.on('eose', () => {
			clearTimeout(timeoutId);
			console.log('[NIP-29] Fetched', groups.length, 'groups');
			resolve(groups);
		});
	});
}

/**
 * Parse a kind 39000 event into GroupMetadata.
 */
function parseGroupMetadata(event: NDKEvent): GroupMetadata | null {
	const dTag = event.tags.find((t) => t[0] === 'd');
	if (!dTag || !dTag[1]) return null;

	const nameTag = event.tags.find((t) => t[0] === 'name');
	const pictureTag = event.tags.find((t) => t[0] === 'picture');
	const aboutTag = event.tags.find((t) => t[0] === 'about');
	const isPrivate = event.tags.some((t) => t[0] === 'private');
	const isClosed = event.tags.some((t) => t[0] === 'closed');
	const isRestricted = event.tags.some((t) => t[0] === 'restricted');

	return {
		id: dTag[1],
		name: nameTag?.[1] || dTag[1],
		picture: pictureTag?.[1] || '',
		about: aboutTag?.[1] || '',
		isPrivate,
		isClosed,
		isRestricted
	};
}

// ═══════════════════════════════════════════════════════════════
// GROUP MEMBERS
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch group members (kind 39002) for a specific group from the pantry relay.
 * These events are signed by the relay and contain `p` tags with member pubkeys.
 */
export async function fetchGroupMembers(
	ndkInstance: NDK,
	groupId: string
): Promise<string[]> {
	await ensurePantryAuthed(ndkInstance);
	const relaySet = getPantryRelaySet(ndkInstance);

	return new Promise((resolve) => {
		const members: string[] = [];
		const timeoutId = setTimeout(() => {
			sub.stop();
			resolve(members);
		}, 8000);

		const sub = ndkInstance.subscribe(
			{ kinds: [39002 as number], '#d': [groupId] },
			{ closeOnEose: true },
			relaySet
		);

		sub.on('event', (event: NDKEvent) => {
			for (const tag of event.tags) {
				if (tag[0] === 'p' && tag[1]) {
					members.push(tag[1]);
				}
			}
		});

		sub.on('eose', () => {
			clearTimeout(timeoutId);
			resolve(members);
		});
	});
}

// ═══════════════════════════════════════════════════════════════
// MESSAGES
// ═══════════════════════════════════════════════════════════════

/**
 * Send a kind 9 chat message to a group.
 */
export async function sendGroupMessage(groupId: string, content: string): Promise<GroupMessage> {
	const ndkInstance = get(ndk);
	const senderPubkey = get(userPublickey);

	if (!senderPubkey) throw new Error('Not logged in');
	if (!content.trim()) throw new Error('Message cannot be empty');

	await ensurePantryAuthed(ndkInstance);

	const event = new NDKEvent(ndkInstance);
	event.kind = 9;
	event.content = content;
	event.tags = [['h', groupId]];

	await event.sign();

	const relaySet = getPantryRelaySet(ndkInstance);
	await publishWithAuthRetry(event, relaySet, ndkInstance);

	console.log('[NIP-29] Message sent to group', groupId);

	return {
		id: event.id,
		groupId,
		sender: senderPubkey,
		content,
		created_at: event.created_at || Math.round(Date.now() / 1000)
	};
}

/**
 * Fetch historical kind 9 messages for a specific group.
 * Uses subscription with EOSE + timeout.
 */
export async function fetchGroupMessages(
	ndkInstance: NDK,
	groupId: string,
	since?: number
): Promise<GroupMessage[]> {
	await ensurePantryAuthed(ndkInstance);
	const relaySet = getPantryRelaySet(ndkInstance);
	const sinceTimestamp = since || Math.round(Date.now() / 1000) - 7 * 24 * 60 * 60;

	return new Promise((resolve) => {
		const messages: GroupMessage[] = [];
		const timeoutId = setTimeout(() => {
			sub.stop();
			resolve(messages);
		}, 8000);

		const sub = ndkInstance.subscribe(
			{ kinds: [9 as number], '#h': [groupId], since: sinceTimestamp },
			{ closeOnEose: true },
			relaySet
		);

		sub.on('event', (event: NDKEvent) => {
			const hTag = event.tags.find((t) => t[0] === 'h');
			if (hTag?.[1] === groupId) {
				messages.push({
					id: event.id,
					groupId,
					sender: event.pubkey,
					content: event.content,
					created_at: event.created_at || 0
				});
			}
		});

		sub.on('eose', () => {
			clearTimeout(timeoutId);
			messages.sort((a, b) => a.created_at - b.created_at);
			resolve(messages);
		});
	});
}

// ═══════════════════════════════════════════════════════════════
// SUBSCRIPTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Subscribe to live kind 9 chat messages across all groups on pantry.
 */
export async function subscribeToGroupMessages(
	ndkInstance: NDK,
	onMessage: (message: GroupMessage) => void
): Promise<{ stop: () => void }> {
	const seenIds = new Set<string>();

	await ensurePantryAuthed(ndkInstance);
	const relaySet = getPantryRelaySet(ndkInstance);

	console.log('[NIP-29] Starting group message subscription');

	const sub = ndkInstance.subscribe(
		{ kinds: [9 as number] },
		{ closeOnEose: false },
		relaySet
	);

	sub.on('event', (event: NDKEvent) => {
		if (seenIds.has(event.id)) return;
		seenIds.add(event.id);

		const hTag = event.tags.find((t) => t[0] === 'h');
		if (!hTag?.[1]) return;

		onMessage({
			id: event.id,
			groupId: hTag[1],
			sender: event.pubkey,
			content: event.content,
			created_at: event.created_at || 0
		});
	});

	sub.on('eose', () => {
		console.log('[NIP-29] Group message subscription EOSE, seen', seenIds.size, 'events');
	});

	return {
		stop: () => {
			sub.stop();
			seenIds.clear();
		}
	};
}

// ═══════════════════════════════════════════════════════════════
// PUBLISH WITH AUTH RETRY
// ═══════════════════════════════════════════════════════════════

/**
 * Publish an event to the relay set, retrying once after NIP-42 auth completes.
 *
 * The Pantry relay uses lazy NIP-42 auth: it only sends an AUTH challenge
 * when an operation requires authentication. This means the first publish
 * may fail with "auth-required", triggering the AUTH handshake. After auth
 * completes, we retry the publish.
 */
async function publishWithAuthRetry(
	event: NDKEvent,
	relaySet: NDKRelaySet,
	ndkInstance: NDK
): Promise<void> {
	try {
		await event.publish(relaySet);
	} catch (e: any) {
		// Check if the error is auth-related
		let isAuthError = false;
		if (e.errors instanceof Map) {
			for (const [, err] of e.errors) {
				if (String(err).includes('auth-required')) {
					isAuthError = true;
					break;
				}
			}
		}

		if (!isAuthError) {
			// Not an auth error — surface details and rethrow
			if (e.relayErrors) {
				console.error('[NIP-29] Publish relay errors:', e.relayErrors);
			}
			throw e;
		}

		console.log('[NIP-29] Auth required — waiting for NIP-42 handshake to complete...');

		const relay = getPantryRelay(ndkInstance);
		if (!relay) throw e;

		// Wait for the auth handshake to finish (auth policy is already handling it)
		await new Promise<void>((resolve) => {
			const onAuthed = () => {
				clearTimeout(timer);
				console.log('[NIP-29] Auth completed, retrying publish...');
				resolve();
			};

			const timer = setTimeout(() => {
				relay.removeListener('authed', onAuthed);
				console.warn('[NIP-29] Auth retry timeout');
				resolve();
			}, 10000);

			relay.on('authed', onAuthed);
		});

		// Retry the publish
		await event.publish(relaySet);
	}
}

// ═══════════════════════════════════════════════════════════════
// GROUP MANAGEMENT
// ═══════════════════════════════════════════════════════════════

/**
 * Create a new group by sending a kind 9007 event to the pantry relay.
 */
export async function createGroup(name: string, about?: string): Promise<string> {
	const ndkInstance = get(ndk);
	const senderPubkey = get(userPublickey);

	if (!senderPubkey) throw new Error('Not logged in');
	if (!name.trim()) throw new Error('Group name is required');

	await ensurePantryAuthed(ndkInstance);

	// Generate a random group ID
	const groupId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');

	const event = new NDKEvent(ndkInstance);
	event.kind = 9007;
	event.content = '';
	event.tags = [['h', groupId]];

	await event.sign();

	const relaySet = getPantryRelaySet(ndkInstance);
	await publishWithAuthRetry(event, relaySet, ndkInstance);

	console.log('[NIP-29] Group created:', groupId);

	// Set metadata via kind 9002 (edit-metadata)
	if (name || about) {
		const metaEvent = new NDKEvent(ndkInstance);
		metaEvent.kind = 9002;
		metaEvent.content = '';
		metaEvent.tags = [['h', groupId]];
		if (name) metaEvent.tags.push(['name', name]);
		if (about) metaEvent.tags.push(['about', about]);

		await metaEvent.sign();
		await publishWithAuthRetry(metaEvent, relaySet, ndkInstance);
		console.log('[NIP-29] Group metadata set for', groupId);
	}

	return groupId;
}

/**
 * Add a user to a group by sending a kind 9000 (put-user) event.
 * Only group admins can add members.
 */
export async function addGroupMember(
	groupId: string,
	memberPubkey: string,
	role: string = 'member'
): Promise<void> {
	const ndkInstance = get(ndk);
	const senderPubkey = get(userPublickey);

	if (!senderPubkey) throw new Error('Not logged in');
	if (!memberPubkey.trim()) throw new Error('Member pubkey is required');

	await ensurePantryAuthed(ndkInstance);

	const event = new NDKEvent(ndkInstance);
	event.kind = 9000;
	event.content = '';
	event.tags = [
		['h', groupId],
		['p', memberPubkey, role]
	];

	await event.sign();

	const relaySet = getPantryRelaySet(ndkInstance);
	await publishWithAuthRetry(event, relaySet, ndkInstance);

	console.log('[NIP-29] Added member', memberPubkey, 'to group', groupId, 'as', role);
}

/**
 * Send a join request (kind 9021) to a group.
 */
export async function joinGroup(groupId: string): Promise<void> {
	const ndkInstance = get(ndk);
	const senderPubkey = get(userPublickey);

	if (!senderPubkey) throw new Error('Not logged in');

	await ensurePantryAuthed(ndkInstance);

	const event = new NDKEvent(ndkInstance);
	event.kind = 9021;
	event.content = '';
	event.tags = [['h', groupId]];

	await event.sign();

	const relaySet = getPantryRelaySet(ndkInstance);
	await publishWithAuthRetry(event, relaySet, ndkInstance);

	console.log('[NIP-29] Join request sent for group', groupId);
}

/**
 * Edit group metadata via kind 9002 (edit-metadata).
 * Supports updating name, about, and picture fields.
 */
export async function editGroupMetadata(
	groupId: string,
	fields: { name?: string; about?: string; picture?: string; visibility?: 'public' | 'members-only' }
): Promise<void> {
	const ndkInstance = get(ndk);
	const senderPubkey = get(userPublickey);

	if (!senderPubkey) throw new Error('Not logged in');

	await ensurePantryAuthed(ndkInstance);

	const event = new NDKEvent(ndkInstance);
	event.kind = 9002;
	event.content = '';
	event.tags = [['h', groupId]];
	if (fields.name !== undefined) event.tags.push(['name', fields.name]);
	if (fields.about !== undefined) event.tags.push(['about', fields.about]);
	if (fields.picture !== undefined) event.tags.push(['picture', fields.picture]);
	if (fields.visibility === 'public') {
		event.tags.push(['public']);
		event.tags.push(['unrestricted']);
	} else if (fields.visibility === 'members-only') {
		event.tags.push(['private']);
		event.tags.push(['restricted']);
	}

	await event.sign();

	const relaySet = getPantryRelaySet(ndkInstance);
	await publishWithAuthRetry(event, relaySet, ndkInstance);

	console.log('[NIP-29] Group metadata updated for', groupId);
}

/**
 * Delete a group by sending a kind 9008 (delete-group) event.
 * Only group admins can delete groups.
 */
export async function deleteGroup(groupId: string): Promise<void> {
	const ndkInstance = get(ndk);
	const senderPubkey = get(userPublickey);

	if (!senderPubkey) throw new Error('Not logged in');

	await ensurePantryAuthed(ndkInstance);

	const event = new NDKEvent(ndkInstance);
	event.kind = 9008;
	event.content = '';
	event.tags = [['h', groupId]];

	await event.sign();

	const relaySet = getPantryRelaySet(ndkInstance);
	await publishWithAuthRetry(event, relaySet, ndkInstance);

	console.log('[NIP-29] Group deleted:', groupId);
}

/**
 * Upload an image to nostr.build and return the URL.
 * Uses NIP-98 HTTP Auth for authentication.
 */
export async function uploadGroupPicture(file: File): Promise<string> {
	const ndkInstance = get(ndk);

	if (!ndkInstance.signer) throw new Error('Not authenticated');

	const url = 'https://nostr.build/api/v2/upload/files';

	const template = new NDKEvent(ndkInstance);
	template.kind = 27235;
	template.created_at = Math.floor(Date.now() / 1000);
	template.content = '';
	template.tags = [
		['u', url],
		['method', 'POST']
	];
	await template.sign();

	const authEvent = {
		id: template.id,
		pubkey: template.pubkey,
		created_at: template.created_at,
		kind: template.kind,
		tags: template.tags,
		content: template.content,
		sig: template.sig
	};

	const body = new FormData();
	body.append('file[]', file);

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}`
		},
		body
	});

	if (!response.ok) throw new Error('Upload failed');

	const result = await response.json();
	const imageUrl = result?.data?.[0]?.url;
	if (!imageUrl) throw new Error('No URL returned from upload');

	return imageUrl;
}
