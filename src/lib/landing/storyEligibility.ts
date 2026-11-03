/** Homepage food stories have a narrower brief than the full Reads feed. */
import { FOOD_LONGFORM_HASHTAGS } from '$lib/foodHashtags';
import type { LongformCard } from './content';

// These broad community tags alone do not demonstrate a food subject.
const AMBIGUOUS_TAGS = new Set([
  'bitcoin',
  'health',
  'wellness',
  'sustainable',
  'sustainability',
  'organic',
  'traditional',
  'offgrid',
  'selfsufficient',
  'selfsufficiency',
  'ruralliving',
  'countryliving',
  'simpleliving',
  'homestead',
  'homesteading',
  'homesteader',
  'homesteaders',
  'ag',
  'farm',
  'farmer',
  'farmers',
  'agriculture',
  'farming',
  'livestock',
  'chickens',
  'goats',
  'bees',
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
  'nutritionist',
  'dietitian',
  'meatmafia'
]);
const FOOD_TAGS = new Set(FOOD_LONGFORM_HASHTAGS.filter((tag) => !AMBIGUOUS_TAGS.has(tag)));
const FOOD_WORDS =
  /\b(cook(?:ing|ed|s)?|kitchen|recipe|recipes|food|ingredient|ingredients|chef|chefs|cuisine|culinary|flavou?r|dinner|lunch|breakfast|dessert|baking|bake|bread|sourdough|pasta|soup|stew|cheese|ferment(?:ation|ing|ed)?|coffee|tea|wine|meal|meals|restaurant|vegetable|vegetables|fruit|fish|seafood|chicken|beef|pork|spice|spices|grill(?:ing|ed)?|roast(?:ing|ed)?|sushi|noodles|rice|chocolate)\b/i;
const PROTOCOL_SUBJECT =
  /\b(nostr|lightning|bitcoin|blockchain|web3|relay|relays|npub\w*|nsec\w*|sats?|zaps?)\b/i;
const PROMOTION =
  /\b(airdrop|giveaway|discount|promo code|buy now|sign up|subscribe|join now|limited.time offer|launch announcement)\b/i;

export function isEligibleFoodStory(card: LongformCard): boolean {
  if (card.type !== 'article' || !card.title?.trim() || !card.image || !card.href) return false;
  if (PROTOCOL_SUBJECT.test(card.title) || PROMOTION.test(card.title)) return false;
  const headlineHasFood = FOOD_WORDS.test(card.title);
  const description = `${card.summary ?? ''} ${card.moderationText ?? ''}`;
  if (!headlineHasFood && (PROTOCOL_SUBJECT.test(description) || PROMOTION.test(description)))
    return false;
  return (
    headlineHasFood ||
    FOOD_WORDS.test(description) ||
    !!card.tags?.some((tag) => FOOD_TAGS.has(tag.toLowerCase()))
  );
}

/** Existing author summary, otherwise a short literal excerpt with markup/URLs removed. */
export function storySummary(card: LongformCard): string | undefined {
  const source = card.summary?.trim() || card.moderationText?.trim();
  if (!source) return undefined;
  const text = source
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/https?:\/\/\S+|nostr:\S+/g, '')
    .replace(/(?:^|\n)\s{0,3}#{1,6}\s+/g, ' ')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return undefined;
  if (text.length <= 180) return text;
  const cut = text.slice(0, 179);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > 100 ? space : cut.length).trimEnd()}…`;
}
