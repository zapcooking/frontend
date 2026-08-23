/**
 * Build a pantry-aware grocery snapshot from consolidated recipe
 * requirements, and apply it to an existing list without duplicating
 * quantities or disturbing manual items.
 */

import { classifyIngredientAgainstPantry } from '$lib/pantry/matching';
import type { PantryItem } from '$lib/pantry/schema';
import {
  canonicalizeGroceryCategory,
  inferGroceryCategory,
  type GroceryAisle
} from './categories';
import {
  consolidateIngredients,
  groceryConsolidationKey,
  grocerySourceKey,
  recombineFromSources,
  type ConsolidatedIngredient,
  type ConsolidationRow,
  type GroceryItemSource
} from './consolidation';
import { DAY_KEYS, SLOT_KEYS, type MealPlan } from '$lib/mealplan/schema';

export type GroceryItemOrigin = 'manual' | 'recipe';

export interface GroceryRequirement {
  name: string;
  normalizedName: string;
  quantity: string;
  amount?: number;
  unit?: string;
  category: GroceryAisle;
  sources: GroceryItemSource[];
  pantryOverride?: boolean;
}

export interface GrocerySnapshot {
  toBuy: GroceryRequirement[];
  inPantry: GroceryRequirement[];
  stats: {
    totalIngredients: number;
    pantryCoveredCount: number;
    addedCount: number;
  };
  recipeLinks: string[];
  sourceWeekId?: string;
}

export interface SnapshotListItem {
  id: string;
  name: string;
  quantity: string;
  category: string;
  checked: boolean;
  recipeId?: string;
  addedAt: number;
  normalizedName?: string;
  unit?: string;
  origin?: GroceryItemOrigin;
  sources?: GroceryItemSource[];
  pantryOverride?: boolean;
}

export interface SnapshotList {
  id: string;
  title: string;
  items: SnapshotListItem[];
  recipeLinks: string[];
  notes?: string;
  pantryCovered?: GroceryRequirement[];
  pantryOverrides?: string[];
  sourceWeekId?: string;
  stats?: GrocerySnapshot['stats'];
  createdAt: number;
  updatedAt: number;
}

const MEAL_OCCURRENCE_RE =
  /^(mon|tue|wed|thu|fri|sat|sun):(breakfast|lunch|dinner|snack)$/;

export function isMealPlanOccurrence(occurrenceId: string): boolean {
  return MEAL_OCCURRENCE_RE.test(occurrenceId);
}

export function isManualGroceryItem(item: Pick<SnapshotListItem, 'origin' | 'recipeId' | 'sources'>): boolean {
  if (item.origin === 'manual') return true;
  if (item.origin === 'recipe') return false;
  if (item.recipeId || (item.sources && item.sources.length > 0)) return false;
  return true;
}

function requirementFromConsolidated(
  item: ConsolidatedIngredient,
  pantryOverride = false
): GroceryRequirement {
  return {
    name: item.name,
    normalizedName: item.normalizedName,
    quantity: item.quantity,
    amount: item.amount,
    unit: item.unit,
    category: item.category,
    sources: item.sources,
    pantryOverride: pantryOverride || undefined
  };
}

function toParsedIngredient(item: ConsolidatedIngredient) {
  return {
    name: item.name,
    quantity: item.quantity,
    category: 'other' as const,
    originalText: `${item.quantity} ${item.name}`.trim()
  };
}

export function buildGrocerySnapshot(
  rows: ConsolidationRow[],
  pantry: Array<Pick<PantryItem, 'name' | 'normalizedName' | 'quantity' | 'unit' | 'isStaple'>>,
  options?: { pantryOverrides?: string[]; sourceWeekId?: string }
): GrocerySnapshot {
  const consolidated = consolidateIngredients(rows);
  const overrides = new Set(
    (options?.pantryOverrides || []).map((n) => groceryConsolidationKey(n) || n)
  );

  const toBuy: GroceryRequirement[] = [];
  const inPantry: GroceryRequirement[] = [];

  for (const item of consolidated) {
    const status = classifyIngredientAgainstPantry(toParsedIngredient(item), pantry);
    const overridden = overrides.has(item.normalizedName);
    if (status === 'have' && !overridden) {
      inPantry.push(requirementFromConsolidated(item));
    } else {
      toBuy.push(requirementFromConsolidated(item, overridden && status === 'have'));
    }
  }

  const recipeLinks = [
    ...new Set(consolidated.flatMap((item) => item.sources.map((s) => s.recipeId)))
  ];

  return {
    toBuy,
    inPantry,
    stats: {
      totalIngredients: consolidated.length,
      pantryCoveredCount: inPantry.length,
      addedCount: toBuy.length
    },
    recipeLinks,
    sourceWeekId: options?.sourceWeekId
  };
}

function itemFromRequirement(
  req: GroceryRequirement,
  existing?: SnapshotListItem
): SnapshotListItem {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: existing?.id || createLocalId(),
    name: req.name,
    quantity: req.quantity,
    category: req.category,
    checked: existing?.checked ?? false,
    recipeId: req.sources[0]?.recipeId,
    addedAt: existing?.addedAt ?? now,
    normalizedName: req.normalizedName,
    unit: req.unit,
    origin: 'recipe',
    sources: req.sources,
    pantryOverride: req.pantryOverride
  };
}

function createLocalId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
}

function recipeItemKey(item: SnapshotListItem): string {
  return item.normalizedName || groceryConsolidationKey(item.name);
}

/**
 * Replace recipe-derived items with the snapshot. Manual items, checked
 * state, and item ids (matched by normalized name) are preserved.
 */
export function applySnapshotToList(list: SnapshotList, snapshot: GrocerySnapshot): SnapshotList {
  const manual = list.items.filter((item) => isManualGroceryItem(item));
  const existingRecipe = list.items.filter((item) => !isManualGroceryItem(item));
  const existingByKey = new Map(existingRecipe.map((item) => [recipeItemKey(item), item]));

  const recipeItems = snapshot.toBuy.map((req) =>
    itemFromRequirement(req, existingByKey.get(req.normalizedName))
  );

  const overrides = [
    ...new Set([
      ...(list.pantryOverrides || []),
      ...snapshot.toBuy.filter((r) => r.pantryOverride).map((r) => r.normalizedName)
    ])
  ];

  return {
    ...list,
    items: [...recipeItems, ...manual],
    recipeLinks: snapshot.recipeLinks,
    pantryCovered: snapshot.inPantry.length ? snapshot.inPantry : undefined,
    pantryOverrides: overrides.length ? overrides : undefined,
    sourceWeekId: snapshot.sourceWeekId ?? list.sourceWeekId,
    stats: snapshot.stats,
    updatedAt: Math.floor(Date.now() / 1000)
  };
}

/**
 * Merge recipe requirements into a list without dropping unrelated
 * recipe items. Same occurrence+recipe sources replace rather than add.
 */
export function mergeRequirementsIntoList(
  list: SnapshotList,
  requirements: GroceryRequirement[],
  pantryCovered: GroceryRequirement[] = []
): SnapshotList {
  const items = [...list.items];
  const recipeItems = items.filter((item) => !isManualGroceryItem(item));
  const manual = items.filter((item) => isManualGroceryItem(item));
  const byKey = new Map(recipeItems.map((item) => [recipeItemKey(item), item]));

  for (const req of requirements) {
    const existing = byKey.get(req.normalizedName);
    if (!existing) {
      const created = itemFromRequirement(req);
      byKey.set(req.normalizedName, created);
      continue;
    }
    const sourceMap = new Map(
      (existing.sources || []).map((s) => [grocerySourceKey(s), s])
    );
    for (const source of req.sources) {
      sourceMap.set(grocerySourceKey(source), source);
    }
    const sources = [...sourceMap.values()];
    const recombined = recombineFromSources(
      req.name,
      req.normalizedName,
      sources,
      req.category
    );
    byKey.set(req.normalizedName, {
      ...existing,
      name: recombined.name,
      quantity: recombined.quantity,
      unit: recombined.unit,
      category: recombined.category,
      sources,
      recipeId: sources[0]?.recipeId,
      origin: 'recipe',
      pantryOverride: existing.pantryOverride || req.pantryOverride
    });
  }

  const covered = [...(list.pantryCovered || [])];
  for (const item of pantryCovered) {
    const alreadyOnList = byKey.has(item.normalizedName);
    const alreadyCovered = covered.some((c) => c.normalizedName === item.normalizedName);
    if (!alreadyOnList && !alreadyCovered) covered.push(item);
  }

  const nextRecipe = [...byKey.values()];
  const recipeLinks = [
    ...new Set([
      ...list.recipeLinks,
      ...nextRecipe.flatMap((item) => (item.sources || []).map((s) => s.recipeId))
    ])
  ];

  return {
    ...list,
    items: [...nextRecipe, ...manual],
    recipeLinks,
    pantryCovered: covered.length ? covered : undefined,
    updatedAt: Math.floor(Date.now() / 1000)
  };
}

export function liveMealPlanSourceKeys(plan: MealPlan): Set<string> {
  const keys = new Set<string>();
  for (const day of DAY_KEYS) {
    const slots = plan.days[day]?.slots;
    if (!slots) continue;
    for (const slot of SLOT_KEYS) {
      const entry = slots[slot];
      if (entry?.type === 'recipe') {
        keys.add(`${day}:${slot}|${entry.a}`);
      }
    }
  }
  return keys;
}

function dropStaleFromSources(
  sources: GroceryItemSource[] | undefined,
  liveKeys: Set<string>
): GroceryItemSource[] {
  return (sources || []).filter((source) => {
    if (!isMealPlanOccurrence(source.occurrenceId)) return true;
    return liveKeys.has(grocerySourceKey(source));
  });
}

/**
 * Drop meal-plan sources that are no longer on the plan and recombine
 * remaining recipe quantities. Manual items are untouched.
 */
export function dropStaleSourcesFromList(list: SnapshotList, plan: MealPlan): SnapshotList {
  const liveKeys = liveMealPlanSourceKeys(plan);
  const nextItems: SnapshotListItem[] = [];

  for (const item of list.items) {
    if (isManualGroceryItem(item)) {
      nextItems.push(item);
      continue;
    }
    const sources = dropStaleFromSources(item.sources, liveKeys);
    if (sources.length === 0) {
      if (item.recipeId && !item.sources?.length) {
        // Legacy single-recipeId item: drop when that recipe is gone.
        const stillLinked = [...liveKeys].some((k) => k.endsWith(`|${item.recipeId}`));
        if (stillLinked) nextItems.push(item);
      }
      continue;
    }
    const normalizedName = item.normalizedName || groceryConsolidationKey(item.name);
    const category = canonicalizeGroceryCategory(item.category, item.name);
    const recombined = recombineFromSources(item.name, normalizedName, sources, category);
    nextItems.push({
      ...item,
      name: recombined.name,
      quantity: recombined.quantity,
      unit: recombined.unit,
      category: recombined.category,
      sources,
      recipeId: sources[0]?.recipeId,
      normalizedName
    });
  }

  const pantryCovered = (list.pantryCovered || [])
    .map((covered) => {
      const sources = dropStaleFromSources(covered.sources, liveKeys);
      if (covered.sources?.length && sources.length === 0) return null;
      if (!sources.length) return covered;
      const recombined = recombineFromSources(
        covered.name,
        covered.normalizedName,
        sources,
        covered.category
      );
      return {
        ...covered,
        name: recombined.name,
        quantity: recombined.quantity,
        unit: recombined.unit,
        sources
      };
    })
    .filter((item): item is GroceryRequirement => item != null);

  const recipeLinks = [
    ...new Set(nextItems.flatMap((item) => (item.sources || []).map((s) => s.recipeId).filter(Boolean)))
  ];

  const recipeCount = nextItems.filter((item) => !isManualGroceryItem(item)).length;

  return {
    ...list,
    items: nextItems,
    recipeLinks,
    pantryCovered: pantryCovered.length ? pantryCovered : undefined,
    stats: list.stats
      ? {
          ...list.stats,
          addedCount: recipeCount,
          pantryCoveredCount: pantryCovered.length,
          totalIngredients: recipeCount + pantryCovered.length
        }
      : undefined,
    updatedAt: Math.floor(Date.now() / 1000)
  };
}

export function movePantryCoveredToList(
  list: SnapshotList,
  index: number
): { list: SnapshotList; added: SnapshotListItem | null } {
  const pantryCovered = [...(list.pantryCovered || [])];
  const covered = pantryCovered[index];
  if (!covered) return { list, added: null };

  pantryCovered.splice(index, 1);
  const key = covered.normalizedName || groceryConsolidationKey(covered.name);
  const overrides = [...new Set([...(list.pantryOverrides || []), key])];
  const req: GroceryRequirement = {
    ...covered,
    normalizedName: key,
    category: covered.category || inferGroceryCategory(covered.name),
    pantryOverride: true
  };

  const merged = mergeRequirementsIntoList(
    { ...list, pantryCovered: pantryCovered.length ? pantryCovered : undefined, pantryOverrides: overrides },
    [req],
    []
  );

  const added =
    merged.items.find((item) => (item.normalizedName || groceryConsolidationKey(item.name)) === key) ||
    null;

  return { list: { ...merged, pantryOverrides: overrides }, added };
}

export function overrideKeysFromList(list: SnapshotList): string[] {
  return list.pantryOverrides || [];
}
