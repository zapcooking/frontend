import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NDKRelayStatus } from '@nostr-dev-kit/ndk';
import type NDK from '@nostr-dev-kit/ndk';
import { ConnectionManager, relayQuorumTarget } from './connectionManager';

/**
 * Quorum readiness tests with a staggered-connect fake pool.
 *
 * The repro test at the bottom is the deterministic reproduction of the
 * cold-session fetch miss described in docs/ndk-readiness-discovery.md:
 * a closeOnEose-style fetch only sees events from relays connected at
 * gate-resolution time (NDK 2.10's EOSE heuristic counts only currently-
 * connected relays and the subscription stops at EOSE), so a first-relay
 * gate misses events that live on later-connecting relays.
 */

interface FakeRelay {
  url: string;
  status: NDKRelayStatus;
}

class FakePool {
  relays = new Map<string, FakeRelay>();
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  on(event: string, cb: (...args: unknown[]) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
  }

  emit(event: string, ...args: unknown[]) {
    for (const cb of this.listeners.get(event) ?? []) cb(...args);
  }
}

function makeFakeNdk(relayUrls: string[]): { ndk: NDK; pool: FakePool } {
  const pool = new FakePool();
  for (const url of relayUrls) {
    pool.relays.set(url, { url, status: NDKRelayStatus.DISCONNECTED });
  }
  const ndk = {
    explicitRelayUrls: relayUrls,
    pool
  } as unknown as NDK;
  return { ndk, pool };
}

function connectRelay(pool: FakePool, url: string) {
  const relay = pool.relays.get(url)!;
  relay.status = NDKRelayStatus.CONNECTED;
  pool.emit('relay:connect', relay);
}

function urls(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `wss://relay${i + 1}.test`);
}

/**
 * The OLD readiness predicate, reimplemented verbatim in spirit: poll until
 * ANY single relay is connected. Kept here (not in the manager) purely so the
 * repro test can contrast old vs new semantics on the same timeline.
 */
function waitForFirstRelayLegacy(pool: FakePool, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const anyConnected = Array.from(pool.relays.values()).some(
        (r) => r.status >= NDKRelayStatus.CONNECTED
      );
      if (anyConnected || Date.now() - startTime > timeoutMs) {
        clearInterval(interval);
        resolve();
      }
    }, 50);
  });
}

describe('relayQuorumTarget', () => {
  it('clamps to 1 for a single-relay pool (members mode unchanged)', () => {
    expect(relayQuorumTarget(1)).toBe(1);
  });

  it('requires both relays of a 2-relay pool', () => {
    expect(relayQuorumTarget(2)).toBe(2);
  });

  it('requires 2 of 3', () => {
    expect(relayQuorumTarget(3)).toBe(2);
  });

  it('requires 3 of 5 (standard pool)', () => {
    expect(relayQuorumTarget(5)).toBe(3);
  });

  it('scales at 60% for larger pools', () => {
    expect(relayQuorumTarget(10)).toBe(6);
  });

  it('never exceeds the pool size', () => {
    for (let m = 1; m <= 12; m++) {
      expect(relayQuorumTarget(m)).toBeLessThanOrEqual(m);
    }
  });
});

describe('ConnectionManager.waitForRelayQuorum', () => {
  let manager: ConnectionManager | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    manager?.destroy();
    manager = null;
    vi.useRealTimers();
  });

  it('M=5: resolves at the 3rd connect, not the 1st', async () => {
    const { ndk, pool } = makeFakeNdk(urls(5));
    manager = new ConnectionManager(ndk);

    const resolved = vi.fn();
    const wait = manager.waitForRelayQuorum(4000).then(resolved);

    setTimeout(() => connectRelay(pool, 'wss://relay1.test'), 100);
    setTimeout(() => connectRelay(pool, 'wss://relay2.test'), 800);
    setTimeout(() => connectRelay(pool, 'wss://relay3.test'), 1500);

    await vi.advanceTimersByTimeAsync(200);
    expect(resolved).not.toHaveBeenCalled(); // 1/5 — old semantics would have resolved here

    await vi.advanceTimersByTimeAsync(700); // t=900, 2/5
    expect(resolved).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(700); // t=1600, 3/5 = quorum
    expect(resolved).toHaveBeenCalled();
    await wait;
  });

  it('M=5: all-connected before the call resolves immediately', async () => {
    const { ndk, pool } = makeFakeNdk(urls(5));
    manager = new ConnectionManager(ndk);
    for (const url of urls(5)) connectRelay(pool, url);

    const resolved = vi.fn();
    const wait = manager.waitForRelayQuorum(4000).then(resolved);
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toHaveBeenCalled();
    await wait;
  });

  it('M=2: quorum is both relays — 1 of 2 is not ready', async () => {
    const { ndk, pool } = makeFakeNdk(urls(2));
    manager = new ConnectionManager(ndk);

    const resolved = vi.fn();
    const wait = manager.waitForRelayQuorum(4000).then(resolved);

    setTimeout(() => connectRelay(pool, 'wss://relay1.test'), 100);
    setTimeout(() => connectRelay(pool, 'wss://relay2.test'), 1000);

    await vi.advanceTimersByTimeAsync(500);
    expect(resolved).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(600); // t=1100, 2/2
    expect(resolved).toHaveBeenCalled();
    await wait;
  });

  it('M=1 (members mode): resolves on the single relay, waits until it connects', async () => {
    const { ndk, pool } = makeFakeNdk(urls(1));
    manager = new ConnectionManager(ndk);

    const resolved = vi.fn();
    const wait = manager.waitForRelayQuorum(4000).then(resolved);

    await vi.advanceTimersByTimeAsync(300);
    expect(resolved).not.toHaveBeenCalled();

    connectRelay(pool, 'wss://relay1.test');
    await vi.advanceTimersByTimeAsync(100);
    expect(resolved).toHaveBeenCalled();
    await wait;
  });

  it('counts relays past CONNECTED (mid-NIP-42 auth) toward quorum', async () => {
    const { ndk, pool } = makeFakeNdk(urls(1));
    manager = new ConnectionManager(ndk);

    pool.relays.get('wss://relay1.test')!.status = NDKRelayStatus.AUTHENTICATED;

    const resolved = vi.fn();
    const wait = manager.waitForRelayQuorum(4000).then(resolved);
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toHaveBeenCalled();
    await wait;
  });

  it('never hangs: resolves at the cap when no relay ever connects', async () => {
    const { ndk } = makeFakeNdk(urls(5));
    manager = new ConnectionManager(ndk);

    const resolved = vi.fn();
    const wait = manager.waitForRelayQuorum(4000).then(resolved);

    await vi.advanceTimersByTimeAsync(3900);
    expect(resolved).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300); // past the 4s cap
    expect(resolved).toHaveBeenCalled();
    await wait;
  });

  it('deterministic repro: first-relay gate misses late-relay events, quorum gate does not', async () => {
    const { ndk, pool } = makeFakeNdk(urls(5));
    manager = new ConnectionManager(ndk);

    // The target event lives ONLY on relay3, which connects late.
    const eventsByRelay: Record<string, string[]> = {
      'wss://relay1.test': ['e-common'],
      'wss://relay2.test': ['e-common'],
      'wss://relay3.test': ['e-common', 'e-target'],
      'wss://relay4.test': [],
      'wss://relay5.test': []
    };

    // Models fetchEvents(closeOnEose): the result set is whatever the relays
    // connected at gate-resolution time hold — EOSE fires over the connected
    // subset and the subscription stops, so later connects deliver nothing.
    const fetchSnapshot = (): string[] => {
      const seen = new Set<string>();
      for (const relay of pool.relays.values()) {
        if (relay.status >= NDKRelayStatus.CONNECTED) {
          for (const id of eventsByRelay[relay.url]) seen.add(id);
        }
      }
      return [...seen];
    };

    setTimeout(() => connectRelay(pool, 'wss://relay1.test'), 100);
    setTimeout(() => connectRelay(pool, 'wss://relay2.test'), 1200);
    setTimeout(() => connectRelay(pool, 'wss://relay3.test'), 1500);
    setTimeout(() => connectRelay(pool, 'wss://relay4.test'), 2000);
    // relay5 never connects

    let oldResult: string[] | null = null;
    let newResult: string[] | null = null;
    const oldGate = waitForFirstRelayLegacy(pool).then(() => {
      oldResult = fetchSnapshot();
    });
    const newGate = manager.waitForRelayQuorum(4000).then(() => {
      newResult = fetchSnapshot();
    });

    await vi.advanceTimersByTimeAsync(2500);
    await Promise.all([oldGate, newGate]);

    // OLD semantics: gate opened on relay1 alone — the fetch misses e-target.
    expect(oldResult).toContain('e-common');
    expect(oldResult).not.toContain('e-target');

    // NEW semantics: gate opened at 3-of-5 (relay3 included) — e-target found.
    expect(newResult).toContain('e-target');
  });
});
