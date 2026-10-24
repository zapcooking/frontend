import { describe, it, expect } from 'vitest';
import { combineQuantities, parseGroceryQuantity } from './units';

describe('parseGroceryQuantity', () => {
  it('parses unitless counts, cups, and fractions', () => {
    expect(parseGroceryQuantity('2')).toEqual({ amount: 2, unit: '', family: 'count' });
    expect(parseGroceryQuantity('2 cups')).toMatchObject({ amount: 2, unit: 'cup', family: 'volume' });
    expect(parseGroceryQuantity('2 cup')).toMatchObject({ amount: 2, unit: 'cup', family: 'volume' });
    expect(parseGroceryQuantity('1/2 tsp')).toMatchObject({ amount: 0.5, unit: 'tsp', family: 'volume' });
    expect(parseGroceryQuantity('1 1/2 cups')).toMatchObject({ amount: 1.5, unit: 'cup', family: 'volume' });
    expect(parseGroceryQuantity('8 oz')).toMatchObject({ amount: 8, unit: 'oz', family: 'weight' });
    expect(parseGroceryQuantity('8 fl oz')).toMatchObject({ amount: 8, unit: 'fl oz', family: 'volume' });
    expect(parseGroceryQuantity('3 cloves')).toMatchObject({ amount: 3, unit: 'clove', family: 'other' });
  });
});

describe('combineQuantities', () => {
  it('sums matching units', () => {
    expect(combineQuantities(['1 cup', '2 cups']).display).toBe('3 cups');
    expect(combineQuantities(['8 oz', '8 oz']).display).toBe('16 oz');
    expect(combineQuantities(['2', '3']).display).toBe('5');
  });

  it('converts compatible volume and weight units', () => {
    expect(combineQuantities(['1 cup', '8 fl oz']).display).toBe('2 cups');
    expect(combineQuantities(['1 lb', '8 oz']).display).toBe('1 1/2 lb');
    expect(combineQuantities(['3 tsp', '1 tbsp']).display).toBe('2 tbsp');
  });

  it('keeps incompatible units instead of inventing a conversion', () => {
    expect(combineQuantities(['3 cloves', '1 head']).display).toBe('3 cloves + 1 head');
  });
});
