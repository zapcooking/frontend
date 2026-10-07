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

import {
  outboxTargetUrls,
  buildInboxAwareRelaySet,
  zapReceiptRelayUrls,
  resolveAuthorPubkey,
  outboxRelaySet
} from './nip65Routing';

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

describe('the author of an unsigned event', () => {
  it('is excluded as a recipient: a self-reply adds no own read relays', async () => {
    const r = await outboxTargetUrls(
      event(
        [
          ['p', ME],
          ['p', THEM]
        ],
        ''
      ),
      ME
    );
    expect(r).not.toContain('wss://my-inbox.example');
    expect(r).toContain('wss://relay.primal.net');
  });

  it('comes from the signer when ndk.activeUser is unset (NIP-07, nsec, passkey logins)', async () => {
    const ndk = { signer: { user: async () => ({ pubkey: ME }) } };
    expect(await resolveAuthorPubkey(ndk as never)).toBe(ME);
    const got: string[] = [];
    await buildInboxAwareRelaySet({
      event: event([['p', THEM]], ''),
      ndk: {
        ...ndk,
        pool: { getRelay: (url: string) => (got.push(url), { url, connect: async () => {} }) }
      } as never
    });
    expect(got[0]).toBe('wss://pyramid.fiatjaf.com');
  });

  it('activeUser wins; no signer and no activeUser is undefined', async () => {
    const ndk = { activeUser: { pubkey: THEM }, signer: { user: async () => ({ pubkey: ME }) } };
    expect(await resolveAuthorPubkey(ndk as never)).toBe(THEM);
    expect(await resolveAuthorPubkey({} as never)).toBeUndefined();
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

describe('outboxRelaySet (lists and reposts)', () => {
  const ndk = {
    activeUser: { pubkey: ME },
    pool: { getRelay: (url: string) => ({ url, connect: async () => {} }) }
  };
  const withNdk = (tags: string[][]) => ({ tags, pubkey: '', ndk }) as never;

  it('a list: own write relays and the app list; its p tags are entries, not recipients', async () => {
    await outboxRelaySet(
      withNdk([
        ['p', THEM],
        ['p', 'c'.repeat(64)]
      ]),
      'list'
    );
    expect(relaySets[0]).toEqual([
      'wss://pyramid.fiatjaf.com',
      'wss://nos.lol',
      'wss://relay.damus.io'
    ]);
  });

  it('a repost: also the original author’s read relays', async () => {
    await outboxRelaySet(
      withNdk([
        ['e', 'x'],
        ['p', THEM]
      ]),
      'engagement'
    );
    expect(relaySets[0]).toContain('wss://relay.primal.net');
  });

  it('no ndk on the event: undefined (NDK’s default pool)', async () => {
    expect(await outboxRelaySet({ tags: [] } as never, 'list')).toBeUndefined();
  });
});
