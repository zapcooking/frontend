import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: false }));

import { canonicalizeGroceryCategory, inferGroceryCategory } from './categories';

describe('inferGroceryCategory', () => {
  it('uses pantry aisles and grocery-specific bakery/beverage/snack groups', () => {
    expect(inferGroceryCategory('Broccoli')).toBe('produce');
    expect(inferGroceryCategory('Chicken Breast')).toBe('meat-seafood');
    expect(inferGroceryCategory('Eggs')).toBe('dairy-eggs');
    expect(inferGroceryCategory('Sourdough bread')).toBe('bakery');
    expect(inferGroceryCategory('Rice')).toBe('grains-pasta');
    expect(inferGroceryCategory('Olive oil')).toBe('sauces');
    expect(inferGroceryCategory('Black pepper')).toBe('spices');
    expect(inferGroceryCategory('Sparkling water')).toBe('beverages');
    expect(inferGroceryCategory('Potato chips')).toBe('snacks');
  });
});

describe('canonicalizeGroceryCategory', () => {
  it('maps legacy grocery categories', () => {
    expect(canonicalizeGroceryCategory('protein', 'chicken')).toBe('meat-seafood');
    expect(canonicalizeGroceryCategory('dairy', 'milk')).toBe('dairy-eggs');
    expect(canonicalizeGroceryCategory('pantry', 'flour')).toBe('baking');
  });
});
