/**
 * Deterministic ingredient normalization for pantry matching.
 *
 * V1 is practical, not culinary-complete. The matching layer consumes
 * `normalizedName`, so a later synonym/ontology upgrade can replace this
 * file without rewriting Pantry storage or Cheffy ranking.
 */

const ALIASES: Record<string, string> = {
  evoo: 'olive oil',
  'e v o o': 'olive oil',
  'ev olive oil': 'olive oil',
  'extra virgin olive oil': 'olive oil',
  'extra-virgin olive oil': 'olive oil',
  scallion: 'green onion',
  scallions: 'green onion',
  'green onions': 'green onion',
  'spring onion': 'green onion',
  'spring onions': 'green onion',
  cilantro: 'cilantro',
  coriander: 'cilantro'
};

const QTY_UNITS = new Set([
  'cup',
  'cups',
  'c',
  'tablespoon',
  'tablespoons',
  'tbsp',
  'tbs',
  'tb',
  'teaspoon',
  'teaspoons',
  'tsp',
  'ts',
  'ounce',
  'ounces',
  'oz',
  'pound',
  'pounds',
  'lb',
  'lbs',
  'gram',
  'grams',
  'g',
  'kilogram',
  'kilograms',
  'kg',
  'milliliter',
  'milliliters',
  'ml',
  'liter',
  'liters',
  'l',
  'clove',
  'cloves',
  'can',
  'cans',
  'bag',
  'bags',
  'bunch',
  'bunches',
  'package',
  'packages',
  'pkg',
  'pinch',
  'pinches',
  'dash',
  'dashes',
  'stick',
  'sticks',
  'head',
  'heads',
  'slice',
  'slices',
  'piece',
  'pieces'
]);

const MODIFIERS = new Set([
  'extra',
  'virgin',
  'cold-pressed',
  'coldpressed',
  'yellow',
  'white',
  'red',
  'green',
  'sweet',
  'large',
  'medium',
  'small',
  'fresh',
  'dried',
  'frozen',
  'canned',
  'ground',
  'whole',
  'boneless',
  'skinless',
  'organic',
  'chopped',
  'diced',
  'minced',
  'sliced',
  'grated',
  'shredded',
  'peeled',
  'cooked',
  'raw',
  'unsalted',
  'unsweetened',
  'lean',
  'ripe',
  'baby',
  'brown',
  'russet',
  'kosher',
  'crushed',
  'powdered',
  'all-purpose',
  'allpurpose',
  'low-fat',
  'lowfat',
  'fat-free',
  'fatfree',
  'free-range',
  'freerange'
]);

const IRREGULAR_SINGULARS: Record<string, string> = {
  tomatoes: 'tomato',
  potatoes: 'potato',
  leaves: 'leaf',
  berries: 'berry',
  cherries: 'cherry',
  strawberries: 'strawberry',
  blueberries: 'blueberry',
  raspberries: 'raspberry',
  cloves: 'clove',
  loaves: 'loaf',
  geese: 'goose',
  mice: 'mouse',
  children: 'child',
  people: 'person',
  teeth: 'tooth'
};

export function parseQuantityInput(raw: string): { quantity?: number; unit?: string } {
  const s = raw.trim();
  if (!s) return {};
  const match = s.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  if (!match) return { unit: s.slice(0, 24) };
  const quantity = parseFloat(match[1]);
  if (!Number.isFinite(quantity) || quantity <= 0) return { unit: s.slice(0, 24) };
  const unit = match[2].trim().slice(0, 24);
  return unit ? { quantity, unit } : { quantity };
}

export function singularizeToken(token: string): string {
  const irregular = IRREGULAR_SINGULARS[token];
  if (irregular) return irregular;
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith('oes') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('sses') || token.endsWith('ss')) return token;
  if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
}

function applyAlias(value: string): string {
  return ALIASES[value] || value;
}

/**
 * Collapse a free-text ingredient into a stable matching key.
 *
 * Examples:
 *   "Eggs" → "egg"
 *   "2 large eggs" → "egg"
 *   "Chicken breasts" → "chicken breast"
 *   "extra virgin olive oil" / "EVOO" → "olive oil"
 *   "yellow onion" → "onion"
 */
export function normalizeIngredientName(raw: string): string {
  if (!raw) return '';
  let s = raw.toLowerCase().trim();
  s = s.replace(/\s*\([^)]*\)\s*/g, ' ');
  s = s.replace(/[^\p{L}\p{N}\s-]+/gu, ' ');
  s = s.replace(/[-_]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return '';

  s = applyAlias(s);

  const tokens = s
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t && !MODIFIERS.has(t) && !/^\d+(\.\d+)?$/.test(t) && !QTY_UNITS.has(t))
    .map(singularizeToken)
    .filter(Boolean);

  s = tokens.join(' ');
  s = applyAlias(s);
  return s.trim();
}
