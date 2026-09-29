import { describe, it, expect, vi } from 'vitest';
import {
	addPubkeyMute,
	removePubkeyMute,
	type MuteListContent,
	type MuteListCrypto
} from './muteListEdit';

const A = 'a'.repeat(64); // publicly muted, with a reason
const B = 'b'.repeat(64); // privately muted
const C = 'c'.repeat(64); // not muted
const PRIV_PUBKEY = 'd'.repeat(64); // private-only, kept on every edit

// Reversible stand-in for NIP-44 self-encryption.
const fakeCrypto = (): MuteListCrypto & { decrypt: ReturnType<typeof vi.fn> } => ({
	decrypt: vi.fn(async (c: string) => atob(c.replace(/^enc:/, ''))),
	encrypt: vi.fn(async (p: string) => `enc:${btoa(p)}`)
});

const privateTags = [
	['p', B],
	['p', PRIV_PUBKEY, 'private reason'],
	['word', 'secretword'],
	['t', 'privatetag'],
	['e', 'f'.repeat(64)]
];

function existingList(): MuteListContent {
	return {
		tags: [
			['p', A, 'spam'],
			['word', 'crypto giveaway'],
			['t', 'nsfw'],
			['e', '1'.repeat(64)],
			['unknown-future-tag', 'kept as-is']
		],
		content: `enc:${btoa(JSON.stringify(privateTags))}`
	};
}

async function privateEntries(list: MuteListContent) {
	return JSON.parse(await fakeCrypto().decrypt(list.content));
}

describe('addPubkeyMute', () => {
	it('keeps every existing public entry and the private part byte-for-byte', () => {
		const before = existingList();
		const after = addPubkeyMute(before, C)!;
		expect(after.tags).toEqual([...before.tags, ['p', C]]);
		expect(after.content).toBe(before.content);
	});

	it('does not mutate the input', () => {
		const before = existingList();
		const snapshot = JSON.parse(JSON.stringify(before));
		addPubkeyMute(before, C);
		expect(before).toEqual(snapshot);
	});

	it('is a no-op when the pubkey is already muted publicly', () => {
		expect(addPubkeyMute(existingList(), A)).toBeNull();
	});

	it('starts a list when there is none', () => {
		expect(addPubkeyMute(null, C)).toEqual({ tags: [['p', C]], content: '' });
	});
});

describe('removePubkeyMute', () => {
	it('removes a public mute and keeps everything else, private part unchanged', async () => {
		const before = existingList();
		const after = (await removePubkeyMute(before, A, fakeCrypto()))!;
		expect(after.tags).toEqual(before.tags.filter((t) => t[1] !== A));
		expect(after.content).toBe(before.content);
	});

	it('removes a private mute and keeps every other private and public entry', async () => {
		const before = existingList();
		const after = (await removePubkeyMute(before, B, fakeCrypto()))!;
		expect(after.tags).toEqual(before.tags);
		expect(await privateEntries(after)).toEqual(privateTags.filter((t) => t[1] !== B));
	});

	it('handles the legacy Mutable object format', async () => {
		const legacy = {
			pubkeys: [{ value: B }, { value: PRIV_PUBKEY, reason: 'r' }],
			words: [{ value: 'w' }],
			tags: [{ value: 't' }],
			threads: [{ value: 'e' }]
		};
		const before = { tags: [['word', 'x']], content: `enc:${btoa(JSON.stringify(legacy))}` };
		const after = (await removePubkeyMute(before, B, fakeCrypto()))!;
		expect(after.tags).toEqual(before.tags);
		expect(await privateEntries(after)).toEqual({ ...legacy, pubkeys: [{ value: PRIV_PUBKEY, reason: 'r' }] });
	});

	it('returns null when the pubkey is not muted at all', async () => {
		expect(await removePubkeyMute(existingList(), C, fakeCrypto())).toBeNull();
		expect(await removePubkeyMute(null, C, fakeCrypto())).toBeNull();
	});

	it('throws instead of dropping private mutes when decryption fails', async () => {
		const crypto = fakeCrypto();
		crypto.decrypt.mockRejectedValueOnce(new Error('signer denied'));
		await expect(removePubkeyMute(existingList(), A, crypto)).rejects.toThrow('signer denied');
	});
});

describe('mute round-trip', () => {
	it('mute then unmute returns the original list exactly', async () => {
		const before = existingList();
		const muted = addPubkeyMute(before, C)!;
		const unmuted = (await removePubkeyMute(muted, C, fakeCrypto()))!;
		expect(unmuted).toEqual(before);
	});
});
