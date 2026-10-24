import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

/**
 * Engagement batching — externally observable behaviour of the per-note
 * event queue: counts, loading state, cache persistence and lifecycle.
 * Store updates and cache writes are counted through a store subscriber
 * and a localStorage spy; relays are a mocked NDK subscription; time is
 * fake so the ~250ms flush and the 5s/10s completion timeouts are driven
 * explicitly.
 */

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('@nostr-dev-kit/ndk', () => ({
  default: class NDK {},
  NDKRelaySet: { fromRelayUrls: () => ({}) }
}));
const countQuery = vi.hoisted(() => ({
  pending: null as null | { resolve: (v: unknown) => void },
  getEngagementCounts: vi.fn(
    () =>
      new Promise((resolve) => {
        countQuery.pending = { resolve };
      })
  ),
  batchFetchFromServerAPI: vi.fn(async () => new Map())
}));
vi.mock('./countQuery', () => ({
  getEngagementCounts: countQuery.getEngagementCounts,
  batchFetchFromServerAPI: countQuery.batchFetchFromServerAPI
}));

import {
  fetchEngagement,
  batchFetchEngagement,
  getEngagementStore,
  cleanupEngagement,
  clearAllEngagementCaches,
  getEngagementStats,
  trackOptimisticReaction,
  trackOptimisticRepost,
  optimisticZapUpdate,
  type EngagementData
} from './engagementCache';

// ── localStorage stub whose entries are enumerable own properties, so
// clearAllEngagementCaches' Object.keys(localStorage) scan works.
const writes: Array<{ key: string; value: string; at: number }> = [];
function makeStorage() {
  const store: Record<string, string> = {};
  const define = (name: string, fn: (...a: string[]) => unknown) =>
    Object.defineProperty(store, name, { value: fn, enumerable: false, writable: true });
  define('getItem', (k) => (k in store ? store[k] : null));
  define('setItem', (k, v) => {
    store[k] = String(v);
    writes.push({ key: k, value: String(v), at: Date.now() });
  });
  define('removeItem', (k) => {
    delete store[k];
  });
  define('clear', () => {
    for (const k of Object.keys(store)) delete store[k];
  });
  return store;
}
const cacheWrites = (id: string) => writes.filter((w) => w.key === `engagement_${id}`);
const persisted = (id: string) => {
  const w = cacheWrites(id);
  return w.length ? (JSON.parse(w[w.length - 1].value) as {
    reactions: { count: number; groups: Array<{ emoji: string; count: number }> };
    comments: number;
    reposts: number;
    zaps: { amount: number; count: number };
    timestamp: number;
  }) : null;
};

// ── mocked NDK subscriptions
type Handler = (...args: unknown[]) => void;
function makeSub() {
  const handlers = new Map<string, Handler[]>();
  return {
    on(name: string, cb: Handler) {
      handlers.set(name, [...(handlers.get(name) ?? []), cb]);
    },
    emit(name: string, ...args: unknown[]) {
      for (const cb of handlers.get(name) ?? []) cb(...args);
    },
    stop: vi.fn()
  };
}
type FakeSub = ReturnType<typeof makeSub>;
let subs: FakeSub[] = [];
const ndk = {
  pool: { getRelay: () => ({ connectivity: { status: 1 }, connect: async () => {} }) },
  explicitRelayUrls: [] as string[],
  subscribe: vi.fn((filter: unknown, opts: unknown) => {
    const s = makeSub();
    (s as FakeSub & { filter: unknown; opts: unknown }).filter = filter;
    (s as FakeSub & { filter: unknown; opts: unknown }).opts = opts;
    subs.push(s);
    return s;
  })
} as never;

// ── event factories (NDKEvent-shaped plain objects)
const USER = 'user-pubkey';
let seq = 0;
const nextId = (p = 'ev') => `${p}-${++seq}`;
const reaction = (target: string, pubkey: string, content = '+', id = nextId('r')) => ({
  id, kind: 7, pubkey, content, created_at: 1_700_000_000, tags: [['e', target], ['p', 'author']]
});
const repost = (target: string, pubkey: string, id = nextId('rp')) => ({
  id, kind: 6, pubkey, content: '', created_at: 1_700_000_000, tags: [['e', target]]
});
const comment = (target: string, pubkey: string, id = nextId('c')) => ({
  id, kind: 1, pubkey, content: 'nice', created_at: 1_700_000_000, tags: [['e', target]]
});
const zap = (target: string, zapper: string, sats: number, id = nextId('z')) => ({
  id, kind: 9735, pubkey: 'lnurl-service', content: '', created_at: 1_700_000_000,
  tags: [
    ['e', target],
    ['description', JSON.stringify({ pubkey: zapper, content: 'zap!', tags: [['amount', String(sats * 1000)]] })]
  ]
});

// ── store observation
function observe(id: string) {
  const store = getEngagementStore(id);
  let updates = -1; // subscribe() fires once immediately
  const unsub = store.subscribe(() => updates++);
  return {
    get updates() {
      return updates;
    },
    get data(): EngagementData {
      return get(store);
    },
    unsub
  };
}

const emitAll = (sub: FakeSub, events: object[]) => events.forEach((e) => sub.emit('event', e));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-05T12:00:00Z'));
  vi.stubGlobal('localStorage', makeStorage());
  writes.length = 0;
  subs = [];
  seq = 0;
  countQuery.pending = null;
  clearAllEngagementCaches();
  writes.length = 0;
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  clearAllEngagementCaches();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('single-note subscription (fetchEngagement)', () => {
  it('a burst of 100 unique events plus duplicate deliveries: one periodic update/write, one completion update/write', async () => {
    const id = 'note-a';
    const obs = observe(id);
    await fetchEngagement(ndk, id, USER);
    expect(subs).toHaveLength(1);
    const sub = subs[0];
    const updatesBefore = obs.updates;
    writes.length = 0;

    const burst = Array.from({ length: 100 }, (_, i) => reaction(id, `pk-${i}`, '+'));
    emitAll(sub, burst);
    emitAll(sub, burst.slice(0, 20)); // relay re-delivers the same ids
    // same users, same emoji, new ids: reaction-pair dedup
    emitAll(sub, Array.from({ length: 5 }, (_, i) => reaction(id, `pk-${i}`, '+')));

    // Nothing applied synchronously; the UI is not re-rendered per event.
    expect(obs.updates - updatesBefore).toBe(0);
    expect(obs.data.reactions.count).toBe(0);
    expect(cacheWrites(id)).toHaveLength(0);

    vi.advanceTimersByTime(250);
    expect(obs.updates - updatesBefore).toBe(1);
    expect(cacheWrites(id)).toHaveLength(1);
    expect(obs.data.reactions.count).toBe(100);
    expect(obs.data.reactions.groups).toEqual([{ emoji: '❤️', count: 100, userReacted: false }]);
    expect(obs.data.loading).toBe(true);

    vi.advanceTimersByTime(100);
    sub.emit('eose');
    expect(obs.updates - updatesBefore).toBe(2);
    expect(cacheWrites(id)).toHaveLength(2);
    expect(obs.data.loading).toBe(false);
    expect(obs.data.lastFetched).toBe(Date.now());
    const saved = persisted(id)!;
    expect(saved.reactions.count).toBe(100);
    expect(saved.timestamp).toBe(Date.now());
    expect(saved.timestamp).toBeGreaterThan(cacheWrites(id)[0].at);

    // The persistent subscription stays open after EOSE.
    expect(sub.stop).not.toHaveBeenCalled();
    expect(getEngagementStats().persistentSubscriptionCount).toBe(1);
    obs.unsub();
  });

  it('EOSE before the periodic flush: correct final counts with exactly one update and one write', async () => {
    const id = 'note-b';
    const obs = observe(id);
    await fetchEngagement(ndk, id, USER);
    const sub = subs[0];
    const before = obs.updates;
    writes.length = 0;

    emitAll(sub, Array.from({ length: 100 }, (_, i) => reaction(id, `pk-${i}`, i % 2 ? '🔥' : '+')));
    sub.emit('eose');

    expect(obs.updates - before).toBe(1);
    expect(cacheWrites(id)).toHaveLength(1);
    expect(obs.data.reactions.count).toBe(100);
    expect(obs.data.loading).toBe(false);
    expect(persisted(id)!.reactions.count).toBe(100);

    // The queue is empty: the timer tick must not update or write again.
    vi.advanceTimersByTime(1000);
    expect(obs.updates - before).toBe(1);
    expect(cacheWrites(id)).toHaveLength(1);
    obs.unsub();
  });

  it('mixed reactions, reposts, comments and zap receipts are counted correctly', async () => {
    const id = 'note-c';
    const obs = observe(id);
    await fetchEngagement(ndk, id, USER);
    const sub = subs[0];

    emitAll(sub, [
      reaction(id, 'p1', '+'),
      reaction(id, 'p2', '🔥'),
      reaction(id, 'p2', '🔥'), // same user + emoji, new id → pair dedup
      reaction(id, 'p3', ':custom:'), // unrenderable shortcode → skipped
      repost(id, 'p1'),
      repost(id, 'p4'),
      comment(id, 'p5'),
      comment('some-other-note', 'p6'), // not a reply to this note
      zap(id, 'p7', 21),
      zap(id, 'p8', 100),
      zap(id, 'p7', 9) // same zapper again → aggregated
    ]);
    sub.emit('eose');

    const d = obs.data;
    expect(d.reactions.count).toBe(2);
    expect(d.reactions.groups.map((g) => [g.emoji, g.count])).toEqual([['❤️', 1], ['🔥', 1]]);
    expect(d.reposts.count).toBe(2);
    expect(d.comments.count).toBe(1);
    expect(d.zaps.count).toBe(3);
    expect(d.zaps.totalAmount).toBe(130_000); // millisats
    expect(d.zaps.topZappers.map((z) => [z.pubkey, z.amount])).toEqual([['p8', 100], ['p7', 30]]);
    const saved = persisted(id)!;
    expect([saved.reactions.count, saved.reposts, saved.comments, saved.zaps.count, saved.zaps.amount]).toEqual([
      2, 2, 1, 3, 130_000
    ]);
    obs.unsub();
  });

  it('optimistic reaction/repost/zap are reconciled when the relay echoes them back', async () => {
    const id = 'note-d';
    const obs = observe(id);
    await fetchEngagement(ndk, id, USER);
    const sub = subs[0];
    const before = obs.updates;

    // Optimistic zap updates the UI immediately (not queued) and persists.
    optimisticZapUpdate(id, 21_000, USER, 'great');
    expect(obs.updates - before).toBe(1);
    expect(obs.data.zaps).toMatchObject({ count: 1, totalAmount: 21_000, userZapped: true });
    expect(persisted(id)!.zaps.count).toBe(1);

    trackOptimisticReaction(id, '❤️', USER);
    trackOptimisticRepost(id, USER);

    emitAll(sub, [
      reaction(id, USER, '+'), // echo of our optimistic reaction → not counted
      repost(id, USER), // echo of our optimistic repost → not counted
      zap(id, USER, 21), // real receipt for the optimistic zap → replaces, no double count
      reaction(id, 'other', '+'),
      zap(id, 'other', 5)
    ]);
    sub.emit('eose');

    const d = obs.data;
    expect(d.reactions.count).toBe(1);
    expect(d.reposts.count).toBe(0);
    expect(d.zaps.count).toBe(2);
    expect(d.zaps.totalAmount).toBe(26_000);
    expect(d.zaps.userZapped).toBe(true);
    expect(persisted(id)!.zaps).toMatchObject({ count: 2, amount: 26_000 });
    obs.unsub();
  });

  it('timeout without EOSE after the queue was already flushed still finalizes and persists once', async () => {
    const id = 'note-e';
    const obs = observe(id);
    await fetchEngagement(ndk, id, USER);
    const sub = subs[0];
    const before = obs.updates;
    writes.length = 0;

    emitAll(sub, [reaction(id, 'p1'), comment(id, 'p2'), zap(id, 'p3', 10)]);
    vi.advanceTimersByTime(250); // periodic flush empties the queue
    expect(obs.updates - before).toBe(1);
    expect(cacheWrites(id)).toHaveLength(1);
    const periodicTs = persisted(id)!.timestamp;
    expect(obs.data.loading).toBe(true);

    vi.advanceTimersByTime(5000 - 250); // subscription timeout, no EOSE
    expect(obs.updates - before).toBe(2);
    expect(cacheWrites(id)).toHaveLength(2);
    const d = obs.data;
    expect(d.loading).toBe(false);
    expect(d.lastFetched).toBe(Date.now());
    const saved = persisted(id)!;
    expect(saved.timestamp).toBeGreaterThan(periodicTs);
    expect(saved.timestamp).toBe(Date.now());
    expect([saved.reactions.count, saved.comments, saved.zaps.count]).toEqual([
      d.reactions.count, d.comments.count, d.zaps.count
    ]);

    // Late EOSE after the timeout: no second finalization.
    sub.emit('eose');
    vi.advanceTimersByTime(1000);
    expect(obs.updates - before).toBe(2);
    expect(cacheWrites(id)).toHaveLength(2);
    obs.unsub();
  });

  it('EOSE cancels the timeout fallback so it cannot finalize a second time', async () => {
    const id = 'note-f';
    const obs = observe(id);
    await fetchEngagement(ndk, id, USER);
    const before = obs.updates;
    writes.length = 0;
    subs[0].emit('eose');
    expect(obs.updates - before).toBe(1);
    vi.advanceTimersByTime(10_000);
    expect(obs.updates - before).toBe(1);
    expect(cacheWrites(id)).toHaveLength(1);
    obs.unsub();
  });

  it('realtime arrivals after completion are applied on the next flush and persisted', async () => {
    const id = 'note-g';
    const obs = observe(id);
    await fetchEngagement(ndk, id, USER);
    const sub = subs[0];
    sub.emit('eose');
    const before = obs.updates;
    writes.length = 0;

    sub.emit('event', zap(id, 'late', 42));
    sub.emit('event', reaction(id, 'late', '+'));
    expect(obs.updates - before).toBe(0);
    vi.advanceTimersByTime(250);
    expect(obs.updates - before).toBe(1);
    expect(cacheWrites(id)).toHaveLength(1);
    expect(obs.data.zaps).toMatchObject({ count: 1, totalAmount: 42_000 });
    expect(obs.data.reactions.count).toBe(1);
    expect(obs.data.loading).toBe(false);
    expect(persisted(id)!.zaps.amount).toBe(42_000);
    obs.unsub();
  });

  it('NIP-45 counts that arrive while the subscription is still counting are ignored', async () => {
    const id = 'note-h';
    const obs = observe(id);
    await fetchEngagement(ndk, id, USER);
    const sub = subs[0];
    emitAll(sub, [reaction(id, 'p1'), reaction(id, 'p2')]);
    vi.advanceTimersByTime(250);
    expect(obs.data.reactions.count).toBe(2);

    countQuery.pending!.resolve({ reactions: 999, comments: 999, reposts: 999, zaps: 999 });
    await vi.advanceTimersByTimeAsync(0);
    expect(obs.data.reactions.count).toBe(2);
    expect(obs.data.comments.count).toBe(0);
    obs.unsub();
  });
});

describe('batch subscription (batchFetchEngagement)', () => {
  it('a burst across two notes: one completion update and write per note at EOSE', async () => {
    const a = 'batch-a';
    const b = 'batch-b';
    const oa = observe(a);
    const ob = observe(b);
    await batchFetchEngagement(ndk, [a, b], USER);
    expect(subs).toHaveLength(1);
    const sub = subs[0];
    expect((sub as FakeSub & { opts: { closeOnEose: boolean } }).opts.closeOnEose).toBe(true);
    const beforeA = oa.updates;
    const beforeB = ob.updates;
    writes.length = 0;

    const eventsA = Array.from({ length: 100 }, (_, i) => reaction(a, `pk-${i}`, '+'));
    const eventsB = [repost(b, 'p1'), zap(b, 'p2', 7), comment(b, 'p3')];
    emitAll(sub, eventsA);
    emitAll(sub, eventsB);
    emitAll(sub, eventsA.slice(0, 30)); // duplicates
    sub.emit('eose');

    expect(oa.updates - beforeA).toBe(1);
    expect(ob.updates - beforeB).toBe(1);
    expect(cacheWrites(a)).toHaveLength(1);
    expect(cacheWrites(b)).toHaveLength(1);
    expect(oa.data.reactions.count).toBe(100);
    expect(oa.data.loading).toBe(false);
    expect(ob.data).toMatchObject({ reposts: { count: 1 }, comments: { count: 1 }, loading: false });
    expect(ob.data.zaps).toMatchObject({ count: 1, totalAmount: 7_000 });
    expect(persisted(a)!.reactions.count).toBe(100);
    expect(persisted(b)!.zaps.amount).toBe(7_000);

    vi.advanceTimersByTime(1000);
    expect(oa.updates - beforeA).toBe(1);
    expect(cacheWrites(a)).toHaveLength(1);
    oa.unsub();
    ob.unsub();
  });

  it('batch timeout without EOSE persists the finalized counts, including a note whose queue is already empty', async () => {
    const a = 'batch-c';
    const b = 'batch-d';
    const oa = observe(a);
    const ob = observe(b);
    await batchFetchEngagement(ndk, [a, b], USER);
    const sub = subs[0];
    writes.length = 0;
    const beforeA = oa.updates;
    const beforeB = ob.updates;

    emitAll(sub, [reaction(a, 'p1'), reaction(a, 'p2')]);
    vi.advanceTimersByTime(250); // a flushed periodically; b never received anything
    expect(cacheWrites(a)).toHaveLength(1);
    expect(cacheWrites(b)).toHaveLength(0);
    const periodicTs = persisted(a)!.timestamp;

    vi.advanceTimersByTime(10_000 - 250); // batch timeout
    expect(oa.updates - beforeA).toBe(2);
    expect(ob.updates - beforeB).toBe(1);
    expect(cacheWrites(a)).toHaveLength(2);
    expect(cacheWrites(b)).toHaveLength(1);
    expect(oa.data.loading).toBe(false);
    expect(ob.data.loading).toBe(false);
    expect(persisted(a)).toMatchObject({ reactions: { count: 2 }, timestamp: Date.now() });
    expect(persisted(a)!.timestamp).toBeGreaterThan(periodicTs);
    expect(persisted(b)).toMatchObject({ reactions: { count: 0 }, timestamp: Date.now() });

    sub.emit('eose'); // late EOSE after timeout
    expect(oa.updates - beforeA).toBe(2);
    expect(cacheWrites(a)).toHaveLength(2);
    oa.unsub();
    ob.unsub();
  });
});

describe('overlapping subscriptions and lifecycle', () => {
  it('single-note and batch subscriptions receiving the same events count each once', async () => {
    const a = 'shared-a';
    const b = 'shared-b';
    const oa = observe(a);
    await fetchEngagement(ndk, a, USER);
    await batchFetchEngagement(ndk, [a, b], USER);
    expect(subs).toHaveLength(2);
    const [single, batch] = subs;

    const events = Array.from({ length: 10 }, (_, i) => reaction(a, `pk-${i}`, '+'));
    emitAll(single, events);
    emitAll(batch, events);
    emitAll(batch, [zap(a, 'z', 3)]);
    emitAll(single, [zap(a, 'z', 3, 'z-dup')]); // different id, same zapper → aggregated, not a dup
    vi.advanceTimersByTime(250);
    expect(oa.data.reactions.count).toBe(10);
    expect(oa.data.zaps.count).toBe(2);

    single.emit('eose');
    batch.emit('eose');
    expect(oa.data.reactions.count).toBe(10);
    expect(oa.data.loading).toBe(false);
    expect(persisted(a)!.reactions.count).toBe(10);
    oa.unsub();
  });

  it('rapid repeated fetches for one note share one dedup set and never double count', async () => {
    const id = 'rapid';
    const obs = observe(id);
    await fetchEngagement(ndk, id, USER);
    await fetchEngagement(ndk, id, USER); // second component mounts
    await fetchEngagement(ndk, id, USER);
    const events = [reaction(id, 'p1'), reaction(id, 'p2'), repost(id, 'p3')];
    for (const s of subs) emitAll(s, events);
    for (const s of subs) s.emit('eose');
    vi.advanceTimersByTime(250);
    expect(obs.data.reactions.count).toBe(2);
    expect(obs.data.reposts.count).toBe(1);
    expect(obs.data.loading).toBe(false);
    obs.unsub();
  });

  it('cleanupEngagement discards queued work; a stale timeout cannot finalize a replacement subscription', async () => {
    const id = 'cleanup';
    const obs = observe(id);
    await fetchEngagement(ndk, id, USER);
    const oldSub = subs[0];
    vi.advanceTimersByTime(1000); // old timeout is due at t+5000
    emitAll(oldSub, [reaction(id, 'p1'), reaction(id, 'p2')]); // queued, not yet flushed

    cleanupEngagement(id);
    expect(oldSub.stop).toHaveBeenCalled();
    writes.length = 0;
    const before = obs.updates;

    vi.advanceTimersByTime(250); // periodic flush: the queued events were discarded
    expect(obs.updates - before).toBe(0);
    expect(obs.data.reactions.count).toBe(0);
    expect(cacheWrites(id)).toHaveLength(0);

    // Replacement subscription for the same note (its timeout is due at t+6250).
    await fetchEngagement(ndk, id, USER);
    const newSub = subs[1];
    const afterStart = obs.updates;
    expect(obs.data.loading).toBe(true);

    vi.advanceTimersByTime(4000); // old subscription's timeout fires (stale)
    expect(obs.data.loading).toBe(true); // the replacement is still counting
    expect(obs.updates - afterStart).toBe(0);
    expect(cacheWrites(id)).toHaveLength(0);

    emitAll(newSub, [reaction(id, 'p9')]);
    newSub.emit('eose');
    expect(obs.data.loading).toBe(false);
    expect(obs.data.reactions.count).toBe(1);
    expect(cacheWrites(id)).toHaveLength(1);
    obs.unsub();
  });

  it('a stale EOSE from a cleaned-up subscription cannot finalize the replacement', async () => {
    const id = 'cleanup-eose';
    const obs = observe(id);
    await fetchEngagement(ndk, id, USER);
    const oldSub = subs[0];
    cleanupEngagement(id);
    await fetchEngagement(ndk, id, USER);
    const afterStart = obs.updates;
    writes.length = 0;

    oldSub.emit('event', reaction(id, 'stale'));
    oldSub.emit('eose');
    vi.advanceTimersByTime(250);
    expect(obs.data.loading).toBe(true);
    expect(obs.updates - afterStart).toBe(0);
    expect(cacheWrites(id)).toHaveLength(0);

    subs[1].emit('eose');
    expect(obs.data.loading).toBe(false);
    expect(cacheWrites(id)).toHaveLength(1);
    obs.unsub();
  });

  it('clearAllEngagementCaches cancels pending work and old callbacks do not recreate stores', async () => {
    const id = 'cleared';
    observe(id).unsub();
    await fetchEngagement(ndk, id, USER);
    const sub = subs[0];
    emitAll(sub, [reaction(id, 'p1'), zap(id, 'p2', 5)]);

    clearAllEngagementCaches();
    writes.length = 0;
    expect(getEngagementStats().storeCount).toBe(0);
    expect(sub.stop).toHaveBeenCalled();

    vi.advanceTimersByTime(250);
    sub.emit('event', reaction(id, 'p3'));
    sub.emit('eose');
    vi.advanceTimersByTime(10_000);
    expect(getEngagementStats().storeCount).toBe(0);
    expect(writes).toHaveLength(0);
  });
});
