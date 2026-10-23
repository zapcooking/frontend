import { describe, it, expect } from 'vitest';
import {
  outboxRelayUrls,
  recipeListRelayUrls,
  isRecipeListEvent,
  isGroupEvent,
  MAX_OUTBOX_RELAYS,
  PANTRY_URL,
  RECIPE_LIST_RELAYS
} from './outboxRelays';

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

describe('recipeListRelayUrls', () => {
  it('default app relays: nos.lol and Primal plus the list relays; never purplepag.es or nostr.wine', () => {
    const standardRelays = ['wss://nos.lol', 'wss://purplepag.es', 'wss://relay.primal.net', 'wss://nostr.wine'];
    expect(recipeListRelayUrls({ own: [], app: standardRelays })).toEqual([
      'wss://nos.lol',
      'wss://relay.primal.net',
      ...RECIPE_LIST_RELAYS
    ]);
  });

  it('own write relays first, refusing relays dropped whatever their spelling, no duplicates', () => {
    expect(
      recipeListRelayUrls({
        own: ['wss://Purplepag.es/', 'wss://relay.nostr.net/', 'wss://pyramid.fiatjaf.com'],
        app: ['wss://nostr.wine', 'wss://nos.lol']
      })
    ).toEqual([
      'wss://relay.nostr.net/',
      'wss://pyramid.fiatjaf.com',
      'wss://nos.lol',
      'wss://nostr.oxtr.dev'
    ]);
  });

  it('a member with no relay list and an empty app list still has two list relays', () => {
    expect(recipeListRelayUrls({ own: [], app: [] })).toEqual(RECIPE_LIST_RELAYS);
  });
});

describe('isRecipeListEvent', () => {
  it('kind 30001 and deletions of one; nothing else', () => {
    expect(isRecipeListEvent({ kind: 30001, tags: [] })).toBe(true);
    expect(isRecipeListEvent({ kind: 5, tags: [['a', '30001:abc:italian']] })).toBe(true);
    expect(isRecipeListEvent({ kind: 5, tags: [['e', 'x']] })).toBe(false);
    expect(isRecipeListEvent({ kind: 3, tags: [] })).toBe(false);
    expect(isRecipeListEvent({ kind: 10000, tags: [] })).toBe(false);
  });
});
