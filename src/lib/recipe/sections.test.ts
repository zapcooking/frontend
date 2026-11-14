import { describe, it, expect } from 'vitest';
import {
  extractIngredientItems,
  markdownBeforeDirections,
  recipeSections,
  withoutIngredientsSection
} from './sections';

const RECIPE = `Intro text.

## Details
- Prep: 10 min

## Ingredients
- 2 cups flour
* 1 tsp salt

1 cup water
### For the topping
- 50 g butter

## Directions
1. Mix the flour and salt.
2. Add water and knead.

## Notes
Keeps for two days.`;

describe('recipe sections', () => {
  it('reads ingredient lines the way the recipe page shows them', () => {
    expect(extractIngredientItems(markdownBeforeDirections(RECIPE))).toEqual([
      '2 cups flour',
      '1 tsp salt',
      '1 cup water',
      '50 g butter'
    ]);
  });

  it('is empty without an Ingredients section', () => {
    expect(extractIngredientItems('Just a story.')).toEqual([]);
  });

  it('keeps the rest of the markdown when the section is removed', () => {
    const before = markdownBeforeDirections(RECIPE);
    const rest = withoutIngredientsSection(before);
    expect(rest).toContain('## Details');
    expect(rest).not.toContain('flour');
  });

  it('returns ingredients and numbered directions together', () => {
    const { ingredients, directions } = recipeSections(RECIPE);
    expect(ingredients.length).toBe(4);
    const steps = directions.flatMap((p) => p.steps.map((s) => s.text));
    expect(steps).toEqual(['Mix the flour and salt.', 'Add water and knead.']);
  });
});
