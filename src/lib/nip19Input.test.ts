import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import { isSecretKeyInput, parseNip19Input, stripNostrPrefix } from './nip19Input';

// Real identifiers: a kind-1 nevent, its author's npub, and an naddr.
const NEVENT =
  'nevent1qvzqqqqqqypzqx38dj7dmt98sxqny0qece578vtac8hkzla2r9xqhyjkv9tsms72qqsryv9gvvng06seqp9uskhdjmukqxcna6ce0vnu9au9kcuujhfdssczmdgsa';
const NPUB = 'npub1aeh2zw4elewy5682lxc6xnlqzjnxksq303gwu2npfaxd49vmde6qcq4nwx';
const NOTE = 'note1swswmmct78w7aqlljncrkzzam5k65975cal9jht5e6sdat00clqq5cqpzj';

describe('stripNostrPrefix', () => {
  it('strips the URI scheme every client writes', () => {
    expect(stripNostrPrefix(`nostr:${NOTE}`)).toBe(NOTE);
  });

  it('strips the registered-handler spelling and odd casing', () => {
    expect(stripNostrPrefix(`web+nostr:${NOTE}`)).toBe(NOTE);
    expect(stripNostrPrefix(`NOSTR:${NOTE}`)).toBe(NOTE);
  });

  it('leaves a bare identifier alone', () => {
    expect(stripNostrPrefix(NOTE)).toBe(NOTE);
  });

  it('trims the whitespace a paste drags along', () => {
    expect(stripNostrPrefix(`  nostr:${NOTE}\n`)).toBe(NOTE);
  });
});

describe('parseNip19Input', () => {
  it('reads a prefixed nevent as a note', () => {
    expect(parseNip19Input(`nostr:${NEVENT}`)).toEqual({
      kind: 'note',
      id: NEVENT,
      path: `/${NEVENT}`
    });
  });

  it('reads a prefixed npub as a profile', () => {
    expect(parseNip19Input(`nostr:${NPUB}`)?.path).toBe(`/user/${NPUB}`);
  });

  it('reads a bare note the same way as a prefixed one', () => {
    expect(parseNip19Input(NOTE)).toEqual(parseNip19Input(`nostr:${NOTE}`));
  });

  it('returns null for ordinary search terms', () => {
    expect(parseNip19Input('sourdough')).toBeNull();
    expect(parseNip19Input('')).toBeNull();
  });

  // Prefix-matching would route this somewhere that can only fail.
  it('returns null for a well-prefixed identifier that does not decode', () => {
    expect(parseNip19Input('nostr:nevent1notactuallybech32')).toBeNull();
  });

  // A mis-pasted secret key must never reach a relay as a search term or a
  // URL, so it is neither routed nor treated as text by callers.
  it('refuses a secret key, prefixed or not', () => {
    const nsec = 'nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5';
    expect(parseNip19Input(nsec)).toBeNull();
    expect(parseNip19Input(`nostr:${nsec}`)).toBeNull();
    expect(isSecretKeyInput(`nostr:${nsec}`)).toBe(true);
    expect(isSecretKeyInput(NOTE)).toBe(false);
  });

  it('refuses a secret key in every spelling the docstring promises', () => {
    const nsec = 'nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5';
    expect(isSecretKeyInput(`web+nostr:${nsec}`)).toBe(true);
    expect(isSecretKeyInput(`  ${nsec.toUpperCase()}\n`)).toBe(true);
    // Truncated paste is still a secret key, not a search term.
    expect(isSecretKeyInput(nsec.slice(0, 20))).toBe(true);
    // Hex is intentionally not treated as a secret.
    expect(isSecretKeyInput('a'.repeat(64))).toBe(false);
  });
});

describe('addressPath / naddr routing by kind', () => {
  const PUBKEY = '85df822a86599ffbe8143db1e1e1bf2d162fa60fc685c65515963e67cfd7499f';
  const naddr = (kind: number) =>
    nip19.naddrEncode({ kind, pubkey: PUBKEY, identifier: 'c7f91f12', relays: ['wss://relay.damus.io/'] });

  it('sends a live stream to /live', () => {
    const id = naddr(30311);
    expect(parseNip19Input(id)).toEqual({ kind: 'address', id, path: `/live/${id}` });
    expect(parseNip19Input(`nostr:${id}`)?.path).toBe(`/live/${id}`);
  });

  it('sends the pasted live-stream naddr from the bug report to /live', () => {
    const id =
      'naddr1qqjxxdmx8yckvvfj95exxd3c956xzdtr943xzenx95unqve5vvergc35vgen2qg4waehxw309aex2mrp0yhxgctdw4eju6t09upzppwlsg4gvkvll05pg0d3u8sm7tgk97nql359ce23t937vl8awjvlqvzqqqrkvu5tdvle';
    expect(parseNip19Input(id)?.path).toBe(`/live/${id}`);
  });

  it('sends packs and cookbooks to their own pages', () => {
    expect(parseNip19Input(naddr(30004))?.path).toBe(`/pack/${naddr(30004)}`);
    expect(parseNip19Input(naddr(30001))?.path).toBe(`/my-kitchen/${naddr(30001)}`);
  });

  it('keeps recipes (and 30023, which the recipe page sorts out) on /recipe', () => {
    expect(parseNip19Input(naddr(30023))?.path).toBe(`/recipe/${naddr(30023)}`);
    expect(parseNip19Input(naddr(35000))?.path).toBe(`/recipe/${naddr(35000)}`);
  });
});
