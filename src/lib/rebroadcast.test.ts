import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import { MAX_REBROADCAST_RELAYS, ensureSignedEvent, rebroadcastRelayUrls } from './rebroadcast';
import { normalizeRelayUrl } from '$lib/relayListCache';
import { ndk } from '$lib/nostr';

// Module-level imports of the service under test; follow the repo's
// established mock pattern (see walletStore.test.ts).
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return { ndk: writable<any>(null) };
});
vi.mock('$lib/relayListCache', () => ({
  normalizeRelayUrl: (url: string) => url.trim().replace(/\/+$/, '').toLowerCase()
}));

function fakeNdk(poolUrls: string[]) {
  return { pool: { relays: new Map(poolUrls.map((u) => [u, {}])) } };
}

describe('rebroadcastRelayUrls', () => {
  it('unions pool and standard relays, pool first', () => {
    const urls = rebroadcastRelayUrls(fakeNdk(['wss://pool.one']));
    const keys = urls.map(normalizeRelayUrl);
    expect(keys).toContain(normalizeRelayUrl('wss://pool.one'));
    for (const std of ['wss://nos.lol', 'wss://purplepag.es', 'wss://relay.primal.net', 'wss://nostr.wine']) {
      expect(keys).toContain(normalizeRelayUrl(std));
    }
    expect(keys.indexOf(normalizeRelayUrl('wss://pool.one'))).toBe(0);
  });

  it('dedupes case and trailing-slash variants via normalizeRelayUrl', () => {
    const urls = rebroadcastRelayUrls(fakeNdk(['wss://NOS.LOL/']));
    const keys = urls.map(normalizeRelayUrl);
    // one entry for nos.lol, not two
    expect(keys.filter((k) => k.includes('nos.lol'))).toHaveLength(1);
  });

  it('skips relays the caller says already confirmed the event', () => {
    const urls = rebroadcastRelayUrls(fakeNdk(['wss://nos.lol']), ['wss://nos.lol']);
    expect(urls.map(normalizeRelayUrl)).not.toContain(normalizeRelayUrl('wss://nos.lol'));
  });

  it('caps the list at MAX_REBROADCAST_RELAYS', () => {
    const pool = Array.from({ length: 30 }, (_, i) => `wss://relay${i}.test`);
    const urls = rebroadcastRelayUrls(fakeNdk(pool));
    expect(urls).toHaveLength(MAX_REBROADCAST_RELAYS);
    // pool order wins: the first 12 pool relays, standard relays squeezed out
    expect(urls.map(normalizeRelayUrl)).toContain(normalizeRelayUrl('wss://relay0.test'));
    expect(urls.map(normalizeRelayUrl)).not.toContain(normalizeRelayUrl('wss://relay29.test'));
  });

  it('returns standard relays when the pool is empty', () => {
    const urls = rebroadcastRelayUrls(fakeNdk([]));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.map(normalizeRelayUrl)).toContain(normalizeRelayUrl('wss://nos.lol'));
  });
});

describe('ensureSignedEvent', () => {
  const signedNote = () =>
    finalizeEvent(
      { kind: 1, created_at: 1_700_000_000, tags: [], content: 'hello relays' },
      generateSecretKey()
    );

  // url → payload the relay answers with (undefined = EOSE, no event)
  let served: Record<string, any>;
  let fetchEvent: ReturnType<typeof vi.fn>;
  const POOL = ['wss://a.test', 'wss://b.test', 'wss://c.test'];

  class FakeWebSocket {
    onopen: (() => void) | null = null;
    onmessage: ((m: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public url: string) {
      setTimeout(() => this.onopen?.(), 0);
    }
    send(frame: string) {
      const [, subId] = JSON.parse(frame);
      const ev = served[this.url];
      setTimeout(() => {
        if (ev) this.onmessage?.({ data: JSON.stringify(['EVENT', subId, ev]) });
        this.onmessage?.({ data: JSON.stringify(['EOSE', subId]) });
      }, 0);
    }
    close() {}
  }

  beforeEach(() => {
    served = {};
    fetchEvent = vi.fn().mockResolvedValue(null);
    vi.stubGlobal('WebSocket', FakeWebSocket);
    (ndk as any).set({ ...fakeNdk(POOL), fetchEvent });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('rebuilds a signed plain object (feed cache) into a publishable NDKEvent', async () => {
    const raw = signedNote();
    const { signed, sourceUrls } = await ensureSignedEvent({ ...raw });
    expect(signed).toBeInstanceOf(NDKEvent);
    expect(typeof signed.publish).toBe('function');
    expect(signed.id).toBe(raw.id);
    expect(signed.sig).toBe(raw.sig);
    expect(sourceUrls).toEqual([]);
  });

  it('skips a relay that serves a tampered copy and uses the next valid one', async () => {
    const raw = signedNote();
    served['wss://a.test'] = { ...raw, content: 'tampered' };
    served['wss://b.test'] = raw;
    const { signed, sourceUrls } = await ensureSignedEvent({ ...raw, sig: undefined });
    expect(signed.content).toBe('hello relays');
    expect(sourceUrls).toEqual(['wss://b.test']);
  });

  it('does not accept a tampered in-hand copy', async () => {
    const raw = signedNote();
    await expect(ensureSignedEvent({ ...raw, content: 'tampered' })).rejects.toThrow(
      /signed copy/
    );
  });

  it('falls back to a relay-only fetch when the raw probes miss', async () => {
    const raw = signedNote();
    fetchEvent.mockResolvedValue(new NDKEvent(undefined, raw));
    const unsignedCached = new NDKEvent(undefined, { ...raw, sig: undefined });
    const { signed } = await ensureSignedEvent(unsignedCached);
    expect(signed.sig).toBe(raw.sig);
    const [filter, opts] = fetchEvent.mock.calls[0];
    expect(filter).toEqual({ ids: [raw.id] });
    expect(opts.cacheUsage).toBe('ONLY_RELAY');
  });
});
