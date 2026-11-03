/**
 * Tests for note OG image selection (docs/plans/og-missing-images-fix.md,
 * Phase 2): `getNoteOgMeta` should prefer a NIP-92 `imeta` tag's URL over
 * scanning note content, and its content-scan fallback should recognize
 * known extensionless image-CDN hosts, not just file-extension URLs.
 */

import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { getNoteOgMeta, extractMentionedPubkeys, cleanNoteText } from './noteOg.server';
import type { OgEventLike } from './recipeOgMeta';

function makeEvent(overrides: Partial<OgEventLike> = {}): OgEventLike {
  return {
    tags: [],
    content: '',
    pubkey: 'a'.repeat(64),
    created_at: 1700000000,
    kind: 1,
    ...overrides
  };
}

const FALLBACK_IMAGE = 'https://zap.cooking/social-share.png';

describe('getNoteOgMeta image selection', () => {
  it('uses the imeta tag URL when present, even if content has no image URL', () => {
    const event = makeEvent({
      content: 'check this out',
      tags: [['imeta', 'url https://nostr.build/i/abc123', 'm image/jpeg']]
    });
    const meta = getNoteOgMeta({ event, author: {} });
    expect(meta.image).toBe('https://nostr.build/i/abc123');
  });

  it('prefers imeta over a content-embedded image URL', () => {
    const event = makeEvent({
      content: 'see https://example.com/other.jpg',
      tags: [['imeta', 'url https://nostr.build/i/from-imeta']]
    });
    const meta = getNoteOgMeta({ event, author: {} });
    expect(meta.image).toBe('https://nostr.build/i/from-imeta');
  });

  it('falls back to a file-extension URL in content when there is no imeta tag', () => {
    const event = makeEvent({ content: 'photo: https://example.com/pic.png here' });
    const meta = getNoteOgMeta({ event, author: {} });
    expect(meta.image).toBe('https://example.com/pic.png');
  });

  it('recognizes an extensionless image-CDN host in content (the Phase 2 gap)', () => {
    // No imeta tag, and the URL has no file extension — only the shared
    // $lib/imageUrls host-list heuristic can classify this as an image.
    const event = makeEvent({ content: 'nostr.build/i/xyz789 https://nostr.build/i/xyz789' });
    const meta = getNoteOgMeta({ event, author: {} });
    expect(meta.image).toBe('https://nostr.build/i/xyz789');
  });

  it('strips trailing punctuation from a content-embedded image URL', () => {
    const event = makeEvent({ content: 'Look at this (https://example.com/pic.jpg).' });
    const meta = getNoteOgMeta({ event, author: {} });
    expect(meta.image).toBe('https://example.com/pic.jpg');
  });

  it('falls back to the author picture when neither imeta nor content has an image', () => {
    const event = makeEvent({ content: 'just text, no links' });
    const meta = getNoteOgMeta({ event, author: { picture: 'https://example.com/avatar.jpg' } });
    expect(meta.image).toBe('https://example.com/avatar.jpg');
  });

  it('falls back to the static graphic when nothing is available', () => {
    const event = makeEvent({ content: 'just text' });
    const meta = getNoteOgMeta({ event, author: {} });
    expect(meta.image).toBe(FALLBACK_IMAGE);
  });

  it('ignores an imeta tag with no url slot and falls through to content', () => {
    const event = makeEvent({
      content: 'https://example.com/fallback.png',
      tags: [['imeta', 'm image/jpeg']] // malformed: no `url` slot
    });
    const meta = getNoteOgMeta({ event, author: {} });
    expect(meta.image).toBe('https://example.com/fallback.png');
  });
});

describe('note mentions in the description', () => {
  const PK_A = 'a'.repeat(64);
  const PK_B = 'b'.repeat(64);
  const npubA = nip19.npubEncode(PK_A);
  const npubB = nip19.npubEncode(PK_B);

  it('renders a resolved nostr:npub mention as @Name instead of dropping it', () => {
    const event = makeEvent({ content: `Thanks to nostr:${npubA} for having us on the show.` });
    const meta = getNoteOgMeta({ event, author: {}, mentions: { [PK_A]: 'Breez' } });
    expect(meta.description).toBe('Thanks to @Breez for having us on the show.');
  });

  it('falls back to a short npub when the profile did not resolve', () => {
    const event = makeEvent({ content: `Thanks to nostr:${npubA} for having us.` });
    const meta = getNoteOgMeta({ event, author: {} });
    expect(meta.description).toBe(
      `Thanks to @${npubA.slice(0, 9)}…${npubA.slice(-4)} for having us.`
    );
  });

  it('handles nprofile mentions and keeps trailing punctuation', () => {
    const nprofile = nip19.nprofileEncode({ pubkey: PK_A, relays: [] });
    const text = cleanNoteText(`cc nostr:${nprofile}, thanks!`, { [PK_A]: 'Alice' });
    expect(text).toBe('cc @Alice, thanks!');
  });

  it('still drops quoted events, notes and urls', () => {
    const nevent = nip19.neventEncode({ id: 'c'.repeat(64) });
    const note = nip19.noteEncode('d'.repeat(64));
    const text = cleanNoteText(`look nostr:${nevent} and nostr:${note} https://example.com/x`);
    expect(text).toBe('look and');
  });

  it('extracts unique mentioned pubkeys near the start, capped', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      nip19.npubEncode(String(i + 1).repeat(64))
    );
    const content = `nostr:${npubA} nostr:${npubA} nostr:${npubB} ` + many.map((n) => `nostr:${n}`).join(' ');
    const keys = extractMentionedPubkeys(content);
    expect(keys).toHaveLength(3);
    expect(keys.slice(0, 2)).toEqual([PK_A, PK_B]);
  });

  it('ignores mentions beyond the scan window', () => {
    const content = 'x'.repeat(500) + ` nostr:${npubA}`;
    expect(extractMentionedPubkeys(content)).toEqual([]);
  });
});
