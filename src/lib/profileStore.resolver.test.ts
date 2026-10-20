// profileStore against the REAL profileResolver (fake NDK underneath):
// the confirmed-miss path answered from the resolver's miss cache, and a
// profile arriving through another path (a seed) reaching a mounted row.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProfileState } from './profileStore';

vi.mock('$app/environment', () => ({ browser: true }));

const ndkStore = vi.hoisted(() => ({ current: null as any }));
vi.mock('./nostr', async () => {
  const { writable: w } = await import('svelte/store');
  const store = w<any>(null);
  ndkStore.current = store;
  return { ndk: store };
});

vi.mock('@nostr-dev-kit/ndk', () => ({
  NDKRelaySet: class NDKRelaySet {
    constructor(public relays: Set<any>, _ndk: unknown) {}
  },
  NDKRelayStatus: { CONNECTED: 5 },
  NDKSubscriptionCacheUsage: { ONLY_RELAY: 'ONLY_RELAY' }
}));

import { profileFor, PROFILE_RETRY_DELAY_MS, __resetProfileStore, __profileStoreStats } from './profileStore';
import { clearProfileCache, seedProfileCache } from './profileResolver';

const PURPLEPAG = 'wss://purplepag.es';
const PK = 'c'.repeat(64);

/**
 * Minimal NDK: every relay is connected; each subscription runs `answer`,
 * which may emit events/EOSE (or nothing, for relays that never reply).
 */
function makeNdk(answer: (sub: { isPurplepag: boolean; event: (e: any) => void; eose: () => void }) => void) {
  const relays = new Map<string, any>();
  const getRelay = (url: string) => {
    if (!relays.has(url)) {
      relays.set(url, { url, status: 5, on() {}, once() {}, off() {} });
    }
    return relays.get(url);
  };
  getRelay('wss://relay.test');
  const subscribe = vi.fn((_filters: any, _opts: any, relaySet: any) => {
    const handlers = new Map<string, ((...a: any[]) => void)[]>();
    let stopped = false;
    const fire = (ev: string, ...a: any[]) => {
      if (!stopped) for (const fn of handlers.get(ev) ?? []) fn(...a);
    };
    const urls = relaySet ? [...relaySet.relays].map((r: any) => r.url) : [];
    return {
      on: (ev: string, fn: (...a: any[]) => void) => handlers.set(ev, [...(handlers.get(ev) ?? []), fn]),
      start: () =>
        answer({
          isPurplepag: urls.length === 1 && urls[0] === PURPLEPAG,
          event: (e) => fire('event', e),
          eose: () => fire('eose')
        }),
      stop: () => {
        stopped = true;
      }
    };
  });
  return { pool: { relays, getRelay }, subscribe };
}

/** Advance fake time, letting the resolver's dynamic NDK imports settle. */
async function tick(ms: number) {
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 3; i++) {
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(0);
  }
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 3; i++) {
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(0);
  }
}

function watch(pubkey: string) {
  const states: ProfileState[] = [];
  const unsubscribe = profileFor(pubkey).subscribe((s) => states.push(s));
  return { states, unsubscribe, last: () => states[states.length - 1] };
}

describe('profileStore with the real resolver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearProfileCache();
    __resetProfileStore();
  });
  afterEach(() => {
    __resetProfileStore();
    vi.useRealTimers();
  });

  it('a null answered from the miss cache (no batch) still shows the confirmed miss', async () => {
    // Every relay, purplepag included, answers EOSE without the author.
    const ndk = makeNdk((sub) => sub.eose());
    ndkStore.current.set(ndk);

    const first = watch(PK);
    await tick(200);
    await tick(100);
    expect(first.last()).toEqual({ status: 'missing' });
    first.unsubscribe(); // missing entries are dropped

    // Remount within 60s: the resolver answers null from its miss cache,
    // without a batch. The store must still read it as confirmed.
    const subsBefore = ndk.subscribe.mock.calls.length;
    const second = watch(PK);
    await tick(10);
    expect(ndk.subscribe.mock.calls.length).toBe(subsBefore);
    expect(second.last()).toEqual({ status: 'missing' });
    expect(__profileStoreStats().pendingRetries).toBe(0);
    second.unsubscribe();
  });

  it('a profile seeded by another path fills a mounted row', async () => {
    // Relays never answer: the row sits on the placeholder.
    const ndk = makeNdk(() => {});
    ndkStore.current.set(ndk);

    const row = watch(PK);
    await tick(200);
    expect(row.last()).toEqual({ status: 'loading' });

    seedProfileCache(PK, { name: 'Seeded Cook' });
    expect(row.last()).toMatchObject({ status: 'found', profile: { name: 'Seeded Cook' } });
    row.unsubscribe();
    // Nothing left pending after unmount.
    await tick(PROFILE_RETRY_DELAY_MS * 3);
    expect(__profileStoreStats()).toEqual({ entries: 1, listening: false, pendingRetries: 0 });
  });

});
