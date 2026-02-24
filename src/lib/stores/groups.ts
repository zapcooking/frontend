/**
 * Group Store — NIP-29 group chat state management.
 *
 * Stores group metadata and messages with IndexedDB caching for instant load.
 * Cache-first: loads from IndexedDB immediately, then syncs from relay.
 */

import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import type NDK from '@nostr-dev-kit/ndk';
import type { GroupMetadata, GroupMessage } from '$lib/nip29';
import {
	fetchAllGroupData,
	subscribeToGroupMessages,
	resetPantryConnection
} from '$lib/nip29';
import { groupCache } from '$lib/groupCacheStorage';
import type { CachedMessage } from '$lib/groupCacheStorage';
import { pantryManager } from '$lib/pantryConnectionManager';
import { clearZapReceipts } from '$lib/stores/groupZapReceipts';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface Group {
	id: string;
	name: string;
	picture: string;
	about: string;
	isPrivate: boolean;
	isClosed: boolean;
	isRestricted: boolean;
	messages: GroupMessage[];
	members: string[];
	lastMessageAt: number;
	unreadCount: number;
}

// ═══════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════

const groups = writable<Map<string, Group>>(new Map());

const seenMessageIds = new Set<string>();

export const activeGroupId = writable<string | null>(null);

export const groupsLoading = writable(false);
export const groupsInitialized = writable(false);
export const groupsSyncing = writable(false);
export const groupsInitAnonymous = writable(false);

// ═══════════════════════════════════════════════════════════════
// DERIVED STORES
// ═══════════════════════════════════════════════════════════════

/** Sorted group list (most recent activity first). */
export const sortedGroups = derived(groups, ($groups) => {
	return Array.from($groups.values()).sort((a, b) => b.lastMessageAt - a.lastMessageAt);
});

/** Total unread count across all groups. */
export const totalGroupUnreadCount = derived(groups, ($groups) => {
	let total = 0;
	for (const group of $groups.values()) total += group.unreadCount;
	return total;
});

/** Get a specific group reactively. */
export function getGroup(groupId: string) {
	return derived(groups, ($groups) => $groups.get(groupId) || null);
}

// ═══════════════════════════════════════════════════════════════
// MESSAGE BATCHING
// ═══════════════════════════════════════════════════════════════

// Buffer for incoming messages — flushed every BATCH_INTERVAL_MS
const BATCH_INTERVAL_MS = 200;
let messageBuffer: { message: GroupMessage; isLive: boolean }[] = [];
let cacheBuffer: CachedMessage[] = [];
let batchFlushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Flush buffered messages into the store in a single update.
 * Also flushes accumulated cache writes in a single IDB transaction.
 */
export function flushMessageBuffer(): void {
	if (batchFlushTimer) {
		clearTimeout(batchFlushTimer);
		batchFlushTimer = null;
	}

	const buffered = messageBuffer.splice(0);
	const cached = cacheBuffer.splice(0);

	// Flush cache even if messages were deduped
	if (cached.length > 0) {
		groupCache.saveMessages(cached).catch(() => {});
	}

	if (buffered.length === 0) return;

	// Single store update for all buffered messages
	groups.update(($groups) => {
		let changed = false;

		for (const { message, isLive } of buffered) {
			const existing = $groups.get(message.groupId);

			// Check pending → confirmed transition
			if (existing) {
				const pendingIdx = existing.messages.findIndex(
					(m) => m.id === message.id && m.status === 'pending'
				);
				if (pendingIdx !== -1) {
					existing.messages[pendingIdx] = { ...message, status: 'confirmed' };
					seenMessageIds.add(message.id);
					changed = true;
					continue;
				}
			}

			// Standard dedup
			if (seenMessageIds.has(message.id)) continue;
			seenMessageIds.add(message.id);

			if (existing) {
				if (existing.messages.some((m) => m.id === message.id)) continue;
				existing.messages.push(message);
				existing.lastMessageAt = Math.max(existing.lastMessageAt, message.created_at);
				if (isLive && message.groupId !== get(activeGroupId)) {
					existing.unreadCount++;
				}
				changed = true;
			} else {
				$groups.set(message.groupId, {
					id: message.groupId,
					name: message.groupId,
					picture: '',
					about: '',
					isPrivate: false,
					isClosed: false,
					isRestricted: false,
					messages: [message],
					members: [],
					lastMessageAt: message.created_at,
					unreadCount: isLive ? 1 : 0
				});
				changed = true;
			}
		}

		if (!changed) return $groups;

		// Sort messages once per group that was touched (not per-message)
		const touchedGroups = new Set(buffered.map((b) => b.message.groupId));
		for (const gid of touchedGroups) {
			const group = $groups.get(gid);
			if (group && group.messages.length > 1) {
				group.messages.sort((a, b) => a.created_at - b.created_at);
			}
		}

		return new Map($groups);
	});
}

function scheduleBatchFlush(): void {
	if (batchFlushTimer) return; // already scheduled
	batchFlushTimer = setTimeout(flushMessageBuffer, BATCH_INTERVAL_MS);
}

// ═══════════════════════════════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Add a message to a group. Messages are buffered and flushed in batches
 * every 200ms for better performance (single store update + single IDB write).
 * @param isLive - true for messages from the live subscription (not batch-loaded)
 */
export function addGroupMessage(message: GroupMessage, isLive = false) {
	// Quick dedup before buffering
	if (seenMessageIds.has(message.id)) {
		// Still check for pending → confirmed (not in seenIds for optimistic msgs)
		const $groups = get(groups);
		const existing = $groups.get(message.groupId);
		if (existing) {
			const hasPending = existing.messages.some(
				(m) => m.id === message.id && m.status === 'pending'
			);
			if (!hasPending) return;
		} else {
			return;
		}
	}

	messageBuffer.push({ message, isLive });
	scheduleBatchFlush();
}

/**
 * Add an optimistic (pending) message to the store.
 */
export function addOptimisticMessage(
	groupId: string,
	tempId: string,
	content: string,
	sender: string
): GroupMessage {
	const msg: GroupMessage = {
		id: tempId,
		groupId,
		sender,
		content,
		created_at: Math.floor(Date.now() / 1000),
		status: 'pending',
		tempId
	};

	groups.update(($groups) => {
		const existing = $groups.get(groupId);
		if (existing) {
			existing.messages.push(msg);
			existing.lastMessageAt = Math.max(existing.lastMessageAt, msg.created_at);
		} else {
			$groups.set(groupId, {
				id: groupId,
				name: groupId,
				picture: '',
				about: '',
				isPrivate: false,
				isClosed: false,
				isRestricted: false,
				messages: [msg],
				members: [],
				lastMessageAt: msg.created_at,
				unreadCount: 0
			});
		}
		return new Map($groups);
	});

	return msg;
}

/**
 * Confirm an optimistic message by replacing the temp ID with the real event ID.
 */
export function confirmOptimisticMessage(groupId: string, tempId: string, realId: string) {
	groups.update(($groups) => {
		const group = $groups.get(groupId);
		if (!group) return $groups;

		const msg = group.messages.find((m) => m.id === tempId || m.tempId === tempId);
		if (msg) {
			msg.id = realId;
			msg.status = 'confirmed';
			msg.tempId = undefined;
			seenMessageIds.add(realId);
		}

		return new Map($groups);
	});
}

/**
 * Mark an optimistic message as failed.
 */
export function markMessageFailed(groupId: string, tempId: string) {
	groups.update(($groups) => {
		const group = $groups.get(groupId);
		if (!group) return $groups;

		const msg = group.messages.find((m) => m.id === tempId || m.tempId === tempId);
		if (msg) {
			msg.status = 'failed';
		}

		return new Map($groups);
	});
}

/**
 * Remove an optimistic message from the store.
 */
export function removeOptimisticMessage(groupId: string, tempId: string) {
	groups.update(($groups) => {
		const group = $groups.get(groupId);
		if (!group) return $groups;

		group.messages = group.messages.filter((m) => m.id !== tempId && m.tempId !== tempId);
		return new Map($groups);
	});
}

/**
 * Set or update group metadata.
 */
export function setGroupMetadata(metadata: GroupMetadata) {
	groups.update(($groups) => {
		const existing = $groups.get(metadata.id);

		if (existing) {
			existing.name = metadata.name;
			existing.picture = metadata.picture;
			existing.about = metadata.about;
			existing.isPrivate = metadata.isPrivate;
			existing.isClosed = metadata.isClosed;
			existing.isRestricted = metadata.isRestricted;
		} else {
			$groups.set(metadata.id, {
				...metadata,
				messages: [],
				members: [],
				lastMessageAt: 0,
				unreadCount: 0
			});
		}

		return new Map($groups);
	});
}

/**
 * Set group members list.
 */
export function setGroupMembers(groupId: string, members: string[]) {
	groups.update(($groups) => {
		const existing = $groups.get(groupId);
		if (existing) {
			existing.members = members;
		} else {
			// Members arrived before metadata — create placeholder
			$groups.set(groupId, {
				id: groupId,
				name: groupId,
				picture: '',
				about: '',
				isPrivate: false,
				isClosed: false,
				isRestricted: false,
				messages: [],
				members,
				lastMessageAt: 0,
				unreadCount: 0
			});
		}
		return new Map($groups);
	});
}

/** Remove a group from the store. */
export function removeGroup(groupId: string) {
	groups.update(($groups) => {
		$groups.delete(groupId);
		return new Map($groups);
	});
	// Also remove from cache (fire-and-forget)
	groupCache.clearGroup(groupId).catch(() => {});
}

/** Mark a group as read (reset unread count to 0). */
export function markGroupAsRead(groupId: string) {
	groups.update(($groups) => {
		const existing = $groups.get(groupId);
		if (existing && existing.unreadCount > 0) {
			existing.unreadCount = 0;
			return new Map($groups);
		}
		return $groups;
	});
}

/** Set the active group. */
export function setActiveGroup(groupId: string | null) {
	activeGroupId.set(groupId);
	if (groupId) {
		markGroupAsRead(groupId);
	}
}

/** Clear all group state (on logout). */
export function clearGroups() {
	groups.set(new Map());
	seenMessageIds.clear();
	activeGroupId.set(null);
	groupsInitialized.set(false);
	groupsSyncing.set(false);
	groupsInitAnonymous.set(false);
	resetPantryConnection();
	pantryManager.destroy();
	clearZapReceipts();
	// Clear IndexedDB cache
	groupCache.clearAll().catch(() => {});
}

// ═══════════════════════════════════════════════════════════════
// SUBSCRIPTION MANAGEMENT
// ═══════════════════════════════════════════════════════════════

let activeSub: { stop: () => void } | null = null;
let reconnectCleanup: (() => void) | null = null;

/**
 * Initialize group subscription with cache-first flow:
 * 1. Load from IndexedDB instantly
 * 2. Sync from relay with since= latest cached timestamp
 * 3. Start live subscription
 * 4. Prune old messages
 */
export async function initGroupSubscription(ndkInstance: NDK, userPubkey?: string) {
	if (!browser) return;

	const isAnonymous = !userPubkey;

	if (get(groupsInitialized) || get(groupsLoading)) {
		console.log('[Groups] Skipping init — already initialized or loading');
		return;
	}

	console.log('[Groups] Initializing...', isAnonymous ? '(anonymous)' : '(authenticated)');
	stopGroupSubscription();

	groupsLoading.set(true);
	groupsInitAnonymous.set(isAnonymous);
	const t0 = performance.now();

	try {
		// ── Phase 1: Load from IndexedDB (skip for anonymous) ──
		let cachedGroupCount = 0;
		let latestTimestamp: number | null = null;

		if (!isAnonymous) {
			try {
				const [cachedMetadata, cachedMembers] = await Promise.all([
					groupCache.getAllMetadata(),
					groupCache.getAllMembers()
				]);

				// Populate store with cached metadata
				for (const meta of cachedMetadata) {
					setGroupMetadata({
						id: meta.id,
						name: meta.name,
						picture: meta.picture,
						about: meta.about,
						isPrivate: meta.isPrivate,
						isClosed: meta.isClosed,
						isRestricted: meta.isRestricted
					});
					cachedGroupCount++;
				}

				// Populate cached members
				for (const cm of cachedMembers) {
					setGroupMembers(cm.groupId, cm.members);
				}

				// Load cached messages for each group
				for (const meta of cachedMetadata) {
					const msgs = await groupCache.getMessages(meta.id);
					for (const msg of msgs) {
						addGroupMessage({
							id: msg.id,
							groupId: msg.groupId,
							sender: msg.sender,
							content: msg.content,
							created_at: msg.created_at
						});
					}
				}

				latestTimestamp = await groupCache.getLatestTimestamp();
			} catch (e) {
				console.warn('[Groups] Cache load failed:', e);
			}
		}

		const t1 = performance.now();

		// If we got data from cache, mark as initialized immediately for instant UI
		if (cachedGroupCount > 0) {
			groupsInitialized.set(true);
			console.log(`[Groups] Cache loaded in ${(t1 - t0).toFixed(0)}ms (${cachedGroupCount} groups)`);
		}

		// ── Phase 2: Sync from relay ──
		groupsSyncing.set(true);

		let groupCount = 0;

		// Use since = latest cached timestamp (with 60s overlap for safety) or default
		const syncSince = latestTimestamp ? latestTimestamp - 60 : undefined;

		// Capture timestamp BEFORE batch fetch so live sub overlaps slightly
		const liveSubSince = Math.floor(Date.now() / 1000);

		await fetchAllGroupData(
			ndkInstance,
			{
				onMetadata: (meta) => {
					setGroupMetadata(meta);
					groupCount++;
					if (!isAnonymous) {
						groupCache
							.saveMetadata({
								...meta,
								updatedAt: Date.now()
							})
							.catch(() => {});
					}
				},
				onMembers: (groupId, members) => {
					setGroupMembers(groupId, members);
					if (!isAnonymous) {
						groupCache.saveMembers(groupId, members).catch(() => {});
					}
				},
				onMessage: (message) => {
					addGroupMessage(message);
					pantryManager.markDataReceived();
					if (!isAnonymous) {
						cacheBuffer.push({
							id: message.id,
							groupId: message.groupId,
							sender: message.sender,
							content: message.content,
							created_at: message.created_at,
							cachedAt: Date.now()
						});
					}
				}
			},
			syncSince
		);

		// Flush any remaining buffered messages after EOSE
		flushMessageBuffer();

		const t2 = performance.now();

		// Start live subscription for new messages
		activeSub = await subscribeToGroupMessages(
			ndkInstance,
			(message) => {
				addGroupMessage(message, true);
				pantryManager.markDataReceived();
				if (!isAnonymous) {
					cacheBuffer.push({
						id: message.id,
						groupId: message.groupId,
						sender: message.sender,
						content: message.content,
						created_at: message.created_at,
						cachedAt: Date.now()
					});
				}
			},
			liveSubSince
		);

		const t3 = performance.now();

		if (groupCount > 0 || cachedGroupCount > 0) {
			groupsInitialized.set(true);
			console.log(
				`[Groups] Ready in ${(t3 - t0).toFixed(0)}ms (cache: ${(t1 - t0).toFixed(0)}ms, sync: ${(t2 - t1).toFixed(0)}ms, live: ${(t3 - t2).toFixed(0)}ms, ${groupCount} relay groups, ${cachedGroupCount} cached)`
			);
		} else if (isAnonymous) {
			groupsInitialized.set(true);
			console.log('[Groups] Anonymous: no public groups found');
		} else {
			// 0 groups from both cache and relay — likely auth failure
			stopGroupSubscription();
			resetPantryConnection();
			console.warn(
				`[Groups] Fetched 0 groups in ${(t3 - t0).toFixed(0)}ms — connection reset, will retry on next navigation`
			);
		}

		// ── Phase 3: Initialize connection manager AFTER relay is connected ──
		// Must be after fetchAllGroupData so the manager doesn't interfere
		// with the initial AUTH handshake in nip29.ts.
		pantryManager.init(ndkInstance);

		// ── Phase 4: Prune old messages (fire-and-forget, skip for anonymous) ──
		if (!isAnonymous) {
			const groupIds = Array.from(get(groups).keys());
			for (const gid of groupIds) {
				groupCache.pruneMessages(gid, 1000).catch(() => {});
			}
		}

		// ── Phase 5: Register reconnect handler ──
		reconnectCleanup = pantryManager.onReady(() => {
			console.log('[Groups] Pantry reconnected, restarting live subscription...');
			restartLiveSubscription(ndkInstance);
		});
	} catch (e) {
		console.error('[Groups] Failed to initialize:', e);
	} finally {
		groupsLoading.set(false);
		groupsSyncing.set(false);
	}
}

/**
 * Restart the live subscription after a reconnect.
 */
async function restartLiveSubscription(ndkInstance: NDK) {
	try {
		// Stop current sub
		if (activeSub) {
			activeSub.stop();
			activeSub = null;
		}

		// Start new sub with 60s overlap
		const since = Math.floor(Date.now() / 1000) - 60;
		activeSub = await subscribeToGroupMessages(
			ndkInstance,
			(message) => {
				addGroupMessage(message, true);
				pantryManager.markDataReceived();
				cacheBuffer.push({
					id: message.id,
					groupId: message.groupId,
					sender: message.sender,
					content: message.content,
					created_at: message.created_at,
					cachedAt: Date.now()
				});
			},
			since
		);

		// Retry pending messages (up to 3 retries)
		try {
			const pending = await groupCache.getPendingMessages();
			for (const pm of pending) {
				if (pm.retryCount < 3) {
					console.log('[Groups] Retrying pending message:', pm.tempId);
					// The UI handles the retry via the retry button — just log for now
				}
			}
		} catch {
			// ignore pending message errors
		}
	} catch (e) {
		console.error('[Groups] Failed to restart live subscription:', e);
	}
}

/** Stop the active group subscription. */
export function stopGroupSubscription() {
	if (activeSub) {
		activeSub.stop();
		activeSub = null;
	}
	if (reconnectCleanup) {
		reconnectCleanup();
		reconnectCleanup = null;
	}
}
