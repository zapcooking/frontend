import { writable } from 'svelte/store';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { isValidImageUrl } from './placeholderImages';

/**
 * "Hide recipes without images" — the member's own choice, persisted across
 * reloads.
 *
 * Same shape as `foodFilterSettings.ts` (a localStorage-backed writable), with
 * the same `typeof localStorage` guard so the module stays importable under
 * vitest, where `$app/environment` is not available.
 *
 * Default is ON: recipe grids show only recipes with a usable cover image by
 * default. When ON, grids drop events that carry no `image` tag, and cards
 * whose cover image fails to load are removed at render time (see RecipeCard +
 * lazyLoad). Toggled from the recipes page header and Settings → Content
 * Filters — both control the same setting.
 */

const STORAGE_KEY = 'zapcooking_hide_imageless_recipes';
const DEFAULT_ENABLED = true;

function hasLocalStorage(): boolean {
  // Accessing `localStorage` (not just getItem) can throw SecurityError in
  // restricted contexts — same guard as `foodFilterSettings.ts`.
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * Read the persisted setting. Anything other than the two values we write
 * (missing key, corrupt value, localStorage throwing) falls back to the
 * default rather than being coerced — `Boolean('false')` is `true`.
 */
export function readStoredHideImagelessRecipes(): boolean {
  if (!hasLocalStorage()) return DEFAULT_ENABLED;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch (error) {
    console.error('Failed to load image filter setting from localStorage:', error);
  }
  return DEFAULT_ENABLED;
}

function createHideImagelessRecipesStore() {
  const { subscribe, set } = writable<boolean>(readStoredHideImagelessRecipes());

  return {
    subscribe,
    setEnabled: (enabled: boolean) => {
      set(enabled);
      if (!hasLocalStorage()) return;
      try {
        localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
      } catch (error) {
        console.error('Failed to save image filter setting to localStorage:', error);
      }
    }
  };
}

export const hideImagelessRecipesSetting = createHideImagelessRecipesStore();

export const HIDE_IMAGELESS_RECIPES_STORAGE_KEY = STORAGE_KEY;
export const HIDE_IMAGELESS_RECIPES_DEFAULT = DEFAULT_ENABLED;

/**
 * Whether a recipe event carries a usable cover image. The `image` tag is the
 * only source RecipeCard renders, so it is the only thing counted here;
 * content-embedded images are not considered. URLs matching known-broken
 * patterns (host error pages captured into the tag) count as imageless.
 */
export function hasRecipeImage(event: NDKEvent): boolean {
  const url = event.tags.find((t) => t[0] === 'image')?.[1];
  return isValidImageUrl(url);
}
