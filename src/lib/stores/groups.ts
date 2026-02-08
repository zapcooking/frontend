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
	fetchGroups,
	fetchGroupMessages,
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
	messages: GroupMessage[];
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
				messages: [message],
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
		} else {
			$groups.set(metadata.id, {
				...metadata,
				messages: [],
				lastMessageAt: 0
			});
		}

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
 * Initialize group subscription: fetch metadata, load messages, start live sub.
 */
export async function initGroupSubscription(ndkInstance: NDK, userPubkey: string) {
	if (!browser) return;
	if (!userPubkey) return;

	if (get(groupsInitialized) || get(groupsLoading)) {
		return;
	}

	stopGroupSubscription();

	groupsLoading.set(true);

	try {
		// 1. Fetch group metadata
		const groupList = await fetchGroups(ndkInstance);
		for (const meta of groupList) {
			setGroupMetadata(meta);
		}

		// 2. Start live subscription for new messages
		activeSub = await subscribeToGroupMessages(ndkInstance, (message) => {
			addGroupMessage(message);
		});

		groupsInitialized.set(true);
		console.log('[Groups] Subscription active, fetched', groupList.length, 'groups');

		// 3. Load historical messages for each group in background
		for (const meta of groupList) {
			fetchGroupMessages(ndkInstance, meta.id)
				.then((messages) => {
					for (const msg of messages) {
						addGroupMessage(msg);
					}
				})
				.catch((e) => {
					console.warn('[Groups] Failed to load messages for group', meta.id, e);
				});
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
