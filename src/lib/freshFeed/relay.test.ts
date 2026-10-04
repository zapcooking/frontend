import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  FreshClient,
  FRESH_KINDS,
  FREE_WINDOW_SECONDS,
  stateOf,
  type Filter,
  type RelayEvent,
  type RelayLike
} from './relay';

/**
 * The Fresh client against a fake relay: what it asks for (the free-window
 * floor, pagination), how it reads closes (auth-required / restricted as
 * states), and that it stays isolated from the app's shared NDK pool.
 */

const NOW = 2_000_000_000;
const FLOOR = NOW - FREE_WINDOW_SECONDS;

function ev(id: string, created_at: number, kind = 1): RelayEvent {
  return { id, pubkey: 'p'.repeat(64), created_at, kind, tags: [], content: id, sig: 's' };
}

type Reply = { events?: RelayEvent[]; close?: string; hang?: boolean };

/** A relay that answers each REQ from a list of posts, or by `respond`. */
class FakeRelay implements RelayLike {
  filters: Filter[] = [];
  closedSubs = 0;
  connected = true;
  constructor(
    public posts: RelayEvent[] = [],
    private respond?: (f: Filter) => Reply | undefined
  ) {}
  subscribe(
    filters: Filter[],
    p: {
      onevent?: (e: RelayEvent) => void;
      oneose?: () => void;
      onclose?: (r: string) => void;
    }
  ) {
    const f = filters[0];
    this.filters.push(f);
    const r = this.respond?.(f) ?? { events: this.match(f) };
    queueMicrotask(() => {
      if (r.hang) return;
      if (r.close !== undefined) return p.onclose?.(r.close);
      for (const e of r.events ?? []) p.onevent?.(e);
      p.oneose?.();
    });
    return { close: () => void this.closedSubs++ };
  }
  close() {
    this.connected = false;
  }
  private match(f: Filter): RelayEvent[] {
    return this.posts
      .filter((e) => (f.kinds ?? []).includes(e.kind))
      .filter((e) => f.since === undefined || e.created_at >= f.since)
      .filter((e) => f.until === undefined || e.created_at <= f.until)
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, f.limit ?? 500);
  }
}

function client(relay: FakeRelay, opts: { member?: boolean; timeoutMs?: number } = {}) {
  const connect = vi.fn(async (_url: string) => relay as RelayLike);
  const c = new FreshClient({
    connect,
    now: () => NOW,
    member: () => opts.member ?? false,
    timeoutMs: opts.timeoutMs
  });
  return { c, connect };
}

describe('isolation', () => {
  const src = readFileSync(new URL('./relay.ts', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);

  it('imports nothing but nostr-tools (no $ndk, NDK, event cache or app stores)', () => {
    expect(imports).toEqual(['nostr-tools/relay']);
  });

  it('connects only to wss://feed.zap.cooking, once, and reuses the connection', async () => {
    const relay = new FakeRelay([ev('a', NOW - 10)]);
    const { c, connect } = client(relay);
    await c.page();
    await c.page(NOW - 100);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith('wss://feed.zap.cooking');
  });

  it('never asks the relay to log in by itself (no onauth on the default connection)', () => {
    expect(src).not.toMatch(/onauth\s*=/);
    expect(src).not.toMatch(/\.auth\(/);
  });

  it('closes every finished request', async () => {
    const relay = new FakeRelay([ev('a', NOW - 10)]);
    const { c } = client(relay);
    await c.page();
    expect(relay.closedSubs).toBe(1);
  });
});

describe('the 14-day floor (non-members)', () => {
  it('asks only for the free window, with the feed kinds', async () => {
    const relay = new FakeRelay();
    const { c } = client(relay);
    await c.page();
    expect(relay.filters[0]).toEqual({ kinds: FRESH_KINDS, limit: 30, since: FLOOR });
  });

  it('never sends a request entirely older than the floor', async () => {
    const relay = new FakeRelay();
    const { c } = client(relay);
    const r = await c.page(FLOOR - 1);
    expect(r).toMatchObject({ state: 'ok', events: [], end: 'floor' });
    expect(relay.filters).toHaveLength(0);
  });

  it('keeps old recipes (served at any age) out of the feed', async () => {
    const relay = new FakeRelay([], () => ({
      events: [ev('new', NOW - 60), ev('oldrecipe', FLOOR - 86400 * 400, 30023)]
    }));
    const { c } = client(relay);
    const r = await c.page();
    expect(r.events.map((e) => e.id)).toEqual(['new']);
  });

  it('reports the floor when the window runs out', async () => {
    const relay = new FakeRelay([ev('a', NOW - 10), ev('b', FLOOR + 5), ev('old', FLOOR - 5)]);
    const { c } = client(relay);
    const r = await c.page();
    expect(r.events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(r.end).toBe('floor');
  });

  it('members ask without a floor and page into history', async () => {
    const relay = new FakeRelay([ev('a', NOW - 10), ev('old', FLOOR - 86400 * 365)]);
    const { c } = client(relay, { member: true });
    const r = await c.page(FLOOR - 1);
    expect(relay.filters[0]).toEqual({ kinds: FRESH_KINDS, limit: 30, until: FLOOR - 1 });
    expect(r.events.map((e) => e.id)).toEqual(['old']);
    expect(r.end).toBe('exhausted');
  });
});

describe('pagination', () => {
  const posts = Array.from({ length: 70 }, (_, i) => ev(`e${i}`, NOW - 100 - i * 60));

  it('walks newest first without gaps or repeats', async () => {
    const relay = new FakeRelay(posts);
    const { c } = client(relay);
    const ids: string[] = [];
    let until: number | undefined;
    for (let i = 0; i < 5; i++) {
      const r = await c.page(until);
      ids.push(...r.events.map((e) => e.id));
      until = r.nextUntil;
      if (r.end !== 'more') break;
    }
    expect(ids).toEqual(posts.map((e) => e.id));
  });

  it('keeps posts that share the boundary timestamp (inclusive until, de-duplicated)', async () => {
    const same = Array.from({ length: 5 }, (_, i) => ev(`s${i}`, NOW - 500));
    const relay = new FakeRelay([...same, ev('older', NOW - 900)]);
    const { c } = client(relay);
    const p1 = await c.page(undefined, 3);
    const p2 = await c.page(p1.nextUntil, 3);
    const p3 = await c.page(p2.nextUntil, 3);
    const ids = [...p1.events, ...p2.events, ...p3.events].map((e) => e.id).sort();
    expect(ids).toEqual(['older', 's0', 's1', 's2', 's3', 's4']);
  });

  it('steps past a second whose posts were all shown instead of stalling', async () => {
    const same = Array.from({ length: 3 }, (_, i) => ev(`s${i}`, NOW - 500));
    const relay = new FakeRelay([...same, ev('older', NOW - 900)]);
    const { c } = client(relay);
    const p1 = await c.page(undefined, 3);
    expect(p1.events).toHaveLength(3);
    const p2 = await c.page(p1.nextUntil, 3);
    expect(p2.events.map((e) => e.id)).toEqual(['older']);
  });

  it('reset() forgets what was shown (a full refresh)', async () => {
    const relay = new FakeRelay([ev('a', NOW - 10)]);
    const { c } = client(relay);
    await c.page();
    expect((await c.page()).events).toHaveLength(0);
    c.reset();
    expect((await c.page()).events).toHaveLength(1);
  });
});

describe('closes are states, not errors', () => {
  const cases: [string, string][] = [
    ['auth-required: posts older than 14 days are for members', 'auth-required'],
    ['restricted: members only', 'restricted'],
    ['error: something broke', 'unavailable'],
    ['', 'unavailable']
  ];
  for (const [reason, state] of cases) {
    it(`${JSON.stringify(reason)} → ${state}`, async () => {
      expect(stateOf(reason)).toBe(state);
      const relay = new FakeRelay([], () => ({ close: reason }));
      const { c } = client(relay, { member: true });
      const r = await c.page();
      expect(r).toMatchObject({ state, events: [] });
    });
  }

  it('does not retry after auth-required or restricted (no loops)', async () => {
    const relay = new FakeRelay([], () => ({ close: 'auth-required: login' }));
    const { c } = client(relay, { member: true });
    await c.page();
    expect(relay.filters).toHaveLength(1);
  });

  it('a request that never answers times out as unavailable', async () => {
    const relay = new FakeRelay([], () => ({ hang: true }));
    const { c } = client(relay, { timeoutMs: 20 });
    const r = await c.page();
    expect(r).toMatchObject({ state: 'unavailable', reason: 'request timeout' });
    expect(relay.closedSubs).toBe(1);
  });

  it('a failed connection is unavailable, and the next request tries again', async () => {
    const relay = new FakeRelay([ev('a', NOW - 10)]);
    let calls = 0;
    const c = new FreshClient({
      now: () => NOW,
      connect: async () => {
        if (++calls === 1) throw new Error('offline');
        return relay;
      }
    });
    expect((await c.page()).state).toBe('unavailable');
    expect((await c.page()).events).toHaveLength(1);
  });
});

describe('live tail', () => {
  it('delivers new posts once, skipping ones already on a page', async () => {
    const relay = new FakeRelay([ev('a', NOW - 10)]);
    const { c } = client(relay);
    await c.page();
    relay.posts.push(ev('b', NOW + 5));
    const got: string[] = [];
    const states: string[] = [];
    relay.filters = [];
    const stop = await c.subscribeNew(
      NOW - 60,
      (e) => got.push(e.id),
      (s) => states.push(s)
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(relay.filters[0]).toEqual({ kinds: FRESH_KINDS, since: NOW - 60 });
    expect(got).toEqual(['b']);
    stop();
    expect(relay.closedSubs).toBeGreaterThan(0);
    expect(states).toEqual([]);
  });

  it('reports a close as a state', async () => {
    const relay = new FakeRelay([], () => ({ close: 'restricted: nope' }));
    const { c } = client(relay);
    const states: string[] = [];
    await c.subscribeNew(
      NOW,
      () => {},
      (s) => states.push(s)
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(states).toEqual(['restricted']);
  });
});

describe('recipes (the recipe-box pool)', () => {
  it('asks for tagged long-form recipes and kind 35000, any age, paging until short', async () => {
    const many = Array.from({ length: 500 }, (_, i) => ev(`r${i}`, NOW - 1000 - i, 30023));
    const older = [ev('rold', NOW - 99999, 30023)];
    const relay = new FakeRelay([], (f) => {
      if (f.kinds?.[0] === 35000) return { events: [ev('g1', NOW - 50, 35000)] };
      return { events: f.until === undefined ? many : [many[499], ...older] };
    });
    const { c } = client(relay);
    const r = await c.recipes(['zapcooking', 'nostrcooking']);
    expect(relay.filters[0]).toEqual({
      kinds: [30023],
      '#t': ['zapcooking', 'nostrcooking'],
      limit: 500
    });
    expect(relay.filters[1].until).toBe(NOW - 1499);
    expect(relay.filters[2]).toEqual({ kinds: [35000], limit: 500 });
    expect(relay.filters.every((f) => f.since === undefined)).toBe(true);
    expect(r.state).toBe('ok');
    expect(r.events.length).toBe(502);
  });

  it('reports a close as a state', async () => {
    const relay = new FakeRelay([], () => ({ close: 'error: down' }));
    const { c } = client(relay);
    expect((await c.recipes(['zapcooking'])).state).toBe('unavailable');
  });
});
