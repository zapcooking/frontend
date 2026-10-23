import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { buildNotePreview, NOTE_PREVIEW_MAX_LENGTH } from './notePreview';

const PUBKEY_A = 'a'.repeat(64);
const PUBKEY_B = 'b'.repeat(64);

const mentionNames = new Map([
  [PUBKEY_A, 'Daniel'],
  [PUBKEY_B, 'Nostrich']
]);

describe('buildNotePreview', () => {
  it('returns empty string for empty content', () => {
    expect(buildNotePreview('')).toBe('');
  });

  it('preserves paragraph breaks', () => {
    const preview = buildNotePreview('First paragraph.\n\nSecond paragraph.');
    expect(preview).toBe('First paragraph.\n\nSecond paragraph.');
  });

  it('keeps single line breaks inside a paragraph', () => {
    expect(buildNotePreview('step one\nstep two')).toBe('step one\nstep two');
  });

  it('collapses runs of 3+ newlines to a single paragraph break', () => {
    expect(buildNotePreview('top\n\n\n\nbottom')).toBe('top\n\nbottom');
  });

  it('normalizes CRLF to LF so Windows line breaks survive', () => {
    expect(buildNotePreview('one\r\n\r\ntwo')).toBe('one\n\ntwo');
  });

  it('trims leading and trailing blank lines', () => {
    expect(buildNotePreview('\n\nhello\n\n')).toBe('hello');
  });

  it('collapses horizontal whitespace runs but not line breaks', () => {
    expect(buildNotePreview('a   b\n\t c')).toBe('a b\n c');
  });

  it('strips http(s) URLs', () => {
    expect(buildNotePreview('see https://example.com/recipe for more')).toBe('see for more');
  });

  it('keeps scheme-less domains as prose', () => {
    expect(buildNotePreview('baked it per zap.cooking/pow')).toBe('baked it per zap.cooking/pow');
  });

  it('strips nostr event references', () => {
    const nevent = nip19.neventEncode({ id: 'c'.repeat(32) });
    expect(buildNotePreview(`look at nostr:${nevent} please`)).toBe('look at please');
  });

  it('strips bare, prefix-less note references like the full renderer', () => {
    const note = nip19.noteEncode('d'.repeat(32));
    expect(buildNotePreview(`quoting ${note} here`)).toBe('quoting here');
  });

  it('drops nprofile mentions when no names are supplied', () => {
    const nprofile = nip19.nprofileEncode({ pubkey: PUBKEY_A });
    expect(buildNotePreview(`ask nostr:${nprofile} about it`)).toBe('ask about it');
  });

  it('resolves npub mentions to names from the map', () => {
    const npub = nip19.npubEncode(PUBKEY_A);
    const preview = buildNotePreview(`thanks nostr:${npub}!`, { mentionNames });
    expect(preview).toBe('thanks @Daniel!');
  });

  it('resolves bare npub mentions and nprofile mentions', () => {
    const npub = nip19.npubEncode(PUBKEY_B);
    const nprofile = nip19.nprofileEncode({ pubkey: PUBKEY_A });
    const preview = buildNotePreview(`cc ${npub} and nostr:${nprofile}`, { mentionNames });
    expect(preview).toBe('cc @Nostrich and @Daniel');
  });

  it('drops mentions missing from the map instead of echoing bech32', () => {
    const npub = nip19.npubEncode('e'.repeat(64));
    expect(buildNotePreview(`cc nostr:${npub}`)).toBe('cc');
  });

  it('sweeps nostr: tokens the scanner does not know', () => {
    expect(buildNotePreview('oops nostr:nsec1qqqqqq leaked')).toBe('oops leaked');
  });

  it('truncates over-budget previews at a word boundary with an ellipsis', () => {
    const long = `${'a'.repeat(50)} ${'b'.repeat(270)}`;
    const preview = buildNotePreview(long);
    expect(preview).toBe(`${'a'.repeat(50)}...`);
  });

  it('falls back to a hard cut when there is no word boundary', () => {
    const preview = buildNotePreview('x'.repeat(NOTE_PREVIEW_MAX_LENGTH + 30));
    expect(preview.length).toBe(NOTE_PREVIEW_MAX_LENGTH + 3);
    expect(preview.endsWith('...')).toBe(true);
  });

  it('honors a custom maxLength', () => {
    expect(buildNotePreview('one two three four', { maxLength: 8 })).toBe('one two...');
  });
});
