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
  anonymousZapReceiptRelayUrls,
  listRelayUrls,
  listRelaySet,
  resolveAuthorPubkey,
  outboxRelaySet,
  waitForConnected
} from './nip65Routing';

const event = (tags: string[][], pubkey = ME, kind?: number) => ({ tags, pubkey, kind }) as never;

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

  it('prefers the current signer over a stale activeUser after switching accounts', async () => {
    const ndk = { activeUser: { pubkey: THEM }, signer: { user: async () => ({ pubkey: ME }) } };
    expect(await resolveAuthorPubkey(ndk as never)).toBe(ME);

    const got: string[] = [];
    await buildInboxAwareRelaySet({
      event: event([], ''),
      ndk: {
        ...ndk,
        pool: { getRelay: (url: string) => (got.push(url), { url, connect: async () => {} }) }
      } as never,
      inbox: false
    });
    expect(got).toContain('wss://pyramid.fiatjaf.com');
    expect(got).not.toContain('wss://their-outbox.example');
  });

  it('falls back to activeUser if there is no signer; neither is undefined', async () => {
    expect(await resolveAuthorPubkey({ activeUser: { pubkey: THEM } } as never)).toBe(THEM);
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

describe('list relays: where lists are written is where My Kitchen reads them', () => {
  it('recipe list writes target exactly listRelayUrls (own write relays, the app list, the list relays)', async () => {
    const listEvent = event(
      [
        ['d', 'nostrcooking-bookmarks'],
        ['a', `30023:${THEM}:x`],
        ['p', THEM]
      ],
      ME,
      30001
    );
    const writes = await outboxTargetUrls(listEvent, ME, false);
    expect(writes).toEqual(await listRelayUrls(ME));
    expect(writes).toEqual([
      'wss://pyramid.fiatjaf.com',
      'wss://nos.lol',
      'wss://relay.damus.io',
      'wss://relay.nostr.net',
      'wss://nostr.oxtr.dev'
    ]);
  });

  it('a recipe list deletion goes where the list went', async () => {
    const del = event([['a', `30001:${ME}:italian`]], ME, 5);
    expect(await outboxTargetUrls(del, ME, false)).toEqual(await listRelayUrls(ME));
  });

  it('purplepag.es is left out even from the own relay list; own-listed nostr.wine stays', async () => {
    lists.set(ME, { read: [], write: ['wss://purplepag.es', 'wss://nostr.wine/', 'wss://nos.lol'] });
    const urls = await listRelayUrls(ME);
    expect(urls).not.toContain('wss://purplepag.es');
    expect(urls.slice(0, 2)).toEqual(['wss://nostr.wine/', 'wss://nos.lol']);
  });

  it('follow, mute and bookmark lists keep own write relays + the app list', async () => {
    lists.set(ME, { read: [], write: ['wss://purplepag.es'] });
    const follow = event([['p', THEM]], ME, 3);
    expect(await outboxTargetUrls(follow, ME, false)).toEqual([
      'wss://purplepag.es',
      'wss://nos.lol',
      'wss://relay.damus.io'
    ]);
  });

  it('the read relay set (My Kitchen refresh, Saved-list safety read) is that same list', async () => {
    const ndk = { pool: { getRelay: (url: string) => ({ url }) } } as never;
    relaySets.length = 0;
    await listRelaySet(ndk, ME);
    expect(relaySets[relaySets.length - 1]).toEqual(await listRelayUrls(ME));
  });

  it('every relay a list is written to is read (no write-only relay)', async () => {
    const listEvent = event([['d', 'nostrcooking-bookmarks']], ME, 30001);
    const writes = await outboxTargetUrls(listEvent, ME, false);
    const reads = await listRelayUrls(ME);
    for (const url of writes) expect(reads).toContain(url);
  });
});

describe('anonymous zap receipt relays', () => {
  // The device's saved relay list (getCurrentRelays, mocked above) carries
  // wss://relay.damus.io; ME's write relay is pyramid. Neither may appear:
  // either could tie the ephemeral request back to this device.
  it("the recipient's read relays, then the fixed public defaults — nothing from this device", async () => {
    const urls = await anonymousZapReceiptRelayUrls(THEM);
    const { standardRelays } = await import('$lib/consts');
    expect(urls[0]).toBe('wss://relay.primal.net');
    expect(urls).not.toContain('wss://relay.damus.io');
    expect(urls).not.toContain('wss://pyramid.fiatjaf.com');
    expect(urls).not.toContain('wss://my-inbox.example');
    for (const url of urls.slice(1)) expect(standardRelays).toContain(url);
  });

  it('recipient without a relay list: the public defaults only', async () => {
    lists.clear();
    const { standardRelays } = await import('$lib/consts');
    const urls = await anonymousZapReceiptRelayUrls(THEM);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(standardRelays).toContain(url);
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

describe('waitForConnected (publish waits for the chosen relays)', () => {
  const relay = (status: number) => {
    const ls = new Set<() => void>();
    return {
      status,
      once: (_e: 'connect', fn: () => void) => ls.add(fn),
      removeListener: (_e: 'connect', fn: () => void) => ls.delete(fn),
      open() {
        this.status = 5;
        for (const f of [...ls]) {
          ls.delete(f);
          f();
        }
      },
      listeners: () => ls.size
    };
  };

  it('resolves at once when every relay is already connected', async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      waitForConnected([relay(5), relay(6)], 4000).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for a slow relay (3 s, past NDK’s 2.5 s publish wait) and resolves when it opens', async () => {
    vi.useFakeTimers();
    try {
      const fast = relay(5);
      const slow = relay(4);
      let done = false;
      waitForConnected([fast, slow], 4000).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(3000);
      expect(done).toBe(false);
      slow.open();
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(true);
      expect(slow.listeners()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after maxMs on a relay that never connects, and removes its listener', async () => {
    vi.useFakeTimers();
    try {
      const dead = relay(1);
      let done = false;
      waitForConnected([dead], 4000).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(3999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toBe(true);
      expect(dead.listeners()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
