import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { buildListTags, listIdentifier, BOOKMARKS_IDENTIFIER } from './listTags';
import { RECIPE_TAG_PREFIX_NEW } from './consts';

/**
 * The list editor republishes a kind-30001 at the same `d` address, so the
 * tag set it emits is the whole list — anything missing is deleted, not
 * left alone. These tests pin the round trip: load a list, change nothing,
 * republish, and every tag the form showed is still there.
 *
 * The regression they guard is a cover image that was pushed onto the
 * source event being read instead of the new event being published, so the
 * republished list silently lost its cover while the page said 'Success!'.
 */

const PUBKEY = 'a723805cda67251191c8786f4da58f797e6977582301354ba8e91bcb0342dc9c';
const COVER = 'https://image.nostr.build/cover.jpg';

function naddrFor(identifier: string): string {
  return nip19.naddrEncode({ kind: 30023, pubkey: PUBKEY, identifier });
}

function tagValue(tags: string[][], name: string): string | undefined {
  return tags.find((t) => t[0] === name)?.[1];
}

describe('buildListTags', () => {
  it('keeps the cover image on a round trip that changes nothing', () => {
    const sourceTags = [
      ['d', 'italian-favorites'],
      ['title', 'Italian Favorites'],
      ['image', COVER],
      ['a', `30023:${PUBKEY}:carbonara`]
    ];

    const tags = buildListTags({
      sourceTags,
      title: 'Italian Favorites',
      summary: '',
      images: [COVER],
      items: [{ naddr: naddrFor('carbonara') }]
    });

    expect(tagValue(tags, 'image')).toBe(COVER);
  });

  it('does not write the image onto the event it was read from', () => {
    const sourceTags = [
      ['d', 'italian-favorites'],
      ['title', 'Italian Favorites']
    ];
    const before = JSON.stringify(sourceTags);

    buildListTags({
      sourceTags,
      title: 'Italian Favorites',
      summary: '',
      images: [COVER],
      items: []
    });

    expect(JSON.stringify(sourceTags)).toBe(before);
  });

  it('carries title, summary, cover and recipes together', () => {
    const tags = buildListTags({
      sourceTags: [['d', 'italian-favorites']],
      title: 'Italian Favorites',
      summary: 'Everything worth making twice.',
      images: [COVER],
      items: [{ naddr: naddrFor('carbonara') }, { naddr: naddrFor('cacio-e-pepe') }]
    });

    expect(tagValue(tags, 'title')).toBe('Italian Favorites');
    expect(tagValue(tags, 'summary')).toBe('Everything worth making twice.');
    expect(tagValue(tags, 'image')).toBe(COVER);
    expect(tags.filter((t) => t[0] === 'a').map((t) => t[1])).toEqual([
      `30023:${PUBKEY}:carbonara`,
      `30023:${PUBKEY}:cacio-e-pepe`
    ]);
  });

  it('gives a named list the zapcooking tag and a slugified identifier', () => {
    const tags = buildListTags({
      sourceTags: [['d', 'italian-favorites']],
      title: 'Italian Favorites',
      summary: '',
      images: [],
      items: []
    });

    expect(tagValue(tags, 't')).toBe(RECIPE_TAG_PREFIX_NEW);
    expect(tagValue(tags, 'd')).toBe('italian-favorites');
    expect(tagValue(tags, 'd')).toBe(listIdentifier('Italian Favorites'));
  });

  it('keeps the bookmarks identifier and does not tag it as a recipe list', () => {
    const tags = buildListTags({
      sourceTags: [['d', BOOKMARKS_IDENTIFIER]],
      title: 'Bookmarks',
      summary: '',
      images: [],
      items: []
    });

    expect(tagValue(tags, 'd')).toBe(BOOKMARKS_IDENTIFIER);
    expect(tags.find((t) => t[0] === 't')).toBeUndefined();
  });

  it('omits summary and image when the member left them empty', () => {
    const tags = buildListTags({
      sourceTags: [['d', 'italian-favorites']],
      title: 'Italian Favorites',
      summary: '',
      images: [],
      items: []
    });

    expect(tags.find((t) => t[0] === 'summary')).toBeUndefined();
    expect(tags.find((t) => t[0] === 'image')).toBeUndefined();
  });
});
