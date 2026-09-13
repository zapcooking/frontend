import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { scanNostrRefs } from './nostrRefScan';

/**
 * Issue #637: a note containing a reference WITHOUT the `nostr:` prefix
 * rendered as a wall of raw bech32 instead of an embed. Several clients
 * emit prefix-less references and most clients render them anyway, so this
 * read as zap.cooking being broken rather than the authoring client.
 *
 * The risky part is a regex run over arbitrary user text, so these pin the
 * failure modes as much as the fix.
 */

const PUBKEY = 'a'.repeat(64);
const EVENT_ID = 'b'.repeat(64);

const NPUB = nip19.npubEncode(PUBKEY);
const NOTE = nip19.noteEncode(EVENT_ID);
const NEVENT = nip19.neventEncode({ id: EVENT_ID });
const NPROFILE = nip19.nprofileEncode({ pubkey: PUBKEY });
const NADDR = nip19.naddrEncode({ identifier: 'my-recipe', pubkey: PUBKEY, kind: 30023 });

const nostrRefs = (text: string) => scanNostrRefs(text).filter((r) => r.type === 'nostr');
const urls = (text: string) => scanNostrRefs(text).filter((r) => r.type === 'url');

describe('prefixed references (existing behavior)', () => {
  it('matches every entity type with a nostr: prefix', () => {
    for (const token of [NPUB, NOTE, NEVENT, NPROFILE, NADDR]) {
      const found = nostrRefs(`look at nostr:${token} ok`);
      expect(found).toHaveLength(1);
      expect(found[0].content).toBe(`nostr:${token}`);
    }
  });
});

describe('bare references (the fix)', () => {
  it('matches every entity type without a prefix', () => {
    for (const token of [NPUB, NOTE, NEVENT, NPROFILE, NADDR]) {
      const found = nostrRefs(`look at ${token} ok`);
      expect(found).toHaveLength(1);
      expect(found[0].content).toBe(token);
    }
  });

  it('reports the prefix and data so the renderer can branch on type', () => {
    const [ref] = nostrRefs(NEVENT);
    expect(ref.prefix).toBe('nevent1');
    expect(ref.data).toBe(NEVENT.slice('nevent1'.length));
  });

  it('handles the reported case — a bare nevent alone on a line', () => {
    const found = nostrRefs(`GM PV\n\n#foodstr\n${NEVENT}`);
    expect(found).toHaveLength(1);
  });

  it('still matches a bare noffer1, which predates this change', () => {
    const found = nostrRefs('pay noffer1qqsxyz234567');
    expect(found).toHaveLength(1);
    expect(found[0].prefix).toBe('noffer1');
  });
});

describe('URL branch stays first', () => {
  it('keeps a njump-style link whole instead of carving the nevent out', () => {
    const text = `https://njump.me/${NEVENT}`;
    const scanned = scanNostrRefs(text);

    expect(scanned).toHaveLength(1);
    expect(scanned[0].type).toBe('url');
    expect(scanned[0].url).toBe(text);
  });

  it('does not treat a bech32 token inside any URL as a separate reference', () => {
    expect(nostrRefs(`https://example.com/p/${NPUB}?x=1`)).toHaveLength(0);
  });
});

describe('scheme-less hosts are not mangled', () => {
  it('ignores a bare npub that is actually a hostname label', () => {
    // The https? branch never sees this, and carving the npub out would
    // mangle the link.
    expect(nostrRefs(`${NPUB}.blossom.band/img.png`)).toHaveLength(0);
  });

  it('ignores a bare token followed by a path separator', () => {
    expect(nostrRefs(`${NPUB}/some/path`)).toHaveLength(0);
  });

  it('still matches when followed by ordinary punctuation', () => {
    expect(nostrRefs(`see ${NPUB}, thanks`)).toHaveLength(1);
    expect(nostrRefs(`see ${NPUB}!`)).toHaveLength(1);
  });
});

describe('undecodable tokens fall through to text', () => {
  it('ignores a bech32-alphabet run that is not a real reference', () => {
    // Right alphabet, right prefix, garbage payload.
    expect(nostrRefs('npub1qqqqqqqqqq')).toHaveLength(0);
  });

  it('ignores a truncated paste', () => {
    expect(nostrRefs(NEVENT.slice(0, 30))).toHaveLength(0);
  });

  it('does not trust a bad checksum even at full length', () => {
    // Flip a character in the data part — length passes, decode must not.
    const corrupted = NPUB.slice(0, -1) + (NPUB.endsWith('q') ? 'p' : 'q');
    expect(nostrRefs(corrupted)).toHaveLength(0);
  });

  it('still trusts a prefixed reference without decoding it', () => {
    // An explicit `nostr:` is a declaration of intent; the renderer handles
    // failure. Only bare guesses get the decode gate.
    expect(nostrRefs('nostr:npub1qqqqqqqqqq')).toHaveLength(1);
  });
});

describe('mixed content', () => {
  it('finds several references and a url in order', () => {
    const text = `hi ${NPUB} see https://example.com and nostr:${NOTE}`;
    const scanned = scanNostrRefs(text);

    expect(scanned.map((r) => r.type)).toEqual(['nostr', 'url', 'nostr']);
    expect(scanned.map((r) => r.index)).toEqual([...scanned.map((r) => r.index)].sort((a, b) => a - b));
  });

  it('returns nothing for plain prose', () => {
    expect(scanNostrRefs('just a normal note about cooking beans')).toHaveLength(0);
  });

  it('reports indices that map back to the source text', () => {
    const text = `abc ${NEVENT} def`;
    const [ref] = scanNostrRefs(text);

    expect(text.slice(ref.index, ref.index + ref.content.length)).toBe(ref.content);
  });
});
