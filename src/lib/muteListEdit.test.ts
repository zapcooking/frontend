import { describe, it, expect, vi } from 'vitest';
import {
	addPubkeyMute,
	addEventMute,
	removePubkeyMute,
	removeEventMute,
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
	it('adds a private mute, keeping every public tag untouched', async () => {
		const before = existingList();
		const after = (await addPubkeyMute(before, C, fakeCrypto()))!;
		expect(after.tags).toEqual(before.tags);
		expect(await privateEntries(after)).toEqual([...privateTags, ['p', C]]);
	});

	it('does not mutate the input', async () => {
		const before = existingList();
		const snapshot = JSON.parse(JSON.stringify(before));
		await addPubkeyMute(before, C, fakeCrypto());
		expect(before).toEqual(snapshot);
	});

	it('is a no-op when the pubkey is already muted privately', async () => {
		expect(await addPubkeyMute(existingList(), B, fakeCrypto())).toBeNull();
	});

	it('converts an existing public mute to private', async () => {
		const before = existingList();
		const after = (await addPubkeyMute(before, A, fakeCrypto()))!;
		// the public tag goes away, the mute reappears in the private part
		expect(after.tags).toEqual(before.tags.filter((t) => t[1] !== A));
		expect(await privateEntries(after)).toEqual([...privateTags, ['p', A]]);
	});

	it('starts an encrypted list when there is none', async () => {
		const after = (await addPubkeyMute(null, C, fakeCrypto()))!;
		expect(after.tags).toEqual([]);
		expect(await privateEntries(after)).toEqual([['p', C]]);
	});

	it('keeps the legacy Mutable object format when that is what is there', async () => {
		const legacy = {
			pubkeys: [{ value: B }],
			words: [{ value: 'w' }],
			tags: [{ value: 't' }],
			threads: [{ value: 'e' }]
		};
		const before = { tags: [['word', 'x']], content: `enc:${btoa(JSON.stringify(legacy))}` };
		const after = (await addPubkeyMute(before, C, fakeCrypto()))!;
		expect(await privateEntries(after)).toEqual({
			...legacy,
			pubkeys: [{ value: B }, { value: C, private: true }]
		});
	});

	it('throws instead of clobbering private mutes when decryption fails', async () => {
		const crypto = fakeCrypto();
		crypto.decrypt.mockRejectedValueOnce(new Error('signer denied'));
		await expect(addPubkeyMute(existingList(), C, crypto)).rejects.toThrow('signer denied');
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
		const muted = (await addPubkeyMute(before, C, fakeCrypto()))!;
		const unmuted = (await removePubkeyMute(muted, C, fakeCrypto()))!;
		expect(unmuted).toEqual(before);
	});

	it('migrating a public mute then unmuting removes it entirely', async () => {
		const before = existingList();
		const migrated = (await addPubkeyMute(before, A, fakeCrypto()))!;
		const unmuted = (await removePubkeyMute(migrated, A, fakeCrypto()))!;
		expect(unmuted.tags).toEqual(before.tags.filter((t) => t[1] !== A));
		expect(await privateEntries(unmuted)).toEqual(privateTags);
	});
});

describe('withoutMuted (every recipe grid and feed row)', () => {
  const list = {
    pubkeys: [{ type: 'pubkey' as const, value: 'bad'.padEnd(64, '0'), private: false }],
    words: [{ type: 'word' as const, value: 'spam', private: false }],
    tags: [],
    threads: [{ type: 'thread' as const, value: 'thread1', private: false }]
  };
  const ev = (id: string, pubkey: string, content = 'hello', tags: string[][] = []) => ({ id, pubkey, content, tags });

  it('drops muted authors, words and threads, keeps the rest', async () => {
    const { withoutMuted } = await import('./muteFilter');
    const out = withoutMuted(list, [
      ev('a', 'bad'.padEnd(64, '0')),
      ev('b', 'ok'.padEnd(64, '0'), 'buy spam now'),
      ev('thread1', 'ok'.padEnd(64, '0')),
      ev('c', 'ok'.padEnd(64, '0'))
    ]);
    expect(out.map((e) => e.id)).toEqual(['c']);
  });

  it('with no list (signed out, not loaded) leaves everything', async () => {
    const { withoutMuted } = await import('./muteFilter');
    const events = [ev('a', 'bad'.padEnd(64, '0'))];
    expect(withoutMuted(null, events)).toBe(events);
  });

  it('drops privately muted entries the same as public ones', async () => {
    const { withoutMuted } = await import('./muteFilter');
    const privateList = {
      pubkeys: [{ type: 'pubkey' as const, value: 'bad'.padEnd(64, '0'), private: true }],
      words: [],
      tags: [],
      threads: [{ type: 'thread' as const, value: 'thread1', private: true }]
    };
    const out = withoutMuted(privateList, [
      ev('a', 'bad'.padEnd(64, '0')),
      ev('thread1', 'ok'.padEnd(64, '0')),
      ev('c', 'ok'.padEnd(64, '0'))
    ]);
    expect(out.map((e) => e.id)).toEqual(['c']);
  });
});

describe('event mutes (thread / note-and-replies)', () => {
	const EVENT = 'e'.repeat(64);

	it('adds a private e mute to an absent list', async () => {
		const edited = (await addEventMute(null, EVENT, fakeCrypto()))!;
		expect(edited.tags).toEqual([]);
		expect(await privateEntries(edited)).toEqual([['e', EVENT]]);
	});

	it('adds the private e mute without disturbing existing tags or private content', async () => {
		const before = existingList();
		const edited = (await addEventMute(before, EVENT, fakeCrypto()))!;
		// every original tag survives verbatim, in order
		expect(edited.tags).toEqual(before.tags);
		expect(await privateEntries(edited)).toEqual([...privateTags, ['e', EVENT]]);
	});

	it('is a no-op when the event is already muted privately', async () => {
		const priv = 'f'.repeat(64);
		expect(await addEventMute(existingList(), priv, fakeCrypto())).toBeNull();
	});

	it('converts a public e mute to private', async () => {
		const before = existingList();
		const edited = (await addEventMute(before, '1'.repeat(64), fakeCrypto()))!;
		expect(edited.tags).toEqual(before.tags.filter((t) => t[1] !== '1'.repeat(64)));
		expect(await privateEntries(edited)).toEqual([...privateTags, ['e', '1'.repeat(64)]]);
	});

	it('removes a public e mute and keeps private content byte-for-byte', async () => {
		const before = existingList();
		const removed = (await removeEventMute(before, '1'.repeat(64), fakeCrypto()))!;
		expect(removed.tags).toEqual(before.tags.filter((t) => t[1] !== '1'.repeat(64)));
		expect(removed.content).toBe(before.content);
	});

	it('removes a private e mute', async () => {
		const priv = 'f'.repeat(64);
		const before = existingList();
		const removed = (await removeEventMute(before, priv, fakeCrypto()))!;
		expect(removed.tags).toEqual(before.tags);
		expect(await privateEntries(removed)).toEqual(privateTags.filter((t) => t[1] !== priv));
	});

	it('returns null when the list does not mute the event', async () => {
		expect(await removeEventMute(null, EVENT, fakeCrypto())).toBeNull();
		expect(await removeEventMute(existingList(), EVENT, fakeCrypto())).toBeNull();
	});
});
