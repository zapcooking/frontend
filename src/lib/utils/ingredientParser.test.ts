import { describe, it, expect, vi } from 'vitest';

// ingredientParser → groceryService → $app/environment: mock the
// SvelteKit module so the chain resolves under plain vitest.
vi.mock('$app/environment', () => ({ browser: false }));
import {
  parseIngredient,
  extractIngredientsFromRecipe,
  parseIngredientsFromRecipe,
  normalizeFraction
} from './ingredientParser';

/**
 * First tests for the ingredient parser (it shipped untested — Phase 3
 * findings). These pin the parser's ACTUAL current behavior so the
 * grocery-generation feature has a stable base; behavioral oddities are
 * documented inline and filed rather than fixed here.
 */

describe('parseIngredient', () => {
  it('parses number + unit + name', () => {
    const p = parseIngredient('2 cups flour');
    // NOTE (quirk, filed): the unit alternation matches the singular
    // form first and `s?` eats the plural — "cups" comes back as "cup".
    expect(p.quantity).toBe('2 cup');
    expect(p.name).toBe('flour');
    expect(p.category).toBe('pantry');
    expect(p.originalText).toBe('2 cups flour');
  });

  it('parses ASCII fractions', () => {
    const p = parseIngredient('1/2 teaspoon salt');
    expect(p.quantity).toBe('1/2 teaspoon');
    expect(p.name).toBe('salt');
  });

  it('parses mixed numbers', () => {
    const p = parseIngredient('1 1/2 cups sugar');
    expect(p.quantity).toBe('1 1/2 cup');
    expect(p.name).toBe('sugar');
  });

  it('parses unicode fractions', () => {
    const p = parseIngredient('½ cup sugar');
    expect(p.quantity).toBe('½ cup');
    expect(p.name).toBe('sugar');
  });

  it('parses unitless quantities', () => {
    const p = parseIngredient('2 onions, diced');
    expect(p.quantity).toBe('2');
    expect(p.name).toBe('onions');
  });

  it('keeps unquantified items whole', () => {
    const p = parseIngredient('salt and pepper to taste');
    expect(p.quantity).toBe('');
    expect(p.name).toBe('salt and pepper to taste');
  });

  it('treats size words as units ("3 large eggs")', () => {
    const p = parseIngredient('3 large eggs');
    expect(p.quantity).toBe('3 large');
    expect(p.name).toBe('eggs');
    expect(p.category).toBe('protein');
  });

  it('strips parenthetical prep notes', () => {
    const p = parseIngredient('2 cups flour (sifted)');
    expect(p.name).toBe('flour');
  });

  it('strips known comma-prep suffixes but keeps unknown ones', () => {
    expect(parseIngredient('2 carrots, chopped').name).toBe('carrots');
    // "beaten" is not in the prep-word list — the suffix stays (quirk, filed)
    expect(parseIngredient('3 large eggs, beaten').name).toBe('eggs, beaten');
  });

  it('drops leading articles from names', () => {
    const p = parseIngredient('1 an onion');
    expect(p.name).toBe('onion');
  });
});

describe('extractIngredientsFromRecipe', () => {
  const MD = `## Chef's notes

Great dish.

## Ingredients

- 2 cups flour
* 1 cup milk
1. 3 eggs

**For the sauce**

- 1 jar tomato sauce
plain line ingredient

## Directions

1. Mix.
`;

  it('extracts bullets, stars, numbered and plain lines; skips bold subheads', () => {
    expect(extractIngredientsFromRecipe(MD)).toEqual([
      '2 cups flour',
      '1 cup milk',
      '3 eggs',
      '1 jar tomato sauce',
      'plain line ingredient'
    ]);
  });

  it('returns empty for content without an Ingredients section', () => {
    expect(extractIngredientsFromRecipe('## Directions\n\n1. Cook.')).toEqual([]);
  });
});

describe('parseIngredientsFromRecipe', () => {
  it('extracts and parses in one pass', () => {
    const parsed = parseIngredientsFromRecipe('## Ingredients\n\n- 2 cups flour\n- 1/2 tsp salt\n');
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe('flour');
    expect(parsed[1].quantity).toBe('1/2 tsp');
  });
});

describe('normalizeFraction', () => {
  it('converts unicode fractions to ASCII', () => {
    expect(normalizeFraction('½ cup and ¾ tsp')).toBe('1/2 cup and 3/4 tsp');
  });
});
