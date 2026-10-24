/**
 * Conservative grocery ingredient consolidation.
 *
 * Merges obvious duplicates (onion/onions, chicken breast/breasts,
 * parmesan/parmesan cheese) and keeps meaningfully distinct items
 * (red vs yellow vs green onion) separate. Quantity combining is
 * delegated to `units.ts`.
 */

import { singularizeToken } from '$lib/pantry/normalization';
import { combineQuantities } from './units';
import { inferGroceryCategory, type GroceryAisle } from './categories';

export interface GroceryItemSource {
  recipeId: string;
  recipeTitle?: string;
  /** Meal-plan slot (`mon:dinner`) or `recipe:<a-tag>` for recipe-page adds. */
  occurrenceId: string;
  quantity: string;
  originalName?: string;
}

export interface ConsolidationRow {
  ingredient: { name: string; quantity: string };
  recipeId: string;
  recipeTitle?: string;
  occurrenceId: string;
}

export interface ConsolidatedIngredient {
  name: string;
  normalizedName: string;
  quantity: string;
  amount?: number;
  unit?: string;
  category: GroceryAisle;
  sources: GroceryItemSource[];
}

const PREP_STRIP = new Set([
  'chopped',
  'diced',
  'minced',
  'sliced',
  'grated',
  'shredded',
  'peeled',
  'cooked',
  'packed',
  'sifted',
  'softened',
  'melted',
  'beaten',
  'divided',
  'optional',
  'fresh',
  'organic',
  'ripe',
  'lean',
  'large',
  'medium',
  'small',
  'extra',
  'virgin'
]);

/** Color / form words that distinguish grocery items. */
const DISTINGUISHING = new Set([
  'yellow',
  'white',
  'red',
  'green',
  'brown',
  'purple',
  'ground',
  'whole',
  'dried',
  'frozen',
  'canned',
  'boneless',
  'skinless'
]);

const DEFAULT_VARIETY = new Set(['yellow', 'white']);

const NAME_ALIASES: Record<string, string> = {
  'parmesan cheese': 'parmesan',
  parmigiano: 'parmesan',
  'parmigiano reggiano': 'parmesan',
  'cheddar cheese': 'cheddar',
  'mozzarella cheese': 'mozzarella',
  'swiss cheese': 'swiss',
  'provolone cheese': 'provolone',
  'asiago cheese': 'asiago',
  'pecorino cheese': 'pecorino',
  'romano cheese': 'romano',
  scallion: 'green onion',
  scallions: 'green onion',
  'spring onion': 'green onion',
  'spring onions': 'green onion',
  evoo: 'olive oil',
  'extra virgin olive oil': 'olive oil'
};

function applyAlias(value: string): string {
  return NAME_ALIASES[value] || value;
}

/**
 * Matching key for grocery consolidation. Keeps distinguishing modifiers
 * (color, ground, dried) that pantry matching may strip.
 */
export function groceryConsolidationKey(raw: string): string {
  if (!raw) return '';
  let s = raw.toLowerCase().trim();
  s = s.replace(/\s*\([^)]*\)\s*/g, ' ');
  s = s.replace(/[^\p{L}\p{N}\s-]+/gu, ' ');
  s = s.replace(/[-_]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/\s+to taste$/i, '').trim();
  if (!s) return '';
  s = applyAlias(s);

  const tokens = s
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t && !PREP_STRIP.has(t) && !/^\d+(\.\d+)?$/.test(t))
    .map(singularizeToken)
    .filter(Boolean);

  s = applyAlias(tokens.join(' '));
  return s.trim();
}

export function titleCaseIngredient(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function pickDisplayName(originalNames: string[], key: string): string {
  const cleaned = originalNames
    .map((n) => n.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const specific = cleaned.reduce((best, name) => (name.length > best.length ? name : best), '');
  if (specific && specific.length >= key.length && !/^[A-Z0-9]{2,}$/.test(specific)) {
    return titleCaseIngredient(specific);
  }
  return titleCaseIngredient(key);
}

export function grocerySourceKey(source: Pick<GroceryItemSource, 'occurrenceId' | 'recipeId'>): string {
  return `${source.occurrenceId}|${source.recipeId}`;
}

function mergeSources(groups: ConsolidatedIngredient[]): GroceryItemSource[] {
  const map = new Map<string, GroceryItemSource>();
  for (const group of groups) {
    for (const source of group.sources) {
      map.set(grocerySourceKey(source), source);
    }
  }
  return [...map.values()];
}

/**
 * Absorb a generic headword ("onion") into a single default-variety
 * specific group ("yellow onion") when that merge is unambiguous.
 * Red / green onion stay distinct; generic "onion" is not merged into
 * them, and is left separate when more than one default variety exists.
 */
function absorbGenericVarieties(groups: Map<string, ConsolidatedIngredient>): void {
  for (const [key, generic] of [...groups.entries()]) {
    if (key.includes(' ')) continue;
    const defaultMatches: string[] = [];
    const otherMatches: string[] = [];
    for (const candidate of groups.keys()) {
      if (candidate === key) continue;
      const tokens = candidate.split(' ');
      if (tokens.length === 2 && tokens[1] === key) {
        if (DEFAULT_VARIETY.has(tokens[0])) defaultMatches.push(candidate);
        else if (DISTINGUISHING.has(tokens[0])) otherMatches.push(candidate);
      }
    }
    if (defaultMatches.length === 1 && otherMatches.length === 0) {
      const target = groups.get(defaultMatches[0]);
      if (!target) continue;
      const merged = mergeConsolidated([target, generic]);
      groups.set(defaultMatches[0], merged);
      groups.delete(key);
    }
  }
}

function mergeConsolidated(items: ConsolidatedIngredient[]): ConsolidatedIngredient {
  const sources = mergeSources(items);
  const combined = combineQuantities(sources.map((s) => s.quantity));
  const names = items.flatMap((item) => [
    item.name,
    ...item.sources.map((s) => s.originalName || item.name)
  ]);
  const key = items[0].normalizedName;
  return {
    name: pickDisplayName(names, key),
    normalizedName: key,
    quantity: combined.display,
    amount: combined.amount,
    unit: combined.unit,
    category: items[0].category,
    sources
  };
}

export function consolidateIngredients(rows: ConsolidationRow[]): ConsolidatedIngredient[] {
  const groups = new Map<string, ConsolidatedIngredient>();

  for (const row of rows) {
    const key = groceryConsolidationKey(row.ingredient.name);
    if (!key) continue;
    const source: GroceryItemSource = {
      recipeId: row.recipeId,
      recipeTitle: row.recipeTitle,
      occurrenceId: row.occurrenceId,
      quantity: row.ingredient.quantity || '',
      originalName: row.ingredient.name
    };
    const existing = groups.get(key);
    if (!existing) {
      const combined = combineQuantities([source.quantity]);
      groups.set(key, {
        name: pickDisplayName([row.ingredient.name], key),
        normalizedName: key,
        quantity: combined.display,
        amount: combined.amount,
        unit: combined.unit,
        category: inferGroceryCategory(row.ingredient.name),
        sources: [source]
      });
      continue;
    }
    groups.set(
      key,
      mergeConsolidated([
        existing,
        {
          name: row.ingredient.name,
          normalizedName: key,
          quantity: source.quantity,
          category: existing.category,
          sources: [source]
        }
      ])
    );
  }

  absorbGenericVarieties(groups);

  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function recombineFromSources(
  name: string,
  normalizedName: string,
  sources: GroceryItemSource[],
  category: GroceryAisle
): ConsolidatedIngredient {
  const combined = combineQuantities(sources.map((s) => s.quantity));
  return {
    name: pickDisplayName(
      [name, ...sources.map((s) => s.originalName || name)],
      normalizedName
    ),
    normalizedName,
    quantity: combined.display,
    amount: combined.amount,
    unit: combined.unit,
    category,
    sources
  };
}
