import { describe, expect, it, vi } from 'vitest';
import { MAX_REBROADCAST_RELAYS, rebroadcastRelayUrls } from './rebroadcast';
import { normalizeRelayUrl } from '$lib/relayListCache';

// Module-level imports of the service under test; follow the repo's
// established mock pattern (see walletStore.test.ts).
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/nostr', () => ({ ndk: {} }));
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
