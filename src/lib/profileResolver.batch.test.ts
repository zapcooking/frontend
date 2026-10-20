import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type NDK from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';

vi.mock('./nostr', () => ({ ndk: {} }));

// The resolver dynamically imports these from the real package, whose
// module graph (websocket polyfills etc.) doesn't load cleanly under
// vitest's node environment — stub them.
vi.mock('@nostr-dev-kit/ndk', () => ({
  NDKRelaySet: class NDKRelaySet {
    constructor(public relays: Set<FakeRelay>, _ndk: unknown) {}
  },
  NDKRelayStatus: { CONNECTED: 5 },
  NDKSubscriptionCacheUsage: { ONLY_RELAY: 'ONLY_RELAY' }
}));

const PURPLEPAG = 'wss://purplepag.es';

type Handler = (...args: any[]) => void;

/** Minimal NDKRelay: status + on/once/off for 'ready' and 'notice'. */
class FakeRelay {
  status: number;
  private handlers = new Map<string, Set<Handler>>();
  constructor(public url: string, connected: boolean) {
    this.status = connected ? 5 : 4;
  }
  on(ev: string, fn: Handler) {
    if (!this.handlers.has(ev)) this.handlers.set(ev, new Set());
    this.handlers.get(ev)!.add(fn);
  }
  once(ev: string, fn: Handler) {
    const wrapped = (...a: any[]) => {
      this.off(ev, wrapped);
      fn(...a);
    };
    this.on(ev, wrapped);
  }
  off(ev: string, fn: Handler) {
    this.handlers.get(ev)?.delete(fn);
  }
  emit(ev: string, ...a: any[]) {
    for (const fn of [...(this.handlers.get(ev) ?? [])]) fn(...a);
  }
  connect() {
    this.status = 5;
    this.emit('ready');
  }
}

/** One ndk.subscribe() call, as the test sees it. */
interface FakeSub {
  filters: any[];
  opts: any;
  relayUrls: string[];
  isPurplepag: boolean;
  startedAt: number;
  stopped: boolean;
  event: (ev: any) => void;
  eose: () => void;
  closed: (reason?: string) => void;
}

type Script = (sub: FakeSub) => void;

/**
 * Fake NDK. `script` runs when each subscription starts and drives it
 * (emit events / EOSE / CLOSED, possibly after a delay via setTimeout).
 */
function makeNdk(opts: { script: Script; purplepagConnected?: boolean }) {
  const relays = new Map<string, FakeRelay>();
  const getRelay = (url: string) => {
    if (!relays.has(url)) {
      relays.set(url, new FakeRelay(url, url !== PURPLEPAG || !!opts.purplepagConnected));
    }
    return relays.get(url)!;
  };
  getRelay('wss://relay.test');
  const subs: FakeSub[] = [];
  const ndk = {
    pool: { relays, getRelay: vi.fn(getRelay) },
    subscribe: vi.fn((filters: any, subOpts: any, relaySet: any) => {
      const handlers = new Map<string, Handler[]>();
      const fire = (ev: string, ...a: any[]) => {
        if (!sub.stopped) for (const fn of handlers.get(ev) ?? []) fn(...a);
      };
      const relayUrls: string[] = relaySet
        ? [...relaySet.relays].map((r: FakeRelay) => r.url)
        : [];
      const sub: FakeSub = {
        filters: Array.isArray(filters) ? filters : [filters],
        opts: subOpts,
        relayUrls,
        isPurplepag: relayUrls.length === 1 && relayUrls[0] === PURPLEPAG,
        startedAt: -1,
        stopped: false,
        event: (ev) => fire('event', ev),
        eose: () => fire('eose'),
        closed: (reason) => fire('closed', undefined, reason)
      };
      subs.push(sub);
      return {
        on: (ev: string, fn: Handler) => {
          handlers.set(ev, [...(handlers.get(ev) ?? []), fn]);
        },
        start: () => {
          sub.startedAt = Date.now();
          opts.script(sub);
        },
        stop: () => {
          sub.stopped = true;
        }
      };
    })
  };
  return { ndk: ndk as unknown as NDK, subs, relay: getRelay };
}

function kind0(pubkey: string, name: string, created_at = 100) {
  return {
    pubkey,
    created_at,
    content: JSON.stringify({ name, display_name: name.toUpperCase() })
  };
}

/** Authors requested by a sub (pool: one filter; purplepag: one per author). */
const authorsOf = (sub: FakeSub): string[] => sub.filters.flatMap((f) => f.authors);

/** Answer subs from `db` (pubkey → events), then EOSE. */
function answerFrom(
  db: Record<string, any[]>,
  which: 'pool' | 'purplepag' | 'both' = 'both'
): Script {
  return (sub) => {
    if (which !== 'both' && (which === 'purplepag') !== sub.isPurplepag) {
      sub.eose();
      return;
    }
    for (const pk of authorsOf(sub)) for (const ev of db[pk] ?? []) sub.event(ev);
    sub.eose();
  };
}

/**
 * Advance fake time, letting the resolver's dynamic NDK imports settle
 * (vitest resolves them in real time, outside the fake clock) so the
 * subscriptions and timers they gate exist before time moves on.
 */
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

describe('profileResolver batching', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    const { clearProfileCache } = await import('./profileResolver');
    clearProfileCache();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces concurrent resolves into one pool REQ and one purplepag REQ', async () => {
    const { resolveProfileByPubkey } = await import('./profileResolver');
    const pubkeys = ['aa', 'bb', 'cc', 'dd', 'ee'];
    const db = Object.fromEntries(pubkeys.map((pk) => [pk, [kind0(pk, `name-${pk}`)]]));
    const { ndk, subs } = makeNdk({ script: answerFrom(db, 'pool'), purplepagConnected: true });

    const pending = pubkeys.map((pk) => resolveProfileByPubkey(pk, ndk));
    // Nothing fires until the collection window closes.
    expect(subs).toHaveLength(0);
    await tick(200);

    const results = await Promise.all(pending);
    const pool = subs.filter((s) => !s.isPurplepag);
    const pp = subs.filter((s) => s.isPurplepag);
    expect(pool).toHaveLength(1);
    expect(pool[0].filters).toEqual([{ kinds: [0], authors: pubkeys }]);
    expect(pp).toHaveLength(1);
    for (const profile of results) {
      expect(profile?.name).toBe(`name-${profile?.pubkey}`);
    }
  });

  it('single-flights duplicate resolves for the same pubkey', async () => {
    const { resolveProfileByPubkey } = await import('./profileResolver');
    const { ndk, subs } = makeNdk({
      script: answerFrom({ dupe: [kind0('dupe', 'name-dupe')] }),
      purplepagConnected: true
    });

    const a = resolveProfileByPubkey('dupe', ndk);
    const b = resolveProfileByPubkey('dupe', ndk);
    await tick(200);
    const [first, second] = await Promise.all([a, b]);

    const pool = subs.filter((s) => !s.isPurplepag);
    expect(pool).toHaveLength(1);
    expect(authorsOf(pool[0])).toEqual(['dupe']);
    expect(first?.name).toBe('name-dupe');
    expect(second?.name).toBe('name-dupe');
  });

  it('resolves null for pubkeys no relay knows', async () => {
    const { resolveProfileByPubkey } = await import('./profileResolver');
    const { ndk } = makeNdk({ script: answerFrom({}), purplepagConnected: true });
    const pending = resolveProfileByPubkey('unknown', ndk);
    await tick(200);
    expect(await pending).toBeNull();
  });

  it('keeps the newest kind:0 when a pubkey has several events', async () => {
    const { resolveProfileByPubkey } = await import('./profileResolver');
    const { ndk } = makeNdk({
      // Newest first, so 'last event wins' would pick the stale one.
      script: answerFrom({ pk: [kind0('pk', 'new', 200), kind0('pk', 'old', 100)] }, 'pool'),
      purplepagConnected: true
    });
    const pending = resolveProfileByPubkey('pk', ndk);
    await tick(200);
    expect((await pending)?.name).toBe('new');
  });

  it('newest kind:0 wins across the pool and purplepag passes', async () => {
    const { resolveProfileByPubkey } = await import('./profileResolver');
    const { ndk } = makeNdk({
      // purplepag's newer copy lands first; the pool's stale one after.
      script: (sub) => {
        if (sub.isPurplepag) {
          sub.event(kind0('x', 'newer', 300));
          sub.eose();
        } else {
          setTimeout(() => {
            sub.event(kind0('x', 'older', 100));
            sub.eose();
          }, 50);
        }
      },
      purplepagConnected: true
    });
    const pending = resolveProfileByPubkey('x', ndk);
    await tick(200);
    await tick(100);
    expect((await pending)?.name).toBe('newer');
  });

  it('a pool relay that never EOSEs does not wipe events already received', async () => {
    const { resolveProfileByPubkey } = await import('./profileResolver');
    const { ndk } = makeNdk({
      script: (sub) => {
        if (sub.isPurplepag) return sub.eose();
        // A fast relay answers; a slow one never sends EOSE.
        sub.event(kind0('fast', 'Fast Cook'));
      },
      purplepagConnected: true
    });
    const pending = resolveProfileByPubkey('fast', ndk);
    await tick(200);
    await tick(5100);
    expect((await pending)?.name).toBe('Fast Cook');
  });

  it('a profile only on purplepag resolves even when purplepag connects late', async () => {
    const { resolveProfileByPubkey } = await import('./profileResolver');
    const { ndk, relay } = makeNdk({
      script: answerFrom({ pp: [kind0('pp', 'shuqi')] }, 'purplepag')
    });
    const pending = resolveProfileByPubkey('pp', ndk);
    await tick(200);
    // The pool pass has already finished; purplepag comes up 1s later.
    await tick(1000);
    relay(PURPLEPAG).connect();
    await tick(10);
    expect((await pending)?.name).toBe('shuqi');
  });

  it('starts the purplepag REQ in parallel with the pool REQ', async () => {
    const { resolveProfileByPubkey } = await import('./profileResolver');
    // The pool pass is slow (EOSE after 2s); purplepag must not wait for it.
    const { ndk, subs } = makeNdk({
      script: (sub) => {
        if (sub.isPurplepag) {
          sub.event(kind0('p', 'from purplepag'));
          sub.eose();
        } else {
          setTimeout(() => sub.eose(), 2000);
        }
      },
      purplepagConnected: true
    });
    const pending = resolveProfileByPubkey('p', ndk);
    await tick(200);
    const pool = subs.find((s) => !s.isPurplepag)!;
    const pp = subs.find((s) => s.isPurplepag);
    expect(pp).toBeDefined();
    expect(pp!.startedAt - pool.startedAt).toBeLessThan(50);
    await tick(2100);
    expect((await pending)?.name).toBe('from purplepag');
  });

  it('per-author filters go to purplepag only, one REQ of ≤50 filters', async () => {
    const { resolveProfileByPubkey } = await import('./profileResolver');
    const pubkeys = Array.from({ length: 60 }, (_, i) => `pk${i}`);
    const { ndk, subs } = makeNdk({ script: answerFrom({}), purplepagConnected: true });
    const pending = pubkeys.map((pk) => resolveProfileByPubkey(pk, ndk));
    await tick(200);
    await Promise.all(pending);

    const pp = subs.filter((s) => s.isPurplepag);
    const pool = subs.filter((s) => !s.isPurplepag);
    expect(pp.length).toBeGreaterThan(0);
    for (const s of pp) {
      expect(s.filters.length).toBeLessThanOrEqual(50);
      for (const f of s.filters) {
        expect(f).toEqual({ kinds: [0], authors: [f.authors[0]], limit: 1 });
      }
      expect(s.opts).toMatchObject({ groupable: false, cacheUsage: 'ONLY_RELAY' });
    }
    expect(pp.flatMap(authorsOf).sort()).toEqual([...pubkeys].sort());
    for (const s of pool) {
      expect(s.filters).toHaveLength(1);
      expect(s.relayUrls).not.toContain(PURPLEPAG);
    }
  });

  it('caches a confirmed miss, then retries after it expires', async () => {
    const { resolveProfileByPubkey } = await import('./profileResolver');
    const { ndk, subs } = makeNdk({ script: answerFrom({}), purplepagConnected: true });

    const first = resolveProfileByPubkey('ghost', ndk);
    await tick(200);
    expect(await first).toBeNull();
    const after1 = subs.length;

    // Within 60s: answered from the miss cache, no new REQ.
    const second = resolveProfileByPubkey('ghost', ndk);
    await tick(200);
    expect(await second).toBeNull();
    expect(subs.length).toBe(after1);

    // After expiry: fetched again.
    await tick(60_000);
    const third = resolveProfileByPubkey('ghost', ndk);
    await tick(200);
    await third;
    expect(subs.length).toBeGreaterThan(after1);
  });

  it('a seeded profile overrides a cached miss', async () => {
    const { resolveProfileByPubkey, seedProfileCache } = await import('./profileResolver');
    const { ndk } = makeNdk({ script: answerFrom({}), purplepagConnected: true });
    const first = resolveProfileByPubkey('later', ndk);
    await tick(200);
    expect(await first).toBeNull();

    seedProfileCache('later', { name: 'Later Cook' });
    expect((await resolveProfileByPubkey('later', ndk))?.name).toBe('Later Cook');
  });

  it('purplepag never connects: pool results kept, misses not cached', async () => {
    const { resolveProfileByPubkey } = await import('./profileResolver');
    const { ndk, subs } = makeNdk({
      script: answerFrom({ known: [kind0('known', 'Pool Cook')] }, 'pool')
    });
    const known = resolveProfileByPubkey('known', ndk);
    const missing = resolveProfileByPubkey('missing', ndk);
    await tick(200);
    await tick(3100);
    expect((await known)?.name).toBe('Pool Cook');
    expect(await missing).toBeNull();
    expect(subs.some((s) => s.isPurplepag)).toBe(false);

    // Not cached: the next resolve goes back to the relays.
    const before = subs.length;
    const retry = resolveProfileByPubkey('missing', ndk);
    await tick(200);
    await tick(3100);
    await retry;
    expect(subs.length).toBeGreaterThan(before);
  });

  it('purplepag CLOSED or NOTICE makes the miss unconfirmed (not cached)', async () => {
    const { resolveProfileByPubkey } = await import('./profileResolver');
    for (const failure of ['closed', 'notice'] as const) {
      const { ndk, subs, relay } = makeNdk({
        script: (sub) => {
          if (!sub.isPurplepag) return sub.eose();
          if (failure === 'closed') return sub.closed('too many filters');
          relay(PURPLEPAG).emit('notice', 'slow down');
          sub.eose();
        },
        purplepagConnected: true
      });
      const pk = `nope-${failure}`;
      const first = resolveProfileByPubkey(pk, ndk);
      await tick(200);
      expect(await first).toBeNull();
      const before = subs.length;
      const retry = resolveProfileByPubkey(pk, ndk);
      await tick(200);
      await retry;
      expect(subs.length).toBeGreaterThan(before);
    }
  });

  it('relay hints bypass a cached miss', async () => {
    const { resolveProfileByPubkey, resolveProfile } = await import('./profileResolver');
    const pk = 'a'.repeat(64);
    const HINT = 'wss://hint.example';
    const { ndk, subs } = makeNdk({
      script: (sub) => {
        if (sub.relayUrls.includes(HINT)) sub.event(kind0(pk, 'Hinted Cook'));
        sub.eose();
      },
      purplepagConnected: true
    });
    const first = resolveProfileByPubkey(pk, ndk);
    await tick(200);
    expect(await first).toBeNull(); // confirmed miss, cached

    const hinted = resolveProfile(nip19.nprofileEncode({ pubkey: pk, relays: [HINT] }), ndk);
    await tick(200);
    expect((await hinted)?.name).toBe('Hinted Cook');
    expect(subs.some((s) => s.relayUrls.includes(HINT))).toBe(true);
  });

  it('keeps relays whose URLs differ only in path case', async () => {
    const { resolveProfile } = await import('./profileResolver');
    const pk = 'b'.repeat(64);
    const { ndk, subs, relay } = makeNdk({ script: answerFrom({}), purplepagConnected: true });
    relay('wss://relay.example/Profile');
    const pending = resolveProfile(
      nip19.nprofileEncode({ pubkey: pk, relays: ['wss://relay.example/profile'] }),
      ndk
    );
    await tick(200);
    await pending;
    const pool = subs.find((s) => !s.isPurplepag)!;
    expect(pool.relayUrls).toContain('wss://relay.example/Profile');
    expect(pool.relayUrls).toContain('wss://relay.example/profile');
  });
});
