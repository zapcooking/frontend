/**
 * Ingredient Parser Utility
 * 
 * Extracts and parses ingredients from recipe content for adding to grocery lists.
 */

import { inferCategory, type GroceryCategory } from '$lib/services/groceryService';

export interface ParsedIngredient {
  name: string;
  quantity: string;
  category: GroceryCategory;
  originalText: string;
}

// ═══════════════════════════════════════════════════════════════
// QUANTITY PATTERNS
// ═══════════════════════════════════════════════════════════════

// Common measurement units (singular and plural forms)
const UNITS = [
  'cup', 'cups', 'c',
  'tablespoon', 'tablespoons', 'tbsp', 'tbs', 'tb',
  'teaspoon', 'teaspoons', 'tsp', 'ts',
  'ounce', 'ounces', 'oz',
  'pound', 'pounds', 'lb', 'lbs',
  'gram', 'grams', 'g',
  'kilogram', 'kilograms', 'kg',
  'milliliter', 'milliliters', 'ml',
  'liter', 'liters', 'l',
  'quart', 'quarts', 'qt',
  'pint', 'pints', 'pt',
  'gallon', 'gallons', 'gal',
  'piece', 'pieces', 'pc', 'pcs',
  'slice', 'slices',
  'can', 'cans',
  'jar', 'jars',
  'package', 'packages', 'pkg',
  'bunch', 'bunches',
  'head', 'heads',
  'clove', 'cloves',
  'stalk', 'stalks',
  'sprig', 'sprigs',
  'pinch', 'pinches',
  'dash', 'dashes',
  'stick', 'sticks',
  'large', 'medium', 'small'
];

// Build a regex pattern for units
const UNIT_PATTERN = UNITS.map(u => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

// Patterns for numbers (including fractions like 1/2, 1 1/2, ½, etc.)
const FRACTION_CHARS = '½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞';
const NUMBER_PATTERN = `(?:\\d+[\\s-])?(?:\\d+\\/\\d+|[${FRACTION_CHARS}]|\\d+(?:\\.\\d+)?)`;

// Combined quantity pattern: number + optional unit
const QUANTITY_PATTERN = new RegExp(
  `^\\s*(${NUMBER_PATTERN})\\s*(?:(${UNIT_PATTERN})s?(?:\\.)?)?\\s+`,
  'i'
);

// Alternative pattern for "X large onions" type format
const ALT_QUANTITY_PATTERN = new RegExp(
  `^\\s*(${NUMBER_PATTERN})\\s+(${UNIT_PATTERN})\\s+`,
  'i'
);

// ═══════════════════════════════════════════════════════════════
// EXTRACTION FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Extract the ingredients section from recipe markdown content
 */
export function extractIngredientsFromRecipe(content: string): string[] {
  const ingredients: string[] = [];
  
  // Try to find ## Ingredients section
  const ingredientsMatch = content.match(/## Ingredients\s*\n([\s\S]*?)(?=\n## |$)/i);
  
  if (ingredientsMatch) {
    const ingredientsSection = ingredientsMatch[1];
    const lines = ingredientsSection.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip empty lines and subheadings
      if (!trimmed || trimmed.startsWith('#') || (trimmed.startsWith('**') && trimmed.endsWith('**'))) {
        continue;
      }
      
      // Handle bullet points (- or *)
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const ingredient = trimmed.substring(2).trim();
        if (ingredient) {
          ingredients.push(ingredient);
        }
      }
      // Handle numbered lists
      else if (/^\d+\.\s+/.test(trimmed)) {
        const ingredient = trimmed.replace(/^\d+\.\s+/, '').trim();
        if (ingredient) {
          ingredients.push(ingredient);
        }
      }
      // Handle plain text lines (non-header lines that aren't empty)
      else if (trimmed.length > 0 && !trimmed.match(/^[A-Z][a-z]+:$/)) {
        ingredients.push(trimmed);
      }
    }
  }
  
  return ingredients;
}

/**
 * Parse a single ingredient line into structured data
 * 
 * Examples:
 * - "2 cups flour" → { quantity: "2 cups", name: "flour" }
 * - "1/2 teaspoon salt" → { quantity: "1/2 teaspoon", name: "salt" }
 * - "3 large eggs" → { quantity: "3 large", name: "eggs" }
 * - "salt and pepper to taste" → { quantity: "", name: "salt and pepper to taste" }
 */
export function parseIngredient(text: string): ParsedIngredient {
  const originalText = text.trim();
  let workingText = originalText;
  
  // Remove common preparation notes in parentheses at the end
  // e.g., "2 cups flour (sifted)" → "2 cups flour"
  workingText = workingText.replace(/\s*\([^)]*\)\s*$/, '').trim();
  
  // Remove trailing preparation instructions after comma
  // e.g., "2 onions, diced" → "2 onions"
  const commaIndex = workingText.indexOf(',');
  if (commaIndex > 0) {
    // Check if what's after the comma looks like a preparation instruction
    const afterComma = workingText.substring(commaIndex + 1).trim().toLowerCase();
    const prepWords = ['diced', 'chopped', 'minced', 'sliced', 'cubed', 'grated', 'shredded', 
                       'melted', 'softened', 'room temperature', 'divided', 'optional',
                       'to taste', 'or more', 'or less', 'packed', 'sifted', 'peeled'];
    if (prepWords.some(word => afterComma.startsWith(word))) {
      workingText = workingText.substring(0, commaIndex).trim();
    }
  }
  
  let quantity = '';
  let name = workingText;
  
  // Try primary quantity pattern
  const match = workingText.match(QUANTITY_PATTERN);
  if (match) {
    const numberPart = match[1].trim();
    const unitPart = match[2] ? match[2].trim() : '';
    quantity = unitPart ? `${numberPart} ${unitPart}` : numberPart;
    name = workingText.substring(match[0].length).trim();
  } else {
    // Try alternative pattern (for things like "3 large eggs")
    const altMatch = workingText.match(ALT_QUANTITY_PATTERN);
    if (altMatch) {
      quantity = `${altMatch[1].trim()} ${altMatch[2].trim()}`;
      name = workingText.substring(altMatch[0].length).trim();
    }
  }
  
  // Clean up the name - remove leading articles
  name = name.replace(/^(the|a|an)\s+/i, '').trim();
  
  // If name is empty, use the original text
  if (!name) {
    name = originalText;
    quantity = '';
  }
  
  // Infer category from the ingredient name
  const category = inferCategory(name);
  
  return {
    name,
    quantity,
    category,
    originalText
  };
}

/**
 * Parse multiple ingredients from recipe content
 */
export function parseIngredientsFromRecipe(content: string): ParsedIngredient[] {
  const rawIngredients = extractIngredientsFromRecipe(content);
  return rawIngredients.map(parseIngredient);
}


/**
 * Convert unicode fractions to decimal-friendly format
 */
export function normalizeFraction(text: string): string {
  const fractionMap: Record<string, string> = {
    '½': '1/2',
    '⅓': '1/3',
    '⅔': '2/3',
    '¼': '1/4',
    '¾': '3/4',
    '⅕': '1/5',
    '⅖': '2/5',
    '⅗': '3/5',
    '⅘': '4/5',
    '⅙': '1/6',
    '⅚': '5/6',
    '⅛': '1/8',
    '⅜': '3/8',
    '⅝': '5/8',
    '⅞': '7/8'
  };
  
  let result = text;
  for (const [fraction, replacement] of Object.entries(fractionMap)) {
    result = result.replace(new RegExp(fraction, 'g'), replacement);
  }
  return result;
}
