import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseZapComment, shortenZapUrl } from './zapComment';

describe('parseZapComment', () => {
  it('splits plain text and clickable URLs without losing punctuation', () => {
    expect(parseZapComment('See https://example.com/menu, then tell me.').segments).toEqual([
      { type: 'text', value: 'See ' },
      { type: 'url', href: 'https://example.com/menu', label: 'example.com/menu' },
      { type: 'text', value: ',' },
      { type: 'text', value: ' then tell me.' }
    ]);
  });

  it('extracts and deduplicates image URLs for the lightbox', () => {
    const image = 'https://image.nostr.build/zap-photo.jpg';
    const parsed = parseZapComment(`${image} and again ${image}!`);
    expect(parsed.imageUrls).toEqual([image]);
    expect(parsed.segments).toEqual([{ type: 'text', value: ' and again ' }]);
  });

  it('hides an image URL and its trailing punctuation from the message text', () => {
    const image = 'https://media.example.com/photo.webp';
    expect(parseZapComment(`${image}!`)).toEqual({ segments: [], imageUrls: [image] });
  });

  it('does not treat ordinary links as images', () => {
    expect(parseZapComment('https://zap.cooking/recipes').imageUrls).toEqual([]);
  });
});

describe('shortenZapUrl', () => {
  it('keeps short URLs readable and truncates long paths in the middle', () => {
    expect(shortenZapUrl('https://example.com/a')).toBe('example.com/a');

    const shortened = shortenZapUrl(`https://example.com/${'long-path/'.repeat(12)}photo.jpg`, 40);
    expect(shortened).toHaveLength(40);
    expect(shortened).toContain('...');
    expect(shortened).toMatch(/photo\.jpg$/);
  });
});

describe('ZapCommentContent', () => {
  it('opens links safely and expands image thumbnails in the shared lightbox', () => {
    const component = readFileSync('src/components/ZapCommentContent.svelte', 'utf8');
    expect(component).toContain('target="_blank"');
    expect(component).toContain('rel="noopener noreferrer"');
    expect(component).toContain('<MediaLightbox');
    expect(component).toContain('Expand image attached to zap');
    expect(component).toContain('failedImageUrls');
    expect(component).toContain('shortenZapUrl(url)');

    for (const surface of [
      'src/components/PostEngagementDrawer.svelte',
      'src/components/ZappersListModal.svelte'
    ]) {
      expect(readFileSync(surface, 'utf8')).toContain('ZapCommentContent');
    }
  });
});
