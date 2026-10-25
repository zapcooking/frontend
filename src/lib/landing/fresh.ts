/** Food-only, public homepage discovery. The full Fresh feed is unchanged. */
import { FOOD_LONGFORM_HASHTAGS } from '$lib/foodHashtags';
import { evaluateReadsContent } from '$lib/reads/moderation';
import type { ReadsModerationLists } from '$lib/reads/moderationConfig';
import type { NostrEvent } from '$lib/relayCollect';
import { freshTopicHref } from '$lib/freshFeed/topicRoute';
import { editionBucket } from './editorialConfig';
import { imageIdentity } from './imageIdentity';
import { noteCard, type FreshTopicTile, type NoteCard } from './content';

export const JUST_SERVED_MAX_AGE_SECONDS = 7 * 86400;
export const PUBLIC_FRESH_MAX_AGE_SECONDS = 14 * 86400 - 60;
export const FRESH_TOPIC_LIMIT = 6;
export const FRESH_POST_LIMIT = 6;
/** Query a bounded candidate set, then substitute topics with suitable public images. */
export const FRESH_TOPIC_CANDIDATES = 10;
/** Editors can change the preferred order here, or publish the signed explore-topics list. */
export const DEFAULT_FRESH_TOPICS = [
  'japanese',
  'dessert',
  'desserts',
  'cheese',
  'baking',
  'soup',
  'soups',
  'grilling'
];

const BROAD_TAGS = new Set([
  'bitcoin',
  'health',
  'wellness',
  'healthy',
  'sustainable',
  'sustainability',
  'organic',
  'traditional',
  'homemade',
  'offgrid',
  'ruralliving',
  'countryliving',
  'simpleliving',
  'selfsufficient',
  'selfsufficiency',
  'ag',
  'dietitian',
  'nutritionist',
  'homestead',
  'homesteading',
  'homesteader',
  'homesteaders',
  'farm',
  'farmer',
  'farmers',
  'agriculture',
  'farming',
  'agrarian',
  'organicfarming',
  'backyardfarming',
  'urbanfarming',
  'urbanhomestead',
  'urbanhomesteading',
  'livestock',
  'chickens',
  'chickenkeeping',
  'goats',
  'goatkeeping',
  'bees',
  'beekeeping',
  'soilhealth',
  'compost',
  'composting',
  'gardening',
  'garden',
  'gardener',
  'sustainablefarming',
  'regenerative',
  'regenerativeagriculture',
  'permaculture',
  'biodynamic',
  'crops',
  'growing',
  'harvest',
  'harvesting',
  'growyourown',
  'raisedbeds',
  'containergardening',
  'foraging',
  'wildcrafting',
  'meatmafia',
  'seasonal',
  'italian',
  'mexican',
  'thai',
  'japanese',
  'korean',
  'indian',
  'mediterranean',
  'chinese',
  'french',
  'vietnamese',
  'greek'
]);
const FOOD_TAGS = new Set(FOOD_LONGFORM_HASHTAGS.filter((tag) => !BROAD_TAGS.has(tag)));
const FOOD_WORDS =
  /\b(?:bread|sourdough|pasta|pizza|sushi|ramen|noodles|dumplings|tacos?|burritos?|sandwich(?:es)?|salad|soup|stew|curry|steak|chicken|beef|pork|fish|seafood|tofu|cheese|eggs?|rice|beans?|lentils?|ingredients?|fruits?|berries|strawberries|carrots?|peppers?|vegetables?|mushrooms?|tomatoes?|potatoes?|onions?|garlic|herbs?|dough|pastry|pastries|cake|cookies?|brownies?|dessert|chocolate|ice cream|breakfast|lunch|dinner|supper|meal|cooking|baking|grilling|roasting|fermenting|pickling|coffee|tea|cocktails?)\b/i;
const PROMOTION =
  /\b(?:airdrop|presale|token sale|mint now|trading signals|follow for follow|earn sats|zapathon|nostr client|relay operator|bitcoin price|crypto giveaway)\b/i;
const textWithoutLinks = (text: string) => text.replace(/https?:\/\/\S+|nostr:[a-z0-9]+/gi, ' ');

export function isLandingFoodText(text: string, tags: readonly string[] = []): boolean {
  const ownWords = textWithoutLinks(text);
  if (PROMOTION.test(ownWords)) return false;
  return tags.some((tag) => FOOD_TAGS.has(tag.toLowerCase())) || FOOD_WORDS.test(ownWords);
}

export function freshNote(
  event: NostrEvent,
  now: number,
  lists: ReadsModerationLists | null,
  editorial = false
): NoteCard | null {
  if (
    !Number.isFinite(event.created_at) ||
    event.created_at < now - PUBLIC_FRESH_MAX_AGE_SECONDS ||
    event.created_at > now + 60
  )
    return null;
  if (lists && evaluateReadsContent(event, lists).blocked) return null;
  const tags = event.tags.filter((tag) => tag[0] === 't').map((tag) => tag[1]?.toLowerCase() ?? '');
  if (!isLandingFoodText(event.content, tags) && !editorial) return null;
  if (PROMOTION.test(textWithoutLinks(event.content))) return null;
  const card = noteCard(event);
  return card && editorial ? { ...card, editorial: true } : card;
}

/** Old cache entries lack moderation metadata; their original caption still gets the food test. */
export function freshCardAllowed(
  card: NoteCard,
  now: number,
  lists: ReadsModerationLists | null,
  maxAge = PUBLIC_FRESH_MAX_AGE_SECONDS
): boolean {
  if (PROMOTION.test(textWithoutLinks(card.moderationText ?? card.text))) return false;
  if (
    !card.image ||
    !Number.isFinite(card.createdAt) ||
    card.createdAt < now - maxAge ||
    card.createdAt > now + 60
  )
    return false;
  if (!isLandingFoodText(card.moderationText ?? card.text, card.tags) && !card.editorial)
    return false;
  return (
    !lists ||
    !evaluateReadsContent(
      {
        id: card.id,
        kind: 1,
        pubkey: card.author.pubkey,
        content: card.moderationText ?? card.text,
        tags: (card.tags ?? []).map((tag) => ['t', tag])
      },
      lists
    ).blocked
  );
}

export function topicPostOverrides(tags: string[][]): Map<string, string> {
  const overrides = new Map<string, string>();
  for (const tag of tags) {
    if (
      tag[0] === 'topic-post' &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag[1] ?? '') &&
      /^[a-f0-9]{64}$/.test(tag[2] ?? '')
    )
      overrides.set(tag[1], tag[2]);
  }
  return overrides;
}

export { freshTopicHref };

/** Topics rotate daily; recent posts always keep their own recency order. No network or personal state. */
export function selectFreshDiscovery(
  topics: FreshTopicTile[],
  posts: NoteCard[],
  now: number,
  excludeImages: ReadonlySet<string> = new Set(),
  excludeIds: ReadonlySet<string> = new Set()
): { freshTopics: FreshTopicTile[]; fresh: NoteCard[] } {
  const images = new Set([...excludeImages].map(imageIdentity));
  const ids = new Set(excludeIds);
  const freshTopics: FreshTopicTile[] = [];
  const seenTopics = new Set<string>();
  const offset = topics.length ? editionBucket(now) % topics.length : 0;
  const ordered = [...topics.slice(offset), ...topics.slice(0, offset)];
  for (const tile of ordered) {
    if (seenTopics.has(tile.slug)) continue;
    const post = [tile.post, ...(tile.alternatives ?? [])].find(
      (card) =>
        freshCardAllowed(card, now, null) &&
        !ids.has(card.id) &&
        !images.has(imageIdentity(card.image))
    );
    if (!post) continue;
    freshTopics.push({
      ...tile,
      image: post.image,
      post,
      href: freshTopicHref(tile.slug),
      alternatives: undefined
    });
    seenTopics.add(tile.slug);
    ids.add(post.id);
    images.add(imageIdentity(post.image));
    if (freshTopics.length >= FRESH_TOPIC_LIMIT) break;
  }
  const authors = new Set<string>();
  const fresh: NoteCard[] = [];
  for (const post of [...posts].sort(
    (a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)
  )) {
    if (
      !freshCardAllowed(post, now, null, JUST_SERVED_MAX_AGE_SECONDS) ||
      ids.has(post.id) ||
      images.has(imageIdentity(post.image)) ||
      authors.has(post.author.pubkey)
    )
      continue;
    fresh.push(post);
    ids.add(post.id);
    images.add(imageIdentity(post.image));
    authors.add(post.author.pubkey);
    if (fresh.length >= FRESH_POST_LIMIT) break;
  }
  return { freshTopics, fresh };
}
