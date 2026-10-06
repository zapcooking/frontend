import { describe, it, expect, vi, beforeEach } from 'vitest';

const ME = 'a'.repeat(64);
const THEM = 'b'.repeat(64);

const lists = new Map<string, { read: string[]; write: string[] }>();
vi.mock('$lib/relayListCache', () => ({
  normalizeRelayUrl: (u: string) => u.toLowerCase().replace(/\/+$/, ''),
  relayListCache: {
    get: async (pk: string) => lists.get(pk) ?? null,
    getMany: async (pks: string[]) =>
      new Map(pks.filter((p) => lists.has(p)).map((p) => [p, lists.get(p)!]))
  }
}));
vi.mock('$lib/nostr', () => ({
  getCurrentRelays: () => ['wss://nos.lol', 'wss://relay.damus.io']
}));

const relaySets: string[][] = [];
vi.mock('@nostr-dev-kit/ndk', () => ({
  NDKRelaySet: class {
    constructor(relays: Set<{ url: string }>) {
      relaySets.push([...relays].map((r) => r.url));
    }
  }
}));

import { outboxTargetUrls, buildInboxAwareRelaySet, zapReceiptRelayUrls } from './nip65Routing';

const event = (tags: string[][], pubkey = ME) => ({ tags, pubkey }) as never;

beforeEach(() => {
  lists.clear();
  relaySets.length = 0;
  lists.set(ME, { read: ['wss://my-inbox.example'], write: ['wss://pyramid.fiatjaf.com'] });
  lists.set(THEM, { read: ['wss://relay.primal.net'], write: ['wss://their-outbox.example'] });
});

describe('outbox routing for engagement', () => {
  it('a reaction or comment: own write relays, the recipient’s read relays, the app list', async () => {
    expect(
      await outboxTargetUrls(
        event([
          ['e', 'x'],
          ['p', THEM]
        ])
      )
    ).toEqual([
      'wss://pyramid.fiatjaf.com',
      'wss://relay.primal.net',
      'wss://nos.lol',
      'wss://relay.damus.io'
    ]);
  });

  it('an unsigned event uses the passed author for the own relays', async () => {
    const r = await outboxTargetUrls(event([['p', THEM]], ''), ME);
    expect(r[0]).toBe('wss://pyramid.fiatjaf.com');
  });

  it('a NIP-29 group event stays on pantry', async () => {
    expect(
      await outboxTargetUrls(
        event([
          ['h', 'grp'],
          ['p', THEM]
        ])
      )
    ).toEqual(['wss://pantry.zap.cooking']);
  });

  it('the publish set is the outbox targets, not the NDK pool (no stray temporary relays)', async () => {
    const got: string[] = [];
    const ndk = {
      activeUser: { pubkey: ME },
      pool: {
        relays: new Map([['wss://someone-elses-outbox.example', {}]]),
        getRelay: (url: string) => {
          got.push(url);
          return { url, connect: async () => {} };
        }
      }
    };
    await buildInboxAwareRelaySet({ event: event([['p', THEM]], ''), ndk: ndk as never });
    expect(got).not.toContain('wss://someone-elses-outbox.example');
    expect(relaySets[0]).toEqual([
      'wss://pyramid.fiatjaf.com',
      'wss://relay.primal.net',
      'wss://nos.lol',
      'wss://relay.damus.io'
    ]);
  });
});

describe('zap receipt relays (NIP-57 relays tag)', () => {
  it('own write relays, the recipient’s read relays, then the app list', async () => {
    expect(await zapReceiptRelayUrls(ME, THEM)).toEqual([
      'wss://pyramid.fiatjaf.com',
      'wss://relay.primal.net',
      'wss://nos.lol',
      'wss://relay.damus.io'
    ]);
  });

  it('no relay lists known: the app list', async () => {
    lists.clear();
    expect(await zapReceiptRelayUrls(ME, THEM)).toEqual(['wss://nos.lol', 'wss://relay.damus.io']);
  });
});
