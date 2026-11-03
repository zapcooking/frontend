import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  eventIdPath,
  eventIdRef,
  eventPath,
  eventRef,
  eventRelayHints,
  parseEventRef
} from './eventUrl';

const HEX = 'a'.repeat(64);
const HEX2 = 'b'.repeat(64);
const PK = 'c'.repeat(64);

describe('eventRelayHints', () => {
  it('collects the serving relay and onRelays, skipping duplicates', () => {
    const hints = eventRelayHints({
      id: HEX,
      relay: { url: 'wss://relay-a' },
      onRelays: [{ url: 'wss://relay-a' }, { url: 'wss://relay-b' }, null]
    });
    expect(hints).toEqual(['wss://relay-a', 'wss://relay-b']);
  });

  it('drops non-wss URLs and handles missing relay info', () => {
    expect(eventRelayHints({ id: HEX, relay: { url: 'http://insecure' } })).toEqual([]);
    expect(eventRelayHints({ id: HEX })).toEqual([]);
    expect(eventRelayHints(null)).toEqual([]);
  });

  it('caps at three hints', () => {
    const hints = eventRelayHints({
      id: HEX,
      onRelays: [
        { url: 'wss://r1' },
        { url: 'wss://r2' },
        { url: 'wss://r3' },
        { url: 'wss://r4' }
      ]
    });
    expect(hints).toHaveLength(3);
  });
});

describe('eventRef', () => {
  it('encodes an nevent with relay, author and kind hints', () => {
    const ref = eventRef({
      id: HEX,
      kind: 1,
      pubkey: PK,
      relay: { url: 'wss://relay-a' }
    });
    expect(ref.startsWith('nevent1')).toBe(true);
    const decoded = nip19.decode(ref);
    expect(decoded.type).toBe('nevent');
    const data = (decoded as nip19.DecodedNevent).data;
    expect(data.id).toBe(HEX);
    expect(data.relays).toEqual(['wss://relay-a']);
    expect(data.author).toBe(PK);
    expect(data.kind).toBe(1);
  });

  it('encodes without optional hints when the event has none', () => {
    const decoded = nip19.decode(eventRef({ id: HEX }));
    const data = (decoded as nip19.DecodedNevent).data;
    expect(data.id).toBe(HEX);
    expect(data.relays ?? []).toEqual([]);
    expect(data.author).toBeUndefined();
    expect(data.kind).toBeUndefined();
  });

  it('never emits a note1 for a well-formed event', () => {
    expect(eventRef({ id: HEX, kind: 1111 }).startsWith('nevent1')).toBe(true);
  });
});

describe('eventIdRef', () => {
  it('wraps a hex id as an nevent with caller hints', () => {
    const decoded = nip19.decode(eventIdRef(HEX, ['wss://tag-hint']));
    const data = (decoded as nip19.DecodedNevent).data;
    expect(data.id).toBe(HEX);
    expect(data.relays).toEqual(['wss://tag-hint']);
  });

  it('normalizes a note1 ref into an nevent (no note in URLs)', () => {
    const note = nip19.noteEncode(HEX2);
    const decoded = nip19.decode(eventIdRef(note));
    expect(decoded.type).toBe('nevent');
    expect((decoded as nip19.DecodedNevent).data.id).toBe(HEX2);
  });

  it('keeps an nevent ref and its relay hints', () => {
    const original = nip19.neventEncode({ id: HEX, relays: ['wss://relay-a'] });
    const decoded = nip19.decode(eventIdRef(original));
    expect(decoded.type).toBe('nevent');
    const data = (decoded as nip19.DecodedNevent).data;
    expect(data.id).toBe(HEX);
    expect(data.relays).toEqual(['wss://relay-a']);
  });

  it('filters non-wss extra hints', () => {
    const decoded = nip19.decode(eventIdRef(HEX, ['http://nope', 'wss://yes']));
    expect((decoded as nip19.DecodedNevent).data.relays).toEqual(['wss://yes']);
  });

  it('throws on input that is not an event reference', () => {
    expect(() => eventIdRef('npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq')).toThrow();
    expect(() => eventIdRef('hello world')).toThrow();
  });
});

describe('parseEventRef', () => {
  it('accepts hex (case-insensitive) and strips the nostr: prefix', () => {
    expect(parseEventRef(HEX.toUpperCase())).toEqual({ hex: HEX, hints: [] });
    expect(parseEventRef(`nostr:${HEX}`)).toEqual({ hex: HEX, hints: [] });
  });

  it('keeps an nevent\'s relays, author and kind', () => {
    const ref = nip19.neventEncode({ id: HEX, relays: ['wss://relay-a'], author: PK, kind: 1 });
    expect(parseEventRef(ref)).toEqual({ hex: HEX, hints: ['wss://relay-a'], author: PK, kind: 1 });
  });

  it('round-trips author and kind through eventIdRef, even with no relays', () => {
    const ref = nip19.neventEncode({ id: HEX, author: PK, kind: 30023 });
    const decoded = nip19.decode(eventIdRef(ref, ['wss://ctx'])) as nip19.DecodedNevent;
    expect(decoded.data).toMatchObject({ id: HEX, author: PK, kind: 30023, relays: ['wss://ctx'] });
    expect(eventIdRef(`nostr:${ref}`)).toBe(ref);
  });

  it('returns null for non-ids', () => {
    expect(parseEventRef('')).toBeNull();
    expect(parseEventRef('zzz')).toBeNull();
  });
});

describe('eventPath / eventIdPath', () => {
  it('builds thread-page paths that the route decodes back to the event', () => {
    const path = eventPath({ id: HEX, relay: { url: 'wss://relay-a' } });
    expect(path.startsWith('/nevent1')).toBe(true);
    const decoded = nip19.decode(path.slice(1));
    expect((decoded as nip19.DecodedNevent).data.id).toBe(HEX);

    expect(eventIdPath(HEX).startsWith('/nevent1')).toBe(true);
  });
});
