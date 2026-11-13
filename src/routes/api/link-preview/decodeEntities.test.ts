import { describe, expect, it } from 'vitest';
import { decodeEntities } from './decodeEntities';

describe('decodeEntities', () => {
  // bitcoinship.show serves og:title with the zero-padded numeric form.
  it('decodes the zero-padded decimal apostrophe', () => {
    expect(decodeEntities('you&#039;re building')).toBe("you're building");
  });

  it('decodes decimal and hex numeric forms', () => {
    expect(decodeEntities('&#39;')).toBe("'");
    expect(decodeEntities('&#x27;')).toBe("'");
    expect(decodeEntities('&#X27;')).toBe("'");
    expect(decodeEntities('&#8217;')).toBe('’');
    expect(decodeEntities('&#x2019;')).toBe('’');
    expect(decodeEntities('&#x1F600;')).toBe('😀');
  });

  it('decodes named entities', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;q&quot; &apos;x&apos;')).toBe(
      'a & b <c> "q" \'x\''
    );
    expect(decodeEntities('BTC &ndash; Lightning&hellip;')).toBe('BTC – Lightning…');
    expect(decodeEntities('it&rsquo;s &ldquo;on&rdquo;')).toBe('it’s “on”');
    expect(decodeEntities('cup&nbsp;cakes')).toBe('cup\u00A0cakes');
  });

  it('decodes &amp; only once (single pass)', () => {
    expect(decodeEntities('&amp;#039;')).toBe('&#039;');
    expect(decodeEntities('&amp;amp;')).toBe('&amp;');
  });

  it('leaves stray ampersands and unknown entities alone', () => {
    expect(decodeEntities('fish & chips')).toBe('fish & chips');
    expect(decodeEntities('a &notanentity; b')).toBe('a &notanentity; b');
    expect(decodeEntities('&#; &#x; &#zz;')).toBe('&#; &#x; &#zz;');
    expect(decodeEntities('no entities here')).toBe('no entities here');
  });

  it('passes through out-of-range scalar refs', () => {
    expect(decodeEntities('&#xD800;')).toBe('&#xD800;');
    expect(decodeEntities('&#x110000;')).toBe('&#x110000;');
  });
});
