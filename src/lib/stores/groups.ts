/**
 * Group Store — NIP-29 group chat state management.
 *
 * Stores group metadata and messages in memory only (never persisted).
 * Groups messages by group ID, tracks state, and provides derived stores for the UI.
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
}

// ═══════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════

const groups = writable<Map<string, Group>>(new Map());

const seenMessageIds = new Set<string>();

export const activeGroupId = writable<string | null>(null);

export const groupsLoading = writable(false);
export const groupsInitialized = writable(false);

// ═══════════════════════════════════════════════════════════════
// DERIVED STORES
// ═══════════════════════════════════════════════════════════════

/** Sorted group list (most recent activity first). */
export const sortedGroups = derived(groups, ($groups) => {
	return Array.from($groups.values()).sort((a, b) => b.lastMessageAt - a.lastMessageAt);
});

/** Get a specific group reactively. */
export function getGroup(groupId: string) {
	return derived(groups, ($groups) => $groups.get(groupId) || null);
}

// ═══════════════════════════════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Add a message to a group. Handles deduplication.
 */
export function addGroupMessage(message: GroupMessage) {
	if (seenMessageIds.has(message.id)) return;
	seenMessageIds.add(message.id);

	groups.update(($groups) => {
		const existing = $groups.get(message.groupId);

		if (existing) {
			if (existing.messages.some((m) => m.id === message.id)) {
				return $groups;
			}
			existing.messages.push(message);
			existing.messages.sort((a, b) => a.created_at - b.created_at);
			existing.lastMessageAt = Math.max(existing.lastMessageAt, message.created_at);
		} else {
			// Group not yet known — create a placeholder entry
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
				lastMessageAt: message.created_at
			});
		}

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
				lastMessageAt: 0
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
				lastMessageAt: 0
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
}

/** Set the active group. */
export function setActiveGroup(groupId: string | null) {
	activeGroupId.set(groupId);
}

/** Clear all group state (on logout). */
export function clearGroups() {
	groups.set(new Map());
	seenMessageIds.clear();
	activeGroupId.set(null);
	groupsInitialized.set(false);
	resetPantryConnection();
}

// ═══════════════════════════════════════════════════════════════
// SUBSCRIPTION MANAGEMENT
// ═══════════════════════════════════════════════════════════════

let activeSub: { stop: () => void } | null = null;

/**
 * Initialize group subscription: fetch all data in one batch, start live sub.
 * Uses a single subscription for metadata + members + messages (progressive rendering).
 */
export async function initGroupSubscription(ndkInstance: NDK, userPubkey: string) {
	if (!browser) return;
	if (!userPubkey) return;

	if (get(groupsInitialized) || get(groupsLoading)) {
		return;
	}

	stopGroupSubscription();

	groupsLoading.set(true);
	const t0 = performance.now();

	try {
		let groupCount = 0;

		// Capture timestamp BEFORE batch fetch so live sub overlaps slightly,
		// ensuring no messages are lost between batch EOSE and live sub start
		const liveSubSince = Math.floor(Date.now() / 1000);

		// 1. Fetch all group data in a single batched subscription
		//    UI updates progressively as each event arrives
		await fetchAllGroupData(ndkInstance, {
			onMetadata: (meta) => {
				setGroupMetadata(meta);
				groupCount++;
			},
			onMembers: (groupId, members) => {
				setGroupMembers(groupId, members);
			},
			onMessage: (message) => {
				addGroupMessage(message);
			}
		});

		const t1 = performance.now();

		// 2. Start live subscription for new messages
		//    Uses liveSubSince (captured before batch) so there's no gap;
		//    dedup in addGroupMessage handles any overlap
		activeSub = await subscribeToGroupMessages(ndkInstance, (message) => {
			addGroupMessage(message);
		}, liveSubSince);

		const t2 = performance.now();

		if (groupCount > 0) {
			groupsInitialized.set(true);
			console.log(`[Groups] Ready in ${(t2 - t0).toFixed(0)}ms (batch: ${(t1 - t0).toFixed(0)}ms, live sub: ${(t2 - t1).toFixed(0)}ms, ${groupCount} groups)`);
		} else {
			// 0 groups likely means auth failed and the relay returned nothing.
			// Reset the connection so the next retry does a full reconnect + re-auth
			// instead of reusing the failed auth state.
			stopGroupSubscription();
			resetPantryConnection();
			console.warn(`[Groups] Fetched 0 groups in ${(t2 - t0).toFixed(0)}ms — connection reset, will retry on next navigation`);
		}
	} catch (e) {
		console.error('[Groups] Failed to initialize:', e);
	} finally {
		groupsLoading.set(false);
	}
}

/** Stop the active group subscription. */
export function stopGroupSubscription() {
	if (activeSub) {
		activeSub.stop();
		activeSub = null;
	}
}
