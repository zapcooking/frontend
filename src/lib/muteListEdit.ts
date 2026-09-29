/**
 * Single-pubkey edits to a NIP-51 mute list (kind 10000) that keep every
 * other entry intact.
 *
 * The edit works on the raw event, not on the parsed MuteList: tags the
 * edit doesn't touch (word / t / e / reasons / tag types we don't parse)
 * are copied verbatim, and the encrypted private part is passed through
 * byte-for-byte. It is only decrypted when un-muting a pubkey that is
 * muted privately — and if that decrypt fails the edit throws, so the
 * caller never publishes a list that silently lost its private mutes.
 */

export interface MuteListContent {
	tags: string[][];
	content: string;
}

export interface MuteListCrypto {
	decrypt(ciphertext: string): Promise<string>;
	encrypt(plaintext: string): Promise<string>;
}

const isPubkeyTag = (tag: string[], hex: string) => tag[0] === 'p' && tag[1] === hex;

/** Add `hex` as a public mute. Returns null when it is already muted publicly. */
export function addPubkeyMute(
	existing: MuteListContent | null,
	hex: string
): MuteListContent | null {
	const tags = existing?.tags ?? [];
	if (tags.some((t) => isPubkeyTag(t, hex))) return null;
	return {
		tags: [...tags.map((t) => [...t]), ['p', hex]],
		content: existing?.content ?? ''
	};
}

/**
 * Remove every mute of `hex`, public and private. Returns null when the
 * list doesn't mute it at all (nothing to publish).
 */
export async function removePubkeyMute(
	existing: MuteListContent | null,
	hex: string,
	crypto: MuteListCrypto
): Promise<MuteListContent | null> {
	if (!existing) return null;

	const tags = existing.tags.filter((t) => !isPubkeyTag(t, hex)).map((t) => [...t]);
	const removedPublic = tags.length !== existing.tags.length;

	let content = existing.content;
	let removedPrivate = false;
	if (content.trim()) {
		// Throws on failure — see the file comment.
		const plaintext = await crypto.decrypt(content);
		const data = JSON.parse(plaintext);
		if (Array.isArray(data)) {
			// NIP-51: an array of tag arrays.
			const kept = data.filter((t: unknown) => !(Array.isArray(t) && isPubkeyTag(t, hex)));
			if (kept.length !== data.length) {
				removedPrivate = true;
				content = await crypto.encrypt(JSON.stringify(kept));
			}
		} else if (data && Array.isArray(data.pubkeys)) {
			// Legacy Mutable object: { pubkeys: [{ value }], words, tags, threads }.
			const kept = data.pubkeys.filter((p: { value?: string }) => p?.value !== hex);
			if (kept.length !== data.pubkeys.length) {
				removedPrivate = true;
				content = await crypto.encrypt(JSON.stringify({ ...data, pubkeys: kept }));
			}
		}
	}

	if (!removedPublic && !removedPrivate) return null;
	return { tags, content };
}

/**
 * fetchMuteList() returns null both for "no list" and for a relay
 * failure. Before treating null as "no list" (and publishing a fresh
 * one-entry list over the real one), check whether the loaded MuteList
 * holds entries that can only have come from a relay copy: word / t / e
 * mutes, private mutes, or pubkeys the legacy localStorage list lacks.
 */
export function hasRelayOnlyEntries(
	list: {
		pubkeys: { value: string; private?: boolean }[];
		words: unknown[];
		tags: unknown[];
		threads: unknown[];
	} | null,
	localPubkeys: Iterable<string>
): boolean {
	if (!list) return false;
	if (list.words.length > 0 || list.tags.length > 0 || list.threads.length > 0) return true;
	const local = new Set(localPubkeys);
	return list.pubkeys.some((p) => p.private || !local.has(p.value));
}
