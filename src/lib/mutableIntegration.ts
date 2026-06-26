import { NDKEvent } from '@nostr-dev-kit/ndk';
import { get } from 'svelte/store';
import { ndk } from '$lib/nostr';
import { encrypt, decrypt, detectEncryptionMethod } from '$lib/encryptionService';

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

	// Parse private mutes from encrypted content
	// Try NIP-44 first (used by Wisp/zap.cooking Android), fall back to NIP-04 (legacy)
	if (event.content && event.content.trim()) {
		try {
			const authorPubkey = event.author?.hexpubkey || event.pubkey;
			let decrypted: string | null = null;

			try {
				const method = detectEncryptionMethod(event.content);
				decrypted = await decrypt(authorPubkey, event.content, method);
			} catch {
				// decrypt() handles all signer types; failure means key unavailable or denied
			}

			if (decrypted) {
				const privateData = JSON.parse(decrypted);

				if (Array.isArray(privateData)) {
					// NIP-51 standard: array of tag arrays [["p","hex"],["word","bad"],...]
					for (const tag of privateData) {
						if (!Array.isArray(tag) || tag.length < 2) continue;
						const [tagType, value, reason] = tag;
						switch (tagType) {
							case 'p':
								muteList.pubkeys.push({ type: 'pubkey', value, reason, private: true });
								break;
							case 'word':
								muteList.words.push({ type: 'word', value, reason, private: true });
								break;
							case 't':
								muteList.tags.push({ type: 'tag', value, reason, private: true });
								break;
							case 'e':
								muteList.threads.push({ type: 'thread', value, reason, private: true });
								break;
						}
					}
				} else {
					// Legacy Mutable object format: {pubkeys:[...], words:[...], ...}
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

/**
 * Publish an updated mute list (kind:10000).
 * Public items go into plaintext tags; private items are encrypted into .content
 * using NIP-44 (preferred) or NIP-04 (fallback) — self-encrypted to the author's pubkey.
 */
export async function publishMuteList(muteList: MuteList, authorPubkey: string): Promise<void> {
	const ndkInstance = get(ndk);
	if (!ndkInstance) throw new Error('NDK not ready');

	const publicItems = {
		pubkeys: muteList.pubkeys.filter((i) => !i.private),
		words: muteList.words.filter((i) => !i.private),
		tags: muteList.tags.filter((i) => !i.private),
		threads: muteList.threads.filter((i) => !i.private)
	};
	const privateItems = {
		pubkeys: muteList.pubkeys.filter((i) => i.private),
		words: muteList.words.filter((i) => i.private),
		tags: muteList.tags.filter((i) => i.private),
		threads: muteList.threads.filter((i) => i.private)
	};

	const tags: string[][] = [];
	for (const item of publicItems.pubkeys) tags.push(item.reason ? ['p', item.value, item.reason] : ['p', item.value]);
	for (const item of publicItems.words) tags.push(item.reason ? ['word', item.value, item.reason] : ['word', item.value]);
	for (const item of publicItems.tags) tags.push(item.reason ? ['t', item.value, item.reason] : ['t', item.value]);
	for (const item of publicItems.threads) tags.push(item.reason ? ['e', item.value, item.reason] : ['e', item.value]);

	let content = '';
	const hasPrivate =
		privateItems.pubkeys.length > 0 ||
		privateItems.words.length > 0 ||
		privateItems.tags.length > 0 ||
		privateItems.threads.length > 0;

	if (hasPrivate) {
		// NIP-51: encrypt as array of tag arrays, not an object
		const privateTags: string[][] = [];
		for (const item of privateItems.pubkeys) privateTags.push(item.reason ? ['p', item.value, item.reason] : ['p', item.value]);
		for (const item of privateItems.words) privateTags.push(item.reason ? ['word', item.value, item.reason] : ['word', item.value]);
		for (const item of privateItems.tags) privateTags.push(item.reason ? ['t', item.value, item.reason] : ['t', item.value]);
		for (const item of privateItems.threads) privateTags.push(item.reason ? ['e', item.value, item.reason] : ['e', item.value]);
		const plaintext = JSON.stringify(privateTags);
		const { ciphertext } = await encrypt(authorPubkey, plaintext);
		content = ciphertext;
	}

	const event = new NDKEvent(ndkInstance);
	event.kind = 10000;
	event.tags = tags;
	event.content = content;
	await event.publish();
}
