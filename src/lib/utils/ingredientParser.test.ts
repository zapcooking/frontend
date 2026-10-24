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
import fixtures from '../../test/fixtures/ingredient-parser.vectors.json';

/**
 * Fixture-driven ingredient parser tests. Expectations live in
 * src/test/fixtures/ingredient-parser.vectors.json (cross-platform contract).
 * Quirks (plural singularization, comma-suffix retention) ARE the contract.
 */

describe('parseIngredient', () => {
  for (const vector of fixtures.parseIngredient) {
    it(vector.id, () => {
      const p = parseIngredient(vector.input);
      expect(p).toEqual(vector.expected);
    });
  }
});

describe('extractIngredientsFromRecipe', () => {
  for (const vector of fixtures.extractIngredientsFromRecipe) {
    it(vector.id, () => {
      expect(extractIngredientsFromRecipe(vector.input)).toEqual(vector.expected);
    });
  }
});

describe('parseIngredientsFromRecipe', () => {
  for (const vector of fixtures.parseIngredientsFromRecipe) {
    it(vector.id, () => {
      expect(parseIngredientsFromRecipe(vector.input)).toEqual(vector.expected);
    });
  }
});

describe('normalizeFraction', () => {
  for (const vector of fixtures.normalizeFraction) {
    it(vector.id, () => {
      expect(normalizeFraction(vector.input)).toBe(vector.expected);
    });
  }
});
