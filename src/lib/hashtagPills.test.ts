import { describe, it, expect } from 'vitest';
import { MAX_HASHTAGS } from './hashtags';
import {
  SUGGESTED_HASHTAGS,
  isHashtagSelected,
  suggestedTagCount,
  atHashtagCap,
  overHashtagCap,
  appendHashtag,
  removeHashtag,
  toggleHashtag
} from './hashtagPills';

describe('SUGGESTED_HASHTAGS', () => {
  it('is the measured set in the designed order, without gratitude', () => {
    expect(SUGGESTED_HASHTAGS).toEqual([
      'foodstr',
      'coffee',
      'cooking',
      'breakfast',
      'dinner',
      'lunch',
      'cookstr',
      'food'
    ]);
    expect(SUGGESTED_HASHTAGS).not.toContain('gratitude');
  });
});

describe('select', () => {
  it('starts a new paragraph after prose', () => {
    expect(toggleHashtag('Made eggs', 'foodstr')).toBe('Made eggs\n\n#foodstr');
  });

  it('is just the tag on an empty body', () => {
    expect(toggleHashtag('', 'foodstr')).toBe('#foodstr');
    expect(toggleHashtag('  \n', 'foodstr')).toBe('#foodstr');
  });

  it('joins a trailing tag line', () => {
    expect(toggleHashtag('Made eggs\n\n#foodstr', 'coffee')).toBe('Made eggs\n\n#foodstr #coffee');
  });

  it('drops trailing whitespace before appending', () => {
    expect(appendHashtag('Made eggs\n\n#foodstr   \n\n', 'coffee')).toBe(
      'Made eggs\n\n#foodstr #coffee'
    );
  });

  it('does not join a line that mixes words and tags', () => {
    expect(appendHashtag('eggs #foodstr', 'coffee')).toBe('eggs #foodstr\n\n#coffee');
  });

  it('reads as selected after the tap', () => {
    expect(isHashtagSelected(toggleHashtag('Made eggs', 'foodstr'), 'foodstr')).toBe(true);
  });
});

describe('deselect', () => {
  it('removes the tag and the paragraph it started', () => {
    expect(toggleHashtag('Made eggs\n\n#foodstr', 'foodstr')).toBe('Made eggs');
  });

  it('removes one tag from a tag line and closes the gap', () => {
    expect(toggleHashtag('Made eggs\n\n#foodstr #coffee', 'foodstr')).toBe('Made eggs\n\n#coffee');
    expect(toggleHashtag('Made eggs\n\n#foodstr #coffee', 'coffee')).toBe('Made eggs\n\n#foodstr');
  });

  it('removes every occurrence, case-insensitively', () => {
    expect(removeHashtag('#Foodstr eggs #FOODSTR and #foodstr', 'foodstr')).toBe('eggs and');
  });

  it('leaves longer tags that share the prefix alone', () => {
    expect(removeHashtag('#foodstr #foodstrlove #food', 'food')).toBe('#foodstr #foodstrlove');
    expect(removeHashtag('#food_pics #food', 'food')).toBe('#food_pics');
  });

  it('reads as unselected after the tap', () => {
    expect(isHashtagSelected(toggleHashtag('x #foodstr', 'foodstr'), 'foodstr')).toBe(false);
  });

  it('leaves a #tag inside a URL fragment untouched', () => {
    const url = 'see https://x.y/page#foodstr and https://x.y/#foodstr';
    expect(removeHashtag(url, 'foodstr')).toBe(url);
    expect(removeHashtag(`${url}\n\n#foodstr`, 'foodstr')).toBe(url);
  });

  it('leaves a # glued to a word untouched, as extraction does', () => {
    expect(removeHashtag('word#foodstr #foodstr', 'foodstr')).toBe('word#foodstr');
  });
});

describe('typed tag shows as selected', () => {
  it('matches a tag typed by hand, any case, anywhere in the body', () => {
    expect(isHashtagSelected('Eggs for #Breakfast today', 'breakfast')).toBe(true);
    expect(isHashtagSelected('#coffee\nfirst', 'coffee')).toBe(true);
  });

  it('matches a typed tag followed by punctuation', () => {
    expect(isHashtagSelected('Loving #foodstr.', 'foodstr')).toBe(true);
  });

  it('does not match a longer tag or a bare word', () => {
    expect(isHashtagSelected('#foodstr', 'food')).toBe(false);
    expect(isHashtagSelected('food is great', 'food')).toBe(false);
  });
});

describe('cap', () => {
  const five = '#a #b #c #d #e';

  it('counts as the feed counts', () => {
    expect(suggestedTagCount('')).toBe(0);
    expect(suggestedTagCount('x #foodstr\n\n#coffee.')).toBe(2);
    expect(suggestedTagCount(five)).toBe(MAX_HASHTAGS);
  });

  it('is at the cap at exactly MAX_HASHTAGS and not below', () => {
    expect(atHashtagCap('#a #b #c #d')).toBe(false);
    expect(atHashtagCap(five)).toBe(true);
    expect(overHashtagCap(five)).toBe(false);
  });

  it('is over the cap only past MAX_HASHTAGS, which typing can reach', () => {
    expect(overHashtagCap(`${five} #f`)).toBe(true);
    expect(atHashtagCap(`${five} #f`)).toBe(true);
  });

  it('ignores a tap on an unselected pill at the cap', () => {
    expect(toggleHashtag(five, 'foodstr')).toBe(five);
  });

  it('still lets a selected pill toggle off at the cap', () => {
    expect(toggleHashtag('#a #b #c #d #foodstr', 'foodstr')).toBe('#a #b #c #d');
  });
});
