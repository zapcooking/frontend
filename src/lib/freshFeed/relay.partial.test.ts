/**
 * A page that ends early keeps what arrived.
 *
 * FreshClient.query() used to resolve {state:'unavailable', events: []} when
 * the silence timer fired (or the connection dropped) before EOSE — after
 * the same events had already been streamed to the screen. The feed then
 * showed "unavailable" over posts the reader could see, or, on the first
 * page, "Nothing fresh yet". Now such a page is {state:'ok', partial:true}
 * with the events, end 'more', and nextUntil at the oldest received.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Params = {
  onevent?: (e: unknown) => void;
  oneose?: () => void;
  onclose?: (r: string) => void;
  eoseTimeout?: number;
};

const script: {
  mode: 'stream-no-eose' | 'stream-then-eose' | 'trickle-no-eose' | 'stream-then-drop' | 'stream-then-restricted';
  events: unknown[];
  subs: { filters: any[]; params: Params; closed: boolean }[];
} = { mode: 'stream-no-eose', events: [], subs: [] };

vi.mock('nostr-tools/relay', () => ({
  Relay: {
    connect: vi.fn(async () => ({
      connected: true,
      close() {},
      subscribe(filters: unknown[], params: Params) {
        const rec = { filters: filters as any[], params, closed: false };
        script.subs.push(rec);
        if (script.mode === 'trickle-no-eose') {
          for (const e of script.events.slice(0, 6)) params.onevent?.(e);
          setTimeout(() => {
            for (const e of script.events.slice(6)) params.onevent?.(e);
          }, 6000);
        } else {
          for (const e of script.events) params.onevent?.(e);
          if (script.mode === 'stream-then-eose') queueMicrotask(() => params.oneose?.());
          if (script.mode === 'stream-then-drop') queueMicrotask(() => params.onclose?.('connection closed'));
          if (script.mode === 'stream-then-restricted')
            queueMicrotask(() => params.onclose?.('restricted: members only'));
        }
        return {
          close: () => {
            rec.closed = true;
          }
        };
      }
    }))
  }
}));

import { FreshClient } from './relay';
import { takeFirstPage, resetFirstPageForTests } from './firstPage';

const NOW_MS = Date.UTC(2026, 9, 7, 12, 0, 0);
const NOW = Math.floor(NOW_MS / 1000);

function events(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i.toString(16).padStart(64, '0'),
    pubkey: (i % 4).toString(16).repeat(64),
    created_at: NOW - 60 * (i + 1),
    kind: 1,
    tags: [],
    content: `post ${i}`,
    sig: 's'.repeat(128)
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
  script.events = events(12);
  script.subs = [];
  resetFirstPageForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a page that ends early keeps what arrived', () => {
  it('silence after 12 streamed events: ok, partial, the 12 events, more from the oldest', async () => {
    script.mode = 'stream-no-eose';
    const client = new FreshClient();
    const streamed: string[] = [];
    let result: Awaited<ReturnType<FreshClient['page']>> | null = null;
    client.page(undefined, 30, (e) => streamed.push(e.id)).then((r) => (result = r));

    await vi.advanceTimersByTimeAsync(9_999);
    expect(streamed).toHaveLength(12);
    expect(result).toBeNull();

    await vi.advanceTimersByTimeAsync(2);
    expect(result).not.toBeNull();
    expect(result!).toMatchObject({ state: 'ok', partial: true, end: 'more', reason: 'request timeout' });
    expect(result!.events).toHaveLength(12);
    expect(result!.nextUntil).toBe(NOW - 60 * 12);
    expect(script.subs[0].closed).toBe(true);
  });

  it('silence with nothing received is still unavailable', async () => {
    script.mode = 'stream-no-eose';
    script.events = [];
    const client = new FreshClient();
    const p = client.page();
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await p).toMatchObject({ state: 'unavailable', events: [], reason: 'request timeout' });
  });

  it('a dropped connection after posts arrived is a partial page too', async () => {
    script.mode = 'stream-then-drop';
    const client = new FreshClient();
    const r = await client.page();
    expect(r).toMatchObject({ state: 'ok', partial: true, end: 'more' });
    expect(r.events).toHaveLength(12);
  });

  it("a restricted: close is the relay's verdict: no partial page, events dropped", async () => {
    script.mode = 'stream-then-restricted';
    const client = new FreshClient();
    const r = await client.page();
    expect(r).toMatchObject({ state: 'restricted', events: [] });
  });

  it('control: the same 12 events then EOSE is a complete page', async () => {
    script.mode = 'stream-then-eose';
    const client = new FreshClient();
    const r = await client.page();
    expect(r).toMatchObject({ state: 'ok', end: 'floor' });
    expect(r.partial).toBeUndefined();
    expect(r.events).toHaveLength(12);
  });

  it('the silence timer still restarts with every event', async () => {
    script.mode = 'trickle-no-eose';
    const client = new FreshClient();
    let result: Awaited<ReturnType<FreshClient['page']>> | null = null;
    client.page().then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(15_999);
    expect(result).toBeNull();
    await vi.advanceTimersByTimeAsync(2);
    expect(result!).toMatchObject({ state: 'ok', partial: true });
    expect(result!.events).toHaveLength(12);
  });

  it('the next page after a partial one continues from the oldest received, without repeats', async () => {
    script.mode = 'stream-no-eose';
    const client = new FreshClient();
    const p1 = client.page();
    await vi.advanceTimersByTimeAsync(10_001);
    const r1 = await p1;
    expect(r1.partial).toBe(true);
    // The relay answers the continuation with the same 12 (overlap) — all seen.
    const p2 = client.page(r1.nextUntil);
    await vi.advanceTimersByTimeAsync(10_001);
    const r2 = await p2;
    expect(script.subs[1].filters[0]).toMatchObject({ until: NOW - 60 * 12 });
    expect(r2.events).toHaveLength(0);
  });

  it('takeFirstPage streams 12 posts and hands loadFirst() the same 12 as a partial page', async () => {
    script.mode = 'stream-no-eose';
    const client = new FreshClient();
    const onEvent = vi.fn();
    const { result } = takeFirstPage(client, onEvent);
    let r: Awaited<typeof result> | null = null;
    result.then((x) => (r = x));
    await vi.advanceTimersByTimeAsync(10_001);
    expect(onEvent).toHaveBeenCalledTimes(12);
    expect(r!).toMatchObject({ state: 'ok', partial: true, end: 'more' });
    expect(r!.events).toHaveLength(12);
  });
});
