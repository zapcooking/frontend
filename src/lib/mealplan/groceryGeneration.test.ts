import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: false }));
import {
  collectWeekRecipeSlots,
  dedupeIngredients,
  groceryListTitle,
  classifyGroceryRows,
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

describe('classifyGroceryRows pantry awareness', () => {
  it('keeps missing ingredients and recognizes pantry items', () => {
    const rows: GenerationRow[] = [
      { ingredient: ing('Feta', ''), recipeId: 'a' },
      { ingredient: ing('Olive oil', ''), recipeId: 'a' },
      { ingredient: ing('Garlic', ''), recipeId: 'a' }
    ];
    const { toBuy, inPantry } = classifyGroceryRows(rows, [
      { name: 'Olive oil', normalizedName: 'olive oil' },
      { name: 'Garlic', normalizedName: 'garlic' }
    ]);
    expect(inPantry.map((r) => r.ingredient.name)).toEqual(['Olive oil', 'Garlic']);
    expect(toBuy.map((r) => r.ingredient.name)).toEqual(['Feta']);
  });

  it('keeps uncertain quantity matches on the grocery list', () => {
    const rows: GenerationRow[] = [{ ingredient: ing('chicken breast', '2 lb'), recipeId: 'a' }];
    const { toBuy, inPantry } = classifyGroceryRows(rows, [
      { name: 'Chicken breast', normalizedName: 'chicken breast', quantity: 1, unit: 'cup' }
    ]);
    expect(inPantry).toHaveLength(0);
    expect(toBuy).toHaveLength(1);
    expect(toBuy[0].status).toBe('uncertain');
  });

  it('still generates a full grocery list when pantry is empty', () => {
    const rows: GenerationRow[] = [
      { ingredient: ing('Rice', '1 cup'), recipeId: 'a' },
      { ingredient: ing('Eggs', '6'), recipeId: 'a' }
    ];
    const { toBuy, inPantry } = classifyGroceryRows(rows, []);
    expect(toBuy).toHaveLength(2);
    expect(inPantry).toHaveLength(0);
  });
});
