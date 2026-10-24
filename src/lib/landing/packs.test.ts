import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import { HIDDEN_RECIPE_COORDINATES } from '$lib/consts';
import { moderatePackCard, packCard } from './packs';
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
});
