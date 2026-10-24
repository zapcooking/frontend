import { describe, it, expect } from 'vitest';
import { groupPantryItems, inferPantryCategory } from './categories';
import { missingCommonStaples, suggestPantryIngredients } from './catalog';

describe('inferPantryCategory', () => {
  it('places common cooking ingredients into the expected aisles', () => {
    expect(inferPantryCategory('Chicken Breast')).toBe('meat-seafood');
    expect(inferPantryCategory('Parmesan Cheese')).toBe('dairy-eggs');
    expect(inferPantryCategory('Eggs')).toBe('dairy-eggs');
    expect(inferPantryCategory('Broccoli')).toBe('produce');
    expect(inferPantryCategory('Rice')).toBe('grains-pasta');
    expect(inferPantryCategory('Olive Oil')).toBe('sauces');
    expect(inferPantryCategory('All-Purpose Flour')).toBe('baking');
    expect(inferPantryCategory('Black Pepper')).toBe('spices');
    expect(inferPantryCategory('Canned Tomatoes')).toBe('canned-jarred');
    expect(inferPantryCategory('Frozen Peas')).toBe('frozen');
  });

  it('does not treat black pepper as produce', () => {
    expect(inferPantryCategory('black pepper')).toBe('spices');
    expect(inferPantryCategory('bell pepper')).toBe('produce');
  });
});

describe('groupPantryItems', () => {
  it('groups by aisle and sorts staples first', () => {
    const groups = groupPantryItems([
      {
        id: '1',
        name: 'Broccoli',
        normalizedName: 'broccoli',
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: '2',
        name: 'Salt',
        normalizedName: 'salt',
        isStaple: true,
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: '3',
        name: 'Paprika',
        normalizedName: 'paprika',
        createdAt: 1,
        updatedAt: 1
      }
    ]);
    expect(groups.map((g) => g.category)).toEqual(['produce', 'spices']);
    expect(groups[1].items.map((i) => i.name)).toEqual(['Salt', 'Paprika']);
  });
});

describe('suggestPantryIngredients', () => {
  it('suggests catalog names from partial input', () => {
    expect(suggestPantryIngredients('chick').map((s) => s.name)).toContain('Chicken Breast');
    expect(suggestPantryIngredients('parm').map((s) => s.name)).toContain('Parmesan Cheese');
    expect(suggestPantryIngredients('olive').map((s) => s.name)).toContain('Olive Oil');
  });

  it('skips ingredients already in the pantry and ignores bulk input', () => {
    const existing = [{ name: 'Chicken Breast', normalizedName: 'chicken breast' }];
    expect(suggestPantryIngredients('chick', existing).map((s) => s.name)).not.toContain(
      'Chicken Breast'
    );
    expect(suggestPantryIngredients('eggs, rice')).toEqual([]);
  });
});

describe('missingCommonStaples', () => {
  it('hides staples the user already has', () => {
    expect(missingCommonStaples([{ name: 'Salt', normalizedName: 'salt' }])).not.toContain('Salt');
    expect(missingCommonStaples([])).toContain('Olive Oil');
  });
});
