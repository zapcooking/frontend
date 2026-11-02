import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writable, get } from 'svelte/store';
/**
 * The optimistic half of a mute ($lib/muteToggle): the moment a member
 * mutes from a post, the post must vanish — before any relay answers —
 * and it must stay vanished across the store's reload until the relay
 * copy itself carries the mute.
 */
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/nostr', () => ({ userPublickey: writable('me'.padEnd(64, '0')) }));

const ME = 'me'.padEnd(64, '0');
const SPAMMER = 'f'.repeat(64);
const THREAD = 'e'.repeat(64);

// fetchMuteListWithStatus/parseMuteListEvent stand-ins: the "relay copy" each load sees.
let relayCopy: { pubkeys?: string[]; threads?: string[] } | null = null;
let fetchError: Error | null = null;
let parseError: Error | null = null;

vi.mock('$lib/mutableIntegration', () => ({
  fetchMuteListWithStatus: vi.fn(async () => {
    if (fetchError) return { status: 'unavailable' as const };
    return relayCopy
      ? { status: 'found' as const, event: { id: 'mute-event' } }
      : { status: 'absent' as const };
  }),
  parseMuteListEvent: vi.fn(async () => {
    if (parseError) throw parseError;
    return {
      pubkeys: (relayCopy?.pubkeys ?? []).map((value) => ({
        type: 'pubkey',
        value,
        private: true
      })),
      words: [],
      tags: [],
      threads: (relayCopy?.threads ?? []).map((value) => ({
        type: 'thread',
        value,
        private: true
      }))
    };
  })
}));

async function freshStore() {
  vi.resetModules();
  const { muteListStore } = await import('./muteListStore');
  return muteListStore;
}

beforeEach(() => {
  relayCopy = null;
  fetchError = null;
  parseError = null;
});

describe('applyLocalMute (the post on screen hides at once)', () => {
  it('hides a pubkey with no list loaded at all', async () => {
    const store = await freshStore();
    store.applyLocalMute({ pubkey: SPAMMER }, true);
    const { muteList } = get(store);
    expect(muteList?.pubkeys.map((p) => p.value)).toEqual([SPAMMER]);
    expect(muteList?.pubkeys[0].private).toBe(true);
  });

  it('unmuting removes the entry immediately', async () => {
    const store = await freshStore();
    store.applyLocalMute({ pubkey: SPAMMER }, true);
    store.applyLocalMute({ pubkey: SPAMMER }, false);
    expect(get(store).muteList?.pubkeys).toEqual([]);
  });

  it('hides a thread (mute note / mute thread)', async () => {
    const store = await freshStore();
    store.applyLocalMute({ eventId: THREAD }, true);
    expect(get(store).muteList?.threads.map((t) => t.value)).toEqual([THREAD]);
  });
});

describe('the local mute survives the post-publish reload', () => {
  it('a relay copy without the mute does not flash the content back', async () => {
    const store = await freshStore();
    store.applyLocalMute({ pubkey: SPAMMER }, true);
    await store.load(true);
    expect(get(store).muteList?.pubkeys.map((p) => p.value)).toEqual([SPAMMER]);
  });

  it('the same holds for a thread mute', async () => {
    const store = await freshStore();
    store.applyLocalMute({ eventId: THREAD }, true);
    await store.load(true);
    expect(get(store).muteList?.threads.map((t) => t.value)).toEqual([THREAD]);
  });

  it('once the relay copy confirms the mute, the entry appears exactly once', async () => {
    relayCopy = { pubkeys: [SPAMMER] };
    const store = await freshStore();
    store.applyLocalMute({ pubkey: SPAMMER }, true);
    await store.load(true);
    expect(get(store).muteList?.pubkeys.map((p) => p.value)).toEqual([SPAMMER]);
  });

  it('a failed load (no relays) keeps the local mute too', async () => {
    fetchError = new Error('no relays');
    const store = await freshStore();
    store.applyLocalMute({ pubkey: SPAMMER }, true);
    await store.load(true);
    expect(get(store).muteList?.pubkeys.map((p) => p.value)).toEqual([SPAMMER]);
  });

  it('unmuting removes the entry at once, even before the relays agree', async () => {
    relayCopy = { pubkeys: [SPAMMER] };
    const store = await freshStore();
    await store.load(true);
    expect(get(store).muteList?.pubkeys.map((p) => p.value)).toEqual([SPAMMER]);
    store.applyLocalMute({ pubkey: SPAMMER }, false);
    expect(get(store).muteList?.pubkeys).toEqual([]);
    // The relay copy still carrying the mute is the authority on the next
    // load: an unmute that never reached the relays un-hides locally but
    // comes back with the copy that says otherwise.
    await store.load(true);
    expect(get(store).muteList?.pubkeys.map((p) => p.value)).toEqual([SPAMMER]);
  });
});

describe('unreliable loads are not cached as "no mutes"', () => {
  it('an unavailable relay answer retries on the next load()', async () => {
    // First load: no relay answers — the member's mutes would be missing
    // from the store. This must not be remembered as a valid empty list.
    fetchError = new Error('no relays answered');
    const store = await freshStore();
    await store.load(true);
    expect(get(store).muteList?.pubkeys).toEqual([]);
    expect(get(store).lastFetched).toBeNull();

    // The pool comes up; an unforced load must ask the relays again.
    fetchError = null;
    relayCopy = { pubkeys: [SPAMMER] };
    await store.load();
    expect(get(store).muteList?.pubkeys.map((p) => p.value)).toEqual([SPAMMER]);
  });

  it('a confirmed absence is cached like an empty list', async () => {
    const store = await freshStore();
    await store.load(true);
    expect(get(store).lastFetched).not.toBeNull();
  });

  it('a thrown parse error also leaves the store retryable', async () => {
    relayCopy = { pubkeys: [] }; // a found event whose parse then fails
    parseError = new Error('bad list');
    const store = await freshStore();
    await store.load(true);
    expect(get(store).lastFetched).toBeNull();
    parseError = null;
    relayCopy = { pubkeys: [SPAMMER] };
    await store.load();
    expect(get(store).muteList?.pubkeys.map((p) => p.value)).toEqual([SPAMMER]);
  });
});
