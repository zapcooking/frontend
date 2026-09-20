import { describe, expect, it } from 'vitest';
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
});
