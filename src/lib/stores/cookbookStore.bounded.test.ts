import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import NDK, {
  NDKNip07Signer,
  NDKNip46Signer,
  NDKPrivateKeySigner,
  NDKRelay,
  NDKRelaySet
} from '@nostr-dev-kit/ndk';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils.js';

/**
 * A list edit always ends — saved, or a refusal the member sees — within a
 * known bound, however slow or silent a relay or signer is. Unlike
 * cookbookStore.customList.test.ts, these run the REAL per-relay read
 * (createRelayQuery: its timeout and EOSE handling) and the REAL NDK publish
 * (per-relay OK timeout). Only the sockets are fake: a fake nostr-tools Relay
 * module for reads, and NDKRelay connectivity for publishes.
 *
 * Bounds (savedListSafety / savedList): 5 s per read phase (relay-list cache,
 * discovery, list read), 8 s OK wait, 30 s extension, 60 s bunker.
 */

const NOS = 'wss://nos.lol';
const PRIMAL = 'wss://relay.primal.net';
const NET = 'wss://relay.nostr.net';
const D = 'weeknight-dinners';
const R = (d: string) => `30023:${'c'.repeat(64)}:${d}`;

type ReadMode = 'answer' | 'held' | 'noconnect';
const net = vi.hoisted(() => ({
  read: {} as Record<string, 'answer' | 'held' | 'noconnect'>,
  /** The relays' copy of each list (by d tag); a stored publish lands here. */
  lists: {} as Record<string, unknown>,
  /** OK after this many ms (null = never); `stores` = the relays keep the event. */
  publish: { okAfterMs: 0 as number | null, stores: true },
  cache: 'answer' as 'answer' | 'held'
}));

/** The fake socket layer for the real read (createRelayQuery). */
const relayModule = {
  Relay: {
    connect: (url: string) => {
      const mode: ReadMode = net.read[url] ?? 'answer';
      if (mode === 'noconnect') return new Promise(() => {});
      return Promise.resolve({
        close: () => {},
        subscribe: (
          filters: { kinds?: number[]; '#d'?: string[] }[],
          h: { onevent: (e: unknown) => void; oneose: () => void }
        ) => {
          if (mode === 'held') return;
          const f = filters[0];
          const found = f.kinds?.[0] === 30001 ? net.lists[f['#d']?.[0] ?? ''] : null;
          queueMicrotask(() => {
            if (found) h.onevent(found);
            h.oneose();
          });
        }
      });
    }
  }
};

vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return {
    ndk: writable<unknown>(null),
    userPublickey: writable(''),
    ensureNdkConnected: vi.fn(async () => {}),
    getCurrentRelays: () => [NOS, PRIMAL]
  };
});
vi.mock('$lib/nip65Routing', () => ({
  listRelayUrls: vi.fn(async () => [NOS, PRIMAL, NET]),
  listRelayUrlsFrom: vi.fn(async () => [NOS, PRIMAL, NET]),
  getOwnWriteRelays: vi.fn(async () => []),
  listRelaySet: vi.fn(async () => undefined),
  // Real NDKRelays whose socket is faked, so NDK's own per-relay OK timeout runs.
  relaySetForUrls: vi.fn(async (ndk: NDK, urls: string[]) => {
    const relays = urls.map((u) => {
      const r = new NDKRelay(u, undefined, ndk);
      const c = r.connectivity as unknown as {
        status: number;
        publish: (e: { tags: string[][] }) => Promise<string>;
      };
      Object.defineProperty(c, 'status', { get: () => 5 }); // CONNECTED
      c.publish = (raw) => {
        if (net.publish.stores) net.lists[raw.tags.find((t) => t[0] === 'd')![1]] = raw;
        const ms = net.publish.okAfterMs;
        return ms === null ? new Promise(() => {}) : new Promise((res) => setTimeout(() => res(''), ms));
      };
      return r;
    });
    return new NDKRelaySet(new Set(relays), ndk);
  }),
  outboxRelaySet: vi.fn(async () => undefined)
}));
vi.mock('$lib/relayListCache', () => ({
  relayListCache: {
    get: vi.fn(() =>
      net.cache === 'held' ? new Promise(() => {}) : Promise.resolve({ read: [], write: [] })
    )
  }
}));
vi.mock('$lib/connectionMonitor', () => ({
  isCurrentlyOnline: vi.fn(() => true),
  onConnect: vi.fn(() => () => {})
}));
vi.mock('$lib/offlineStorage', () => ({
  offlineStorage: {
    getAllCookbooks: vi.fn(async () => []),
    saveCookbook: vi.fn(async () => {}),
    getPendingOperations: vi.fn(async () => []),
    markCookbookSynced: vi.fn(async () => {}),
    queueOperation: vi.fn(async () => {}),
    removeOperation: vi.fn(async () => {}),
    updateOperationRetry: vi.fn(async () => {}),
    clearFailedOperations: vi.fn(async () => {}),
    getQueueStatus: vi.fn(async () => ({ pending: 0, failed: 0 }))
  }
}));

import { ndk, userPublickey } from '$lib/nostr';
import { createRelayQuery } from '$lib/savedList';
import {
  cookbookStore,
  LIST_SAVE_UNCONFIRMED_MESSAGE,
  LIST_UNCONFIRMED_MESSAGE,
  SIGNER_TIMEOUT_MESSAGE,
  type SavedListResult
} from './cookbookStore';

// The edit loads these with import(); load them first so the fake clock
// measures the edit's own timers, not module loading.
await import('$lib/followSafety');
await import('$lib/nip89');

let SK = '';
let PUBKEY = '';
let ndkInstance: NDK;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-10-23T12:00:00Z'));
  const sk = generateSecretKey();
  SK = bytesToHex(sk);
  PUBKEY = getPublicKey(sk);
  ndkInstance = new NDK({ explicitRelayUrls: [] });
  ndkInstance.signer = new NDKPrivateKeySigner(SK);
  cookbookStore.reset();
  ndk.set(ndkInstance as never);
  userPublickey.set(PUBKEY);
  net.read = {};
  net.lists = {
    [D]: {
      id: 'ev-1000',
      pubkey: PUBKEY,
      kind: 30001,
      created_at: 1000,
      tags: [['d', D], ['title', 'Weeknight dinners'], ['a', R('r1')]],
      content: ''
    }
  };
  net.publish = { okAfterMs: 0, stores: true };
  net.cache = 'answer';
  cookbookStore.__setSavedListQueryForTests(createRelayQuery(async () => relayModule as never));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Advance the fake clock in 10 ms steps until `p` settles or `limitMs` passes (null = never ended). */
async function timed<T>(p: Promise<T>, limitMs = 180_000): Promise<{ ms: number; value: T } | null> {
  const t0 = Date.now();
  let settled: { value: T } | null = null;
  p.then((value) => (settled = { value }));
  while (!settled && Date.now() - t0 < limitMs) await vi.advanceTimersByTimeAsync(10);
  const done = settled as { value: T } | null;
  return done ? { ms: Date.now() - t0, value: done.value } : null;
}

/** It ended within `boundMs`: saved, or refused with a message the member sees. */
function endedWithin(r: { ms: number; value: SavedListResult } | null, boundMs: number): SavedListResult {
  expect(r, 'the edit never ended').not.toBeNull();
  expect(r!.ms).toBeLessThanOrEqual(boundMs);
  if (!r!.value.ok) expect(r!.value.message.length).toBeGreaterThan(0);
  return r!.value;
}

const edit = () => cookbookStore.editList(D, { add: [R('r2')] });

/** A remote signer of `kind` that never answers. */
function silentSigner(kind: typeof NDKNip07Signer | typeof NDKNip46Signer) {
  const s = Object.create(kind.prototype) as {
    user: () => Promise<{ pubkey: string }>;
    sign: () => Promise<string>;
  };
  s.user = async () => ({ pubkey: PUBKEY });
  s.sign = () => new Promise(() => {});
  return s;
}

describe('every held case ends in success or a visible refusal, within its bound', () => {
  it('nothing held: saved at once', async () => {
    expect(endedWithin(await timed(edit()), 100)).toMatchObject({ ok: true, changed: true });
  });

  it('two relays hold the read (connected, no EOSE): refused at the 5 s read timeout', async () => {
    net.read = { [NOS]: 'held', [PRIMAL]: 'held' };
    expect(endedWithin(await timed(edit()), 5_100)).toEqual({ ok: false, message: LIST_UNCONFIRMED_MESSAGE });
  });

  it('two relays never connect: refused at the 5 s read timeout', async () => {
    net.read = { [NOS]: 'noconnect', [PRIMAL]: 'noconnect' };
    expect(endedWithin(await timed(edit()), 5_100)).toEqual({ ok: false, message: LIST_UNCONFIRMED_MESSAGE });
  });

  it('relay-list cache and discovery relays hold: refused after two 5 s phases', async () => {
    net.cache = 'held';
    net.read = { [NOS]: 'held', [PRIMAL]: 'held', 'wss://purplepag.es': 'held' };
    expect(endedWithin(await timed(edit()), 10_100)).toEqual({ ok: false, message: LIST_UNCONFIRMED_MESSAGE });
  });

  it('OKs after 2.6 s (past NDK’s old 2.5 s default): saved', async () => {
    net.publish = { okAfterMs: 2_600, stores: true };
    expect(endedWithin(await timed(edit()), 2_700)).toMatchObject({ ok: true, changed: true });
  });

  it('no OK within 8 s, but the relays stored it: the confirmation read finds it — saved', async () => {
    net.publish = { okAfterMs: null, stores: true };
    expect(endedWithin(await timed(edit()), 8_100)).toMatchObject({ ok: true, changed: true });
  });

  it('no OK within 8 s and nothing stored: "Couldn’t confirm the save", with Refresh', async () => {
    net.publish = { okAfterMs: null, stores: false };
    expect(endedWithin(await timed(edit()), 8_100)).toEqual({
      ok: false,
      uncertain: true,
      message: LIST_SAVE_UNCONFIRMED_MESSAGE
    });
  });

  it('no OK, and the confirmation read is held too: unconfirmed after 8 s + 5 s', async () => {
    net.publish = { okAfterMs: null, stores: false };
    const p = edit();
    // The read before the publish answers; once the event is out, the relays go quiet.
    await vi.advanceTimersByTimeAsync(1_000);
    net.read = { [NOS]: 'held', [PRIMAL]: 'held', [NET]: 'held' };
    expect(endedWithin(await timed(p), 12_100)).toMatchObject({ ok: false, uncertain: true });
  });

  it('an extension that never answers: refused at 30 s, and the next edit is not stuck', async () => {
    ndkInstance.signer = silentSigner(NDKNip07Signer) as never;
    expect(endedWithin(await timed(edit()), 30_100)).toEqual({ ok: false, message: SIGNER_TIMEOUT_MESSAGE });
    ndkInstance.signer = new NDKPrivateKeySigner(SK);
    expect(endedWithin(await timed(edit()), 100)).toMatchObject({ ok: true, changed: true });
  });

  it('a bunker that never answers: refused at 60 s', async () => {
    ndkInstance.signer = silentSigner(NDKNip46Signer) as never;
    expect(endedWithin(await timed(edit()), 60_100)).toEqual({ ok: false, message: SIGNER_TIMEOUT_MESSAGE });
  });
});
