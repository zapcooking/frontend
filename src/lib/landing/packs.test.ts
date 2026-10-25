import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import { HIDDEN_RECIPE_COORDINATES } from '$lib/consts';
import { moderatePackCard, packCard, selectPackImages } from './packs';
import type { LongformCard } from './content';
import { imageIdentity } from './imageIdentity';
import { ev, pk } from './fakeRelay.testutil';

const author = pk('a');
const recipe = `30023:${pk('b')}:https://example.com/pasta:one`;
const makePack = (extra: string[][] = []) =>
  ev({
    kind: 30004,
    pubkey: author,
    tags: [
      ['d', 'shared-pack'],
      ['title', 'Weeknight dinners'],
      ['description', 'Recipes to share.'],
      ['t', 'recipe-pack'],
      ['a', recipe],
      ...extra
    ]
  });
const lists = {
  blockedPubkeys: [] as string[],
  blockedEventIds: [] as string[],
  blockedNaddrs: [] as string[],
  denylist: [] as string[]
};

describe('Explore recipe pack cards', () => {
  it('preserves colon-containing recipe references and links to the actual shareable pack', () => {
    const card = packCard(makePack([['image', 'https://example.com/pack.jpg']]))!;
    expect(card.recipeCoordinates).toEqual([recipe]);
    expect(card.recipeCount).toBe(1);
    expect(card.title).toBe('Weeknight dinners');
    expect(card.description).toBe('Recipes to share.');
    expect(card.image).toBe('https://example.com/pack.jpg');
    expect(nip19.decode(card.href.replace('/pack/', ''))).toMatchObject({
      type: 'naddr',
      data: { kind: 30004, pubkey: author, identifier: 'shared-pack' }
    });
  });

  it('counts distinct valid recipe references and excludes hidden or non-recipe references', () => {
    const hidden = [...HIDDEN_RECIPE_COORDINATES][0];
    const card = packCard(
      makePack([
        ['a', recipe],
        ['a', recipe.replace(pk('b'), pk('b').toUpperCase())],
        ['a', `35000:${pk('c')}:legacy`],
        ['a', `30004:${pk('c')}:another-pack`],
        ['a', 'malformed'],
        ['a', `30023:${pk('d')}:`],
        ['a', hidden]
      ])
    )!;
    expect(card.recipeCount).toBe(2);
    expect(card.recipeCoordinates).toEqual([recipe, `35000:${pk('c')}:legacy`]);
  });

  it('rejects wrong kinds, missing pack markers, curation lists and content warnings', () => {
    const original = makePack();
    expect(packCard({ ...original, kind: 30023 })).toBeNull();
    expect(
      packCard({ ...original, tags: original.tags.filter((tag) => tag[0] !== 't') })
    ).toBeNull();
    expect(
      packCard({
        ...original,
        tags: original.tags.map((tag) => (tag[0] === 'd' ? ['d', 'explore-hero'] : tag))
      })
    ).toBeNull();
    expect(packCard(makePack([['content-warning', 'sensitive']]))).toBeNull();
    expect(
      packCard({ ...original, tags: original.tags.filter((tag) => tag[0] !== 'a') })
    ).toBeNull();
  });

  it('keeps image-free packs and ignores unsafe image schemes', () => {
    expect(packCard(makePack())?.image).toBeUndefined();
    expect(packCard(makePack([['image', 'javascript:alert(1)']]))?.image).toBeUndefined();
  });

  it('rechecks cached pack identities, descriptions and recipe pointers against moderation', () => {
    const card = packCard(makePack())!;
    expect(moderatePackCard(card, { ...lists, blockedPubkeys: [author] })).toBeNull();
    expect(moderatePackCard(card, { ...lists, blockedEventIds: [card.eventId!] })).toBeNull();
    expect(
      moderatePackCard(card, { ...lists, blockedNaddrs: [card.href.replace('/pack/', '')] })
    ).toBeNull();
    expect(moderatePackCard(card, { ...lists, denylist: ['share'] })).toBeNull();
    expect(moderatePackCard(card, { ...lists, blockedPubkeys: [pk('b')] })).toBeNull();
    const withTwo = packCard(makePack([['a', `35000:${pk('c')}:legacy`]]))!;
    expect(moderatePackCard(withTwo, { ...lists, blockedPubkeys: [pk('b')] })?.recipeCount).toBe(1);
  });

  it('prefers the existing pack cover and preserves its actual metadata', () => {
    const card = packCard(makePack([['image', 'https://example.com/cover.jpg']]))!;
    const [selected] = selectPackImages([card], [], new Set());
    expect(selected.previewImages).toEqual(['https://example.com/cover.jpg']);
    expect(selected.title).toBe(card.title);
    expect(selected.recipeCount).toBe(card.recipeCount);
    expect(card.previewImages).toBeUndefined();
  });

  it('builds a collage only from actual referenced recipes already in the cache', () => {
    const refs = [recipe, `35000:${pk('c')}:two`, `30023:${pk('d')}:three`];
    const card = packCard(makePack(refs.slice(1).map((ref) => ['a', ref])))!;
    const cached: LongformCard[] = [...refs, `30023:${pk('e')}:unrelated`].map((coordinate, i) => ({
      type: 'recipe',
      coordinate,
      title: `Recipe ${i}`,
      image: `https://example.com/recipe-${i}.jpg`,
      href: `/recipe/${i}`,
      author: { pubkey: author },
      publishedAt: 1
    }));
    const [selected] = selectPackImages([card], cached, new Set());
    expect(selected.previewImages).toEqual(cached.slice(0, 3).map((item) => item.image));
    expect(selected.image).toBeUndefined();
    expect(selected.recipeCount).toBe(3);
  });

  it('avoids resized duplicates across sections and packs without hiding valid packs', () => {
    const card = packCard(makePack([['image', 'https://example.com/cover.jpg?w=320']]))!;
    const cached: LongformCard = {
      type: 'recipe',
      coordinate: recipe,
      title: 'A real recipe',
      image: 'https://example.com/recipe.jpg',
      href: '/recipe/a',
      author: { pubkey: author },
      publishedAt: 1
    };
    const used = new Set([imageIdentity('https://example.com/cover.jpg?w=960')]);
    const selected = selectPackImages(
      [card, { ...card, coordinate: `${card.coordinate}-other` }],
      [cached],
      used
    );
    expect(selected).toHaveLength(2);
    expect(selected[0].previewImages).toEqual([cached.image]);
    expect(selected[1].previewImages).toEqual([]);
    expect(selected[1].image).toBeUndefined();
    expect(selected[1].recipeCount).toBe(1);
    expect(used.size).toBe(1);
  });
});
