import { describe, expect, it } from 'vitest';
import {
  EDITION_SECONDS,
  editionVariant,
  nextEditionHref,
  selectCollections,
  selectCover,
  selectMixedCover,
  selectLandingEdition
} from './editions';
import {
  DEFAULT_HEADLINE,
  EDITORIAL_HEADLINES,
  EDITORIAL_SUPPORTING_LINE,
  editionBucket,
  editionHeadline
} from './editorialConfig';
import { emptyLandingData, topicHref } from './landingData.server';
import { longformCard, type LongformCard, type NoteCard, type PackCard } from './content';
import { isEligibleFoodStory, storySummary } from './storyEligibility';
import { imageIdentity } from './imageIdentity';
import { ev, pk } from './fakeRelay.testutil';

function recipe(n: number, author = String(n), tags: string[] = []): LongformCard {
  return {
    type: 'recipe',
    coordinate: `recipe-${n}`,
    title: `Dish ${n}`,
    href: `/recipe/${n}`,
    image: `https://image.nostr.build/${n}.jpg`,
    author: { pubkey: author, name: `Cook ${author}` },
    tags,
    publishedAt: n
  };
}
function story(n: number, author = `writer-${n}`): LongformCard {
  return {
    ...recipe(n, author),
    type: 'article',
    coordinate: `article-${n}`,
    href: `/reads/${n}`,
    title: `Cooking pasta, a kitchen story ${n}`,
    summary: 'A cook shares a favorite kitchen tradition.',
    tags: ['cooking']
  };
}
function post(n: number, now: number, image = `https://image.nostr.build/post-${n}.jpg`): NoteCard {
  return {
    id: `post-${n}`,
    href: `/note/${n}`,
    text: 'Baking bread in my kitchen.',
    image,
    author: { pubkey: `cook-${n}`, name: `Cook ${n}` },
    createdAt: now - n,
    tags: ['baking']
  };
}
const pool = Array.from({ length: 16 }, (_, n) => recipe(n, String(n % 8)));

describe('daily editorial editions', () => {
  it('keeps headline and cover stable throughout the configured day without mutating the cache', () => {
    const before = JSON.stringify(pool);
    const current = selectCover(pool, 0);
    expect(EDITION_SECONDS).toBe(86400);
    expect(selectCover(pool, EDITION_SECONDS - 1)).toEqual(current);
    expect(selectCover(pool, EDITION_SECONDS)).not.toEqual(current);
    expect(editionHeadline(0)).toBe(DEFAULT_HEADLINE);
    expect(editionHeadline(EDITION_SECONDS - 1)).toBe(DEFAULT_HEADLINE);
    expect(editionHeadline(EDITION_SECONDS)).toBe(EDITORIAL_HEADLINES[1]);
    expect(editionBucket(12 * 3600, 6 * 3600)).toBe(2);
    expect(editionHeadline(3600, ['First', 'Second'], 3600)).toBe('Second');
    expect(editionHeadline(NaN, [])).toBe(DEFAULT_HEADLINE);
    expect(editionBucket(0, 0)).toBe(0);
    expect(JSON.stringify(pool)).toBe(before);
  });
  it('prefers three distinct cooks, coordinates, photographs and complementary tags', () => {
    const cards = selectCover(
      [
        recipe(0, 'a', ['pasta']),
        recipe(1, 'a', ['pasta']),
        recipe(2, 'b', ['pasta']),
        recipe(3, 'c', ['drinks']),
        { ...recipe(4, 'd'), image: recipe(0).image + '?w=640' }
      ],
      0
    );
    expect(cards).toHaveLength(3);
    expect(new Set(cards.map((card) => card.author.pubkey)).size).toBe(3);
    expect(new Set(cards.map((card) => imageIdentity(card.image))).size).toBe(3);
    expect(cards[1].tags).toEqual(['drinks']);
  });
  it('mixes an approved story with two recipes and preserves three authors when possible', () => {
    const cards = selectMixedCover(
      [recipe(0, 'a'), recipe(1, 'b'), recipe(2, 'c')],
      [story(20, 'a')],
      0
    );
    expect(cards.map((card) => card.type)).toEqual(['recipe', 'recipe', 'article']);
    expect(new Set(cards.map((card) => card.author.pubkey)).size).toBe(3);
    const jointChoice = selectMixedCover(
      [recipe(0, 'a'), recipe(1, 'b')],
      [story(20, 'b'), story(21, 'c')],
      0
    );
    expect(new Set(jointChoice.map((card) => card.author.pubkey)).size).toBe(3);
  });
  it('falls back to recipes when no suitable approved story exists, and renders sparse pools honestly', () => {
    expect(
      selectMixedCover(pool, [{ ...story(20), title: 'Bitcoin relay announcement' }], 0).map(
        (card) => card.type
      )
    ).toEqual(['recipe', 'recipe', 'recipe']);
    expect(selectMixedCover([], [story(20)], 0)).toEqual([]);
    const data = {
      ...emptyLandingData(),
      coverPool: [recipe(0)],
      recipePool: pool,
      reads: [story(20)]
    };
    const result = selectLandingEdition(data, 0);
    expect(result.cover?.coordinate).toBe('recipe-0');
    expect(result.picks).toEqual([]);
    expect(result.reads[0].coordinate).toBe('article-20');
  });
  it('offers four bounded cached variations without changing the headline', () => {
    const data = { ...emptyLandingData(), coverPool: pool, readPool: [story(20), story(21)] };
    expect(selectCover(pool, 0, editionVariant('next'))).not.toEqual(selectCover(pool, 0));
    expect(selectLandingEdition(data, 0, 'next').headline).toBe(
      selectLandingEdition(data, 0).headline
    );
    expect(editionVariant('9000')).toBe(0);
    expect(editionVariant('-1')).toBe(0);
    expect(nextEditionHref(null)).toBe('/explore?edition=next');
    expect(nextEditionHref('next')).toBe('/explore?edition=2');
    expect(nextEditionHref('2')).toBe('/explore?edition=3');
    expect(nextEditionHref('3')).toBe('/explore');
  });
  it('deduplicates every displayed item and photograph across cover, recipes, stories, Fresh and packs', () => {
    const now = 86400;
    const topicPost = post(1, now);
    const pack: PackCard = {
      coordinate: 'pack',
      href: '/pack/one',
      title: 'A real pack',
      author: { pubkey: 'pack-author' },
      recipeCount: 1,
      recipeCoordinates: ['recipe-0'],
      image: recipe(0).image,
      publishedAt: 1
    };
    const data = {
      ...emptyLandingData(),
      coverPool: pool.slice(0, 4),
      recipePool: pool,
      readPool: [story(20)],
      reads: [
        story(20),
        story(21),
        story(22),
        story(23),
        { ...story(24), image: recipe(0).image + '?width=320' }
      ],
      freshTopics: [
        {
          slug: 'baking',
          name: 'Baking',
          href: '/feed?tab=fresh&topic=baking',
          image: topicPost.image,
          post: topicPost
        }
      ],
      freshPool: [topicPost, post(2, now), post(3, now, recipe(0).image), post(4, now)],
      packs: [pack]
    };
    const result = selectLandingEdition(data, now);
    const cards = [result.cover!, ...result.picks, ...result.newRecipes, ...result.reads];
    const images = [
      ...cards.map((card) => card.image),
      ...result.freshTopics!.map((topic) => topic.image),
      ...result.fresh.map((note) => note.image),
      ...result.packs!.flatMap((item) => item.previewImages ?? (item.image ? [item.image] : []))
    ].map(imageIdentity);
    expect(new Set(cards.map((card) => card.coordinate)).size).toBe(cards.length);
    expect(new Set(images).size).toBe(images.length);
    expect(result.reads).toHaveLength(3);
    expect(result.newRecipes).toHaveLength(4);
    expect(new Set(result.newRecipes.map((card) => card.author.pubkey)).size).toBe(4);
    expect(result.packs).toHaveLength(1);
    expect(result.packs![0].image).toBeUndefined();
    expect(result.collections).toEqual([]);
    expect(result.spotlights).toEqual([]);
  });
  it('updates genuinely recent posts inside a day without rotating the editorial opening', () => {
    const now = 86400;
    const data = {
      ...emptyLandingData(),
      coverPool: pool,
      readPool: [story(20)],
      freshPool: [post(1, now)]
    };
    const before = selectLandingEdition(data, now);
    const after = selectLandingEdition(
      { ...data, freshPool: [post(2, now + 120), post(1, now)] },
      now + 120
    );
    expect(after.headline).toBe(before.headline);
    expect(after.cover).toEqual(before.cover);
    expect(after.picks).toEqual(before.picks);
    expect(after.fresh[0].id).toBe('post-2');
    expect(after.supportingLine).toBe(EDITORIAL_SUPPORTING_LINE);
  });
  it('excludes paid photographs in every editorial section without removing image-free packs', () => {
    const paidImage = recipe(0).image;
    const data = {
      ...emptyLandingData(),
      coverPool: [recipe(0)],
      recipePool: [recipe(0)],
      reads: [{ ...story(20), image: paidImage }],
      freshPool: [post(1, 100, paidImage)]
    };
    const result = selectLandingEdition(data, 100, null, new Set([imageIdentity(paidImage)]));
    expect(result.cover).toBeNull();
    expect(result.newRecipes).toEqual([]);
    expect(result.reads).toEqual([]);
    expect(result.fresh).toEqual([]);
  });
  it('never promotes unapproved old-cache fallback content', () => {
    const result = selectLandingEdition(
      {
        ...emptyLandingData(),
        cover: pool[0],
        picks: [pool[1]],
        newRecipes: [pool[2]],
        reads: [story(20)]
      },
      0
    );
    expect(result.cover).toBeNull();
    expect(result.picks).toEqual([]);
  });
});

describe('food story eligibility', () => {
  it('requires actual food evidence and rejects protocol discussion and generic promotions', () => {
    expect(isEligibleFoodStory(story(20))).toBe(true);
    expect(
      isEligibleFoodStory({ ...story(20), title: 'Bitcoin changes everything', tags: ['food'] })
    ).toBe(false);
    expect(
      isEligibleFoodStory({
        ...story(20),
        title: 'A fresh start',
        summary: '',
        moderationText: '',
        tags: ['bitcoin', 'wellness']
      })
    ).toBe(false);
    expect(
      isEligibleFoodStory({ ...story(20), title: 'Subscribe to our launch', tags: ['cooking'] })
    ).toBe(false);
    expect(
      isEligibleFoodStory({
        ...story(20),
        title: 'Sunday at home',
        summary: 'I baked sourdough for my family.'
      })
    ).toBe(true);
  });
  it('uses an existing summary or a faithful short excerpt without inventing headlines', () => {
    expect(storySummary(story(20))).toBe('A cook shares a favorite kitchen tradition.');
    expect(
      storySummary({
        ...story(20),
        summary: undefined,
        moderationText: '# Baking bread\nI let the dough rest. [Read more](https://example.org)'
      })
    ).toBe('Baking bread I let the dough rest. Read more');
    expect(
      storySummary({ ...story(20), summary: undefined, moderationText: undefined })
    ).toBeUndefined();
  });
});

describe('public collections', () => {
  it('normalizes real recipe metadata and uses it for public tag destinations', () => {
    const card = longformCard(
      ev({
        kind: 30023,
        pubkey: pk('a'),
        tags: [
          ['d', 'bread'],
          ['title', 'Bread'],
          ['image', 'https://image.nostr.build/bread.jpg'],
          ['t', 'zapcooking'],
          ['t', 'zapcooking-bread']
        ]
      })
    )!;
    expect(card.tags).toEqual(['bread']);
    const tiles = selectCollections([card], 0);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].href).toBe('/tag/bread');
    expect(topicHref('vegetables')).toBe('/tag/vegetables');
    expect(topicHref('fish & chips')).toBe('/tag/fish%20%26%20chips');
  });
  it('does not make up collection content or reuse an image and bounds the tile count', () => {
    expect(selectCollections([recipe(0)], 0)).toEqual([]);
    const tags = ['pasta', 'soup', 'bread', 'vegetables', 'drinks', 'dessert', 'breakfast'];
    const tiles = selectCollections(
      tags.map((t, n) => recipe(n, String(n), [t])),
      0
    );
    expect(tiles).toHaveLength(6);
    expect(tiles.every((t) => t.href.startsWith('/tag/') && !t.href.includes('/feed'))).toBe(true);
    expect(new Set(tiles.map((t) => t.image)).size).toBe(tiles.length);
  });
  it('uses recurring date rules for seasonal collections', () => {
    const cards = [recipe(0, 'a', ['soup']), recipe(1, 'b', ['salad'])];
    expect(selectCollections(cards, Date.UTC(2026, 0, 15) / 1000).map((t) => t.slug)).toEqual([
      'soup'
    ]);
    expect(selectCollections(cards, Date.UTC(2027, 6, 15) / 1000).map((t) => t.slug)).toEqual([
      'salad'
    ]);
  });
});
