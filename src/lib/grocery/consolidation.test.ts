import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: false }));

import { consolidateIngredients, groceryConsolidationKey } from './consolidation';

function row(name: string, quantity: string, recipeId: string, occurrenceId = `${recipeId}:slot`) {
  return {
    ingredient: { name, quantity },
    recipeId,
    recipeTitle: recipeId,
    occurrenceId
  };
}

describe('groceryConsolidationKey', () => {
  it('singularizes and aliases obvious variants', () => {
    expect(groceryConsolidationKey('onions')).toBe('onion');
    expect(groceryConsolidationKey('tomatoes')).toBe('tomato');
    expect(groceryConsolidationKey('chicken breasts')).toBe('chicken breast');
    expect(groceryConsolidationKey('parmesan cheese')).toBe('parmesan');
    expect(groceryConsolidationKey('Parmesan')).toBe('parmesan');
  });

  it('keeps distinguishing colors and forms', () => {
    expect(groceryConsolidationKey('yellow onion')).toBe('yellow onion');
    expect(groceryConsolidationKey('red onion')).toBe('red onion');
    expect(groceryConsolidationKey('green onion')).toBe('green onion');
    expect(groceryConsolidationKey('ground beef')).toBe('ground beef');
  });
});

describe('consolidateIngredients', () => {
  it('merges yellow onions with generic onion and sums counts', () => {
    const out = consolidateIngredients([
      row('yellow onion', '1', 'A'),
      row('yellow onions', '2', 'B'),
      row('onion', '1', 'C')
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].normalizedName).toBe('yellow onion');
    expect(out[0].quantity).toBe('4');
    expect(out[0].sources).toHaveLength(3);
  });

  it('keeps red, yellow, and green onions distinct', () => {
    const out = consolidateIngredients([
      row('red onion', '1', 'A'),
      row('yellow onion', '1', 'B'),
      row('green onion', '1', 'C')
    ]);
    expect(out.map((item) => item.normalizedName).sort()).toEqual([
      'green onion',
      'red onion',
      'yellow onion'
    ]);
  });

  it('does not merge generic onion when both red and yellow are present', () => {
    const out = consolidateIngredients([
      row('red onion', '1', 'A'),
      row('yellow onion', '1', 'B'),
      row('onion', '1', 'C')
    ]);
    expect(out).toHaveLength(3);
  });

  it('combines compatible quantities and keeps recipe sources', () => {
    const out = consolidateIngredients([
      row('chicken broth', '1 cup', 'A', 'mon:dinner'),
      row('chicken broth', '2 cups', 'B', 'tue:dinner')
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBe('3 cups');
    expect(out[0].sources.map((s) => s.recipeId).sort()).toEqual(['A', 'B']);
  });

  it('does not double the same occurrence', () => {
    const out = consolidateIngredients([
      row('rice', '1 cup', 'A', 'mon:dinner'),
      row('rice', '1 cup', 'A', 'mon:dinner')
    ]);
    expect(out[0].sources).toHaveLength(1);
    expect(out[0].quantity).toBe('1 cup');
  });
});
