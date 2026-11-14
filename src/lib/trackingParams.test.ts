import { describe, it, expect } from 'vitest';
import { cleanTrackedUrl, findTrackedUrls } from './trackingParams';

// The load-bearing promise is narrow and mechanical: the output is the input
// minus whole query parameters. Nothing else moves. A path stays, a fragment
// stays, and a parameter being kept comes back encoded exactly as it arrived.
// Ported from sidecar's test/tracking-params.test.js (PR #338).

describe('cleanTrackedUrl', () => {
  it('takes a utm tail off and the rest of the link does not move', () => {
    expect(
      cleanTrackedUrl('https://example.com/a/b?id=7&utm_source=newsletter&utm_medium=email')
    ).toBe('https://example.com/a/b?id=7');
    // The whole query was tracking, so the question mark goes with it. A
    // trailing ? is a different string than no query at all, and some servers
    // treat it as one.
    expect(cleanTrackedUrl('https://example.com/a?utm_campaign=x')).toBe('https://example.com/a');
    // Nothing to take off is null, not a copy. The offer must not appear for a
    // clean link.
    expect(cleanTrackedUrl('https://example.com/a?id=7')).toBe(null);
    expect(cleanTrackedUrl('https://example.com/a')).toBe(null);
  });

  it('THE OUTPUT IS THE INPUT MINUS WHOLE PARAMETERS, AND NOTHING ELSE', () => {
    // The promise that makes this safe to run against a site nobody here has
    // heard of. Any rebuild through URL or URLSearchParams breaks it, which is
    // why the implementation works on the query string as text.
    const cases = [
      'https://example.com/path/with.dots/and-dashes?q=a%20b&utm_source=x',
      'https://example.com/?keep=%5Bbracketed%5D&fbclid=123',
      'https://example.com/p?a=1&utm_term=t&b=2&gclid=9&c=3',
      'https://user.example.com:8443/deep/path?x=1&utm_id=7'
    ];
    for (const raw of cases) {
      const out = cleanTrackedUrl(raw);
      expect(out).toBeTruthy();
      const rawParts = raw.slice(raw.indexOf('?') + 1).split('&');
      const outParts = out!.includes('?') ? out!.slice(out!.indexOf('?') + 1).split('&') : [];
      for (const part of outParts) {
        expect(rawParts).toContain(part);
      }
      expect(outParts.length).toBeLessThan(rawParts.length);
      // And the half before the query is byte-identical, port, case, dots and all.
      expect(out!.split('?')[0]).toBe(raw.split('?')[0]);
    }
  });

  it('encoding survives, because re-encoding is an edit', () => {
    // URLSearchParams turns %20 into + and escapes brackets it was handed raw.
    // Both are a different URL than the one that was pasted.
    expect(cleanTrackedUrl('https://example.com/s?q=one%20two&utm_source=x')).toBe(
      'https://example.com/s?q=one%20two'
    );
    expect(cleanTrackedUrl('https://example.com/s?q=a+b&fbclid=1')).toBe(
      'https://example.com/s?q=a+b'
    );
  });

  it('the fragment stays, and the order of what is kept stays', () => {
    // Sorting the query or dropping the fragment would be an edit to a link
    // nobody asked us to edit: #installation is where they meant to send you,
    // and a reordered query is a link they did not write.
    expect(cleanTrackedUrl('https://docs.example.com/guide?utm_source=x&v=2#installation')).toBe(
      'https://docs.example.com/guide?v=2#installation'
    );
    expect(cleanTrackedUrl('https://example.com/?z=1&utm_medium=m&a=2')).toBe(
      'https://example.com/?z=1&a=2'
    );
  });

  it('the path is never touched', () => {
    // Several sites carry tracking in path segments, and nothing tells those
    // apart from an id without knowing the site. Refusing to touch a path is
    // what keeps the rule general.
    expect(cleanTrackedUrl('https://example.com/ref=abc123/page?utm_source=x')).toBe(
      'https://example.com/ref=abc123/page'
    );
    expect(cleanTrackedUrl('https://example.com/utm_source/page')).toBe(null);
  });

  it('A SHORT NAME IS ONLY TRACKING ON THE HOST THAT OWNS IT', () => {
    // `t` and `s` on x.com are a share token and where the share came from. As
    // global rules they would gut a search URL on some unrelated site, so they
    // are scoped to the host.
    expect(cleanTrackedUrl('https://x.com/someone/status/123?s=20&t=AbCd')).toBe(
      'https://x.com/someone/status/123'
    );
    expect(cleanTrackedUrl('https://example.com/search?s=20&t=AbCd')).toBe(null);
    // YouTube keeps the video id and loses the share id, which is the case
    // this list was written for in the first place.
    expect(cleanTrackedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=xyz')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    );
    expect(cleanTrackedUrl('https://youtu.be/dQw4w9WgXcQ?si=xyz&t=43')).toBe(
      'https://youtu.be/dQw4w9WgXcQ?t=43'
    );
  });

  it("Amazon's affiliate tag is deliberately left alone", () => {
    // Sometimes the affiliate code is the entire reason somebody shared the
    // link. A button offering to remove tracking must not quietly be a button
    // that removes earnings.
    expect(cleanTrackedUrl('https://www.amazon.com/dp/B000?tag=someone-20')).toBe(null);
    // utm on the same URL still comes off, since that one is nobody's income.
    expect(cleanTrackedUrl('https://www.amazon.com/dp/B000?tag=someone-20&utm_source=x')).toBe(
      'https://www.amazon.com/dp/B000?tag=someone-20'
    );
  });

  it('only http and https, so a nostr: or mailto: link is left where it is', () => {
    expect(cleanTrackedUrl('nostr:npub1abc?utm_source=x')).toBe(null);
    expect(cleanTrackedUrl('mailto:someone@example.com?utm_source=x')).toBe(null);
    expect(cleanTrackedUrl('not a url at all')).toBe(null);
    expect(cleanTrackedUrl('')).toBe(null);
  });
});

describe('findTrackedUrls', () => {
  it('trailing punctuation belongs to the sentence, not the link', () => {
    const hits = findTrackedUrls('read this https://example.com/a?utm_source=x.');
    expect(hits.length).toBe(1);
    expect(hits[0].raw).toBe('https://example.com/a?utm_source=x');
    // A closing bracket the URL opened itself is part of the URL. Wikipedia
    // depends on it; a stray one after a link does not.
    expect(
      findTrackedUrls('(see https://en.wikipedia.org/wiki/Foo_(bar)?utm_source=x)')[0].raw
    ).toBe('https://en.wikipedia.org/wiki/Foo_(bar)?utm_source=x');
    expect(findTrackedUrls('plain https://example.com/a?utm_source=x), ok')[0].raw).toBe(
      'https://example.com/a?utm_source=x'
    );
  });

  it('finds the tracked link in a line of writing and not the clean one', () => {
    const hits = findTrackedUrls(
      'read this https://example.com/a?utm_source=x. and this https://example.com/b?id=1'
    );
    expect(hits.length).toBe(1);
    expect(hits[0]).toEqual({
      raw: 'https://example.com/a?utm_source=x',
      clean: 'https://example.com/a'
    });
    expect(findTrackedUrls('nothing here')).toEqual([]);
    expect(findTrackedUrls('')).toEqual([]);
  });

  it('LONGEST FIRST, or replacing one link eats the front of another', () => {
    // Two shares of the same page with different campaign ids produce exactly
    // this: one URL is a strict prefix of the other, and replacing the short
    // one first would leave the long one spliced.
    const hits = findTrackedUrls(
      'https://example.com/a?utm_source=x https://example.com/a?utm_source=xy&id=1'
    );
    expect(hits.length).toBe(2);
    expect(hits[0].raw.length).toBeGreaterThanOrEqual(hits[1].raw.length);
    // And the replacement the composer performs leaves both links intact.
    let text = 'https://example.com/a?utm_source=x https://example.com/a?utm_source=xy&id=1';
    for (const hit of hits) text = text.split(hit.raw).join(hit.clean);
    expect(text).toBe('https://example.com/a https://example.com/a?id=1');
  });

  it('the same link twice is offered once and cleaned everywhere', () => {
    const dup = 'https://example.com/a?utm_source=x';
    const hits = findTrackedUrls(`${dup} and again ${dup}`);
    expect(hits.length).toBe(1);
    let text = `${dup} and again ${dup}`;
    for (const hit of hits) text = text.split(hit.raw).join(hit.clean);
    expect(text).toBe('https://example.com/a and again https://example.com/a');
  });
});
