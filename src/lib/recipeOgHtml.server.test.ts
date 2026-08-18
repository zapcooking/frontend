/**
 * Tests for `isCrawler`'s User-Agent matching.
 *
 * Two properties are being pinned, and they pull in opposite directions:
 *  1. every unfurler we claim to support actually matches (Bluesky was the
 *     gap — `Bluesky Cardyb/1.1` fell through to the SPA shell and got a
 *     generic card);
 *  2. no in-app browser UA matches. A false positive serves a human the
 *     empty-body crawler document instead of the app — that is the reason
 *     WhatsApp/Pinterest/Bluesky are matched only in their dedicated-crawler
 *     form, and the reason those negatives are asserted here and not just
 *     described in the comment above `CRAWLER_UA`.
 */

import { describe, it, expect } from 'vitest';
import { isCrawler, injectOgTags } from './recipeOgHtml.server';

describe('isCrawler', () => {
  it('matches the Bluesky link-card fetcher', () => {
    expect(isCrawler('Bluesky Cardyb/1.1')).toBe(true);
  });

  it('matches a future Bluesky Cardyb version (no version suffix required)', () => {
    expect(isCrawler('Bluesky Cardyb/2.0')).toBe(true);
  });

  it('does NOT match a bare "Bluesky" in-app browser UA', () => {
    expect(
      isCrawler(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Bluesky/1.87'
      )
    ).toBe(false);
  });

  const crawlers = [
    ['Facebook', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
    ['X / Twitter', 'Twitterbot/1.0'],
    [
      'LinkedIn',
      'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)'
    ],
    ['Discord', 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'],
    ['Slack', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
    ['Telegram', 'TelegramBot (like TwitterBot)'],
    ['WhatsApp', 'WhatsApp/2.23.20.0 A'],
    [
      'Apple',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 (Applebot/0.1)'
    ],
    ['Mastodon', 'http.rb/5.1.1 (Mastodon/4.2.1; +https://mastodon.social/)']
  ] as const;

  for (const [label, ua] of crawlers) {
    it(`still matches ${label}`, () => {
      expect(isCrawler(ua)).toBe(true);
    });
  }

  const humans = [
    [
      'WhatsApp in-app browser',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp'
    ],
    [
      'Pinterest in-app browser',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [Pinterest/iOS]'
    ],
    [
      'desktop Chrome',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    ]
  ] as const;

  for (const [label, ua] of humans) {
    it(`does NOT match ${label}`, () => {
      expect(isCrawler(ua)).toBe(false);
    });
  }

  it('does not match a missing User-Agent', () => {
    expect(isCrawler(null)).toBe(false);
    expect(isCrawler('')).toBe(false);
  });
});

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
