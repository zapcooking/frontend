/**
 * Tests for the OG injection pipeline: `injectOgTags` must replace the SSR
 * page's placeholder tags (shipping both sets is how cards went generic —
 * scrapers pick one arbitrarily), and `buildOgTagBlock` must degrade rather
 * than throw on bad relay-supplied data.
 *
 * There are deliberately no User-Agent tests here: the crawler allowlist is
 * gone, OG tags are injected for every visitor. Do not reintroduce UA
 * sniffing (see recipeOgHtml.server.ts).
 */

import { describe, it, expect } from 'vitest';
import { injectOgTags, buildOgTagBlock, createOgPageTransformer } from './recipeOgHtml.server';

describe('injectOgTags', () => {
  const TAGS = [
    '<title>The Anything Omelette - zap.cooking</title>',
    '<meta property="og:title" content="The Anything Omelette" />',
    '<meta property="og:image" content="https://img.example/real.jpg" />'
  ].join('\n');

  /** The shape SSR produces: the page's own placeholder tags in <head>. */
  const ssrPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Recipe</title>
  <meta name="description" content="A recipe shared on zap.cooking" />
  <link rel="canonical" href="https://zap.cooking/r/naddr1x" />
  <meta property="og:title" content="Recipe" />
  <meta property="og:image" content="https://zap.cooking/social-share.png" />
  <meta name="twitter:title" content="Recipe" />
  <link rel="stylesheet" href="/app.css" />
</head>
<body><div id="app">hi</div><script src="/app.js"></script></body>
</html>`;

  it('replaces the placeholder tags rather than adding a second set', () => {
    const out = injectOgTags(ssrPage, TAGS);

    // Exactly one of each — duplicates are how cards went generic before.
    expect(out.match(/<meta property="og:title"/g)).toHaveLength(1);
    expect(out.match(/<title>/g)).toHaveLength(1);
    expect(out).toContain('content="The Anything Omelette"');
    expect(out).not.toContain('content="Recipe"');
    expect(out).not.toContain('social-share.png');
  });

  it('removes the page description, canonical and twitter tags too', () => {
    const out = injectOgTags(ssrPage, TAGS);

    expect(out).not.toContain('A recipe shared on zap.cooking');
    expect(out).not.toContain('rel="canonical"');
    expect(out).not.toContain('twitter:title');
  });

  it('leaves non-OG head content alone', () => {
    const out = injectOgTags(ssrPage, TAGS);

    expect(out).toContain('<meta charset="utf-8" />');
    expect(out).toContain('<link rel="stylesheet" href="/app.css" />');
  });

  it('leaves the body untouched', () => {
    const out = injectOgTags(ssrPage, TAGS);

    expect(out).toContain('<div id="app">hi</div>');
    expect(out).toContain('<script src="/app.js"></script>');
  });

  it('does not touch a <title> that appears in the body', () => {
    const withSvg = ssrPage.replace(
      '<div id="app">hi</div>',
      '<svg><title>icon label</title></svg>'
    );

    const out = injectOgTags(withSvg, TAGS);

    // Head rewriting must not reach into body content.
    expect(out).toContain('<title>icon label</title>');
  });

  it('returns the html unchanged when there is no head', () => {
    const noHead = '<html><body>nope</body></html>';
    expect(injectOgTags(noHead, TAGS)).toBe(noHead);
  });

  it('still injects when the page emitted no OG tags of its own', () => {
    const bare = '<html><head><meta charset="utf-8" /></head><body></body></html>';

    const out = injectOgTags(bare, TAGS);

    expect(out).toContain('og:title');
    expect(out.match(/<meta property="og:title"/g)).toHaveLength(1);
  });
});

describe('createOgPageTransformer', () => {
  const TAGS = '<meta property="og:title" content="The Anything Omelette" />';
  const page = `<!doctype html><html><head>
  <meta property="og:title" content="Recipe" />
</head><body>hi</body></html>`;

  it('injects when the page arrives as a single chunk', () => {
    const transform = createOgPageTransformer(TAGS);
    const out = transform({ html: page, done: true });

    expect(out).toContain('The Anything Omelette');
    expect(out.match(/og:title/g)).toHaveLength(1);
  });

  it('injects when the chunk boundary falls between <head> and </head>', () => {
    // A per-chunk injection would see no complete head in either chunk and
    // ship the placeholders — the exact regression this transformer prevents.
    const splitAt = page.indexOf('<meta property');
    const transform = createOgPageTransformer(TAGS);

    const first = transform({ html: page.slice(0, splitAt), done: false });
    const last = transform({ html: page.slice(splitAt), done: true });
    const out = first + last;

    expect(first).toBe('');
    expect(out).toContain('The Anything Omelette');
    expect(out).not.toContain('content="Recipe"');
    expect(out).toContain('<body>hi</body>');
  });
});

describe('buildOgTagBlock resilience', () => {
  const base = {
    pageTitle: 'T',
    ogTitle: 'T',
    description: 'D',
    image: 'https://zap.cooking/social-share.png',
    authorPubkey: null
  };

  it('omits the published tag for an out-of-range timestamp instead of throwing', async () => {
    // Date#toISOString throws a RangeError past ±8.64e15 ms. A single bad
    // relay `created_at` must not take the page render down.
    const out = await buildOgTagBlock(
      { ...base, publishedAt: 8.64e15 },
      'https://zap.cooking/r/naddr1x'
    );

    expect(out).not.toContain('article:published_time');
    expect(out).toContain('og:title');
  });

  it('still emits the published tag for a normal timestamp', async () => {
    const out = await buildOgTagBlock(
      { ...base, publishedAt: 1_700_000_000 },
      'https://zap.cooking/r/naddr1x'
    );

    expect(out).toContain('article:published_time');
  });
});
