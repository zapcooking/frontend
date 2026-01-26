import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { get } from 'svelte/store';
import { ndk } from '$lib/nostr';
import { nip04 } from 'nostr-tools';

// Type definitions (from mutable)
export interface MutedPubkey {
	type: 'pubkey';
	value: string; // hex pubkey
	reason?: string;
	eventRef?: string;
	private?: boolean;
}

export interface MutedWord {
	type: 'word';
	value: string;
	reason?: string;
	private?: boolean;
}

export interface MutedTag {
	type: 'tag';
	value: string;
	reason?: string;
	private?: boolean;
}

export interface MutedThread {
	type: 'thread';
	value: string; // event id
	reason?: string;
	private?: boolean;
}

export interface MuteList {
	pubkeys: MutedPubkey[];
	words: MutedWord[];
	tags: MutedTag[];
	threads: MutedThread[];
}

/**
 * Fetch user's mute list (kind:10000) from relays
 */
export async function fetchMuteList(pubkey: string): Promise<NDKEvent | null> {
	const ndkInstance = get(ndk);
	if (!ndkInstance || !pubkey) return null;

	try {
		const events = await ndkInstance.fetchEvents({
			kinds: [10000],
			authors: [pubkey]
		});

		if (events.size === 0) return null;

		// Get most recent
		const sortedEvents = Array.from(events).sort(
			(a, b) => (b.created_at || 0) - (a.created_at || 0)
		);

		return sortedEvents[0];
	} catch (error) {
		console.error('Failed to fetch mute list:', error);
		return null;
	}
}

/**
 * Parse mute list event - extracts both public tags and private encrypted content
 */
export async function parseMuteListEvent(event: NDKEvent): Promise<MuteList> {
	const muteList: MuteList = {
		pubkeys: [],
		words: [],
		tags: [],
		threads: []
	};

	// Parse public mutes from tags
	for (const tag of event.tags) {
		if (!Array.isArray(tag) || tag.length < 2) continue;

		const [tagType, value, reason] = tag;

		switch (tagType) {
			case 'p':
				muteList.pubkeys.push({
					type: 'pubkey',
					value,
					reason,
					private: false
				});
				break;
			case 'word':
				muteList.words.push({
					type: 'word',
					value,
					reason,
					private: false
				});
				break;
			case 't':
				muteList.tags.push({
					type: 'tag',
					value,
					reason,
					private: false
				});
				break;
			case 'e':
				muteList.threads.push({
					type: 'thread',
					value,
					reason,
					private: false
				});
				break;
		}
	}

	// Parse private mutes from encrypted content (NIP-04)
	if (event.content && event.content.trim()) {
		try {
			const authorPubkey = event.author?.hexpubkey || event.pubkey;

			// Check if NIP-07 extension is available
			if (typeof window !== 'undefined' && window.nostr?.nip04) {
				// Decrypt content (user decrypts their own mute list)
				const decrypted = await window.nostr.nip04.decrypt(authorPubkey, event.content);

				const privateData = JSON.parse(decrypted);

				// Merge private items (marked as private: true)
				if (privateData.pubkeys) {
					muteList.pubkeys.push(
						...privateData.pubkeys.map((p: MutedPubkey) => ({ ...p, private: true }))
					);
				}
				if (privateData.words) {
					muteList.words.push(
						...privateData.words.map((w: MutedWord) => ({ ...w, private: true }))
					);
				}
				if (privateData.tags) {
					muteList.tags.push(
						...privateData.tags.map((t: MutedTag) => ({ ...t, private: true }))
					);
				}
				if (privateData.threads) {
					muteList.threads.push(
						...privateData.threads.map((t: MutedThread) => ({ ...t, private: true }))
					);
				}
			}
		} catch (error) {
			console.warn('Failed to decrypt private mutes:', error);
			// Continue with public mutes only
		}
	}

	return muteList;
}

/**
 * Check if a pubkey is in the mute list
 */
export function isPubkeyMuted(muteList: MuteList, pubkey: string): boolean {
	return muteList.pubkeys.some((item) => item.value === pubkey);
}

/**
 * Check if content contains muted words
 */
export function containsMutedWord(muteList: MuteList, content: string): boolean {
	if (!content) return false;
	const lowerContent = content.toLowerCase();
	return muteList.words.some((item) => lowerContent.includes(item.value.toLowerCase()));
}

/**
 * Check if event has muted tags
 */
export function hasMutedTag(muteList: MuteList, eventTags: string[][]): boolean {
	const eventHashtags = eventTags
		.filter((tag) => tag[0] === 't')
		.map((tag) => tag[1]?.toLowerCase());

	return muteList.tags.some((item) => eventHashtags.includes(item.value.toLowerCase()));
}

/**
 * Check if thread is muted
 */
export function isThreadMuted(muteList: MuteList, eventId: string): boolean {
	return muteList.threads.some((item) => item.value === eventId);
}
