/**
 * Shared week grocery generation used by Meal Planner and Grocery
 * Planner retry. Recipe fetch stays here so requirements.ts remains
 * a pure snapshot/apply module.
 */

import { get } from 'svelte/store';
import { ndk } from '$lib/nostr';
import { isOnline } from '$lib/connectionMonitor';
import { offlineStorage } from '$lib/offlineStorage';
import { parseIngredientsFromRecipe } from '$lib/utils/ingredientParser';
import { groceryStore, groceryInitialized } from '$lib/stores/groceryStore';
import { plannerStore } from '$lib/stores/plannerStore';
import { pantryStore, pantryItems, pantryInitialized } from '$lib/stores/pantryStore';
import {
  collectWeekRecipeOccurrences,
  rowsFromRecipeLines
} from '$lib/mealplan/groceryGeneration';
import {
  buildGrocerySnapshot,
  unresolvedRecipeSources,
  type GrocerySnapshot,
  type UnresolvedRecipeSource
} from './requirements';

export interface WeekGroceryGeneration {
  snapshot: GrocerySnapshot;
  textSkipped: number;
  resolvedRecipeCount: number;
  unresolved: UnresolvedRecipeSource[];
}

export async function loadRecipeLinesByATag(aTags: string[]): Promise<Map<string, string[]>> {
  const linesByATag = new Map<string, string[]>();
  if (aTags.length === 0) return linesByATag;

  const cached = await offlineStorage.getRecipes(aTags);
  for (const recipe of cached) {
    if (recipe.ingredients?.length) {
      linesByATag.set(recipe.id, recipe.ingredients);
    } else if (recipe.content) {
      linesByATag.set(
        recipe.id,
        parseIngredientsFromRecipe(recipe.content).map((parsed) => parsed.originalText)
      );
    }
  }

  const missing = aTags.filter((a) => !linesByATag.has(a));
  const ndkInstance = get(ndk);
  if (missing.length === 0 || !get(isOnline) || !ndkInstance) {
    return linesByATag;
  }

  await Promise.all(
    missing.map(async (aTag) => {
      const parts = aTag.split(':');
      if (parts.length !== 3) return;
      const [kind, pubkey, identifier] = parts;
      try {
        const event = await ndkInstance.fetchEvent({
          kinds: [Number(kind)],
          '#d': [identifier],
          authors: [pubkey]
        });
        if (!event?.content) return;
        linesByATag.set(
          aTag,
          parseIngredientsFromRecipe(event.content).map((parsed) => parsed.originalText)
        );
        try {
          await offlineStorage.saveRecipeFromEvent(event);
        } catch {
          // Cache write is best-effort; the in-memory lines are enough.
        }
      } catch (error) {
        console.warn('[Grocery generate] Failed to fetch', aTag, error);
      }
    })
  );

  return linesByATag;
}

export async function generateWeekGrocerySnapshot(
  weekId: string
): Promise<WeekGroceryGeneration | null> {
  if (!get(groceryInitialized)) {
    await groceryStore.load();
  }
  if (!get(pantryInitialized)) {
    await pantryStore.load();
  }

  await plannerStore.ensureWeek(weekId);
  const week = get(plannerStore).weeks[weekId];
  if (!week || week.status !== 'ok') return null;

  const collected = collectWeekRecipeOccurrences(week.plan);
  const linesByATag = await loadRecipeLinesByATag(collected.aTags);
  const resolvedOccurrences = collected.occurrences.filter((occ) => linesByATag.has(occ.a));
  const rows = rowsFromRecipeLines(
    resolvedOccurrences.map((occ) => ({
      a: occ.a,
      title: occ.title,
      occurrenceId: occ.occurrenceId,
      lines: linesByATag.get(occ.a) || []
    }))
  );

  const existing = groceryStore.findListForWeek(weekId);
  const unresolved = unresolvedRecipeSources(collected.occurrences, linesByATag.keys());
  const snapshot = buildGrocerySnapshot(rows, get(pantryItems), {
    pantryOverrides: existing?.pantryOverrides,
    sourceWeekId: weekId,
    unresolvedRecipes: unresolved
  });

  return {
    snapshot,
    textSkipped: collected.textCount,
    resolvedRecipeCount: new Set(resolvedOccurrences.map((occ) => occ.a)).size,
    unresolved
  };
}
