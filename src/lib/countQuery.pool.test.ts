import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('./nostr', () => ({ ndk: {} }));

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  closed = false;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  // Test helpers
  simulateOpen() {
    this.onopen?.();
  }

  simulateMessage(payload: unknown[]) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

describe('countQuery socket pool', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules(); // fresh pool / support-set state per test
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shares one socket per relay across concurrent queries, multiplexed by subId', async () => {
    const { fetchCount } = await import('./countQuery');

    const pendingA = fetchCount({ kinds: [7], '#e': ['event-a'] }, { relays: ['wss://test.relay'], timeout: 5000 });
    const pendingB = fetchCount({ kinds: [1], '#e': ['event-b'] }, { relays: ['wss://test.relay'], timeout: 5000 });

    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWebSocket.instances).toHaveLength(1); // one socket, not two
    const ws = FakeWebSocket.instances[0];

    ws.simulateOpen();
    await vi.advanceTimersByTimeAsync(0);
    expect(ws.sent).toHaveLength(2);

    const frames = ws.sent.map((s) => JSON.parse(s) as unknown[]);
    expect(frames.every((f) => f[0] === 'COUNT')).toBe(true);
    const subIds = frames.map((f) => f[1] as string);
    expect(new Set(subIds).size).toBe(2); // distinct subIds

    ws.simulateMessage(['COUNT', subIds[0], { count: 11 }]);
    ws.simulateMessage(['COUNT', subIds[1], { count: 22 }]);

    const [a, b] = await Promise.all([pendingA, pendingB]);
    expect(a?.count).toBe(11);
    expect(b?.count).toBe(22);

    // Idle after last release -> socket closes.
    await vi.advanceTimersByTimeAsync(11_000);
    expect(ws.closed).toBe(true);
  });

  it('resolves pending queries as null when the relay drops the socket', async () => {
    const { fetchCount } = await import('./countQuery');

    const pending = fetchCount({ kinds: [7], '#e': ['event-x'] }, { relays: ['wss://test.relay'], timeout: 5000 });
    await vi.advanceTimersByTimeAsync(0);
    const ws = FakeWebSocket.instances[0];
    ws.simulateOpen();
    await vi.advanceTimersByTimeAsync(0);

    ws.close(); // relay drops us
    expect(await pending).toBeNull();
  });

  it('reuses the socket for queries arriving within the idle window', async () => {
    const { fetchCount } = await import('./countQuery');

    const first = fetchCount({ kinds: [7], '#e': ['e1'] }, { relays: ['wss://test.relay'], timeout: 5000 });
    await vi.advanceTimersByTimeAsync(0);
    const ws = FakeWebSocket.instances[0];
    ws.simulateOpen();
    await vi.advanceTimersByTimeAsync(0);
    ws.simulateMessage(['COUNT', JSON.parse(ws.sent[0])[1], { count: 1 }]);
    expect((await first)?.count).toBe(1);

    // Before the 10s idle close fires, a second query arrives.
    await vi.advanceTimersByTimeAsync(5_000);
    const second = fetchCount({ kinds: [7], '#e': ['e2'] }, { relays: ['wss://test.relay'], timeout: 5000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWebSocket.instances).toHaveLength(1); // still one socket
    ws.simulateMessage(['COUNT', JSON.parse(ws.sent[1])[1], { count: 2 }]);
    expect((await second)?.count).toBe(2);

    await vi.advanceTimersByTimeAsync(11_000);
    expect(ws.closed).toBe(true);
  });
});
