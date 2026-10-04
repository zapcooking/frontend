import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  nextContactTags,
  nextBookmarkTags,
  bookmarkRef,
  isBookmarked,
  reportTemplate,
  REPORT_TYPES
} from './social';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

describe('follow', () => {
  it('adds a follow and keeps the others', () => {
    expect(nextContactTags([['p', A]], B, true)).toEqual([
      ['p', A],
      ['p', B]
    ]);
  });
  it('removes a follow', () => {
    expect(
      nextContactTags(
        [
          ['p', A],
          ['p', B]
        ],
        A,
        false
      )
    ).toEqual([['p', B]]);
  });
  it('publishes nothing when nothing changes', () => {
    expect(nextContactTags([['p', A]], A, true)).toBeNull();
    expect(nextContactTags([['p', A]], B, false)).toBeNull();
  });
  it('never empties a list that had more than one follow', () => {
    // A duplicated entry would otherwise empty a two-entry list.
    expect(
      nextContactTags(
        [
          ['p', A],
          ['p', A]
        ],
        A,
        false
      )
    ).toBeNull();
  });
  it('may unfollow the only follow', () => {
    expect(nextContactTags([['p', A]], A, false)).toEqual([]);
  });
  it('keeps only p tags (as ProfileSheet does)', () => {
    expect(
      nextContactTags(
        [
          ['t', 'x'],
          ['p', A]
        ],
        B,
        true
      )
    ).toEqual([
      ['p', A],
      ['p', B]
    ]);
  });
});

describe('bookmarks', () => {
  const note = { id: C, kind: 1, pubkey: A, tags: [] as string[][] };
  const article = { id: C, kind: 30023, pubkey: A, tags: [['d', 'soup']] };

  it('references notes by id and long-form posts by address', () => {
    expect(bookmarkRef(note)).toEqual(['e', C]);
    expect(bookmarkRef(article)).toEqual(['a', `30023:${A}:soup`]);
  });
  it('adds and removes, keeping every other entry and its order', () => {
    const tags = [
      ['t', 'food'],
      ['e', B]
    ];
    expect(nextBookmarkTags(tags, ['e', C], true)).toEqual([...tags, ['e', C]]);
    expect(nextBookmarkTags([...tags, ['e', C]], ['e', C], false)).toEqual(tags);
  });
  it('publishes nothing when nothing changes', () => {
    expect(nextBookmarkTags([['e', C]], ['e', C], true)).toBeNull();
    expect(nextBookmarkTags([], ['e', C], false)).toBeNull();
  });
  it('isBookmarked', () => {
    expect(isBookmarked([['e', C]], ['e', C])).toBe(true);
    expect(isBookmarked(null, ['e', C])).toBe(false);
  });
});

describe('reports (NIP-56)', () => {
  it('reports the post and its author with the same type', () => {
    expect(reportTemplate({ id: C, pubkey: A }, 'spam', '  bot  ')).toEqual({
      kind: 1984,
      content: 'bot',
      tags: [
        ['e', C, 'spam'],
        ['p', A, 'spam']
      ]
    });
  });
  it('offers only NIP-56 report types', () => {
    const nip56 = ['nudity', 'malware', 'profanity', 'illegal', 'spam', 'impersonation', 'other'];
    for (const t of REPORT_TYPES) expect(nip56).toContain(t.value);
  });
});

describe('writes go through $ndk, never the feed relay', () => {
  const src = readFileSync(new URL('./social.ts', import.meta.url), 'utf8');
  it('does not touch the Fresh relay client', () => {
    expect(src).not.toMatch(/from '\.\/relay'|feed\.zap\.cooking|freshSession/);
  });
});
