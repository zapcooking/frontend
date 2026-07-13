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

function planWith(days: MealPlan['days']): MealPlan {
  return { ...createEmptyMealPlan('2026-W29'), days };
}

function ing(name: string, quantity: string): ParsedIngredient {
  return { name, quantity, category: 'other', originalText: `${quantity} ${name}`.trim() };
}

describe('collectWeekRecipeSlots', () => {
  it('collects unique coordinates in day/slot order and counts text entries', () => {
    const plan = planWith({
      mon: {
        slots: {
          breakfast: { type: 'text', text: 'Coffee' },
          dinner: { type: 'recipe', a: '30023:pk:curry' }
        }
      },
      wed: {
        slots: {
          lunch: { type: 'recipe', a: '30023:pk:salad' },
          dinner: { type: 'recipe', a: '30023:pk:curry' } // repeat
        }
      },
      sun: { slots: { lunch: { type: 'text', text: 'Eating out' } } }
    });

    const result = collectWeekRecipeSlots(plan);
    expect(result.aTags).toEqual(['30023:pk:curry', '30023:pk:salad']);
    expect(result.textCount).toBe(2);
    expect(result.recipeSlotCount).toBe(3);
  });

  it('handles an empty week', () => {
    expect(collectWeekRecipeSlots(planWith({}))).toEqual({
      aTags: [],
      textCount: 0,
      recipeSlotCount: 0
    });
  });
});

describe('dedupeIngredients (approved v1: exact-match collapse, no merging)', () => {
  it('collapses exact (name, quantity) duplicates keeping the first recipeId', () => {
    const rows: GenerationRow[] = [
      { ingredient: ing('olive oil', '2 tbsp'), recipeId: 'r1' },
      { ingredient: ing('rice', '1 cup'), recipeId: 'r1' },
      { ingredient: ing('olive oil', '2 tbsp'), recipeId: 'r2' } // exact dup
    ];
    const out = dedupeIngredients(rows);
    expect(out).toHaveLength(2);
    expect(out[0].recipeId).toBe('r1');
  });

  it('does NOT merge same name with different quantities', () => {
    const rows: GenerationRow[] = [
      { ingredient: ing('rice', '1 cup'), recipeId: 'r1' },
      { ingredient: ing('rice', '2 cup'), recipeId: 'r2' }
    ];
    expect(dedupeIngredients(rows)).toHaveLength(2);
  });

  it('name match is case-insensitive, quantity verbatim', () => {
    const rows: GenerationRow[] = [
      { ingredient: ing('Olive Oil', '2 tbsp'), recipeId: 'r1' },
      { ingredient: ing('olive oil', '2 tbsp'), recipeId: 'r2' },
      { ingredient: ing('olive oil', '2 Tbsp'), recipeId: 'r3' } // quantity differs
    ];
    expect(dedupeIngredients(rows)).toHaveLength(2);
  });
});

describe('groceryListTitle', () => {
  it('titles by week display range', () => {
    expect(groceryListTitle('2026-W29')).toBe('Groceries — Week 29 (Jul 13–19)');
  });
});
