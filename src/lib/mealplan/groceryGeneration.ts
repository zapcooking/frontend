/**
 * Grocery generation from a week's meal plan.
 *
 * Pure helpers — persistence stays in groceryStore. Ingredients are
 * consolidated (names + safe quantities) and classified against pantry
 * after combining, so a pantry amount is compared to the week's total.
 *
 * `dedupeIngredients` is the original exact-match collapse and remains
 * for the shared Android fixture contract. The planner uses
 * `collectWeekRecipeOccurrences` + `buildGrocerySnapshot`.
 */

import type { ParsedIngredient } from '$lib/utils/ingredientParser';
import { parseIngredient } from '$lib/utils/ingredientParser';
import { DAY_KEYS, SLOT_KEYS, type MealPlan } from '$lib/mealplan/schema';
import { weekDisplayRange } from '$lib/mealplan/week';
import type { ConsolidationRow } from '$lib/grocery/consolidation';
import { buildGrocerySnapshot } from '$lib/grocery/requirements';

export interface WeekRecipeSlots {
  /** Unique recipe coordinates in day/slot order. */
  aTags: string[];
  /** Number of text entries (skipped by generation). */
  textCount: number;
  /** Total recipe slots including repeats of the same coordinate. */
  recipeSlotCount: number;
}

export interface WeekRecipeOccurrence {
  a: string;
  title?: string;
  occurrenceId: string;
}

export interface WeekRecipeOccurrences extends WeekRecipeSlots {
  occurrences: WeekRecipeOccurrence[];
}

/** Walk the plan's days/slots and collect unique recipe coordinates. */
export function collectWeekRecipeSlots(plan: MealPlan): WeekRecipeSlots {
  const collected = collectWeekRecipeOccurrences(plan);
  return {
    aTags: collected.aTags,
    textCount: collected.textCount,
    recipeSlotCount: collected.recipeSlotCount
  };
}

/** Include every planned recipe slot so repeated meals count twice. */
export function collectWeekRecipeOccurrences(plan: MealPlan): WeekRecipeOccurrences {
  const seen = new Set<string>();
  const aTags: string[] = [];
  const occurrences: WeekRecipeOccurrence[] = [];
  let textCount = 0;
  let recipeSlotCount = 0;

  for (const day of DAY_KEYS) {
    const slots = plan.days[day]?.slots;
    if (!slots) continue;
    for (const slotKey of SLOT_KEYS) {
      const entry = slots[slotKey];
      if (!entry) continue;
      if (entry.type === 'text') {
        textCount++;
      } else if (entry.type === 'recipe') {
        recipeSlotCount++;
        occurrences.push({
          a: entry.a,
          title: entry.title,
          occurrenceId: `${day}:${slotKey}`
        });
        if (!seen.has(entry.a)) {
          seen.add(entry.a);
          aTags.push(entry.a);
        }
      }
    }
  }

  return { aTags, textCount, recipeSlotCount, occurrences };
}

export interface GenerationRow {
  ingredient: ParsedIngredient;
  /** Source recipe coordinate (becomes GroceryItem.recipeId). */
  recipeId: string;
  recipeTitle?: string;
  occurrenceId?: string;
}

/**
 * Approved v1 dedupe: collapse rows whose (name, quantity) match
 * EXACTLY (case-insensitive name, verbatim quantity). No unit
 * normalization, no quantity math. First occurrence wins, keeping its
 * source recipeId.
 */
export function dedupeIngredients(rows: GenerationRow[]): GenerationRow[] {
  const seen = new Set<string>();
  const out: GenerationRow[] = [];
  for (const row of rows) {
    const key = `${row.ingredient.name.trim().toLowerCase()}|${row.ingredient.quantity.trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function rowsFromRecipeLines(
  recipes: Array<{ a: string; title?: string; occurrenceId: string; lines: string[] }>
): ConsolidationRow[] {
  const rows: ConsolidationRow[] = [];
  for (const recipe of recipes) {
    for (const line of recipe.lines) {
      const ingredient = parseIngredient(line);
      rows.push({
        ingredient: { name: ingredient.name, quantity: ingredient.quantity },
        recipeId: recipe.a,
        recipeTitle: recipe.title,
        occurrenceId: recipe.occurrenceId
      });
    }
  }
  return rows;
}

/** "Groceries — Week 29 (Jul 13–19)" — reuses the PR7 display helper. */
export function groceryListTitle(weekId: string): string {
  return `Groceries — ${weekDisplayRange(weekId)}`;
}

export { classifyGroceryRows } from '$lib/pantry/matching';
export { buildGrocerySnapshot };
