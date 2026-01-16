/**
 * Unit Converter Utility
 * 
 * Provides conversion functions for cooking units:
 * - Volume (teaspoon, tablespoon, cup, etc.)
 * - Weight (ounce, pound, gram, etc.)
 * - Temperature (Fahrenheit, Celsius)
 * 
 * TODO: Future expansion - ingredient density conversions (flour, sugar, etc.)
 */

export type UnitCategory = 'volume' | 'weight' | 'temperature';

export interface Unit {
  id: string;
  label: string;
  category: UnitCategory;
  abbreviation?: string;
}

// Volume units (base: milliliters)
const VOLUME_TO_ML: Record<string, number> = {
  tsp: 4.92892,
  tbsp: 14.7868,
  'fl oz': 29.5735,
  cup: 236.588,
  pint: 473.176,
  quart: 946.353,
  gallon: 3785.41,
  mL: 1,
  L: 1000,
};

// Weight units (base: grams)
const WEIGHT_TO_G: Record<string, number> = {
  oz: 28.3495,
  lb: 453.592,
  g: 1,
  kg: 1000,
};

// Unit definitions
export const UNITS: Unit[] = [
  // Volume
  { id: 'tsp', label: 'teaspoon', category: 'volume', abbreviation: 'tsp' },
  { id: 'tbsp', label: 'tablespoon', category: 'volume', abbreviation: 'tbsp' },
  { id: 'fl oz', label: 'fluid ounce', category: 'volume', abbreviation: 'fl oz' },
  { id: 'cup', label: 'cup', category: 'volume' },
  { id: 'pint', label: 'pint', category: 'volume' },
  { id: 'quart', label: 'quart', category: 'volume' },
  { id: 'gallon', label: 'gallon', category: 'volume' },
  { id: 'mL', label: 'milliliter', category: 'volume', abbreviation: 'mL' },
  { id: 'L', label: 'liter', category: 'volume', abbreviation: 'L' },
  // Weight
  { id: 'oz', label: 'ounce', category: 'weight', abbreviation: 'oz' },
  { id: 'lb', label: 'pound', category: 'weight', abbreviation: 'lb' },
  { id: 'g', label: 'gram', category: 'weight', abbreviation: 'g' },
  { id: 'kg', label: 'kilogram', category: 'weight', abbreviation: 'kg' },
  // Temperature
  { id: '°F', label: 'Fahrenheit', category: 'temperature', abbreviation: '°F' },
  { id: '°C', label: 'Celsius', category: 'temperature', abbreviation: '°C' },
];

/**
 * Get all units for a specific category
 */
export function getUnitsByCategory(category: UnitCategory): Unit[] {
  return UNITS.filter(unit => unit.category === category);
}

/**
 * Get unit by ID
 */
export function getUnitById(id: string): Unit | undefined {
  return UNITS.find(unit => unit.id === id);
}

/**
 * Get category for a unit
 */
export function getUnitCategory(unitId: string): UnitCategory | undefined {
  return getUnitById(unitId)?.category;
}

/**
 * Check if two units are in the same category
 */
export function areUnitsCompatible(fromUnitId: string, toUnitId: string): boolean {
  const fromCategory = getUnitCategory(fromUnitId);
  const toCategory = getUnitCategory(toUnitId);
  return fromCategory !== undefined && fromCategory === toCategory;
}

/**
 * Convert volume from one unit to another
 */
function convertVolume(amount: number, fromUnitId: string, toUnitId: string): number {
  if (fromUnitId === toUnitId) return amount;
  
  const fromMultiplier = VOLUME_TO_ML[fromUnitId];
  const toMultiplier = VOLUME_TO_ML[toUnitId];
  
  if (!fromMultiplier || !toMultiplier) {
    throw new Error(`Invalid volume unit: ${fromUnitId} or ${toUnitId}`);
  }
  
  // Convert to base (mL), then to target unit
  const milliliters = amount * fromMultiplier;
  return milliliters / toMultiplier;
}

/**
 * Convert weight from one unit to another
 */
function convertWeight(amount: number, fromUnitId: string, toUnitId: string): number {
  if (fromUnitId === toUnitId) return amount;
  
  const fromMultiplier = WEIGHT_TO_G[fromUnitId];
  const toMultiplier = WEIGHT_TO_G[toUnitId];
  
  if (!fromMultiplier || !toMultiplier) {
    throw new Error(`Invalid weight unit: ${fromUnitId} or ${toUnitId}`);
  }
  
  // Convert to base (g), then to target unit
  const grams = amount * fromMultiplier;
  return grams / toMultiplier;
}

/**
 * Convert temperature from one unit to another
 */
function convertTemperature(amount: number, fromUnitId: string, toUnitId: string): number {
  if (fromUnitId === toUnitId) return amount;
  
  if (fromUnitId === '°F' && toUnitId === '°C') {
    // Fahrenheit to Celsius: (F - 32) * 5/9
    return (amount - 32) * (5 / 9);
  } else if (fromUnitId === '°C' && toUnitId === '°F') {
    // Celsius to Fahrenheit: (C * 9/5) + 32
    return (amount * (9 / 5)) + 32;
  }
  
  throw new Error(`Invalid temperature conversion: ${fromUnitId} to ${toUnitId}`);
}

/**
 * Convert amount from one unit to another
 * Returns null if units are incompatible or conversion fails
 */
export function convert(
  amount: number,
  fromUnitId: string,
  toUnitId: string
): number | null {
  // Validate input
  if (isNaN(amount) || !isFinite(amount)) {
    return null;
  }
  
  // Check compatibility
  if (!areUnitsCompatible(fromUnitId, toUnitId)) {
    return null;
  }
  
  const category = getUnitCategory(fromUnitId);
  if (!category) {
    return null;
  }
  
  try {
    let result: number;
    
    switch (category) {
      case 'volume':
        result = convertVolume(amount, fromUnitId, toUnitId);
        break;
      case 'weight':
        result = convertWeight(amount, fromUnitId, toUnitId);
        break;
      case 'temperature':
        result = convertTemperature(amount, fromUnitId, toUnitId);
        break;
      default:
        return null;
    }
    
    return result;
  } catch (error) {
    console.error('Conversion error:', error);
    return null;
  }
}

/**
 * Format a number for display (removes trailing zeros, limits decimals)
 */
export function formatNumber(value: number | null): string {
  if (value === null || isNaN(value) || !isFinite(value)) {
    return '';
  }
  
  // Round to 2 decimal places, then remove trailing zeros
  const rounded = Math.round(value * 100) / 100;
  return rounded.toString().replace(/\.?0+$/, '');
}

/**
 * Get a default "to" unit for a given "from" unit
 * Returns a common complementary unit in the same category
 */
export function getDefaultToUnit(fromUnitId: string): string | null {
  const category = getUnitCategory(fromUnitId);
  if (!category) return null;
  
  const units = getUnitsByCategory(category);
  if (units.length < 2) return null;
  
  // For volume: if imperial, default to metric, and vice versa
  if (category === 'volume') {
    const imperial = ['tsp', 'tbsp', 'fl oz', 'cup', 'pint', 'quart', 'gallon'];
    if (imperial.includes(fromUnitId)) {
      return 'mL'; // Default to mL for imperial
    } else {
      return 'cup'; // Default to cup for metric
    }
  }
  
  // For weight: if imperial, default to metric, and vice versa
  if (category === 'weight') {
    const imperial = ['oz', 'lb'];
    if (imperial.includes(fromUnitId)) {
      return 'g'; // Default to g for imperial
    } else {
      return 'oz'; // Default to oz for metric
    }
  }
  
  // For temperature: swap between F and C
  if (category === 'temperature') {
    return fromUnitId === '°F' ? '°C' : '°F';
  }
  
  // Fallback: return second unit in category
  return units[1]?.id || null;
}
