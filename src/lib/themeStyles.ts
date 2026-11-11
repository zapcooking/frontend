export type ExploreStyleMode = 'light' | 'dark';

export interface ExploreStyle {
  value: string;
  label: string;
  /** Color modes the style can render. A single entry means the mode controls are inert. */
  modes: readonly ExploreStyleMode[];
  /**
   * Sats to unlock the theme permanently with a zap to the Zap Cooking profile.
   * Absent means the theme is free for everyone.
   */
  price?: number;
  /**
   * The gallery miniature's search-field copy, in the theme's own voice.
   * Absent falls back to 'Search recipes…'.
   */
  search?: string;
}

/** Every mood except Cast Iron, in picker order. Add new moods here. */
const MOODS: readonly ExploreStyle[] = [
  { value: 'original', label: 'Zap Original', modes: ['light', 'dark'] },
  { value: 'warm-kitchen', label: 'Warm Kitchen', modes: ['light', 'dark'], search: 'Search the kitchen…' },
  { value: 'after-hours', label: 'After Hours ’80s', modes: ['light', 'dark'], search: 'Search the mixtape…' },
  { value: 'recipe-club', label: 'Recipe Club ’90s', modes: ['light', 'dark'], search: 'Search the binder…' },
  { value: 'recipe-box', label: 'Recipe Box', modes: ['light', 'dark'], search: 'Search the recipe box…' },
  { value: 'corner-diner', label: 'Corner Diner', modes: ['light', 'dark'], price: 2100, search: 'Search the menu…' },
  { value: 'sunday-market', label: 'Farmers Market', modes: ['light', 'dark'], price: 2100, search: 'Search the market…' },
  { value: 'provence', label: 'Provence', modes: ['light', 'dark'], price: 2100, search: 'Search the lavender…' },
  { value: 'spice-route', label: 'Spice Route', modes: ['light', 'dark'], price: 2100, search: 'Search the caravan…' },
  { value: 'copper-bazaar', label: 'Copper Bazaar', modes: ['light', 'dark'], price: 5000, search: 'Search the bazaar…' },
  { value: 'izakaya', label: 'Izakaya', modes: ['light', 'dark'], price: 5000, search: 'Search the izakaya…' },
  { value: 'sakura', label: 'Sakura', modes: ['light', 'dark'], price: 5000, search: 'Search the blossoms…' },
  { value: 'espresso-bar', label: 'Espresso Bar', modes: ['light', 'dark'], price: 5000, search: 'Search the roast…' },
  { value: 'bbq', label: 'Backyard BBQ', modes: ['light', 'dark'], price: 5000, search: 'Search the pit…' }
];

/** Cast Iron always closes the picker, however many moods are added above it.
 * It is also the priciest theme; nothing above it may cost more. */
const CAST_IRON: ExploreStyle = {
  value: 'cast-iron',
  label: 'Cast Iron',
  modes: ['dark'],
  price: 10000,
  search: 'Search the skillet…'
};

/** Shared with static/appearance.js, whose allowlist is kept aligned by test. */
export const EXPLORE_STYLES: readonly ExploreStyle[] = [...MOODS, CAST_IRON];

export function findExploreStyle(value: string): ExploreStyle {
  return EXPLORE_STYLES.find((style) => style.value === value) ?? EXPLORE_STYLES[0];
}

/** True when anyone may use the style without unlocking it. */
export function isFreeStyle(value: string): boolean {
  const style = EXPLORE_STYLES.find((s) => s.value === value);
  return !!style && style.price === undefined;
}

/** Values of every style that needs an unlock. */
export const LOCKED_STYLE_VALUES: readonly string[] = EXPLORE_STYLES.filter(
  (style) => style.price !== undefined
).map((style) => style.value);

/**
 * Zap request tag naming the theme a zap unlocks: `['zapcooking_theme', value]`.
 * The receipt embeds the signed request, so the tag can't be added after payment.
 */
export const THEME_UNLOCK_TAG = 'zapcooking_theme';
