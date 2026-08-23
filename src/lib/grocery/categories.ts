/**
 * Store-oriented grocery aisles.
 *
 * Reuses pantry category inference and adds bakery / beverages / snacks.
 * Legacy grocery values (`protein`, `dairy`, `pantry`) are accepted on
 * read and canonicalized at display time so older lists keep working.
 */

import { inferPantryCategory, type PantryCategory } from '$lib/pantry/categories';
import { normalizeIngredientName } from '$lib/pantry/normalization';

export const GROCERY_CATEGORIES = [
  'produce',
  'meat-seafood',
  'dairy-eggs',
  'bakery',
  'grains-pasta',
  'canned-jarred',
  'sauces',
  'spices',
  'baking',
  'frozen',
  'beverages',
  'snacks',
  'other'
] as const;

export type GroceryAisle = (typeof GROCERY_CATEGORIES)[number];

/** Includes legacy persisted values from earlier grocery lists. */
export type GroceryCategory = GroceryAisle | 'protein' | 'dairy' | 'pantry';

export const GROCERY_CATEGORY_LABELS: Record<GroceryAisle, string> = {
  produce: 'Produce',
  'meat-seafood': 'Meat & Seafood',
  'dairy-eggs': 'Dairy & Eggs',
  bakery: 'Bakery',
  'grains-pasta': 'Grains, Pasta & Rice',
  'canned-jarred': 'Canned & Jarred',
  sauces: 'Sauces & Condiments',
  spices: 'Spices & Seasonings',
  baking: 'Baking',
  frozen: 'Frozen',
  beverages: 'Beverages',
  snacks: 'Snacks',
  other: 'Other'
};

export const GROCERY_CATEGORY_EMOJI: Record<GroceryAisle, string> = {
  produce: '🥬',
  'meat-seafood': '🥩',
  'dairy-eggs': '🧀',
  bakery: '🍞',
  'grains-pasta': '🍝',
  'canned-jarred': '🥫',
  sauces: '🫙',
  spices: '🧂',
  baking: '🧁',
  frozen: '🧊',
  beverages: '🥤',
  snacks: '🍿',
  other: '📦'
};

const AISLE_SET = new Set<string>(GROCERY_CATEGORIES);

const BAKERY_KEYWORDS = [
  'baguette',
  'bagel',
  'brioche',
  'croissant',
  'english muffin',
  'sourdough',
  'bread',
  'bun',
  'roll',
  'loaf',
  'baguette'
];

const BEVERAGE_KEYWORDS = [
  'coffee',
  'espresso',
  'sparkling water',
  'seltzer',
  'kombucha',
  'soda',
  'cola',
  'beer',
  'wine',
  'tea bags',
  'black tea',
  'green tea',
  'iced tea'
];

const SNACK_KEYWORDS = [
  'potato chip',
  'tortilla chip',
  'chips',
  'pretzel',
  'popcorn',
  'candy',
  'cookie',
  'granola bar',
  'protein bar',
  'crackers'
];

function haystackFor(name: string): string {
  const raw = name.toLowerCase();
  const normalized = normalizeIngredientName(name);
  return `${raw} ${normalized}`.trim();
}

function matchesKeyword(haystack: string, keywords: string[]): boolean {
  return keywords.some((kw) => haystack.includes(kw));
}

const PANTRY_TO_GROCERY: Record<PantryCategory, GroceryAisle> = {
  produce: 'produce',
  'meat-seafood': 'meat-seafood',
  'dairy-eggs': 'dairy-eggs',
  'grains-pasta': 'grains-pasta',
  'canned-jarred': 'canned-jarred',
  baking: 'baking',
  spices: 'spices',
  sauces: 'sauces',
  frozen: 'frozen',
  other: 'other'
};

/**
 * Infer a grocery aisle from an item name. Bakery / beverages / snacks
 * win over the pantry mapping so "bread" is Bakery, not Grains.
 */
export function inferGroceryCategory(name: string): GroceryAisle {
  const haystack = haystackFor(name);
  if (!haystack) return 'other';
  if (matchesKeyword(haystack, BEVERAGE_KEYWORDS)) return 'beverages';
  if (matchesKeyword(haystack, SNACK_KEYWORDS)) return 'snacks';
  if (matchesKeyword(haystack, BAKERY_KEYWORDS)) return 'bakery';
  return PANTRY_TO_GROCERY[inferPantryCategory(name)];
}

export function canonicalizeGroceryCategory(
  category: string | undefined,
  name?: string
): GroceryAisle {
  if (category === 'protein') return 'meat-seafood';
  if (category === 'dairy') return 'dairy-eggs';
  if (category === 'pantry') {
    return name ? inferGroceryCategory(name) : 'other';
  }
  if (category && AISLE_SET.has(category)) return category as GroceryAisle;
  return name ? inferGroceryCategory(name) : 'other';
}

export function groceryCategoryLabel(category: string, name?: string): string {
  return GROCERY_CATEGORY_LABELS[canonicalizeGroceryCategory(category, name)];
}
