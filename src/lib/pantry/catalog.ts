/**
 * Common-ingredient catalog for pantry autocomplete.
 *
 * This is a cooking-focused suggestion list, not an inventory ontology.
 * Users can always enter freeform names when nothing matches.
 */

import { normalizeIngredientName } from './normalization';
import { ingredientsMatch } from './matching';

export interface CatalogIngredient {
  name: string;
  aliases?: string[];
}

/** Household staples offered as one-tap adds. */
export const COMMON_STAPLES: string[] = [
  'Salt',
  'Black Pepper',
  'Olive Oil',
  'Butter',
  'All-Purpose Flour',
  'Sugar',
  'Garlic',
  'Onion',
  'Eggs',
  'Rice',
  'Soy Sauce',
  'Vinegar',
  'Baking Powder',
  'Baking Soda',
  'Paprika',
  'Cumin',
  'Oregano',
  'Cinnamon'
];

export const INGREDIENT_CATALOG: CatalogIngredient[] = [
  { name: 'Chicken Breast', aliases: ['chicken', 'chicken breasts'] },
  { name: 'Chicken Thighs' },
  { name: 'Ground Chicken' },
  { name: 'Whole Chicken' },
  { name: 'Ground Beef', aliases: ['beef', 'hamburger'] },
  { name: 'Steak' },
  { name: 'Pork Chops' },
  { name: 'Bacon' },
  { name: 'Sausage' },
  { name: 'Ham' },
  { name: 'Turkey' },
  { name: 'Salmon' },
  { name: 'Tuna' },
  { name: 'Shrimp' },
  { name: 'Cod' },
  { name: 'Tofu' },
  { name: 'Eggs', aliases: ['egg'] },
  { name: 'Milk' },
  { name: 'Heavy Cream', aliases: ['cream'] },
  { name: 'Half and Half' },
  { name: 'Butter' },
  { name: 'Parmesan Cheese', aliases: ['parm', 'parmesan', 'parmigiano'] },
  { name: 'Cheddar Cheese', aliases: ['cheddar'] },
  { name: 'Mozzarella' },
  { name: 'Feta' },
  { name: 'Cream Cheese' },
  { name: 'Sour Cream' },
  { name: 'Yogurt' },
  { name: 'Greek Yogurt' },
  { name: 'Onion', aliases: ['onions', 'yellow onion'] },
  { name: 'Red Onion' },
  { name: 'Green Onion', aliases: ['scallion', 'spring onion'] },
  { name: 'Shallot' },
  { name: 'Garlic' },
  { name: 'Ginger' },
  { name: 'Tomato' },
  { name: 'Cherry Tomatoes' },
  { name: 'Potato' },
  { name: 'Sweet Potato' },
  { name: 'Carrot' },
  { name: 'Celery' },
  { name: 'Bell Pepper', aliases: ['pepper'] },
  { name: 'Jalapeño' },
  { name: 'Broccoli' },
  { name: 'Cauliflower' },
  { name: 'Spinach' },
  { name: 'Kale' },
  { name: 'Lettuce' },
  { name: 'Cabbage' },
  { name: 'Cucumber' },
  { name: 'Zucchini' },
  { name: 'Mushroom' },
  { name: 'Avocado' },
  { name: 'Lemon' },
  { name: 'Lime' },
  { name: 'Orange' },
  { name: 'Apple' },
  { name: 'Banana' },
  { name: 'Strawberry' },
  { name: 'Blueberry' },
  { name: 'Cilantro' },
  { name: 'Parsley' },
  { name: 'Basil' },
  { name: 'Mint' },
  { name: 'Rice' },
  { name: 'Brown Rice' },
  { name: 'Pasta' },
  { name: 'Spaghetti' },
  { name: 'Penne' },
  { name: 'Macaroni' },
  { name: 'Noodles' },
  { name: 'Tortillas' },
  { name: 'Bread' },
  { name: 'Breadcrumbs' },
  { name: 'Oats' },
  { name: 'Quinoa' },
  { name: 'Couscous' },
  { name: 'Canned Tomatoes' },
  { name: 'Tomato Paste' },
  { name: 'Tomato Sauce' },
  { name: 'Black Beans' },
  { name: 'Chickpeas' },
  { name: 'Chicken Broth' },
  { name: 'Vegetable Broth' },
  { name: 'Coconut Milk' },
  { name: 'Olive Oil', aliases: ['evoo', 'extra virgin olive oil', 'olive'] },
  { name: 'Vegetable Oil' },
  { name: 'Sesame Oil' },
  { name: 'Vinegar' },
  { name: 'Apple Cider Vinegar' },
  { name: 'Balsamic Vinegar' },
  { name: 'Soy Sauce' },
  { name: 'Hot Sauce' },
  { name: 'Mustard' },
  { name: 'Ketchup' },
  { name: 'Mayonnaise' },
  { name: 'Salsa' },
  { name: 'Peanut Butter' },
  { name: 'All-Purpose Flour', aliases: ['flour'] },
  { name: 'Sugar' },
  { name: 'Brown Sugar' },
  { name: 'Powdered Sugar' },
  { name: 'Baking Powder' },
  { name: 'Baking Soda' },
  { name: 'Yeast' },
  { name: 'Cocoa Powder' },
  { name: 'Chocolate Chips' },
  { name: 'Honey' },
  { name: 'Maple Syrup' },
  { name: 'Vanilla Extract', aliases: ['vanilla'] },
  { name: 'Salt' },
  { name: 'Black Pepper', aliases: ['pepper'] },
  { name: 'Paprika' },
  { name: 'Cumin' },
  { name: 'Chili Powder' },
  { name: 'Cayenne' },
  { name: 'Cinnamon' },
  { name: 'Oregano' },
  { name: 'Thyme' },
  { name: 'Rosemary' },
  { name: 'Garlic Powder' },
  { name: 'Onion Powder' },
  { name: 'Red Pepper Flakes' },
  { name: 'Italian Seasoning' },
  { name: 'Frozen Peas' },
  { name: 'Frozen Corn' },
  { name: 'Frozen Berries' }
];

export interface IngredientSuggestion {
  name: string;
  /** 0 = strongest match. */
  score: number;
}

function catalogSearchBlob(entry: CatalogIngredient): string {
  return [entry.name, ...(entry.aliases || [])].join(' ').toLowerCase();
}

/**
 * Suggest catalog ingredients for a typed query. Already-pantry items are
 * excluded. Returns [] for empty/comma-separated bulk input so freeform
 * multi-add is not interrupted.
 */
export function suggestPantryIngredients(
  query: string,
  existing: Array<{ name: string; normalizedName: string }> = [],
  limit = 8
): IngredientSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q || /[,;\n]/.test(query)) return [];
  if (q.length < 2) return [];

  const scored: IngredientSuggestion[] = [];
  for (const entry of INGREDIENT_CATALOG) {
    if (existing.some((item) => ingredientsMatch(entry.name, item.name))) continue;

    const nameLower = entry.name.toLowerCase();
    const normalized = normalizeIngredientName(entry.name);
    const aliases = (entry.aliases || []).map((a) => a.toLowerCase());
    const blob = catalogSearchBlob(entry);

    let score = -1;
    if (nameLower === q || normalized === q || aliases.includes(q)) score = 0;
    else if (aliases.some((a) => a.startsWith(q))) score = 1;
    else if (nameLower.startsWith(q) || normalized.startsWith(q)) score = 2;
    else if (nameLower.split(' ').some((t) => t.startsWith(q))) score = 3;
    else if (blob.includes(q)) score = 4;

    if (score >= 0) scored.push({ name: entry.name, score });
  }

  scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return scored.slice(0, limit);
}

export function missingCommonStaples(
  existing: Array<{ name: string; normalizedName: string }>
): string[] {
  return COMMON_STAPLES.filter(
    (name) => !existing.some((item) => ingredientsMatch(name, item.name))
  );
}
