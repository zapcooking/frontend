/**
 * Grocery generation from a week's meal plan (Phase 3.3, PR11).
 *
 * Pure helpers — the relay/store side (groceryStore.addList/addItem)
 * stays in the planner page. Approved v1 behavior per the Phase 3
 * findings: dedupe-without-merge (collapse EXACT (name, quantity)
 * duplicates, first occurrence's recipeId wins; no quantity summing —
 * that's v1.1), text slots skipped and reported.
 */

import type { ParsedIngredient } from '$lib/utils/ingredientParser';
import { DAY_KEYS, SLOT_KEYS, type MealPlan } from '$lib/mealplan/schema';
import { weekDisplayRange } from '$lib/mealplan/week';

export interface WeekRecipeSlots {
  /** Unique recipe coordinates in day/slot order. */
  aTags: string[];
  /** Number of text entries (skipped by generation). */
  textCount: number;
  /** Total recipe slots including repeats of the same coordinate. */
  recipeSlotCount: number;
}

/** Walk the plan's days/slots and collect what generation operates on. */
export function collectWeekRecipeSlots(plan: MealPlan): WeekRecipeSlots {
  const seen = new Set<string>();
  const aTags: string[] = [];
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
        if (!seen.has(entry.a)) {
          seen.add(entry.a);
          aTags.push(entry.a);
        }
      }
    }
  }

  return { aTags, textCount, recipeSlotCount };
}

export interface GenerationRow {
  ingredient: ParsedIngredient;
  /** Source recipe coordinate (becomes GroceryItem.recipeId). */
  recipeId: string;
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

/** "Groceries — Week 29 (Jul 13–19)" — reuses the PR7 display helper. */
export function groceryListTitle(weekId: string): string {
  return `Groceries — ${weekDisplayRange(weekId)}`;
}
