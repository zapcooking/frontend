/**
 * Deterministic pantry ↔ recipe ingredient matching.
 *
 * Matching is never delegated to Cheffy. Ranking may use the result;
 * hard dietary / slot / exclude constraints still win.
 *
 * Grocery quantity policy (V1)
 * - Name match is required.
 * - A staple is always presence-only → `have`, even if a quantity is stored.
 * - If the pantry item has no quantity, treat as presence-only: the user
 *   said they have it without tracking how much → `have`.
 * - If both sides have a comparable numeric quantity in the same unit
 *   family, compare amounts. Insufficient pantry amount → `need`.
 * - If quantity comparison is uncertain (mixed units, unparseable) →
 *   `uncertain`, which stays on the grocery list.
 * - Never auto-decrement pantry inventory.
 */

import type { ParsedIngredient } from '$lib/utils/ingredientParser';
import { normalizeIngredientName, parseQuantityInput } from './normalization';
import type { PantryItem } from './schema';

export interface PantryMatch {
  matchedIngredients: string[];
  missingIngredients: string[];
  totalIngredients: number;
  matchedCount: number;
  matchRatio: number;
}

export type GroceryPantryStatus = 'need' | 'have' | 'uncertain';

export interface ClassifiedGroceryRow {
  ingredient: ParsedIngredient;
  recipeId: string;
  status: GroceryPantryStatus;
}

/** Headwords too generic to match as a substring/token of a longer name. */
const GENERIC_HEADS = new Set([
  'oil',
  'sauce',
  'salt',
  'water',
  'pepper',
  'cheese',
  'milk',
  'stock',
  'broth',
  'flour',
  'sugar',
  'juice',
  'powder',
  'flake',
  'extract',
  'seasoning',
  'spice',
  'mix',
  'blend',
  'paste',
  'cream',
  'butter',
  'seed',
  'leaf',
  'leaves'
]);

const UNIT_ALIASES: Record<string, string> = {
  cup: 'cup',
  cups: 'cup',
  c: 'cup',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  tbsp: 'tbsp',
  tbs: 'tbsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tsp: 'tsp',
  ounce: 'oz',
  ounces: 'oz',
  oz: 'oz',
  pound: 'lb',
  pounds: 'lb',
  lb: 'lb',
  lbs: 'lb',
  gram: 'g',
  grams: 'g',
  g: 'g',
  kilogram: 'kg',
  kilograms: 'kg',
  kg: 'kg',
  milliliter: 'ml',
  milliliters: 'ml',
  ml: 'ml',
  liter: 'l',
  liters: 'l',
  l: 'l',
  piece: 'count',
  pieces: 'count',
  pc: 'count',
  pcs: 'count',
  count: 'count',
  large: 'count',
  medium: 'count',
  small: 'count'
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWholePhrase(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  const re = new RegExp(`(?:^|\\s)${escapeRegExp(needle)}(?:\\s|$)`);
  return re.test(haystack);
}

/**
 * True when two ingredient names refer to the same pantry item.
 * Uses normalized keys plus whole-token containment. Never matches
 * `ham` to `hamburger`.
 */
export function ingredientsMatch(a: string, b: string): boolean {
  const na = normalizeIngredientName(a);
  const nb = normalizeIngredientName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (shorter.length < 3) return false;
  if (GENERIC_HEADS.has(shorter)) return false;
  return hasWholePhrase(longer, shorter);
}

export function findMatchingPantryItem(
  ingredientName: string,
  pantry: Array<Pick<PantryItem, 'name' | 'normalizedName'>>
): Pick<PantryItem, 'name' | 'normalizedName'> | undefined {
  return pantry.find(
    (item) =>
      ingredientsMatch(ingredientName, item.normalizedName) ||
      ingredientsMatch(ingredientName, item.name)
  );
}

export function matchRecipeToPantry(
  ingredients: string[],
  pantry: Array<Pick<PantryItem, 'name' | 'normalizedName'>>
): PantryMatch {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of ingredients || []) {
    const name = (raw || '').trim();
    if (!name) continue;
    const key = normalizeIngredientName(name) || name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(name);
  }

  if (unique.length === 0) {
    return {
      matchedIngredients: [],
      missingIngredients: [],
      totalIngredients: 0,
      matchedCount: 0,
      matchRatio: 0
    };
  }

  if (!pantry.length) {
    return {
      matchedIngredients: [],
      missingIngredients: [...unique],
      totalIngredients: unique.length,
      matchedCount: 0,
      matchRatio: 0
    };
  }

  const matchedIngredients: string[] = [];
  const missingIngredients: string[] = [];
  for (const name of unique) {
    if (findMatchingPantryItem(name, pantry)) matchedIngredients.push(name);
    else missingIngredients.push(name);
  }

  return {
    matchedIngredients,
    missingIngredients,
    totalIngredients: unique.length,
    matchedCount: matchedIngredients.length,
    matchRatio: matchedIngredients.length / unique.length
  };
}

function canonicalizeUnit(unit: string | undefined): string | undefined {
  if (!unit) return 'count';
  const key = unit.trim().toLowerCase().replace(/\.$/, '');
  if (!key) return 'count';
  return UNIT_ALIASES[key] || UNIT_ALIASES[singularizeLoose(key)] || key;
}

function singularizeLoose(token: string): string {
  if (token.endsWith('s') && token.length > 2) return token.slice(0, -1);
  return token;
}

function parseComparableQuantity(
  quantityText: string | undefined,
  explicitQuantity?: number,
  explicitUnit?: string
): { amount: number; unit: string } | null {
  if (explicitQuantity != null && Number.isFinite(explicitQuantity) && explicitQuantity > 0) {
    return { amount: explicitQuantity, unit: canonicalizeUnit(explicitUnit) || 'count' };
  }
  if (!quantityText || !quantityText.trim()) return null;
  const parsed = parseQuantityInput(quantityText);
  if (parsed.quantity == null) return null;
  return { amount: parsed.quantity, unit: canonicalizeUnit(parsed.unit) || 'count' };
}

/**
 * Classify a recipe grocery row against pantry.
 * Uncertain matches stay on the grocery list (`need` is not used for those —
 * callers put `uncertain` in the to-buy bucket).
 */
export function classifyIngredientAgainstPantry(
  ingredient: ParsedIngredient,
  pantry: Array<Pick<PantryItem, 'name' | 'normalizedName' | 'quantity' | 'unit' | 'isStaple'>>
): GroceryPantryStatus {
  const item = pantry.find(
    (p) =>
      ingredientsMatch(ingredient.name, p.normalizedName) ||
      ingredientsMatch(ingredient.name, p.name)
  );
  if (!item) return 'need';

  if (item.isStaple) {
    // Staples are always-on-hand; quantity is ignored so grocery lists
    // do not keep suggesting salt, oil, and similar household items.
    return 'have';
  }

  const pantryQty = parseComparableQuantity(undefined, item.quantity, item.unit);
  if (!pantryQty) {
    // Presence-only pantry entry: user listed the ingredient without an amount.
    return 'have';
  }

  const recipeQty = parseComparableQuantity(ingredient.quantity);
  if (!recipeQty) return 'uncertain';
  if (pantryQty.unit !== recipeQty.unit) return 'uncertain';
  return pantryQty.amount + 1e-9 >= recipeQty.amount ? 'have' : 'need';
}

export function classifyGroceryRows(
  rows: Array<{ ingredient: ParsedIngredient; recipeId: string }>,
  pantry: Array<Pick<PantryItem, 'name' | 'normalizedName' | 'quantity' | 'unit' | 'isStaple'>>
): { toBuy: ClassifiedGroceryRow[]; inPantry: ClassifiedGroceryRow[] } {
  const toBuy: ClassifiedGroceryRow[] = [];
  const inPantry: ClassifiedGroceryRow[] = [];
  for (const row of rows) {
    const status = classifyIngredientAgainstPantry(row.ingredient, pantry);
    const classified = { ...row, status };
    if (status === 'have') inPantry.push(classified);
    else toBuy.push(classified);
  }
  return { toBuy, inPantry };
}

export function pantryMatchSummary(match: {
  matchedCount: number;
  totalIngredients?: number;
  totalCount?: number;
}): string {
  const total = match.totalIngredients ?? match.totalCount ?? 0;
  if (total === 0) return '';
  return `You have ${match.matchedCount} of ${total} ingredients`;
}

export function pantryNeededSummary(match: {
  matchedCount: number;
  totalIngredients?: number;
  totalCount?: number;
}): string {
  const total = match.totalIngredients ?? match.totalCount ?? 0;
  if (total === 0) return '';
  const needed = total - match.matchedCount;
  if (needed === 0) return 'You have every ingredient';
  if (match.matchedCount === 0) {
    return `${needed} ingredient${needed === 1 ? '' : 's'} needed`;
  }
  return pantryMatchSummary(match);
}

export function weakPantryPlanNote(
  matches: Array<{ matchRatio: number; totalIngredients?: number; totalCount?: number } | undefined>
): string | null {
  const usable = matches.filter(
    (m): m is { matchRatio: number; totalIngredients?: number; totalCount?: number } =>
      !!m && (m.totalIngredients ?? m.totalCount ?? 0) > 0
  );
  if (usable.length === 0) return null;
  const avg = usable.reduce((sum, m) => sum + m.matchRatio, 0) / usable.length;
  if (avg >= 0.5) return null;
  return "I couldn't build the whole week from your pantry, but these meals use the ingredients you already have most effectively.";
}
