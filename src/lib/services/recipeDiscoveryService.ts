/**
 * Discover real Zap Cooking recipes for Cheffy meal planning.
 *
 * Reuses the same NDK filters as the planner's RecipePicker and Explore
 * (`kind:30023` + RECIPE_TAGS). Does not introduce a separate recipe DB.
 * Candidates are built from event tags plus the existing markdown parser.
 */

import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk';
import {
  RECIPE_TAG_PREFIX_LEGACY,
  RECIPE_TAG_PREFIX_NEW,
  RECIPE_TAGS,
  HIDDEN_RECIPE_COORDINATES,
  isHiddenRecipeCoordinate
} from '$lib/consts';
import { fetchMyAuthoredRecipeEvents } from '$lib/myRecipesPack';
import { offlineStorage, type CachedRecipe } from '$lib/offlineStorage';
import { extractRecipeDetails, validateMarkdownTemplate } from '$lib/parser';
import { parseIngredientsFromRecipe } from '$lib/utils/ingredientParser';
import { cookbookStore, cookbookLists } from '$lib/stores/cookbookStore';
import { get } from 'svelte/store';
import {
  MAX_INGREDIENTS_PER_CANDIDATE,
  MAX_TAGS_PER_CANDIDATE,
  MAX_TITLE_CHARS,
  isRecipeCoordinate,
  type RecipeCandidate,
  type RecipeSource
} from '$lib/mealplan/generation';

const RECIPE_KIND = 30023;
const EXPLORE_LIMIT = 150;
const EXPLORE_TIMEOUT_MS = 8000;
const FETCH_EVENT_TIMEOUT_MS = 8000;

const META_TAG_SKIP = new Set([RECIPE_TAG_PREFIX_NEW, RECIPE_TAG_PREFIX_LEGACY]);

export interface DiscoveredRecipe extends RecipeCandidate {
  image?: string;
}

function hasValidRecipeMarkdown(content: string | undefined): boolean {
  if (!content) return false;
  return typeof validateMarkdownTemplate(content) !== 'string';
}

function aTagFromEvent(event: NDKEvent): string | null {
  const dTag = event.tags?.find((t) => t[0] === 'd')?.[1] || '';
  if (!dTag || !event.pubkey) return null;
  const kind = event.kind || RECIPE_KIND;
  if (isHiddenRecipeCoordinate(kind, event.pubkey, dTag)) return null;
  const a = `${kind}:${event.pubkey}:${dTag}`;
  if (!isRecipeCoordinate(a)) return null;
  return a;
}

function tagValue(event: NDKEvent, name: string): string | undefined {
  const value = event.tags?.find((t) => t[0] === name)?.[1]?.trim();
  return value || undefined;
}

function recipeTags(event: NDKEvent): string[] {
  const tags = (event.tags || [])
    .filter((t) => t[0] === 't' && t[1] && !META_TAG_SKIP.has(t[1]))
    .map((t) => t[1].trim())
    .filter(Boolean);
  return uniqueTrim(tags, MAX_TAGS_PER_CANDIDATE);
}

function uniqueTrim(values: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v.slice(0, 80));
    if (out.length >= cap) break;
  }
  return out;
}

function ingredientNamesFromLines(lines: string[]): string[] {
  return uniqueTrim(
    lines.map((line) => {
      const cleaned = line.replace(/^[-*•]\s+/, '').trim();
      // Drop a leading quantity so Cheffy sees "chicken" not "2 lbs chicken".
      return cleaned.replace(
        /^\d[\d\s/.\-¼½¾⅓⅔⅛⅜⅝⅞]*\s*(?:cups?|tbsp|tsp|oz|lbs?|g|kg|ml|l|cloves?|cans?|slices?)?\s+/i,
        ''
      );
    }),
    MAX_INGREDIENTS_PER_CANDIDATE
  );
}

function ingredientsFromEvent(event: NDKEvent): string[] {
  const tagged: string[] = [];
  for (const tag of event.tags || []) {
    if (tag[0] !== 'ingredient') continue;
    if (tag.length >= 4) tagged.push(tag[3] || tag[1]);
    else if (tag.length >= 2) tagged.push(tag[1]);
  }
  if (tagged.length > 0) return ingredientNamesFromLines(tagged);
  if (event.content) {
    return ingredientNamesFromLines(
      parseIngredientsFromRecipe(event.content).map((p) => p.name || p.originalText)
    );
  }
  return [];
}

export function candidateFromEvent(event: NDKEvent): DiscoveredRecipe | null {
  const a = aTagFromEvent(event);
  if (!a) return null;
  const title = (tagValue(event, 'title') || a.split(':')[2] || 'Recipe').slice(0, MAX_TITLE_CHARS);
  const details = event.content ? extractRecipeDetails(event.content) : null;
  const candidate: DiscoveredRecipe = {
    a,
    title,
    tags: recipeTags(event),
    ingredients: ingredientsFromEvent(event),
    image: tagValue(event, 'image')
  };
  const prep = tagValue(event, 'prep_time') || details?.prepTime || undefined;
  const cook = tagValue(event, 'cook_time') || details?.cookTime || undefined;
  const servings = tagValue(event, 'servings') || details?.servings || undefined;
  if (prep) candidate.prepTime = prep;
  if (cook) candidate.cookTime = cook;
  if (servings) candidate.servings = servings;
  return candidate;
}

export function candidateFromCached(recipe: CachedRecipe): DiscoveredRecipe | null {
  if (!isRecipeCoordinate(recipe.id) || HIDDEN_RECIPE_COORDINATES.has(recipe.id)) return null;
  const details = recipe.content ? extractRecipeDetails(recipe.content) : null;
  const ingredients =
    recipe.ingredients?.length > 0
      ? ingredientNamesFromLines(recipe.ingredients)
      : recipe.content
        ? ingredientNamesFromLines(
            parseIngredientsFromRecipe(recipe.content).map((p) => p.name || p.originalText)
          )
        : [];
  const tags = uniqueTrim(
    (recipe.tags || []).filter((t) => t && !META_TAG_SKIP.has(t)),
    MAX_TAGS_PER_CANDIDATE
  );
  const candidate: DiscoveredRecipe = {
    a: recipe.id,
    title: (recipe.title || 'Recipe').slice(0, MAX_TITLE_CHARS),
    tags,
    ingredients,
    image: recipe.image
  };
  const prep = recipe.prepTime || details?.prepTime || undefined;
  const cook = recipe.cookTime || details?.cookTime || undefined;
  const servings = recipe.servings || details?.servings || undefined;
  if (prep) candidate.prepTime = prep;
  if (cook) candidate.cookTime = cook;
  if (servings) candidate.servings = servings;
  return candidate;
}

export function toWireCandidate(recipe: DiscoveredRecipe): RecipeCandidate {
  const wire: RecipeCandidate = {
    a: recipe.a,
    title: recipe.title,
    tags: recipe.tags,
    ingredients: recipe.ingredients
  };
  if (recipe.prepTime) wire.prepTime = recipe.prepTime;
  if (recipe.cookTime) wire.cookTime = recipe.cookTime;
  if (recipe.servings) wire.servings = recipe.servings;
  if (recipe.pantry) wire.pantry = recipe.pantry;
  if (recipe.nourish) wire.nourish = recipe.nourish;
  return wire;
}

/** Attach discovered recipe images onto generated meals for the preview only. */
export function attachDiscoveredImages<T extends { a: string }>(
  meals: T[],
  recipes: DiscoveredRecipe[]
): Array<T & { image?: string }> {
  const images = new Map<string, string>();
  for (const recipe of recipes) {
    if (recipe.image) images.set(recipe.a, recipe.image);
  }
  return meals.map((meal) => {
    const image = images.get(meal.a);
    return image ? { ...meal, image } : meal;
  });
}

async function resolveCoordinates(ndk: NDK, aTags: string[]): Promise<DiscoveredRecipe[]> {
  const unique = [
    ...new Set(aTags.filter((a) => isRecipeCoordinate(a) && !HIDDEN_RECIPE_COORDINATES.has(a)))
  ];
  if (unique.length === 0) return [];

  const byA = new Map<string, DiscoveredRecipe>();
  const cached = await offlineStorage.getRecipes(unique);
  for (const c of cached) {
    const candidate = candidateFromCached(c);
    if (candidate) byA.set(candidate.a, candidate);
  }

  const missing = unique.filter((a) => !byA.has(a));
  if (missing.length > 0 && ndk) {
    await Promise.all(
      missing.map(async (aTag) => {
        const parts = aTag.split(':');
        if (parts.length !== 3) return;
        const [kind, pubkey, identifier] = parts;
        try {
          const event = await Promise.race([
            ndk.fetchEvent({
              kinds: [Number(kind)],
              '#d': [identifier],
              authors: [pubkey]
            }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_EVENT_TIMEOUT_MS))
          ]);
          if (event) {
            const candidate = candidateFromEvent(event);
            if (candidate) {
              byA.set(candidate.a, candidate);
              offlineStorage.saveRecipeFromEvent(event).catch(() => {});
            }
          }
        } catch (err) {
          console.warn('[CheffyPlan] Failed to resolve', aTag, err);
        }
      })
    );
  }

  return unique.map((a) => byA.get(a)).filter((c): c is DiscoveredRecipe => !!c);
}

async function fetchExploreRecipeEvents(ndk: NDK, limit = EXPLORE_LIMIT): Promise<NDKEvent[]> {
  const filter: NDKFilter = {
    kinds: [RECIPE_KIND],
    '#t': RECIPE_TAGS,
    limit
  };
  const byA = new Map<string, NDKEvent>();

  await new Promise<void>((resolve) => {
    const subscription = ndk.subscribe(filter, { closeOnEose: true });
    const finish = () => {
      try {
        subscription.stop();
      } catch {
        // already stopped
      }
      resolve();
    };
    const timeout = setTimeout(finish, EXPLORE_TIMEOUT_MS);
    subscription.on('event', (event: NDKEvent) => {
      // Same markdown gate Explore / My Recipes use so Cheffy only
      // sees parseable Zap Cooking recipes, not arbitrary kind:30023.
      if (!hasValidRecipeMarkdown(event.content)) return;
      const a = aTagFromEvent(event);
      if (!a) return;
      const existing = byA.get(a);
      if (existing && (existing.created_at || 0) >= (event.created_at || 0)) return;
      byA.set(a, event);
    });
    subscription.on('eose', () => {
      clearTimeout(timeout);
      finish();
    });
  });

  return [...byA.values()];
}

async function loadMyRecipes(ndk: NDK, pubkey: string): Promise<DiscoveredRecipe[]> {
  const events = await fetchMyAuthoredRecipeEvents(ndk, pubkey);
  const out: DiscoveredRecipe[] = [];
  for (const event of events) {
    const candidate = candidateFromEvent(event);
    if (candidate) {
      out.push(candidate);
      offlineStorage.saveRecipeFromEvent(event).catch(() => {});
    }
  }
  return out;
}

async function loadSavedRecipes(ndk: NDK): Promise<DiscoveredRecipe[]> {
  const lists = get(cookbookLists);
  if (!lists.length) {
    await cookbookStore.load();
  }
  const seen = new Set<string>();
  const aTags: string[] = [];
  for (const list of get(cookbookLists)) {
    for (const a of list.recipes) {
      if (!seen.has(a)) {
        seen.add(a);
        aTags.push(a);
      }
    }
  }
  return resolveCoordinates(ndk, aTags);
}

async function loadExploreRecipes(ndk: NDK): Promise<DiscoveredRecipe[]> {
  const events = await fetchExploreRecipeEvents(ndk);
  const out: DiscoveredRecipe[] = [];
  for (const event of events) {
    const candidate = candidateFromEvent(event);
    if (candidate) {
      out.push(candidate);
      offlineStorage.saveRecipeFromEvent(event).catch(() => {});
    }
  }
  return out;
}

function mergeByA(groups: DiscoveredRecipe[][]): DiscoveredRecipe[] {
  const byA = new Map<string, DiscoveredRecipe>();
  for (const group of groups) {
    for (const recipe of group) {
      if (!byA.has(recipe.a)) byA.set(recipe.a, recipe);
    }
  }
  return [...byA.values()];
}

export async function discoverRecipesForPlanning(opts: {
  ndk: NDK;
  pubkey: string;
  source: RecipeSource;
}): Promise<DiscoveredRecipe[]> {
  const { ndk, pubkey, source } = opts;
  if (source === 'my-recipes') return loadMyRecipes(ndk, pubkey);
  if (source === 'saved') return loadSavedRecipes(ndk);
  if (source === 'explore') return loadExploreRecipes(ndk);

  const [mine, saved, explore] = await Promise.all([
    loadMyRecipes(ndk, pubkey).catch((err) => {
      console.warn('[CheffyPlan] My recipes failed', err);
      return [] as DiscoveredRecipe[];
    }),
    loadSavedRecipes(ndk).catch((err) => {
      console.warn('[CheffyPlan] Saved recipes failed', err);
      return [] as DiscoveredRecipe[];
    }),
    loadExploreRecipes(ndk).catch((err) => {
      console.warn('[CheffyPlan] Explore recipes failed', err);
      return [] as DiscoveredRecipe[];
    })
  ]);
  return mergeByA([mine, saved, explore]);
}
