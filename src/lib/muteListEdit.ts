/**
 * Single-entry edits to a NIP-51 mute list (kind 10000) that keep every
 * other entry intact.
 *
 * Mutes added here are **private**: they go into the self-encrypted
 * content as an array of tag arrays — the private mute list MutABLE and
 * Lazarus both read — never into the publicly visible tags. A mute of
 * something that carries an existing *public* mute converts that tag to a
 * private entry, so a mute made from a post always ends up private; an
 * unmute removes from both parts.
 *
 * The edit works on the raw event, not on the parsed MuteList: tags the
 * edit doesn't touch (word / t / reasons / tag types we don't parse) are
 * copied verbatim. The encrypted content is decrypted for every private
 * edit — and if that decrypt or parse fails the edit throws, so the
 * caller never publishes a list that silently lost its private mutes.
 *
 * The legacy Mutable object format ({ pubkeys: [{ value }], words, … }) is
 * preserved when it is what's already there; new content is written in the
 * NIP-51 array format.
 */

export interface MuteListContent {
	tags: string[][];
	content: string;
}

export interface MuteListCrypto {
	decrypt(ciphertext: string): Promise<string>;
	encrypt(plaintext: string): Promise<string>;
}

const isTagFor = (type: string, value: string) => (tag: unknown) =>
	Array.isArray(tag) && tag[0] === type && tag[1] === value;

/** The legacy Mutable object's array field for a tag type. */
const legacyKeyFor = (type: 'p' | 'e'): 'pubkeys' | 'threads' =>
	type === 'p' ? 'pubkeys' : 'threads';

/**
 * The decrypted private part: NIP-51 tag arrays, or the legacy Mutable
 * object. Null for empty content. Throws when content exists but can't be
 * decrypted or parsed — the caller must not rewrite it.
 */
async function readPrivateContent(
	content: string,
	crypto: MuteListCrypto
): Promise<{ format: 'tags'; entries: unknown[] } | { format: 'legacy'; data: object } | null> {
	if (!content.trim()) return null;
	const parsed = JSON.parse(await crypto.decrypt(content));
	if (Array.isArray(parsed)) return { format: 'tags', entries: parsed };
	if (parsed && typeof parsed === 'object') return { format: 'legacy', data: parsed };
	throw new Error('Unrecognized private mute content');
}

function hasPrivateEntry(
	part: Awaited<ReturnType<typeof readPrivateContent>>,
	type: 'p' | 'e',
	value: string
): boolean {
	if (!part) return false;
	if (part.format === 'tags') return part.entries.some(isTagFor(type, value));
	const arr = (part.data as Record<string, unknown>)[legacyKeyFor(type)];
	return Array.isArray(arr) && arr.some((item) => (item as { value?: string })?.value === value);
}

/** Content with `type`/`value` appended, format preserved. */
async function appendPrivateEntry(
	part: Awaited<ReturnType<typeof readPrivateContent>>,
	type: 'p' | 'e',
	value: string,
	crypto: MuteListCrypto
): Promise<string> {
	if (!part) return crypto.encrypt(JSON.stringify([[type, value]]));
	if (part.format === 'tags') {
		return crypto.encrypt(JSON.stringify([...part.entries, [type, value]]));
	}
	const key = legacyKeyFor(type);
	const data = part.data as Record<string, unknown>;
	const arr = Array.isArray(data[key]) ? (data[key] as unknown[]) : [];
	return crypto.encrypt(JSON.stringify({ ...data, [key]: [...arr, { value, private: true }] }));
}

/**
 * Add a private mute of `type`/`value`. Returns null when it is already
 * muted privately; an existing public mute is converted to private.
 */
async function addEntry(
	existing: MuteListContent | null,
	type: 'p' | 'e',
	value: string,
	crypto: MuteListCrypto
): Promise<MuteListContent | null> {
	const tags = existing?.tags ?? [];
	const part = await readPrivateContent(existing?.content ?? '', crypto);
	if (hasPrivateEntry(part, type, value)) return null;

	const isTarget = isTagFor(type, value);
	const editedTags = tags.some(isTarget) ? tags.filter((t) => !isTarget(t)).map((t) => [...t]) : tags.map((t) => [...t]);
	const content = await appendPrivateEntry(part, type, value, crypto);
	return { tags: editedTags, content };
}

/**
 * Remove every mute of `type`/`value`, public and private. Returns null
 * when the list doesn't mute it at all (nothing to publish).
 */
async function removeEntry(
	existing: MuteListContent | null,
	type: 'p' | 'e',
	value: string,
	crypto: MuteListCrypto
): Promise<MuteListContent | null> {
	if (!existing) return null;

	const isTarget = isTagFor(type, value);
	const tags = existing.tags.filter((t) => !isTarget(t)).map((t) => [...t]);
	const removedPublic = tags.length !== existing.tags.length;

	let content = existing.content;
	let removedPrivate = false;
	const part = await readPrivateContent(existing.content, crypto);
	if (part) {
		if (part.format === 'tags') {
			const kept = part.entries.filter((t) => !isTarget(t));
			if (kept.length !== part.entries.length) {
				removedPrivate = true;
				content = await crypto.encrypt(JSON.stringify(kept));
			}
		} else {
			const key = legacyKeyFor(type);
			const arr = (part.data as Record<string, unknown>)[key];
			if (Array.isArray(arr)) {
				const kept = arr.filter((item) => (item as { value?: string })?.value !== value);
				if (kept.length !== arr.length) {
					removedPrivate = true;
					content = await crypto.encrypt(
						JSON.stringify({ ...(part.data as object), [key]: kept })
					);
				}
			}
		}
	}

	if (!removedPublic && !removedPrivate) return null;
	return { tags, content };
}

/**
 * Mute `hex` as a private entry (encrypted into content). Returns null
 * when the pubkey is already muted privately — nothing to publish.
 */
export function addPubkeyMute(
	existing: MuteListContent | null,
	hex: string,
	crypto: MuteListCrypto
): Promise<MuteListContent | null> {
	return addEntry(existing, 'p', hex, crypto);
}

/**
 * Remove every mute of `hex`, public and private. Returns null when the
 * list doesn't mute it at all (nothing to publish).
 */
export function removePubkeyMute(
	existing: MuteListContent | null,
	hex: string,
	crypto: MuteListCrypto
): Promise<MuteListContent | null> {
	return removeEntry(existing, 'p', hex, crypto);
}

/**
 * Mute `id` as a private event entry (a whole thread, or a note and its
 * direct replies). Returns null when it is already muted privately.
 */
export function addEventMute(
	existing: MuteListContent | null,
	id: string,
	crypto: MuteListCrypto
): Promise<MuteListContent | null> {
	return addEntry(existing, 'e', id, crypto);
}

/**
 * Remove every event mute of `id`, public and private. Returns null when
 * the list doesn't mute it (nothing to publish).
 */
export function removeEventMute(
	existing: MuteListContent | null,
	id: string,
	crypto: MuteListCrypto
): Promise<MuteListContent | null> {
	return removeEntry(existing, 'e', id, crypto);
}
