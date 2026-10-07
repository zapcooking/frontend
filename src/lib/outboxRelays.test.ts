import { describe, it, expect } from 'vitest';
import { outboxRelayUrls, isGroupEvent, MAX_OUTBOX_RELAYS, PANTRY_URL } from './outboxRelays';

const many = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `wss://${prefix}${i}.example`);

describe('outboxRelayUrls', () => {
  it('own write relays first, then recipients’ read relays, then the app list', () => {
    expect(
      outboxRelayUrls({
        own: ['wss://pyramid.fiatjaf.com'],
        recipients: ['wss://relay.primal.net'],
        app: ['wss://nos.lol']
      })
    ).toEqual(['wss://pyramid.fiatjaf.com', 'wss://relay.primal.net', 'wss://nos.lol']);
  });

  it('dedupes by comparable URL, keeping the first spelling', () => {
    expect(
      outboxRelayUrls({
        own: ['wss://Nos.lol/'],
        recipients: ['wss://nos.lol'],
        app: ['wss://nos.lol/', 'wss://relay.damus.io']
      })
    ).toEqual(['wss://Nos.lol/', 'wss://relay.damus.io']);
  });

  it('caps at 16: the app list is dropped first, own relays kept', () => {
    const r = outboxRelayUrls({
      own: many('own', 6),
      recipients: many('in', 8),
      app: many('app', 8)
    });
    expect(r).toHaveLength(MAX_OUTBOX_RELAYS);
    expect(r.slice(0, 6)).toEqual(many('own', 6));
    expect(r.slice(6, 14)).toEqual(many('in', 8));
    expect(r.slice(14)).toEqual(many('app', 2));
  });

  it('a reader with no relay list still reaches recipients and the app list', () => {
    expect(
      outboxRelayUrls({ own: [], recipients: ['wss://a.example'], app: ['wss://b.example'] })
    ).toEqual(['wss://a.example', 'wss://b.example']);
  });

  it('skips non-relay URLs', () => {
    expect(
      outboxRelayUrls({
        own: ['https://x.example', 'not a url', ''],
        recipients: ['wss://ok.example'],
        app: []
      })
    ).toEqual(['wss://ok.example']);
  });

  it('pantry only when the reader listed it (own or app list), never from a recipient', () => {
    expect(outboxRelayUrls({ own: [], recipients: [PANTRY_URL], app: [] })).toEqual([]);
    expect(outboxRelayUrls({ own: [PANTRY_URL + '/'], recipients: [], app: [] })).toEqual([
      PANTRY_URL + '/'
    ]);
    expect(outboxRelayUrls({ own: [], recipients: [], app: [PANTRY_URL] })).toEqual([PANTRY_URL]);
  });
});

describe('isGroupEvent', () => {
  it('an h tag marks a NIP-29 group event', () => {
    expect(
      isGroupEvent([
        ['h', 'abc'],
        ['p', 'x']
      ])
    ).toBe(true);
    expect(
      isGroupEvent([
        ['e', 'x'],
        ['p', 'y']
      ])
    ).toBe(false);
  });
});
