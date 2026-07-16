import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: false }));
import {
  collectWeekRecipeSlots,
  dedupeIngredients,
  groceryListTitle,
  type GenerationRow
} from './groceryGeneration';
import { createEmptyMealPlan, type MealPlan } from './schema';
import type { ParsedIngredient } from '$lib/utils/ingredientParser';
import fixtures from '../../test/fixtures/grocery-generation.vectors.json';

function planWith(days: MealPlan['days']): MealPlan {
  return { ...createEmptyMealPlan('2026-W29'), days };
}

function ing(name: string, quantity: string): ParsedIngredient {
  return { name, quantity, category: 'other', originalText: `${quantity} ${name}`.trim() };
}

describe('collectWeekRecipeSlots', () => {
  for (const v of fixtures.collectWeekRecipeSlots) {
    it(v.id, () => {
      const plan = planWith(v.days as MealPlan['days']);
      expect(collectWeekRecipeSlots(plan)).toEqual(v.expected);
    });
  }
});

describe('dedupeIngredients (approved v1: exact-match collapse, no merging)', () => {
  for (const v of fixtures.dedupeIngredients) {
    it(v.id, () => {
      const rows: GenerationRow[] = v.rows.map((r) => ({
        ingredient: ing(r.name, r.quantity),
        recipeId: r.recipeId
      }));
      const out = dedupeIngredients(rows);
      expect(out).toHaveLength(v.expectedLength);
      if (v.expectedFirstRecipeId) {
        expect(out[0].recipeId).toBe(v.expectedFirstRecipeId);
      }
    });
  }
});

describe('groceryListTitle', () => {
  for (const v of fixtures.groceryListTitle) {
    it(v.id, () => {
      expect(groceryListTitle(v.weekId)).toBe(v.expected);
    });
  }
});
