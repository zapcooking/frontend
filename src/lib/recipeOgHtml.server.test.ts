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
import { isCrawler } from './recipeOgHtml.server';

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
