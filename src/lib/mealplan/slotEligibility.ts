/**
 * Meal-slot eligibility for Cheffy planning.
 *
 * Internal to meal-plan generation — not part of the shared Android
 * meal-plan schema. Breakfast (and snack) are hard filters; lunch and
 * dinner stay permissive.
 */

import type { MealSlotKey } from './schema';

/** Minimal candidate shape — kept local to avoid a cycle with generation.ts. */
export interface SlotEligibilityCandidate {
  title: string;
  tags: string[];
}

const BREAKFAST_TAG_NEEDLES = ['breakfast', 'brunch'];

const BREAKFAST_TITLE_PHRASES = [
  'breakfast',
  'brunch',
  'omelet',
  'omelette',
  'frittata',
  'pancake',
  'pancakes',
  'waffle',
  'waffles',
  'french toast',
  'oatmeal',
  'overnight oats',
  'porridge',
  'granola',
  'yogurt',
  'parfait',
  'smoothie',
  'breakfast sandwich',
  'breakfast burrito',
  'hash brown',
  'hashbrowns',
  'hash browns',
  'muffin',
  'muffins',
  'bagel',
  'bagels',
  'cereal',
  'muesli',
  'shakshuka',
  'eggs benedict',
  'scrambled eggs',
  'fried eggs',
  'poached eggs',
  'avocado toast',
  'crepe',
  'crepes',
  'scone',
  'scones',
  'acai'
];

const BREAKFAST_TITLE_WORDS = ['eggs', 'oats', 'hash'];

const SNACK_TAG_NEEDLES = ['snack', 'snacks'];

const SNACK_TITLE_PHRASES = [
  'snack',
  'snacks',
  'bites',
  'energy ball',
  'energy balls',
  'granola bar',
  'protein bar',
  'trail mix',
  'popcorn',
  'hummus'
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_/]+/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

function tagMatches(tags: string[], needles: string[]): boolean {
  for (const tag of tags || []) {
    const n = normalize(tag);
    if (!n) continue;
    for (const needle of needles) {
      if (n === needle || n.includes(needle)) return true;
    }
  }
  return false;
}

function titleHasPhrase(title: string, phrases: string[]): boolean {
  const n = ` ${normalize(title)} `;
  return phrases.some((phrase) => n.includes(` ${phrase} `) || n.includes(` ${phrase}`));
}

function titleHasWord(title: string, words: string[]): boolean {
  const n = normalize(title);
  if (!n) return false;
  const tokens = new Set(n.split(' '));
  return words.some((w) => tokens.has(w));
}

function hasBreakfastSignal(candidate: SlotEligibilityCandidate): boolean {
  if (tagMatches(candidate.tags, BREAKFAST_TAG_NEEDLES)) return true;
  const title = candidate.title || '';
  if (titleHasPhrase(title, BREAKFAST_TITLE_PHRASES)) return true;
  if (titleHasWord(title, BREAKFAST_TITLE_WORDS)) return true;
  return false;
}

function hasSnackSignal(candidate: SlotEligibilityCandidate): boolean {
  if (tagMatches(candidate.tags, SNACK_TAG_NEEDLES)) return true;
  return titleHasPhrase(candidate.title || '', SNACK_TITLE_PHRASES);
}

/**
 * Whether a recipe may be assigned to a planner slot.
 *
 * Breakfast and snack require a positive signal (tags first, then title).
 * Lunch and dinner are always eligible — many recipes work for either.
 */
export function isRecipeEligibleForSlot(
  candidate: SlotEligibilityCandidate,
  slot: MealSlotKey
): boolean {
  if (slot === 'lunch' || slot === 'dinner') return true;
  if (slot === 'breakfast') return hasBreakfastSignal(candidate);
  if (slot === 'snack') return hasSnackSignal(candidate);
  return false;
}

export function eligibleSlotsForRecipe(candidate: SlotEligibilityCandidate): MealSlotKey[] {
  const slots: MealSlotKey[] = [];
  if (isRecipeEligibleForSlot(candidate, 'breakfast')) slots.push('breakfast');
  slots.push('lunch', 'dinner');
  if (isRecipeEligibleForSlot(candidate, 'snack')) slots.push('snack');
  return slots;
}

const HARD_SLOTS: MealSlotKey[] = ['breakfast', 'snack'];

/**
 * Drop recipes that cannot fill any requested slot. Breakfast-only
 * (or snack-only) requests keep only matching recipes — dinner entrees
 * never reach Cheffy as breakfast options. Lunch/dinner requests are
 * unrestricted.
 */
export function restrictCandidatesToRequestedSlots<T extends SlotEligibilityCandidate>(
  candidates: T[],
  mealSlots: MealSlotKey[]
): T[] {
  if (mealSlots.length === 0) return candidates;
  const hard = mealSlots.filter((s) => HARD_SLOTS.includes(s));
  const hasSoft = mealSlots.some((s) => s === 'lunch' || s === 'dinner');
  if (hard.length === 0) return candidates;
  if (hasSoft) {
    return candidates.filter((c) => mealSlots.some((slot) => isRecipeEligibleForSlot(c, slot)));
  }
  return candidates.filter((c) => hard.some((slot) => isRecipeEligibleForSlot(c, slot)));
}

export function insufficientSlotCoverageMessage(opts: {
  mealSlots: MealSlotKey[];
  found: number;
  requested: number;
}): string | null {
  if (opts.found >= opts.requested || opts.found <= 0) return null;
  if (opts.mealSlots.length === 1 && opts.mealSlots[0] === 'breakfast') {
    const n = opts.found;
    return `Cheffy found ${n} breakfast ${n === 1 ? 'recipe' : 'recipes'} that match your preferences. Try broadening your preferences to fill the rest of the week.`;
  }
  if (opts.mealSlots.length === 1 && opts.mealSlots[0] === 'snack') {
    const n = opts.found;
    return `Cheffy found ${n} snack ${n === 1 ? 'recipe' : 'recipes'} that match your preferences. Try broadening your preferences to fill the rest of the week.`;
  }
  return `Cheffy found ${opts.found} matching ${opts.found === 1 ? 'recipe' : 'recipes'} — some slots were left empty rather than filled with a poor match.`;
}

export function noEligibleRecipesMessage(mealSlots: MealSlotKey[]): string {
  if (mealSlots.length === 1 && mealSlots[0] === 'breakfast') {
    return 'Cheffy could not find breakfast or brunch recipes that match your preferences. Try another source, or add breakfast recipes.';
  }
  if (mealSlots.length === 1 && mealSlots[0] === 'snack') {
    return 'Cheffy could not find snack recipes that match your preferences. Try another source, or loosen the filters.';
  }
  return 'Could not find enough matching recipes. Try another source, or loosen the time and ingredient filters.';
}
