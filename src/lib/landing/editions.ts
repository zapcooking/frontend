/** Pure presentation of one shared pool. URL variants never fetch relays. */
import {
  isFastResizeImage,
  type Cook,
  type LongformCard,
  type FreshTopicTile,
  type PackCard
} from './content';
import type { LandingData } from './landingData.server';
import {
  EDITORIAL_EDITION_SECONDS,
  EDITORIAL_SUPPORTING_LINE,
  editionBucket,
  editionHeadline
} from './editorialConfig';
import { imageIdentity } from './imageIdentity';
import { isEligibleFoodStory, storySummary } from './storyEligibility';
import { selectFreshDiscovery } from './fresh';
import { selectPackImages } from './packs';

export const EDITION_SECONDS = EDITORIAL_EDITION_SECONDS;
export const EDITION_VARIANTS = 4;

export interface CollectionTile {
  slug: string;
  name: string;
  description: string;
  image: string;
  href: string;
}
export interface CookSpotlight extends Cook {
  recipe: LongformCard;
}
export interface LandingEdition extends LandingData {
  headline: string;
  supportingLine: string;
  freshTopics: FreshTopicTile[];
  packs: PackCard[];
  /** Kept for older cached/fixture consumers; the magazine no longer reserves these cards. */
  collections: CollectionTile[];
  spotlights: CookSpotlight[];
}

/** Four variants only; arbitrary query strings never create new selections or fetches. */
export function editionVariant(raw: string | null | undefined): number {
  if (raw === 'next') return 1;
  return raw === '2' || raw === '3' ? Number(raw) : 0;
}
export function nextEditionHref(raw: string | null | undefined): string {
  const next = (editionVariant(raw) + 1) % EDITION_VARIANTS;
  return next === 0 ? '/explore' : `/explore?edition=${next === 1 ? 'next' : next}`;
}

function uniqueCards(cards: LongformCard[]): LongformCard[] {
  const coordinates = new Set<string>();
  const images = new Set<string>();
  return cards.filter((card) => {
    if (!card.title?.trim() || !card.image || !card.href) return false;
    const image = imageIdentity(card.image);
    if (coordinates.has(card.coordinate) || images.has(image)) return false;
    coordinates.add(card.coordinate);
    images.add(image);
    return true;
  });
}
function uniqueRecipes(cards: LongformCard[]): LongformCard[] {
  return uniqueCards(cards.filter((card) => card.type === 'recipe'));
}
function rotate<T>(items: T[], offset: number): T[] {
  if (!items.length) return [];
  const start = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}
function newTags(card: LongformCard, selected: LongformCard[]): number {
  const used = new Set(selected.flatMap((item) => item.tags ?? []));
  return (card.tags ?? []).filter((tag) => !used.has(tag)).length;
}
function available(card: LongformCard, selected: LongformCard[]): boolean {
  return !selected.some(
    (item) =>
      item.coordinate === card.coordinate || imageIdentity(item.image) === imageIdentity(card.image)
  );
}
function complement(
  candidates: LongformCard[],
  selected: LongformCard[]
): LongformCard | undefined {
  const authors = new Set(selected.map((card) => card.author.pubkey));
  return candidates
    .filter((card) => available(card, selected))
    .sort(
      (a, b) =>
        Number(!authors.has(b.author.pubkey)) - Number(!authors.has(a.author.pubkey)) ||
        newTags(b, selected) - newTags(a, selected)
    )[0];
}

/** Recipe-only fallback, preferring distinct cooks and author-supplied food metadata. */
export function selectCover(
  pool: LongformCard[],
  nowSeconds: number,
  variant = 0,
  cadenceSeconds = EDITION_SECONDS
): LongformCard[] {
  const ordered = rotate(
    uniqueRecipes(pool).slice(0, 20),
    editionBucket(nowSeconds, cadenceSeconds) + variant * 3
  );
  if (!ordered.length) return [];
  const selected = [ordered.find((card) => isFastResizeImage(card.image)) ?? ordered[0]];
  while (selected.length < 3) {
    const next = complement(ordered, selected);
    if (!next) break;
    selected.push(next);
  }
  return selected;
}

/** Opening order: one lead recipe, a complementary recipe, then an approved food story. */
export function selectMixedCover(
  recipePool: LongformCard[],
  storyPool: LongformCard[],
  nowSeconds: number,
  variant = 0
): LongformCard[] {
  const offset = editionBucket(nowSeconds) + variant * 3;
  const recipes = rotate(uniqueRecipes(recipePool).slice(0, 20), offset);
  if (!recipes.length) return [];
  const stories = rotate(uniqueCards(storyPool.filter(isEligibleFoodStory)), offset);
  const storyAuthors = new Set(stories.map((card) => card.author.pubkey));
  // If the sole story author also has recipes, prefer two other cooks when possible.
  const otherCooks = recipes.filter((card) => !storyAuthors.has(card.author.pubkey));
  const leadCandidates =
    storyAuthors.size === 1 && new Set(otherCooks.map((card) => card.author.pubkey)).size >= 2
      ? otherCooks
      : recipes;
  const lead = leadCandidates.find((card) => isFastResizeImage(card.image)) ?? leadCandidates[0];
  const combinations = stories
    .filter((card) => available(card, [lead]))
    .map((story) => {
      const recipe = complement(recipes, [lead, story]);
      const cards = recipe ? [lead, recipe, story] : [lead, story];
      return { cards, authors: new Set(cards.map((card) => card.author.pubkey)).size };
    });
  combinations.sort((a, b) => b.authors - a.authors || b.cards.length - a.cards.length);
  if (combinations.length) return combinations[0].cards;
  return selectCover(recipePool, nowSeconds, variant);
}

interface CollectionRule {
  slug: string;
  name: string;
  description: string;
  /** UTC month numbers. Omitted means year-round. */
  months?: number[];
}
const COLLECTIONS: CollectionRule[] = [
  {
    slug: 'pasta',
    name: 'Dinner around the table',
    description: 'Pasta recipes for your next shared meal.'
  },
  {
    slug: 'soup',
    name: 'Something warming',
    description: 'Bowls of soup to settle into.',
    months: [0, 1, 2, 8, 9, 10, 11]
  },
  {
    slug: 'salad',
    name: 'Fresh on the table',
    description: 'Salads full of color and crunch.',
    months: [3, 4, 5, 6, 7]
  },
  { slug: 'bread', name: 'Weekend baking', description: 'Make time for a loaf of your own.' },
  {
    slug: 'vegetables',
    name: 'Vegetables take the lead',
    description: 'Put the produce at the center of the plate.'
  },
  {
    slug: 'drinks',
    name: 'Something to sip',
    description: 'A new drink for a quiet moment or good company.'
  },
  {
    slug: 'dessert',
    name: 'A little something sweet',
    description: 'Find a reason to make dessert.'
  },
  { slug: 'breakfast', name: 'A good start', description: 'Recipes to make the morning yours.' },
  {
    slug: 'italian',
    name: 'At the Italian table',
    description: 'Explore Italian recipes shared by cooks.'
  },
  {
    slug: 'mexican',
    name: 'From a Mexican kitchen',
    description: 'Discover Mexican recipes from the community.'
  }
];

/** A tile exists only when a real recipe bears its exact public browsing tag. */
export function selectCollections(recipes: LongformCard[], nowSeconds: number): CollectionTile[] {
  const month = new Date(nowSeconds * 1000).getUTCMonth();
  const used = new Set<string>();
  const result: CollectionTile[] = [];
  for (const rule of COLLECTIONS) {
    if (rule.months && !rule.months.includes(month)) continue;
    const recipe = recipes.find((c) => !used.has(c.coordinate) && c.tags?.includes(rule.slug));
    if (!recipe) continue;
    used.add(recipe.coordinate);
    result.push({
      slug: rule.slug,
      name: rule.name,
      description: rule.description,
      image: recipe.image,
      href: `/tag/${encodeURIComponent(rule.slug)}`
    });
    if (result.length === 6) break;
  }
  return result;
}

export function selectLandingEdition(
  data: LandingData,
  nowSeconds: number,
  rawVariant?: string | null,
  excludedImages: ReadonlySet<string> = new Set()
): LandingEdition {
  // Old cached fallback cards never become an approved opening feature.
  const withoutPaidPhoto = (card: LongformCard) => !excludedImages.has(imageIdentity(card.image));
  const opening = selectMixedCover(
    (data.coverPool ?? []).filter(withoutPaidPhoto),
    (data.readPool ?? []).filter(withoutPaidPhoto),
    nowSeconds,
    editionVariant(rawVariant)
  );
  const usedCoordinates = new Set(opening.map((card) => card.coordinate));
  const usedImages = new Set([
    ...excludedImages,
    ...opening.map((card) => imageIdentity(card.image))
  ]);
  const accept = (card: LongformCard) =>
    !usedCoordinates.has(card.coordinate) && !usedImages.has(imageIdentity(card.image));
  const mark = (card: LongformCard) => {
    usedCoordinates.add(card.coordinate);
    usedImages.add(imageIdentity(card.image));
  };
  const allRecipes = uniqueRecipes([...(data.recipePool ?? []), ...data.newRecipes]);
  const newRecipes: LongformCard[] = [];
  const recipeAuthors = new Set<string>();
  for (const card of allRecipes) {
    if (!accept(card) || recipeAuthors.has(card.author.pubkey)) continue;
    newRecipes.push(card);
    recipeAuthors.add(card.author.pubkey);
    mark(card);
    if (newRecipes.length === 4) break;
  }
  const reads: LongformCard[] = [];
  const stories = uniqueCards(
    [...(data.readPool ?? []), ...data.reads].filter(isEligibleFoodStory)
  );
  while (reads.length < 3) {
    const authors = new Set(reads.map((card) => card.author.pubkey));
    const candidates = stories
      .filter(accept)
      .sort(
        (a, b) => Number(!authors.has(b.author.pubkey)) - Number(!authors.has(a.author.pubkey))
      );
    if (!candidates.length) break;
    const card = candidates[0];
    reads.push({ ...card, summary: storySummary(card) });
    mark(card);
  }
  const discovery = selectFreshDiscovery(
    data.freshTopics ?? [],
    data.freshPool ?? data.fresh,
    nowSeconds,
    usedImages
  );
  for (const topic of discovery.freshTopics) usedImages.add(imageIdentity(topic.image));
  for (const note of discovery.fresh) usedImages.add(imageIdentity(note.image));
  const packs = selectPackImages((data.packs ?? []).slice(0, 4), allRecipes, usedImages);
  return {
    ...data,
    headline: editionHeadline(nowSeconds),
    supportingLine: EDITORIAL_SUPPORTING_LINE,
    cover: opening[0] ?? null,
    picks: opening
      .slice(1)
      .map((card) => (card.type === 'article' ? { ...card, summary: storySummary(card) } : card)),
    newRecipes,
    reads,
    ...discovery,
    packs,
    collections: [],
    spotlights: []
  };
}
