import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  httpsUrl,
  parseStreamEvent,
  parseStreamAddress,
  streamAddress,
  naddrEncode,
  pseudonym,
  runtime
} from './parse';
import type { NostrEventLike } from './types';

const HOST = 'a'.repeat(64);
const VIEWER = 'b'.repeat(64);
const NOW = 1700000000;

function announcement(
  overrides: Partial<NostrEventLike> = {},
  tags: string[][] = []
): NostrEventLike {
  return {
    id: '1'.repeat(64),
    pubkey: HOST,
    created_at: NOW - 120,
    kind: 30311,
    tags: [
      ['d', 'my-stream'],
      ['title', 'Sunday Roast Live'],
      ['streaming', 'https://cdn.example.com/live.m3u8'],
      ['status', 'live'],
      ['current_participants', '41'],
      ['summary', 'Cooking together'],
      ...tags
    ],
    content: '',
    sig: 'f'.repeat(128),
    ...overrides
  };
}

describe('httpsUrl', () => {
  it('accepts only absolute https without credentials', () => {
    expect(httpsUrl('https://cdn.example.com/live.m3u8')).toBe('https://cdn.example.com/live.m3u8');
    expect(httpsUrl('http://cdn.example.com/live.m3u8')).toBeNull();
    expect(httpsUrl('https://user:pass@cdn.example.com/live.m3u8')).toBeNull();
    expect(httpsUrl('not a url')).toBeNull();
    expect(httpsUrl(null)).toBeNull();
  });
});

describe('parseStreamEvent', () => {
  it('reads the NIP-53 tags into an item', () => {
    const item = parseStreamEvent(announcement(), NOW);
    expect(item).not.toBeNull();
    expect(item!.key).toBe(`30311:${HOST}:my-stream`);
    expect(item!.title).toBe('Sunday Roast Live');
    expect(item!.url).toBe('https://cdn.example.com/live.m3u8');
    expect(item!.status).toBe('live');
    expect(item!.viewers).toBe(41);
    expect(item!.live).toBe(true);
    expect(item!.host).toBe(HOST);
  });

  it('falls back to the author when no host p tag is present', () => {
    expect(parseStreamEvent(announcement(), NOW)!.host).toBe(HOST);
    expect(parseStreamEvent(announcement(undefined, [['p', VIEWER, '', 'host']]), NOW)!.host).toBe(
      VIEWER
    );
  });

  it('rejects non-30311 kinds, missing d tags, and future timestamps', () => {
    expect(parseStreamEvent(announcement({ kind: 1 }), NOW)).toBeNull();
    expect(parseStreamEvent(announcement({ tags: [['title', 'no d']] }), NOW)).toBeNull();
    expect(parseStreamEvent(announcement({ created_at: NOW + 3600 }), NOW)).toBeNull();
    expect(parseStreamEvent(announcement({ pubkey: 'short' }), NOW)).toBeNull();
  });

  it('only trusts live status on fresh announcements', () => {
    expect(parseStreamEvent(announcement(), NOW)!.live).toBe(true);
    const stale = parseStreamEvent(announcement({ created_at: NOW - 7200 }), NOW);
    expect(stale!.live).toBe(false);
    expect(stale!.status).toBe('live');
  });

  it('drops a future end time but keeps one that has passed', () => {
    const future = parseStreamEvent(announcement(undefined, [['ends', String(NOW + 3600)]]), NOW);
    expect(future!.ends).toBeNull();
    const past = parseStreamEvent(announcement(undefined, [['ends', String(NOW - 30)]]), NOW);
    expect(past!.ends).toBe(NOW - 30);
  });

  it('strips non-https media and image addresses', () => {
    const item = parseStreamEvent(
      announcement({
        tags: [
          ['d', 'my-stream'],
          ['streaming', 'http://insecure.example.com/live.m3u8'],
          ['image', 'https://img.example.com/banner.jpg']
        ]
      }),
      NOW
    );
    expect(item!.url).toBeNull();
    expect(item!.image).toBe('https://img.example.com/banner.jpg');
  });
});

describe('streamAddress', () => {
  it('round-trips through nip19 encode and decode', () => {
    const item = parseStreamEvent(
      announcement(undefined, [['relays', 'wss://relay.example.com']]),
      NOW
    )!;
    const address = streamAddress(item)!;
    expect(address.kind).toBe(30311);
    expect(address.pubkey).toBe(HOST);
    expect(address.identifier).toBe('my-stream');

    const encoded = naddrEncode(address);
    const decoded = nip19.decode(encoded);
    expect(decoded.type).toBe('naddr');
    expect((decoded.data as { identifier: string }).identifier).toBe('my-stream');
    expect((decoded.data as { pubkey: string }).pubkey).toBe(HOST);
  });

  it('returns null for a saved video link (no 30311 key)', () => {
    expect(streamAddress({ key: 'url:https://x.example.com/v.m3u8', relays: [] })).toBeNull();
  });
});

describe('parseStreamAddress', () => {
  it('accepts an naddr with or without the nostr: prefix', () => {
    const item = parseStreamEvent(announcement(), NOW)!;
    const encoded = naddrEncode(streamAddress(item)!);
    const direct = parseStreamAddress(encoded);
    expect(direct).toEqual({
      naddr: { pubkey: HOST, identifier: 'my-stream', relays: [] }
    });
    expect(parseStreamAddress(`nostr:${encoded}`)).toEqual(direct);
  });

  it('accepts an https video address and rejects the rest', () => {
    expect(parseStreamAddress('https://vod.example.com/rec.mp4')).toEqual({
      url: 'https://vod.example.com/rec.mp4'
    });
    expect(parseStreamAddress('ftp://x')).toEqual({ error: 'invalid' });
    expect(parseStreamAddress('naddr1notbase32!')).toEqual({ error: 'invalid' });
    expect(parseStreamAddress('')).toEqual({ error: 'invalid' });
  });

  it('says not-a-stream for a well-formed naddr of another kind', () => {
    const other = nip19.naddrEncode({
      kind: 30023,
      pubkey: HOST,
      identifier: 'an-article',
      relays: []
    });
    expect(parseStreamAddress(other)).toEqual({ error: 'not-a-stream' });
  });
});

describe('pseudonym', () => {
  it('is stable per pubkey and follows the anon-chef pool', () => {
    expect(pseudonym(HOST)).toBe(pseudonym(HOST));
    // The app's anon-chef names: words joined with spaces or hyphens.
    expect(pseudonym(HOST)).toMatch(/^[A-Za-z-]+ [A-Za-z-]+$/);
    expect(pseudonym('ff'.repeat(32))).not.toBe(pseudonym(HOST));
  });
});

describe('runtime', () => {
  it('splits a running elapsed time into days, hours, minutes', () => {
    const started = NOW - ((2 * 24 + 3) * 60 + 25) * 60;
    expect(runtime(started, NOW)).toEqual({ days: 2, hours: 3, minutes: 25 });
  });

  it('is null before the start and for non-integer timestamps', () => {
    expect(runtime(NOW + 60, NOW)).toBeNull();
    expect(runtime(null, NOW)).toBeNull();
    expect(runtime(NOW - 30.5, NOW)).toBeNull();
  });
});
