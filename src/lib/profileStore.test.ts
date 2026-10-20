import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nip19 } from 'nostr-tools';
import type { ProfileState } from './profileStore';

const env = vi.hoisted(() => ({ browser: true }));
vi.mock('$app/environment', () => ({
  get browser() {
    return env.browser;
  }
}));

// Every writable the store module creates, with a count of its set()
// calls, so a write into a dropped store is observable.
const created = vi.hoisted(() => [] as { sets: number }[]);
vi.mock('svelte/store', async () => {
  const actual = (await vi.importActual('svelte/store')) as typeof import('svelte/store');
  return {
    ...actual,
    writable: (value: any) => {
      const store = actual.writable(value);
      const record = { sets: 0 };
      created.push(record);
      return {
        ...store,
        set: (v: any) => {
          record.sets++;
          store.set(v);
        }
      };
    }
  };
});

vi.mock('./nostr', async () => {
  const { writable } = await import('svelte/store');
  return { ndk: writable({}) };
});

// The resolver, reduced to the four things the store uses. `listeners`
// mirrors onProfileCached so tests can deliver a late profile the way
// another component's lookup (or a seed) would.
const resolver = vi.hoisted(() => ({
  resolve: vi.fn(),
  confirmed: vi.fn((_pk: string) => false),
  resolveProfiles: vi.fn(async () => new Map()),
  listeners: new Set<(pk: string, p: any) => void>()
}));
vi.mock('./profileResolver', () => ({
  resolveProfileByPubkey: (pk: string, ndk: unknown) => resolver.resolve(pk, ndk),
  isProfileMissConfirmed: (pk: string) => resolver.confirmed(pk),
  resolveProfiles: (s: string[], ndk: unknown) => resolver.resolveProfiles(s, ndk),
  onProfileCached: (fn: (pk: string, p: any) => void) => {
    resolver.listeners.add(fn);
    return () => resolver.listeners.delete(fn);
  },
  formatDisplayName: (p: any) => p?.display_name || p?.name || ''
}));

import {
  profileFor,
  authorLabel,
  shortNpub,
  prefetchProfiles,
  PROFILE_RETRY_DELAY_MS,
  __resetProfileStore,
  __profileStoreStats
} from './profileStore';
import { getAnonChefName } from './anonName';

const PK = 'a'.repeat(64);
const profile = (pubkey: string, name: string) => ({ pubkey, name, lastFetched: 0 });

/** Subscribe and record every value the store pushes. */
function watch(pubkey: string) {
  const states: ProfileState[] = [];
  const unsubscribe = profileFor(pubkey).subscribe((s) => states.push(s));
  return { states, unsubscribe, last: () => states[states.length - 1] };
}

/** A promise the test resolves by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const deliverLate = (pk: string, p: any) => {
  for (const fn of [...resolver.listeners]) fn(pk, p);
};

describe('profileStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    env.browser = true;
    resolver.resolve.mockReset();
    resolver.confirmed.mockReset().mockReturnValue(false);
    resolver.resolveProfiles.mockClear();
    resolver.listeners.clear();
    __resetProfileStore();
  });
  afterEach(() => {
    __resetProfileStore();
    vi.useRealTimers();
  });

  it('loading → found', async () => {
    resolver.resolve.mockResolvedValue(profile(PK, 'shuqi'));
    const w = watch(PK);
    expect(w.states).toEqual([{ status: 'loading' }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.last()).toEqual({ status: 'found', profile: profile(PK, 'shuqi') });
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    w.unsubscribe();
  });

  it('a late profile replaces the placeholder without a remount', async () => {
    resolver.resolve.mockReturnValue(new Promise(() => {})); // relays slow
    const w = watch(PK);
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.last()).toEqual({ status: 'loading' });

    deliverLate(PK, profile(PK, 'Late Cook'));
    expect(w.last()).toEqual({ status: 'found', profile: profile(PK, 'Late Cook') });
    expect(authorLabel(PK, w.last())).toEqual({ kind: 'text', text: 'Late Cook' });
    w.unsubscribe();
  });

  it('a late profile also upgrades an unconfirmed row', async () => {
    resolver.resolve.mockResolvedValue(null);
    const w = watch(PK);
    await vi.advanceTimersByTimeAsync(PROFILE_RETRY_DELAY_MS + 10);
    expect(w.last()).toEqual({ status: 'unconfirmed' });
    deliverLate(PK, profile(PK, 'Finally'));
    expect(w.last()).toMatchObject({ status: 'found' });
    w.unsubscribe();
  });

  it('a confirmed miss shows the anon name', async () => {
    resolver.resolve.mockResolvedValue(null);
    resolver.confirmed.mockReturnValue(true);
    const w = watch(PK);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.last()).toEqual({ status: 'missing' });
    expect(authorLabel(PK, w.last())).toEqual({ kind: 'text', text: getAnonChefName(PK) });
    // No retry for a confirmed miss.
    await vi.advanceTimersByTimeAsync(PROFILE_RETRY_DELAY_MS * 3);
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    w.unsubscribe();
  });

  it('an unconfirmed miss keeps the placeholder, retries exactly once, then shows a short npub', async () => {
    resolver.resolve.mockResolvedValue(null);
    const w = watch(PK);
    await vi.advanceTimersByTimeAsync(0);
    // Still a placeholder — never the anon name — while the retry is pending.
    expect(w.last()).toEqual({ status: 'loading' });
    expect(authorLabel(PK, w.last())).toEqual({ kind: 'skeleton' });
    expect(resolver.resolve).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(PROFILE_RETRY_DELAY_MS);
    expect(resolver.resolve).toHaveBeenCalledTimes(2);
    expect(w.last()).toEqual({ status: 'unconfirmed' });
    expect(authorLabel(PK, w.last())).toEqual({ kind: 'text', text: shortNpub(PK) });
    expect(w.states.some((s) => s.status === 'missing')).toBe(false);

    // Bounded: no further attempts.
    await vi.advanceTimersByTimeAsync(PROFILE_RETRY_DELAY_MS * 10);
    expect(resolver.resolve).toHaveBeenCalledTimes(2);
    w.unsubscribe();
  });

  it('checks the confirmed-miss flag on the retry null too', async () => {
    resolver.resolve.mockResolvedValue(null);
    resolver.confirmed.mockReturnValueOnce(false).mockReturnValue(true);
    const w = watch(PK);
    await vi.advanceTimersByTimeAsync(PROFILE_RETRY_DELAY_MS + 10);
    expect(w.last()).toEqual({ status: 'missing' });
    w.unsubscribe();
  });

  it('unmount during the retry window: no fetch, no write, timer and listener dropped', async () => {
    resolver.resolve.mockResolvedValue(null);
    const w = watch(PK);
    await vi.advanceTimersByTimeAsync(0);
    expect(__profileStoreStats()).toMatchObject({ pendingRetries: 1, listening: true });

    w.unsubscribe();
    expect(__profileStoreStats()).toEqual({ entries: 0, listening: false, pendingRetries: 0 });
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(PROFILE_RETRY_DELAY_MS * 2);
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    expect(w.states).toEqual([{ status: 'loading' }]);
  });

  it('a lookup that finishes after its store was dropped writes nothing', async () => {
    const first = deferred<any>();
    const second = deferred<any>();
    resolver.resolve.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const before = created.length;
    const a = watch(PK);
    const droppedStore = created[before];
    a.unsubscribe(); // dropped while the first lookup is in flight
    const b = watch(PK); // fresh store, second lookup in flight

    first.resolve(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0); // the stale null scheduled no retry
    expect(b.states).toEqual([{ status: 'loading' }]);
    // A late profile for the pubkey reaches only the live store.
    deliverLate(PK, profile(PK, 'via listener'));
    expect(droppedStore.sets).toBe(0);
    expect(b.last()).toMatchObject({ status: 'found' });

    second.resolve(profile(PK, 'fresh'));
    await vi.advanceTimersByTimeAsync(0);
    expect(droppedStore.sets).toBe(0);
    b.unsubscribe();
  });

  it('SSR: no fetch, no timer, no listener; the label is a skeleton', async () => {
    env.browser = false;
    resolver.resolve.mockResolvedValue(profile(PK, 'x'));
    const w = watch(PK);
    await vi.advanceTimersByTimeAsync(PROFILE_RETRY_DELAY_MS * 2);
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(__profileStoreStats().listening).toBe(false);
    expect(w.states).toEqual([{ status: 'loading' }]);
    expect(authorLabel(PK, w.last())).toEqual({ kind: 'skeleton' });
    w.unsubscribe();

    await prefetchProfiles(['nostr:nprofile1x']);
    expect(resolver.resolveProfiles).not.toHaveBeenCalled();
  });

  it('50 rows in one batch: each row notifies only for its own pubkey', async () => {
    const pubkeys = Array.from({ length: 50 }, (_, i) => i.toString(16).padStart(64, '0'));
    // Like the real resolver: caching a profile announces it to listeners
    // before the lookup returns.
    resolver.resolve.mockImplementation(async (pk: string) => {
      await new Promise((r) => setTimeout(r, 150)); // the batch window
      const p = profile(pk, `name-${pk.slice(-2)}`);
      deliverLate(pk, p);
      return p;
    });
    const rows = pubkeys.map((pk) => ({ pk, ...watch(pk) }));
    await vi.advanceTimersByTimeAsync(200);

    for (const row of rows) {
      expect(row.states).toHaveLength(2); // loading, found — once each
      expect(row.states[1]).toMatchObject({ status: 'found', profile: { pubkey: row.pk } });
    }

    // A late profile for author A touches A's row and no other.
    const [a, ...others] = rows;
    deliverLate(a.pk, profile(a.pk, 'A renamed'));
    expect(a.states).toHaveLength(3);
    for (const row of others) expect(row.states).toHaveLength(2);
    for (const row of rows) row.unsubscribe();
  });

  it('remount shows the kept name at once; reconciling a cache hit adds no update', async () => {
    const kept = profile(PK, 'kept');
    resolver.resolve.mockResolvedValue(kept); // the resolver's cached object
    const a = watch(PK);
    await vi.advanceTimersByTimeAsync(0);
    a.unsubscribe();
    const b = watch(PK);
    expect(b.states).toEqual([{ status: 'found', profile: kept }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(resolver.resolve).toHaveBeenCalledTimes(2); // reconciled
    expect(b.states).toHaveLength(1); // same object: no extra notification
    b.unsubscribe();
  });

  it('unsubscribe → cache refresh → resubscribe picks up the refreshed profile', async () => {
    const v1 = { ...profile(PK, 'old name'), created_at: 100 };
    const v2 = { ...profile(PK, 'new name'), created_at: 200 };
    resolver.resolve.mockResolvedValueOnce(v1);
    const a = watch(PK);
    await vi.advanceTimersByTimeAsync(0);
    a.unsubscribe();
    expect(__profileStoreStats().listening).toBe(false);

    // The resolver refreshes the profile while nothing is listening.
    deliverLate(PK, v2); // no listener attached: nobody hears it
    resolver.resolve.mockResolvedValueOnce(v2);

    const b = watch(PK);
    expect(b.states).toEqual([{ status: 'found', profile: v1 }]); // old name shown meanwhile
    await vi.advanceTimersByTimeAsync(0);
    expect(b.last()).toEqual({ status: 'found', profile: v2 });
    b.unsubscribe();
  });

  it('reconciling never overwrites a newer listener update, nor downgrades to a miss', async () => {
    const v1 = { ...profile(PK, 'v1'), created_at: 100 };
    const v2 = { ...profile(PK, 'v2'), created_at: 200 };
    const v3 = { ...profile(PK, 'v3'), created_at: 300 };
    resolver.resolve.mockResolvedValueOnce(v1);
    const a = watch(PK);
    await vi.advanceTimersByTimeAsync(0);
    a.unsubscribe();

    const reconcile = deferred<any>();
    resolver.resolve.mockReturnValueOnce(reconcile.promise);
    const b = watch(PK);
    deliverLate(PK, v3); // newer, via another lookup
    reconcile.resolve(v2); // older result lands after it
    await vi.advanceTimersByTimeAsync(0);
    expect(b.last()).toEqual({ status: 'found', profile: v3 });
    b.unsubscribe();

    resolver.resolve.mockResolvedValueOnce(null);
    const c = watch(PK);
    await vi.advanceTimersByTimeAsync(PROFILE_RETRY_DELAY_MS * 2);
    expect(c.last()).toEqual({ status: 'found', profile: v3 });
    c.unsubscribe();
  });

  it('versions compare on kind:0 created_at, not lastFetched: a later fetch of an older kind:0 never wins', async () => {
    // Shown: kind:0 from t=200, fetched long ago.
    const shown = { ...profile(PK, 'current'), created_at: 200, lastFetched: 1 };
    // Later fetch (newer lastFetched) returning an OLDER kind:0 from a stale relay.
    const stale = { ...profile(PK, 'stale'), created_at: 100, lastFetched: 9_999 };
    resolver.resolve.mockResolvedValueOnce(shown);
    const a = watch(PK);
    await vi.advanceTimersByTimeAsync(0);
    a.unsubscribe();

    // Reconcile on remount returns the stale version: ignored.
    resolver.resolve.mockResolvedValueOnce(stale);
    const b = watch(PK);
    await vi.advanceTimersByTimeAsync(0);
    expect(b.last()).toEqual({ status: 'found', profile: shown });
    expect(b.states).toHaveLength(1);

    // Same through the cache listener (another component's stale fetch).
    deliverLate(PK, stale);
    expect(b.last()).toEqual({ status: 'found', profile: shown });
    expect(b.states).toHaveLength(1);

    // A genuinely newer kind:0 still replaces it.
    const newer = { ...profile(PK, 'newer'), created_at: 300, lastFetched: 2 };
    deliverLate(PK, newer);
    expect(b.last()).toEqual({ status: 'found', profile: newer });
    b.unsubscribe();
  });

  it('a seeded profile (no created_at) counts as oldest', async () => {
    const fetched = { ...profile(PK, 'from relays'), created_at: 100 };
    resolver.resolve.mockResolvedValueOnce(fetched);
    const w = watch(PK);
    await vi.advanceTimersByTimeAsync(0);
    deliverLate(PK, profile(PK, 'seeded, partial')); // no created_at
    expect(w.last()).toEqual({ status: 'found', profile: fetched });
    w.unsubscribe();

    // …but a seed still fills a row that has no name yet.
    resolver.resolve.mockReturnValueOnce(new Promise(() => {}));
    const other = 'd'.repeat(64);
    const row = watch(other);
    deliverLate(other, profile(other, 'seeded'));
    expect(row.last()).toEqual({ status: 'found', profile: profile(other, 'seeded') });
    row.unsubscribe();
  });

  it('1,001 simultaneously mounted authors all resolve (eviction never takes a mounted row)', async () => {
    const pubkeys = Array.from({ length: 1001 }, (_, i) => i.toString(16).padStart(64, '0'));
    resolver.resolve.mockImplementation(async (pk: string) => profile(pk, `n${pk.slice(-3)}`));
    const rows = pubkeys.map((pk) => watch(pk));
    await vi.advanceTimersByTimeAsync(0);
    for (const row of rows) expect(row.last()).toMatchObject({ status: 'found' });
    expect(__profileStoreStats().entries).toBe(1001);
    for (const row of rows) row.unsubscribe();
  });

  it('prefetchProfiles warms the resolver in the browser', async () => {
    await prefetchProfiles(['nostr:nprofile1abc']);
    expect(resolver.resolveProfiles).toHaveBeenCalledWith(['nostr:nprofile1abc'], {});
  });
});

describe('shortNpub / authorLabel', () => {
  it('shortNpub is a truncated real npub, not "npub1" + hex', () => {
    const npub = nip19.npubEncode(PK);
    expect(shortNpub(PK)).toBe(`${npub.slice(0, 10)}…${npub.slice(-4)}`);
    expect(shortNpub(PK).startsWith('npub1' + PK.slice(0, 5))).toBe(false);
  });

  it('labels: skeleton while loading, name when found, anon only when missing', () => {
    expect(authorLabel(PK, { status: 'loading' })).toEqual({ kind: 'skeleton' });
    expect(authorLabel(PK, null)).toEqual({ kind: 'skeleton' });
    expect(authorLabel(PK, { status: 'found', profile: profile(PK, 'Jin') })).toEqual({
      kind: 'text',
      text: 'Jin'
    });
    // A profile without name fields keeps the hash-stable anon name.
    expect(authorLabel(PK, { status: 'found', profile: { pubkey: PK, lastFetched: 0 } })).toEqual({
      kind: 'text',
      text: getAnonChefName(PK)
    });
    expect(authorLabel(PK, { status: 'missing' })).toEqual({ kind: 'text', text: getAnonChefName(PK) });
    expect(authorLabel(PK, { status: 'unconfirmed' })).toEqual({ kind: 'text', text: shortNpub(PK) });
    expect(authorLabel('', { status: 'loading' })).toEqual({ kind: 'text', text: getAnonChefName(null) });
  });
});
