import { describe, it, expect } from 'vitest';
import {
  HASHTAG_PATTERN,
  MAX_HASHTAGS,
  countContentHashtags,
  hashtagCount,
  extractHashtags,
  buildHashtagTags
} from './hashtags';

describe('extractHashtags', () => {
  it('returns nothing for an empty or tagless body', () => {
    expect(extractHashtags('')).toEqual([]);
    expect(extractHashtags('no tags here')).toEqual([]);
  });

  it('finds tags at the start, mid-line and on their own line', () => {
    expect(extractHashtags('#foodstr breakfast\nwas #cooking\n\n#coffee')).toEqual([
      'foodstr',
      'cooking',
      'coffee'
    ]);
  });

  it('lowercases and de-duplicates, keeping first-seen order', () => {
    expect(extractHashtags('#Foodstr #FOODSTR #food #foodstr')).toEqual(['foodstr', 'food']);
  });

  it('drops sentence punctuation that trails a tag', () => {
    expect(extractHashtags('Loving this #foodstr. And #coffee!')).toEqual(['foodstr', 'coffee']);
    expect(extractHashtags('(see #lunch)')).toEqual(['lunch']);
  });

  it('ignores a # glued to a word or a URL fragment', () => {
    expect(extractHashtags('word#notatag https://x.y/#anchor')).toEqual([]);
  });

  it('ignores a bare # and a double ##', () => {
    expect(extractHashtags('# alone and ##double')).toEqual([]);
  });

  it('matches the feed pattern token for token', () => {
    const body = 'a #one b #two\n#three #four.';
    const feedCount = (body.match(HASHTAG_PATTERN) ?? []).length;
    expect(extractHashtags(body)).toHaveLength(feedCount);
  });
});

describe('buildHashtagTags', () => {
  it('shapes each tag as a t tag', () => {
    expect(buildHashtagTags('#foodstr and #Dinner')).toEqual([
      ['t', 'foodstr'],
      ['t', 'dinner']
    ]);
  });

  it('is empty for a body without hashtags', () => {
    expect(buildHashtagTags('plain note')).toEqual([]);
  });
});

describe('hashtagCount', () => {
  it('counts body tokens as the feed pattern does, punctuation included', () => {
    expect(countContentHashtags('#a #b\n#c.')).toBe(3);
    expect(countContentHashtags('')).toBe(0);
  });

  it('takes the greater of body tokens and t tags', () => {
    const tTags = [
      ['t', 'x'],
      ['t', 'y'],
      ['p', 'ignored']
    ];
    expect(hashtagCount('#one', tTags)).toBe(2);
    expect(hashtagCount('#one #two #three', tTags)).toBe(3);
    expect(hashtagCount('', [])).toBe(0);
  });

  it('exposes the cap the feed filters on', () => {
    expect(MAX_HASHTAGS).toBe(5);
  });
});
