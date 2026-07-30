import { writable } from 'svelte/store';

/**
 * "Only Food" feed toggle — the member's own choice, persisted across reloads.
 *
 * Same shape as `hellthreadFilterSettings.ts` (a localStorage-backed writable),
 * with one deliberate difference: localStorage is guarded with
 * `typeof localStorage` instead of importing `browser` from
 * `$app/environment`, so this module stays importable under vitest, where the
 * `$app` alias is not available. `memories.ts` avoids that import for the same
 * reason and uses the same guard.
 *
 * The default is OFF. Following and Replies are a promise about *who*, not
 * about *what* — the member already filtered by choosing who to follow. The
 * Global Food tab carries the food promise in its own name and applies the
 * food test regardless of this setting (see `isFoodFilterActive` in
 * `FoodstrFeedOptimized.svelte`).
 */

const STORAGE_KEY = 'zapcooking_food_filter';
const DEFAULT_ENABLED = false;

function hasLocalStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

/**
 * Read the persisted setting. Anything other than the two values we write
 * (missing key, corrupt value, localStorage throwing) falls back to the
 * default rather than being coerced — `Boolean('false')` is `true`.
 */
export function readStoredFoodFilter(): boolean {
  if (!hasLocalStorage()) return DEFAULT_ENABLED;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch (error) {
    console.error('Failed to load food filter setting from localStorage:', error);
  }
  return DEFAULT_ENABLED;
}

function createFoodFilterStore() {
  const { subscribe, set } = writable<boolean>(readStoredFoodFilter());

  return {
    subscribe,
    setEnabled: (enabled: boolean) => {
      set(enabled);
      if (!hasLocalStorage()) return;
      try {
        localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
      } catch (error) {
        console.error('Failed to save food filter setting to localStorage:', error);
      }
    }
  };
}

export const foodFilterSetting = createFoodFilterStore();

export const FOOD_FILTER_STORAGE_KEY = STORAGE_KEY;
export const FOOD_FILTER_DEFAULT = DEFAULT_ENABLED;
