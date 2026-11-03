/**
 * The live tail survives a dropped socket.
 *
 * Against the real nostr-tools Relay over a fake WebSocket: when the OS
 * closes the socket (iOS backgrounding, idle drops), nostr-tools does not
 * reconnect and the old subscribeNew() had no way back — a later page()
 * opened a new socket WITHOUT the live request, so new posts silently
 * stopped for the rest of the visit. liveTail() reports the loss and
 * revive() subscribes again from the newest post seen.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useWebSocketImplementation } from 'nostr-tools/relay';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { FreshClient } from './relay';

class FakeWS {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWS[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  constructor(public url: string) {
    FakeWS.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }
  send(m: string) {
    this.sent.push(m);
  }
  close() {
    this.readyState = 3;
  }
  reqs() {
    return this.sent.map((m) => JSON.parse(m)).filter((m) => m[0] === 'REQ');
  }
  push(msg: unknown[]) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  /** The OS kills the socket while the tab is in the background. */
  osKill() {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: '' });
  }
}

const sk = generateSecretKey();
const NOW_MS = Date.UTC(2026, 9, 7, 12, 0, 0);
const NOW = Math.floor(NOW_MS / 1000);
function signed(content: string, created_at: number) {
  return finalizeEvent({ kind: 1, created_at, tags: [], content }, sk);
}

beforeEach(() => {
  FakeWS.instances = [];
  useWebSocketImplementation(FakeWS);
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('live tail after a background socket drop', () => {
  it('reports the loss, and revive() subscribes again from the newest post seen', async () => {
    const client = new FreshClient();
    const live: string[] = [];
    const states: string[] = [];
    const tail = await client.liveTail(NOW - 60, (e) => live.push(e.content), (s) => states.push(s));
    await vi.advanceTimersByTimeAsync(0);
    const ws1 = FakeWS.instances[0];
    const req1 = ws1.reqs()[0];
    expect(req1[2]).toEqual({ kinds: [1, 30023, 35000, 1068], since: NOW - 60 });
    expect(tail.lost).toBe(false);

    ws1.push(['EVENT', req1[1], signed('before background', NOW)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(live).toEqual(['before background']);

    ws1.osKill();
    await vi.advanceTimersByTimeAsync(0);
    expect(tail.lost).toBe(true);
    expect(states).toEqual(['unavailable']);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(FakeWS.instances).toHaveLength(1); // nostr-tools does not reconnect on its own

    // The tab comes back: the feed revives the tail.
    expect(await tail.revive()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWS.instances).toHaveLength(2);
    const ws2 = FakeWS.instances[1];
    const req2 = ws2.reqs()[0];
    expect(req2[2]).toEqual({ kinds: [1, 30023, 35000, 1068], since: NOW + 1 }); // newest seen + 1
    expect(tail.lost).toBe(false);

    ws2.push(['EVENT', req2[1], signed('after foreground', NOW + 120)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(live).toEqual(['before background', 'after foreground']);
  });

  it('a page() after the drop opens a new socket; revive() adds the live request to it', async () => {
    const client = new FreshClient();
    const live: string[] = [];
    const tail = await client.liveTail(NOW - 60, (e) => live.push(e.content));
    await vi.advanceTimersByTimeAsync(0);
    FakeWS.instances[0].osKill();
    await vi.advanceTimersByTimeAsync(0);

    const p = client.page();
    await vi.advanceTimersByTimeAsync(0);
    const ws2 = FakeWS.instances[1];
    expect(ws2.reqs()).toHaveLength(1); // only the page request so far
    ws2.push(['EOSE', ws2.reqs()[0][1]]);
    await vi.advanceTimersByTimeAsync(0);
    expect((await p).state).toBe('ok');

    expect(await tail.revive()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWS.instances).toHaveLength(2); // reused the page's connection
    const liveReq = ws2.reqs()[1];
    expect(liveReq[2]).toMatchObject({ since: NOW - 60 }); // nothing seen yet: the original since
    ws2.push(['EVENT', liveReq[1], signed('after foreground', NOW + 120)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(live).toEqual(['after foreground']);
  });

  it('revive() does nothing while the tail is healthy or after stop()', async () => {
    const client = new FreshClient();
    const tail = await client.liveTail(NOW - 60, () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(await tail.revive()).toBe(false);
    expect(FakeWS.instances).toHaveLength(1);
    FakeWS.instances[0].osKill();
    await vi.advanceTimersByTimeAsync(0);
    tail.stop();
    expect(await tail.revive()).toBe(false);
    expect(FakeWS.instances).toHaveLength(1);
  });

  it('subscribeNew() still returns a stop function (compatibility)', async () => {
    const client = new FreshClient();
    const stop = await client.subscribeNew(NOW - 60, () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(typeof stop).toBe('function');
    stop();
  });
});

describe('nostr-tools contract the login relies on', () => {
  it('Relay keeps its auth promise in a field named authPromise (MemberLogin clears it on a failed login)', async () => {
    const { Relay } = await import('nostr-tools/relay');
    const relay = new Relay('wss://feed.zap.cooking');
    expect('authPromise' in relay || Object.getOwnPropertyNames(relay).includes('authPromise') || (relay as any).authPromise === undefined).toBe(true);
    // The class body declares the field; an instance exposes it as own property.
    expect(Object.getOwnPropertyNames(relay)).toContain('authPromise');
  });
});
