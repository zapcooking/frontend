/**
 * Conservative grocery quantity parsing and combining.
 *
 * Only converts units that are unambiguously in the same family
 * (volume, weight, or count). Mixed units such as cloves vs heads
 * are preserved side-by-side instead of inventing a number.
 */

export type QuantityFamily = 'volume' | 'weight' | 'count' | 'other';

const FRACTION_MAP: Record<string, string> = {
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

function normalizeFraction(text: string): string {
  let result = text;
  for (const [fraction, replacement] of Object.entries(FRACTION_MAP)) {
    result = result.replace(new RegExp(fraction, 'g'), replacement);
  }
  return result;
}

export interface ParsedGroceryQuantity {
  amount: number;
  unit: string;
  family: QuantityFamily;
}

export interface CombinedQuantity {
  display: string;
  parts: ParsedGroceryQuantity[];
  /** Present when the combined result is a single comparable amount. */
  amount?: number;
  unit?: string;
}

interface UnitDef {
  aliases: string[];
  canon: string;
  family: QuantityFamily;
  /** Size in the family's base unit (tsp for volume, oz for weight). */
  factor?: number;
}

const UNITS: UnitDef[] = [
  {
    aliases: ['fluid ounces', 'fluid ounce', 'fl. oz', 'fl oz', 'floz'],
    canon: 'fl oz',
    family: 'volume',
    factor: 6
  },
  {
    aliases: ['tablespoons', 'tablespoon', 'tbsps', 'tbsp', 'tbs', 'tb'],
    canon: 'tbsp',
    family: 'volume',
    factor: 3
  },
  {
    aliases: ['teaspoons', 'teaspoon', 'tsps', 'tsp', 'ts'],
    canon: 'tsp',
    family: 'volume',
    factor: 1
  },
  { aliases: ['cups', 'cup', 'c'], canon: 'cup', family: 'volume', factor: 48 },
  { aliases: ['pints', 'pint', 'pt'], canon: 'pint', family: 'volume', factor: 96 },
  { aliases: ['quarts', 'quart', 'qt'], canon: 'quart', family: 'volume', factor: 192 },
  { aliases: ['milliliters', 'milliliter', 'mls', 'ml'], canon: 'ml', family: 'volume', factor: 0.202884 },
  { aliases: ['liters', 'liter', 'l'], canon: 'l', family: 'volume', factor: 202.884 },
  { aliases: ['pounds', 'pound', 'lbs', 'lb'], canon: 'lb', family: 'weight', factor: 16 },
  { aliases: ['ounces', 'ounce', 'oz'], canon: 'oz', family: 'weight', factor: 1 },
  { aliases: ['kilograms', 'kilogram', 'kgs', 'kg'], canon: 'kg', family: 'weight', factor: 35.27396 },
  { aliases: ['grams', 'gram', 'gs', 'g'], canon: 'g', family: 'weight', factor: 0.03527396 },
  { aliases: ['pieces', 'piece', 'pcs', 'pc', 'count'], canon: '', family: 'count' },
  { aliases: ['large', 'medium', 'small'], canon: '', family: 'count' },
  { aliases: ['cloves', 'clove'], canon: 'clove', family: 'other' },
  { aliases: ['heads', 'head', 'bulb', 'bulbs'], canon: 'head', family: 'other' },
  { aliases: ['bunches', 'bunch'], canon: 'bunch', family: 'other' },
  { aliases: ['cans', 'can'], canon: 'can', family: 'other' },
  { aliases: ['jars', 'jar'], canon: 'jar', family: 'other' },
  { aliases: ['bags', 'bag'], canon: 'bag', family: 'other' },
  { aliases: ['packages', 'package', 'pkgs', 'pkg'], canon: 'package', family: 'other' },
  { aliases: ['sticks', 'stick'], canon: 'stick', family: 'other' },
  { aliases: ['slices', 'slice'], canon: 'slice', family: 'other' },
  { aliases: ['sprigs', 'sprig'], canon: 'sprig', family: 'other' },
  { aliases: ['stalks', 'stalk'], canon: 'stalk', family: 'other' },
  { aliases: ['pinches', 'pinch'], canon: 'pinch', family: 'other' },
  { aliases: ['dashes', 'dash'], canon: 'dash', family: 'other' }
];

const ALIAS_LOOKUP: Array<{ alias: string; def: UnitDef }> = UNITS.flatMap((def) =>
  def.aliases
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((alias) => ({ alias, def }))
).sort((a, b) => b.alias.length - a.alias.length);

const NUMBER_RE = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)/;

function parseNumberToken(raw: string): number | null {
  const text = raw.trim();
  const mixed = text.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const num = Number(mixed[2]);
    const den = Number(mixed[3]);
    if (den === 0) return null;
    return whole + num / den;
  }
  const frac = text.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const den = Number(frac[2]);
    if (den === 0) return null;
    return Number(frac[1]) / den;
  }
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function matchUnit(raw: string): { def: UnitDef; rest: string } | null {
  const text = raw.trim().toLowerCase().replace(/\.$/, '');
  if (!text) return null;
  for (const { alias, def } of ALIAS_LOOKUP) {
    if (text === alias || text.startsWith(`${alias} `) || text.startsWith(`${alias}s`)) {
      return { def, rest: text.slice(alias.length).trim() };
    }
    if (text.endsWith('s') && text.slice(0, -1) === alias) {
      return { def, rest: '' };
    }
  }
  return null;
}

export function parseGroceryQuantity(raw: string): ParsedGroceryQuantity | null {
  const text = normalizeFraction((raw || '').trim());
  if (!text) return null;
  const numMatch = text.match(NUMBER_RE);
  if (!numMatch) return null;
  const amount = parseNumberToken(numMatch[1]);
  if (amount == null) return null;
  const rest = text.slice(numMatch[0].length).trim();
  if (!rest) return { amount, unit: '', family: 'count' };
  const matched = matchUnit(rest);
  if (!matched) {
    const unit = rest.slice(0, 24);
    return { amount, unit, family: 'other' };
  }
  return { amount, unit: matched.def.canon, family: matched.def.family };
}

function unitFactor(unit: string, family: QuantityFamily): number | undefined {
  if (family === 'count') return 1;
  const def = UNITS.find((u) => u.canon === unit && u.family === family);
  return def?.factor;
}

function canConvert(a: ParsedGroceryQuantity, b: ParsedGroceryQuantity): boolean {
  if (a.family !== b.family) return false;
  if (a.family === 'other') return a.unit === b.unit;
  if (a.family === 'count') return true;
  return unitFactor(a.unit, a.family) != null && unitFactor(b.unit, b.family) != null;
}

function toBase(q: ParsedGroceryQuantity): number | null {
  if (q.family === 'count') return q.amount;
  if (q.family === 'other') return q.amount;
  const factor = unitFactor(q.unit, q.family);
  if (factor == null) return null;
  return q.amount * factor;
}

const VOLUME_PREFERENCE = ['cup', 'tbsp', 'tsp', 'fl oz', 'pint', 'quart', 'ml', 'l'];
const WEIGHT_PREFERENCE = ['lb', 'oz', 'kg', 'g'];

function pickDisplayUnit(family: QuantityFamily, unitsUsed: string[], baseAmount: number): string {
  if (family === 'count') return '';
  if (family === 'other') return unitsUsed[0] || '';

  const preference = family === 'volume' ? VOLUME_PREFERENCE : WEIGHT_PREFERENCE;
  const uniqueUsed = [...new Set(unitsUsed.filter(Boolean))];
  if (uniqueUsed.length === 1) return uniqueUsed[0];

  for (const unit of preference) {
    const factor = unitFactor(unit, family);
    if (factor == null) continue;
    const converted = baseAmount / factor;
    if (converted >= 1 && uniqueUsed.includes(unit)) return unit;
  }
  for (const unit of preference) {
    const factor = unitFactor(unit, family);
    if (factor == null) continue;
    const converted = baseAmount / factor;
    if (converted >= 1) return unit;
  }
  return uniqueUsed[0] || preference[preference.length - 1];
}

function formatAmount(amount: number): string {
  const rounded = Math.round(amount * 1000) / 1000;
  const nearest = Math.round(rounded);
  if (Math.abs(rounded - nearest) < 0.001) return String(nearest);

  const fractions: Array<[number, string]> = [
    [0.25, '1/4'],
    [1 / 3, '1/3'],
    [0.5, '1/2'],
    [2 / 3, '2/3'],
    [0.75, '3/4']
  ];
  const whole = Math.floor(rounded);
  const frac = rounded - whole;
  for (const [value, label] of fractions) {
    if (Math.abs(frac - value) < 0.02) {
      return whole > 0 ? `${whole} ${label}` : label;
    }
  }
  return String(Math.round(rounded * 100) / 100);
}

export function formatGroceryQuantity(amount: number, unit: string): string {
  const amountText = formatAmount(amount);
  if (!unit) return amountText;
  const plural =
    Math.abs(amount - 1) > 0.001 &&
    !['oz', 'lb', 'g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'fl oz'].includes(unit) &&
    !unit.endsWith('s')
      ? `${unit}s`
      : unit;
  return `${amountText} ${plural}`;
}

function combineGroup(group: ParsedGroceryQuantity[]): ParsedGroceryQuantity | null {
  if (group.length === 0) return null;
  if (group.length === 1) return group[0];
  const family = group[0].family;
  let base = 0;
  for (const part of group) {
    const value = toBase(part);
    if (value == null) return null;
    base += value;
  }
  const unit = pickDisplayUnit(
    family,
    group.map((p) => p.unit),
    base
  );
  const factor = family === 'count' || family === 'other' ? 1 : unitFactor(unit, family);
  if (factor == null) return null;
  return { amount: base / factor, unit, family };
}

/**
 * Combine quantity strings. Compatible units are summed; incompatible
 * units become a joined display like "3 cloves + 1 head".
 */
export function combineQuantities(quantityTexts: string[]): CombinedQuantity {
  const parsed: ParsedGroceryQuantity[] = [];
  const unparsed: string[] = [];
  for (const text of quantityTexts) {
    const trimmed = (text || '').trim();
    if (!trimmed) continue;
    const qty = parseGroceryQuantity(trimmed);
    if (qty) parsed.push(qty);
    else unparsed.push(trimmed);
  }

  if (parsed.length === 0 && unparsed.length === 0) {
    return { display: '', parts: [] };
  }

  const groups: ParsedGroceryQuantity[][] = [];
  for (const qty of parsed) {
    const existing = groups.find((g) => canConvert(g[0], qty));
    if (existing) existing.push(qty);
    else groups.push([qty]);
  }

  const combinedParts: ParsedGroceryQuantity[] = [];
  for (const group of groups) {
    const combined = combineGroup(group);
    if (combined) combinedParts.push(combined);
    else combinedParts.push(...group);
  }

  const displayParts = [
    ...combinedParts.map((p) => formatGroceryQuantity(p.amount, p.unit)),
    ...unparsed
  ];
  const display = displayParts.join(' + ');

  if (combinedParts.length === 1 && unparsed.length === 0) {
    return {
      display,
      parts: combinedParts,
      amount: combinedParts[0].amount,
      unit: combinedParts[0].unit
    };
  }
  return { display, parts: combinedParts };
}
