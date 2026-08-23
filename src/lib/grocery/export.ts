/**
 * Provider-ready grocery export.
 *
 * Zap owns the normalized shopping list. A future adapter (Instacart,
 * Walmart, etc.) should consume this shape rather than grocery-list
 * persistence or any retailer-specific fields. No adapters are
 * implemented here.
 */

import { canonicalizeGroceryCategory, type GroceryAisle } from './categories';
import { groceryConsolidationKey, type GroceryItemSource } from './consolidation';
import { isManualGroceryItem, type SnapshotListItem } from './requirements';

export interface NormalizedGroceryExportItem {
  name: string;
  normalizedName: string;
  quantity: string;
  quantityValue?: number;
  unit?: string;
  category: GroceryAisle;
  recipeSources: Array<{ recipeId: string; recipeTitle?: string }>;
  pantryStatus: 'need' | 'have' | 'overridden';
  userOverride: boolean;
  origin: 'manual' | 'recipe';
}

function uniqueRecipeSources(sources: GroceryItemSource[] | undefined, recipeId?: string) {
  const map = new Map<string, { recipeId: string; recipeTitle?: string }>();
  for (const source of sources || []) {
    if (!map.has(source.recipeId)) {
      map.set(source.recipeId, {
        recipeId: source.recipeId,
        recipeTitle: source.recipeTitle
      });
    }
  }
  if (recipeId && !map.has(recipeId)) {
    map.set(recipeId, { recipeId });
  }
  return [...map.values()];
}

export function toProviderItem(item: SnapshotListItem): NormalizedGroceryExportItem {
  const origin = isManualGroceryItem(item) ? 'manual' : 'recipe';
  return {
    name: item.name,
    normalizedName: item.normalizedName || groceryConsolidationKey(item.name),
    quantity: item.quantity,
    unit: item.unit,
    category: canonicalizeGroceryCategory(item.category, item.name),
    recipeSources: uniqueRecipeSources(item.sources, item.recipeId),
    pantryStatus: item.pantryOverride ? 'overridden' : 'need',
    userOverride: !!item.pantryOverride,
    origin
  };
}

export function toProviderList(items: SnapshotListItem[]): NormalizedGroceryExportItem[] {
  return items.filter((item) => !item.checked).map(toProviderItem);
}
