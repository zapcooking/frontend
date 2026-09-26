import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event, Filter } from 'nostr-tools';

/** zap's Lazarus relay adapter: the I/O half the vendored core injects.
 * jank's service mocks are replaced here with mocks of zap's seams —
 * SimplePool.subscribeMany, the kind-10002 relay-list cache, and the app's
 * configured relays — pinning the same behaviors: relay-set assembly,
 * paging, timeout handling, and the newest-version pre-check. */

vi.mock('$lib/nostr', () => ({
  getCurrentRelays: () => ['wss://default']
}));

// Faithful mini-version of $lib/relayListCache's normalizeRelayUrl: lowercase,
// ensure wss://, strip trailing slashes.
vi.mock('$lib/relayListCache', () => ({
  normalizeRelayUrl: (url: string) => {
    let normalized = url.trim().toLowerCase();
    if (!normalized.startsWith('wss://') && !normalized.startsWith('ws://')) {
      normalized = 'wss://' + normalized;
    }
    try {
      const parsed = new URL(normalized);
      let path = parsed.pathname;
      while (path.endsWith('/') && path.length > 1) path = path.slice(0, -1);
      return `${parsed.protocol}//${parsed.host}${path === '/' ? '' : path}`;
    } catch {
      return normalized.replace(/\/+$/, '');
    }
  },
  relayListCache: {
    get: vi.fn()
  }
}));

const subscribeMany = vi.fn();
const destroy = vi.fn();

vi.mock('nostr-tools/pool', () => ({
  SimplePool: vi.fn().mockImplementation(() => ({ subscribeMany, close: vi.fn(), destroy }))
}));

import { relayListCache } from '$lib/relayListCache';
import { getLazarusKindProfile, LAZARUS_REGISTRY } from './registry';
import { lazarusScanReachedNoRelay, scanLazarusKind, LAZARUS_ARCHIVAL_RELAYS } from './recovery';
import {
  closeLazarusScanPool,
  fetchLatestLazarusVersion,
  getLazarusPublishRelays,
  getLazarusScanPlan,
  zapLazarusRelaySource
} from './source';

const mockedRelayListGet = vi.mocked(relayListCache.get);

let counter = 0;
function makeEvent(overrides: Partial<Event> = {}): Event {
  counter += 1;
  return {
    id: counter.toString(16).padStart(64, '0'),
    pubkey: 'test-pubkey',
    created_at: 1000 + counter,
    kind: 3,
    tags: [],
    content: '',
    sig: 'test-sig',
    ...overrides
  } as Event;
}

function followListEvent(count: number, createdAt: number): Event {
  return {
    ...makeEvent({ created_at: createdAt, kind: 3 }),
    tags: Array.from({ length: count }, (_, i) => ['p', `pk${i}`])
  };
}

interface Handlers {
  onevent?: (event: Event) => void;
  oneose?: () => void;
  onclose?: () => void;
}

/** Serve a fixed history from one relay through the mocked pool. */
function serve(relay: string, events: Event[], honorUntil = true) {
  subscribeMany.mockImplementation((urls: string[], filter: Filter, handlers: Handlers) => {
    const { until, limit = 50 } = filter as { until?: number; limit?: number };
    queueMicrotask(() => {
      if (urls[0] === relay) {
        events
          .filter((event) => !honorUntil || until === undefined || event.created_at <= until)
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, limit)
          .forEach((event) => handlers.onevent?.(event));
      }
      handlers.oneose?.();
    });
    return { close: vi.fn() };
  });
}

beforeEach(() => {
  mockedRelayListGet.mockResolvedValue({ read: [], write: [], updatedAt: 0 });
});

afterEach(() => {
  subscribeMany.mockReset();
  mockedRelayListGet.mockReset();
});

/** Every relay's connection fails before EOSE. */
function failAll() {
  subscribeMany.mockImplementation((_urls: string[], _filter: Filter, handlers: Handlers) => {
    queueMicrotask(() => handlers.onclose?.());
    return { close: vi.fn() };
  });
}

describe('getLazarusScanPlan', () => {
  it('scans every user relay (read and write), the app defaults, and the archival set', async () => {
    mockedRelayListGet.mockResolvedValueOnce({
      read: ['wss://hist.nostr.land/', 'wss://r1/'],
      write: ['wss://w1/', 'wss://w2/', 'wss://w3/', 'wss://w4/', 'wss://w5/', 'wss://w6/'],
      updatedAt: 0
    });
    const { relays, relayList } = await getLazarusScanPlan('pubkey');
    expect(relayList).toBe('found');
    // Past the first few write relays, and read relays too
    for (const expected of ['wss://w6', 'wss://r1', 'wss://default']) {
      expect(relays).toContain(expected);
    }
    for (const url of LAZARUS_ARCHIVAL_RELAYS) {
      expect(relays).toContain(url.replace(/\/$/, ''));
    }
    // A user relay that is also archival is scanned once
    expect(relays.filter((url) => url === 'wss://hist.nostr.land')).toHaveLength(1);
    expect(new Set(relays).size).toBe(relays.length);
  });

  it('looks the relay list up itself when the cache has none, taking the newest', async () => {
    mockedRelayListGet.mockRejectedValueOnce(new Error('offline'));
    const relayListEvent = (createdAt: number, url: string) =>
      makeEvent({ kind: 10002, created_at: createdAt, tags: [['r', url, 'write']] });
    serve('wss://default', [relayListEvent(1000, 'wss://old/'), relayListEvent(2000, 'wss://new/')]);
    const plan = await getLazarusScanPlan('test-pubkey');
    expect(plan.relayList).toBe('found');
    expect(plan.write).toEqual(['wss://new']);
  });

  it('lets the app relays stand in when relays answered without a relay list', async () => {
    mockedRelayListGet.mockRejectedValueOnce(new Error('offline'));
    serve('wss://none', []);
    const plan = await getLazarusScanPlan('pubkey');
    expect(plan.relayList).toBe('missing');
    expect(plan.write).toEqual(['wss://default']);
    expect(plan.relays).toContain('wss://hist.nostr.land');
  });

  it('never substitutes the app relays when no relay answered the lookup', async () => {
    mockedRelayListGet.mockRejectedValueOnce(new Error('offline'));
    failAll();
    const plan = await getLazarusScanPlan('pubkey');
    expect(plan.relayList).toBe('unknown');
    expect(plan.write).toEqual([]);
    // The default and archival sets are still scanned
    expect(plan.relays).toContain('wss://default');
    expect(plan.relays).toContain('wss://hist.nostr.land');
  });
});

describe('getLazarusPublishRelays', () => {
  it('judges success on the write relays and sends the rest as extras', async () => {
    mockedRelayListGet.mockResolvedValueOnce({
      read: ['wss://r1/'],
      write: ['wss://w1/', 'wss://w2/'],
      updatedAt: 0
    });
    const relays = await getLazarusPublishRelays('pubkey', ['wss://hist.nostr.land', 'wss://w1/']);
    expect(relays).toEqual({ write: ['wss://w1', 'wss://w2'], extra: ['wss://hist.nostr.land'] });
  });

  it('falls back to the app relays when the user has no relay list', async () => {
    mockedRelayListGet.mockRejectedValueOnce(new Error('offline'));
    serve('wss://none', []);
    expect(await getLazarusPublishRelays('pubkey', ['wss://a/'])).toEqual({
      write: ['wss://default'],
      extra: ['wss://a']
    });
  });
});

describe('zapLazarusRelaySource.fetchVersions', () => {
  const HISTORY_RELAY = 'wss://hist.nostr.land';
  // 70 versions on one relay: more than one page.
  const history = Array.from({ length: 70 }, (_, i) => followListEvent(10, 1000 + i));

  it('pages back from relays that filled a page', async () => {
    serve(HISTORY_RELAY, history);
    const scan = await scanLazarusKind(3, 'test-pubkey', zapLazarusRelaySource);
    expect(scan.candidates).toHaveLength(50);
    expect(scan.olderCursors).toEqual({ [HISTORY_RELAY]: 1020 });

    const profile = getLazarusKindProfile(3)!;
    const { loadOlderLazarusVersions } = await import('./recovery');
    const older = await loadOlderLazarusVersions(profile, scan, 'test-pubkey', zapLazarusRelaySource);
    expect(older.candidates).toHaveLength(70);
    expect(older.olderCursors).toEqual({});
  });

  it('stops paging a relay that ignores until', async () => {
    serve(HISTORY_RELAY, history, false);
    const scan = await scanLazarusKind(3, 'test-pubkey', zapLazarusRelaySource);
    const profile = getLazarusKindProfile(3)!;
    const { loadOlderLazarusVersions } = await import('./recovery');
    const older = await loadOlderLazarusVersions(profile, scan, 'test-pubkey', zapLazarusRelaySource);
    expect(older.candidates).toHaveLength(50);
    expect(older.olderCursors).toEqual({});
  });

  it('closes relay subscriptions that time out, and fails a scan no relay answered', async () => {
    vi.useFakeTimers();
    try {
      const close = vi.fn();
      subscribeMany.mockImplementation(() => ({ close }));
      const pending = scanLazarusKind(3, 'test-pubkey', zapLazarusRelaySource);
      // Attach the rejection handler before the timers fire
      const failed = expect(pending).rejects.toThrow('No relay answered the scan');
      // The relay list lookup times out, then the scan
      await vi.advanceTimersByTimeAsync(12000);
      await failed;
      expect(close).toHaveBeenCalledTimes(subscribeMany.mock.calls.length);
    } finally {
      vi.useRealTimers();
    }
  });

  it('records how each relay ended, keeping versions sent before a failure', async () => {
    mockedRelayListGet.mockResolvedValue({ read: [], write: ['wss://w1/'], updatedAt: 0 });
    const partial = followListEvent(5, 1000);
    subscribeMany.mockImplementation((urls: string[], _filter: Filter, handlers: Handlers) => {
      queueMicrotask(() => {
        if (urls[0] === HISTORY_RELAY) {
          // Sends a version, then its connection drops before EOSE
          handlers.onevent?.(partial);
          return handlers.onclose?.();
        }
        if (urls[0] === 'wss://w1') return handlers.onclose?.();
        handlers.oneose?.();
      });
      return { close: vi.fn() };
    });
    const scan = await scanLazarusKind(3, 'test-pubkey', zapLazarusRelaySource);
    expect(scan.candidates.map((c) => c.event.id)).toEqual([partial.id]);
    expect(scan.relayOutcomes?.[HISTORY_RELAY]).toBe('failed');
    expect(scan.relayOutcomes?.['wss://w1']).toBe('failed');
    expect(scan.relayOutcomes?.['wss://default']).toBe('answered');
    // The only write relay failed, so current is unconfirmed
    expect(scan.currentConfirmed).toBe(false);
    expect(lazarusScanReachedNoRelay(scan)).toBe(false);
  });

  it('recommends nothing while no write relay answered', async () => {
    mockedRelayListGet.mockResolvedValue({ read: [], write: ['wss://w1/'], updatedAt: 0 });
    // A clear clobber on the history relay: 40 follows, then 3
    const full = followListEvent(40, 1000);
    const clobbered = followListEvent(3, 2000);
    const serveClobber = (writeRelayAnswers: boolean) =>
      subscribeMany.mockImplementation((urls: string[], _filter: Filter, handlers: Handlers) => {
        queueMicrotask(() => {
          if (urls[0] === 'wss://w1' && !writeRelayAnswers) return handlers.onclose?.();
          if (urls[0] === HISTORY_RELAY) [full, clobbered].forEach((e) => handlers.onevent?.(e));
          handlers.oneose?.();
        });
        return { close: vi.fn() };
      });
    serveClobber(true);
    expect((await scanLazarusKind(3, 'test-pubkey', zapLazarusRelaySource)).recommended?.event.id).toBe(
      full.id
    );
    serveClobber(false);
    const unconfirmed = await scanLazarusKind(3, 'test-pubkey', zapLazarusRelaySource);
    expect(unconfirmed.currentConfirmed).toBe(false);
    expect(unconfirmed.recommended).toBeUndefined();
  });

  it('shows versions that arrived even when no relay answered', async () => {
    mockedRelayListGet.mockResolvedValue({ read: [], write: ['wss://w1/'], updatedAt: 0 });
    const partial = followListEvent(5, 1000);
    subscribeMany.mockImplementation((urls: string[], _filter: Filter, handlers: Handlers) => {
      queueMicrotask(() => {
        if (urls[0] === HISTORY_RELAY) handlers.onevent?.(partial);
        handlers.onclose?.();
      });
      return { close: vi.fn() };
    });
    const scan = await scanLazarusKind(3, 'test-pubkey', zapLazarusRelaySource);
    expect(scan.candidates.map((c) => c.event.id)).toEqual([partial.id]);
    expect(lazarusScanReachedNoRelay(scan)).toBe(true);
  });

  it('drops events from another author or kind, even when the relay ignores the filter', async () => {
    const valid = followListEvent(4, 1000);
    const foreignAuthor = { ...followListEvent(9, 1001), pubkey: 'someone-else' } as Event;
    const wrongKind = { ...followListEvent(9, 1002), kind: 1 } as Event;
    serve('wss://default', [foreignAuthor, valid, wrongKind]);
    const scan = await scanLazarusKind(3, 'test-pubkey', zapLazarusRelaySource);
    expect(scan.candidates.map((c) => c.event.id)).toEqual([valid.id]);
    expect(scan.respondingRelays).toEqual(['wss://default']);
  });

  it('counts a relay that answered with only foreign events as having nothing', async () => {
    mockedRelayListGet.mockResolvedValueOnce({
      read: [],
      write: ['wss://hostile/'],
      updatedAt: 0
    });
    const foreign = { ...followListEvent(9, 1001), pubkey: 'someone-else' } as Event;
    serve('wss://hostile', [foreign]);
    const scan = await scanLazarusKind(3, 'test-pubkey', zapLazarusRelaySource);
    expect(scan.candidates).toHaveLength(0);
    expect(scan.respondingRelays).toEqual([]);
    expect(scan.relayOutcomes?.['wss://hostile']).toBe('answered');
  });
});

describe('closeLazarusScanPool', () => {
  it('destroys the pool so every socket closes — close([]) would close none', async () => {
    serve('wss://default', [followListEvent(3, 1000)]);
    await scanLazarusKind(3, 'test-pubkey', zapLazarusRelaySource);
    expect(destroy).not.toHaveBeenCalled();
    closeLazarusScanPool();
    expect(destroy).toHaveBeenCalledTimes(1);
    // The next scan makes a fresh pool
    await scanLazarusKind(3, 'test-pubkey', zapLazarusRelaySource);
    closeLazarusScanPool();
    expect(destroy).toHaveBeenCalledTimes(2);
  });
});

describe('fetchLatestLazarusVersion', () => {
  it('finds the newest version on the write relays before a restore', async () => {
    mockedRelayListGet.mockResolvedValue({
      read: [],
      write: ['wss://w1/', 'wss://w2/'],
      updatedAt: 0
    });
    const older = followListEvent(5, 1000);
    const newer = followListEvent(6, 2000);
    subscribeMany.mockImplementation((urls: string[], _filter: Filter, handlers: Handlers) => {
      queueMicrotask(() => {
        handlers.onevent?.(urls[0] === 'wss://w1' ? older : newer);
        handlers.oneose?.();
      });
      return { close: vi.fn() };
    });
    expect((await fetchLatestLazarusVersion(3, 'test-pubkey'))?.id).toBe(newer.id);
  });

  it('ignores foreign events a relay serves despite the filter', async () => {
    mockedRelayListGet.mockResolvedValue({
      read: [],
      write: ['wss://w1/'],
      updatedAt: 0
    });
    const mine = followListEvent(5, 1000);
    const foreign = { ...followListEvent(9, 5000), pubkey: 'someone-else' } as Event;
    const otherKind = { ...followListEvent(9, 6000), kind: 1 } as Event;
    subscribeMany.mockImplementation((_urls: string[], _filter: Filter, handlers: Handlers) => {
      queueMicrotask(() => {
        [mine, foreign, otherKind].forEach((event) => handlers.onevent?.(event));
        handlers.oneose?.();
      });
      return { close: vi.fn() };
    });
    expect((await fetchLatestLazarusVersion(3, 'test-pubkey'))?.id).toBe(mine.id);
  });

  it('fails closed when no write relay could be reached', async () => {
    mockedRelayListGet.mockResolvedValue({
      read: [],
      write: ['wss://w1/', 'wss://w2/'],
      updatedAt: 0
    });
    vi.useFakeTimers();
    try {
      subscribeMany.mockImplementation(() => ({ close: vi.fn() })); // never EOSEs
      // Attach the rejection handler before the timers fire, or the
      // rejection lands unhandled in between awaits.
      const pending = expect(fetchLatestLazarusVersion(3, 'test-pubkey')).rejects.toThrow(
        'No write relay could be reached'
      );
      await vi.advanceTimersByTimeAsync(4000);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails closed when every write relay closes without answering', async () => {
    mockedRelayListGet.mockResolvedValue({
      read: [],
      write: ['wss://w1/', 'wss://w2/'],
      updatedAt: 0
    });
    // A refused connection closes the subscription before EOSE, with nothing sent
    subscribeMany.mockImplementation((_urls: string[], _filter: Filter, handlers: Handlers) => {
      queueMicrotask(() => handlers.onclose?.());
      return { close: vi.fn() };
    });
    await expect(fetchLatestLazarusVersion(3, 'test-pubkey')).rejects.toThrow(
      'No write relay could be reached'
    );
  });

  it('resolves to no current event when a relay answers empty, even if the rest time out', async () => {
    mockedRelayListGet.mockResolvedValue({
      read: [],
      write: ['wss://w1/', 'wss://w2/'],
      updatedAt: 0
    });
    vi.useFakeTimers();
    try {
      subscribeMany.mockImplementation((urls: string[], _filter: Filter, handlers: Handlers) => {
        if (urls[0] === 'wss://w1') queueMicrotask(() => handlers.oneose?.());
        return { close: vi.fn() }; // w2 never answers
      });
      const pending = fetchLatestLazarusVersion(3, 'test-pubkey');
      await vi.advanceTimersByTimeAsync(4000);
      expect(await pending).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('registry sanity against the adapter', () => {
  it('scans the tier-1 kinds the UI offers', async () => {
    serve('wss://default', [followListEvent(3, 1000)]);
    for (const kind of [3, 10000]) {
      const scan = await scanLazarusKind(kind, 'test-pubkey', zapLazarusRelaySource);
      // The mocked relay serves kind-3 events regardless of the filter; only
      // the wiring is under test here.
      expect(scan.kind).toBe(kind);
      expect(LAZARUS_REGISTRY[kind].tier).toBe(1);
    }
  });
});
