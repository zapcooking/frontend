import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import { mentionedPubkeys, tokenizeChatText } from './chatText';

const PUBKEY = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
const OTHER = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const npub = nip19.npubEncode(PUBKEY);
const nprofile = nip19.nprofileEncode({ pubkey: OTHER, relays: ['wss://relay.damus.io'] });
const note = nip19.noteEncode(OTHER);

describe('tokenizeChatText', () => {
  it('leaves plain text alone', () => {
    expect(tokenizeChatText('hello from shosho on android!')).toEqual([
      { type: 'text', text: 'hello from shosho on android!' }
    ]);
    expect(tokenizeChatText('')).toEqual([]);
  });

  it('turns a nostr:npub into a mention, keeping the surrounding text', () => {
    expect(tokenizeChatText(`nostr:${npub} Check your zapper, it seems to be down today.`)).toEqual([
      { type: 'mention', pubkey: PUBKEY, raw: `nostr:${npub}` },
      { type: 'text', text: ' Check your zapper, it seems to be down today.' }
    ]);
  });

  it('handles a bare npub', () => {
    expect(tokenizeChatText(`thanks ${npub}!`)).toEqual([
      { type: 'text', text: 'thanks ' },
      { type: 'mention', pubkey: PUBKEY, raw: npub },
      { type: 'text', text: '!' }
    ]);
  });

  it('folds an @ prefix into the mention instead of leaving "@@name"', () => {
    const segments = tokenizeChatText(`hey @${npub} gm`);
    expect(segments).toEqual([
      { type: 'text', text: 'hey ' },
      { type: 'mention', pubkey: PUBKEY, raw: npub },
      { type: 'text', text: ' gm' }
    ]);
  });

  it('resolves nprofile to its pubkey', () => {
    expect(tokenizeChatText(`nostr:${nprofile}`)).toEqual([
      { type: 'mention', pubkey: OTHER, raw: `nostr:${nprofile}` }
    ]);
  });

  it('keeps several mentions in order', () => {
    const segments = tokenizeChatText(`nostr:${npub} and nostr:${nprofile}`);
    expect(segments.filter((s) => s.type === 'mention').map((s) => (s as { pubkey: string }).pubkey)).toEqual([
      PUBKEY,
      OTHER
    ]);
  });

  it('leaves an invalid npub as text, unchanged', () => {
    const bogus = 'npub1thisisnotavalidbech32stringatallxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    const segments = tokenizeChatText(`nostr:${bogus} hi`);
    expect(segments.some((s) => s.type === 'mention')).toBe(false);
    const rendered = segments.map((s) => (s.type === 'text' ? s.text : '')).join('');
    expect(rendered).toContain(bogus);
  });

  it('links http(s) URLs and drops trailing sentence punctuation', () => {
    expect(tokenizeChatText('see https://zap.cooking/live.')).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'link', href: 'https://zap.cooking/live', text: 'https://zap.cooking/live' },
      { type: 'text', text: '.' }
    ]);
  });

  it('turns a note reference into a short in-app link', () => {
    const segments = tokenizeChatText(`look at nostr:${note}`);
    const ref = segments.find((s) => s.type === 'ref') as { href: string; text: string };
    expect(ref.href).toBe(`/${note}`);
    expect(ref.text.length).toBeLessThan(note.length);
    expect(ref.text).toContain('…');
  });
});

describe('mentionedPubkeys', () => {
  it('lists each mentioned pubkey once', () => {
    expect(mentionedPubkeys(`nostr:${npub} ${npub} nostr:${nprofile} hi`).sort()).toEqual(
      [PUBKEY, OTHER].sort()
    );
  });

  it('is empty when nothing is mentioned', () => {
    expect(mentionedPubkeys('just chatting https://example.com')).toEqual([]);
  });
});
