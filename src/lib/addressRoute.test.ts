import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import { addressPath, parseNip19Input } from './nip19Input';
import { isRecipeLike, routeForLoadedAddress } from './addressRoute';

const PUBKEY = '85df822a86599ffbe8143db1e1e1bf2d162fa60fc685c65515963e67cfd7499f';
const naddr = (kind: number, identifier = 'c7f91f12-2c68-4a5c-baff-9034c24b4b35') =>
  nip19.naddrEncode({ kind, pubkey: PUBKEY, identifier, relays: ['wss://relay.damus.io/'] });

describe('addressPath', () => {
  it('sends a live stream to its player page', () => {
    const n = naddr(30311);
    expect(addressPath(30311, n)).toBe(`/live/${n}`);
  });

  it('sends a pack to the pack page', () => {
    const n = naddr(30004);
    expect(addressPath(30004, n)).toBe(`/pack/${n}`);
  });

  it('keeps recipes (and the ambiguous 30023) on the recipe page', () => {
    for (const kind of [30023, 35000]) {
      const n = naddr(kind);
      expect(addressPath(kind, n)).toBe(`/recipe/${n}`);
    }
  });
});

describe('searching for a pasted naddr', () => {
  it('REGRESSION: a live-stream link opens the stream, not the recipe page', () => {
    // The link that failed: kind 30311, relay hint attached.
    const pasted =
      'naddr1qqjxxdmx8yckvvfj95exxd3c956xzdtr943xzenx95unqve5vvergc35vgen2qg4waehxw309aex2mrp0yhxgctdw4eju6t09upzppwlsg4gvkvll05pg0d3u8sm7tgk97nql359ce23t937vl8awjvlqvzqqqrkvu5tdvle';
    const target = parseNip19Input(pasted);
    expect(target?.kind).toBe('address');
    expect(target?.path).toBe(`/live/${pasted}`);
  });

  it('routes the same with the nostr: prefix a copy button adds', () => {
    const n = naddr(30311);
    expect(parseNip19Input(`nostr:${n}`)?.path).toBe(`/live/${n}`);
  });

  it('still sends a recipe-kind naddr to the recipe page', () => {
    const n = naddr(30023);
    expect(parseNip19Input(n)?.path).toBe(`/recipe/${n}`);
  });
});

describe('isRecipeLike', () => {
  it('recognizes both recipe tag spellings, in any case', () => {
    expect(isRecipeLike({ tags: [['t', 'zapcooking']], content: '' })).toBe(true);
    expect(isRecipeLike({ tags: [['t', 'NostrCooking']], content: '' })).toBe(true);
  });

  it('keeps an untagged recipe written in the recipe template (content-shape fallback)', () => {
    const template = [
      '## Details',
      '- ⏲️ Prep time: 10 min',
      '- 🍳 Cook time: 20 min',
      '- 🍽️ Servings: 4',
      '',
      '## Ingredients',
      '- 2 eggs',
      '- 1 cup flour',
      '',
      '## Directions',
      '1. Whisk the eggs.',
      '2. Fold in the flour and cook.',
      ''
    ].join('\n');
    expect(isRecipeLike({ tags: [['title', 'Pancakes']], content: template })).toBe(true);
    expect(
      routeForLoadedAddress({ kind: 30023, pubkey: PUBKEY, content: template, tags: [['d', 'pancakes']] })
    ).toBeNull();
  });

  it('treats an untagged article as not a recipe', () => {
    expect(isRecipeLike({ tags: [['t', 'education']], content: 'Một bài viết dài.\n'.repeat(40) })).toBe(false);
  });
});

describe('routeForLoadedAddress', () => {
  const event = (kind: number, tags: string[][], content = 'Just some prose about my week.') => ({
    kind,
    pubkey: PUBKEY,
    content,
    tags: [['d', 'c7f91f12'], ...tags]
  });

  it('moves an article (30023, no recipe tag, not recipe-shaped) to the reader', () => {
    const e = event(30023, [['t', 'education'], ['title', 'A long read']]);
    const moved = routeForLoadedAddress(e);
    expect(moved).toMatch(/^\/r\/naddr1/);
    const decoded = nip19.decode(moved!.replace('/r/', ''));
    expect(decoded.type).toBe('naddr');
    expect((decoded.data as nip19.AddressPointer).identifier).toBe('c7f91f12');
    expect((decoded.data as nip19.AddressPointer).kind).toBe(30023);
  });

  it('leaves a tagged recipe where it is', () => {
    expect(routeForLoadedAddress(event(30023, [['t', 'zapcooking'], ['title', 'Philly']]))).toBeNull();
  });

  it('leaves a premium recipe (35000) where it is', () => {
    expect(routeForLoadedAddress(event(35000, []))).toBeNull();
  });

  it('sends a loaded live stream to /live', () => {
    expect(routeForLoadedAddress(event(30311, []))).toMatch(/^\/live\/naddr1/);
  });

  it('does nothing when it cannot build an address', () => {
    expect(routeForLoadedAddress({ kind: 30023, pubkey: PUBKEY, content: '', tags: [] })).toBeNull();
    expect(routeForLoadedAddress({ pubkey: PUBKEY, content: '', tags: [['d', 'x']] })).toBeNull();
  });
});
