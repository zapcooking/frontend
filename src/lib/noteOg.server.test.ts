/**
 * Tests for note OG image selection (docs/plans/og-missing-images-fix.md,
 * Phase 2): `getNoteOgMeta` should prefer a NIP-92 `imeta` tag's URL over
 * scanning note content, and its content-scan fallback should recognize
 * known extensionless image-CDN hosts, not just file-extension URLs.
 */

import { describe, it, expect } from 'vitest';
import { getNoteOgMeta } from './noteOg.server';
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
