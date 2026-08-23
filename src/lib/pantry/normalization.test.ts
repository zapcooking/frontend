import { describe, it, expect } from 'vitest';
import { normalizeIngredientName, parseQuantityInput, singularizeToken } from './normalization';
import {
  classifyIngredientAgainstPantry,
  classifyGroceryRows,
  ingredientsMatch,
  matchRecipeToPantry
} from './matching';
import { sanitizePantryItem, validatePantryPayload, formatPantryQuantity } from './schema';
import type { ParsedIngredient } from '$lib/utils/ingredientParser';

describe('normalizeIngredientName', () => {
  it('normalizes eggs to egg', () => {
    expect(normalizeIngredientName('Eggs')).toBe('egg');
    expect(normalizeIngredientName('eggs')).toBe('egg');
  });

  it('normalizes chicken breasts to chicken breast', () => {
    expect(normalizeIngredientName('Chicken breasts')).toBe('chicken breast');
  });

  it('normalizes tomatoes to tomato', () => {
    expect(normalizeIngredientName('Tomatoes')).toBe('tomato');
  });

  it('maps EVOO and extra virgin olive oil to olive oil', () => {
    expect(normalizeIngredientName('EVOO')).toBe('olive oil');
    expect(normalizeIngredientName('extra virgin olive oil')).toBe('olive oil');
  });

  it('strips color modifiers from onions', () => {
    expect(normalizeIngredientName('yellow onion')).toBe('onion');
    expect(normalizeIngredientName('onions')).toBe('onion');
  });

  it('strips a leading quantity from a pantry line', () => {
    expect(normalizeIngredientName('2 large eggs')).toBe('egg');
  });
});

describe('singularizeToken', () => {
  it('handles regular and irregular plurals', () => {
    expect(singularizeToken('eggs')).toBe('egg');
    expect(singularizeToken('tomatoes')).toBe('tomato');
    expect(singularizeToken('breasts')).toBe('breast');
  });
});

describe('parseQuantityInput', () => {
  it('parses optional amounts and units', () => {
    expect(parseQuantityInput('8')).toEqual({ quantity: 8 });
    expect(parseQuantityInput('2 lb')).toEqual({ quantity: 2, unit: 'lb' });
    expect(parseQuantityInput('1 bag')).toEqual({ quantity: 1, unit: 'bag' });
    expect(parseQuantityInput('')).toEqual({});
  });
});

describe('ingredientsMatch', () => {
  it('matches exact and plural/singular names', () => {
    expect(ingredientsMatch('eggs', 'egg')).toBe(true);
    expect(ingredientsMatch('Eggs', 'egg')).toBe(true);
    expect(ingredientsMatch('chicken breasts', 'chicken breast')).toBe(true);
    expect(ingredientsMatch('tomatoes', 'tomato')).toBe(true);
  });

  it('matches normalized variants', () => {
    expect(ingredientsMatch('yellow onion', 'onion')).toBe(true);
    expect(ingredientsMatch('olive oil', 'extra virgin olive oil')).toBe(true);
    expect(ingredientsMatch('EVOO', 'olive oil')).toBe(true);
  });

  it('does not match unrelated ingredients', () => {
    expect(ingredientsMatch('eggs', 'flour')).toBe(false);
    expect(ingredientsMatch('chicken', 'beef')).toBe(false);
  });

  it('does not match accidental substrings', () => {
    expect(ingredientsMatch('ham', 'hamburger')).toBe(false);
    expect(ingredientsMatch('hamburger', 'ham')).toBe(false);
    expect(ingredientsMatch('egg', 'eggplant')).toBe(false);
    expect(ingredientsMatch('oil', 'olive oil')).toBe(false);
  });

  it('matches a more specific cut to a generic pantry protein', () => {
    expect(ingredientsMatch('chicken', 'chicken breast')).toBe(true);
  });
});

describe('matchRecipeToPantry', () => {
  const pantry = [
    { name: 'Chicken breast', normalizedName: 'chicken breast' },
    { name: 'Parmesan', normalizedName: 'parmesan' },
    { name: 'Eggs', normalizedName: 'egg' },
    { name: 'Olive oil', normalizedName: 'olive oil' },
    { name: 'Garlic', normalizedName: 'garlic' }
  ];

  it('calculates match ratio and lists matched/missing ingredients', () => {
    const match = matchRecipeToPantry(
      ['Chicken breast', 'Parmesan', 'Breadcrumbs', 'Egg', 'Tomato sauce', 'Olive oil', 'Garlic'],
      pantry
    );
    expect(match.totalIngredients).toBe(7);
    expect(match.matchedCount).toBe(5);
    expect(match.matchRatio).toBeCloseTo(5 / 7);
    expect(match.matchedIngredients).toEqual([
      'Chicken breast',
      'Parmesan',
      'Egg',
      'Olive oil',
      'Garlic'
    ]);
    expect(match.missingIngredients).toEqual(['Breadcrumbs', 'Tomato sauce']);
  });

  it('handles an empty pantry', () => {
    const match = matchRecipeToPantry(['Eggs', 'Flour'], []);
    expect(match.matchedCount).toBe(0);
    expect(match.matchRatio).toBe(0);
    expect(match.missingIngredients).toEqual(['Eggs', 'Flour']);
  });

  it('handles a recipe with no parsed ingredients', () => {
    const match = matchRecipeToPantry([], pantry);
    expect(match.totalIngredients).toBe(0);
    expect(match.matchRatio).toBe(0);
    expect(match.matchedIngredients).toEqual([]);
    expect(match.missingIngredients).toEqual([]);
  });
});

function ing(name: string, quantity = ''): ParsedIngredient {
  return { name, quantity, category: 'other', originalText: `${quantity} ${name}`.trim() };
}

describe('classifyIngredientAgainstPantry', () => {
  it('recognizes pantry ingredients by name', () => {
    expect(
      classifyIngredientAgainstPantry(ing('Olive oil'), [
        { name: 'Olive oil', normalizedName: 'olive oil' }
      ])
    ).toBe('have');
  });

  it('keeps missing ingredients as need', () => {
    expect(
      classifyIngredientAgainstPantry(ing('Feta'), [
        { name: 'Olive oil', normalizedName: 'olive oil' }
      ])
    ).toBe('need');
  });

  it('does not treat 1 egg as enough for 6 eggs', () => {
    expect(
      classifyIngredientAgainstPantry(ing('eggs', '6'), [
        { name: 'Eggs', normalizedName: 'egg', quantity: 1 }
      ])
    ).toBe('need');
  });

  it('treats mixed units as uncertain so they stay on the grocery list', () => {
    expect(
      classifyIngredientAgainstPantry(ing('chicken breast', '2 lb'), [
        { name: 'Chicken breast', normalizedName: 'chicken breast', quantity: 2, unit: 'cups' }
      ])
    ).toBe('uncertain');
  });

  it('classifies grocery rows into to-buy vs in-pantry', () => {
    const { toBuy, inPantry } = classifyGroceryRows(
      [
        { ingredient: ing('Feta'), recipeId: 'a' },
        { ingredient: ing('Olive oil'), recipeId: 'a' },
        { ingredient: ing('eggs', '6'), recipeId: 'a' }
      ],
      [
        { name: 'Olive oil', normalizedName: 'olive oil' },
        { name: 'Eggs', normalizedName: 'egg', quantity: 1 }
      ]
    );
    expect(inPantry.map((r) => r.ingredient.name)).toEqual(['Olive oil']);
    expect(toBuy.map((r) => r.ingredient.name)).toEqual(['Feta', 'eggs']);
  });

  it('leaves the grocery list unchanged when pantry is empty', () => {
    const rows = [{ ingredient: ing('Rice'), recipeId: 'a' }];
    const { toBuy, inPantry } = classifyGroceryRows(rows, []);
    expect(toBuy).toHaveLength(1);
    expect(inPantry).toHaveLength(0);
  });
});

describe('pantry schema', () => {
  it('sanitizes and validates a pantry payload', () => {
    const item = sanitizePantryItem({
      id: 'abc',
      name: 'Eggs',
      normalizedName: 'egg',
      quantity: 8,
      createdAt: 1,
      updatedAt: 1
    });
    expect(item?.name).toBe('Eggs');
    expect(formatPantryQuantity(item!)).toBe('8');

    const validated = validatePantryPayload({
      schemaVersion: 1,
      items: [item],
      createdAt: 1,
      updatedAt: 2
    });
    expect(validated?.readOnly).toBe(false);
    expect(validated?.pantry.items).toHaveLength(1);
  });

  it('treats a newer schemaVersion as read-only', () => {
    const validated = validatePantryPayload({
      schemaVersion: 2,
      items: [],
      createdAt: 1,
      updatedAt: 1
    });
    expect(validated?.readOnly).toBe(true);
  });
});
