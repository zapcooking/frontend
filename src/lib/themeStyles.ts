export type ExploreStyleMode = 'light' | 'dark';

export interface ExploreStyle {
  value: string;
  label: string;
  /** Color modes the style can render. A single entry means the mode controls are inert. */
  modes: readonly ExploreStyleMode[];
}

/** Shared with static/appearance.js, whose allowlist is kept aligned by test. */
export const EXPLORE_STYLES: readonly ExploreStyle[] = [
  { value: 'original', label: 'Zap Original', modes: ['light', 'dark'] },
  { value: 'warm-kitchen', label: 'Warm Kitchen', modes: ['light', 'dark'] },
  { value: 'after-hours', label: 'After Hours ’80s', modes: ['light', 'dark'] },
  { value: 'recipe-club', label: 'Recipe Club ’90s', modes: ['light', 'dark'] },
  { value: 'recipe-box', label: 'Recipe Box', modes: ['light', 'dark'] },
  { value: 'corner-diner', label: 'Corner Diner', modes: ['light', 'dark'] },
  { value: 'sunday-market', label: 'Sunday Market', modes: ['light', 'dark'] },
  { value: 'cast-iron', label: 'Cast Iron', modes: ['dark'] },
  { value: 'copper-bazaar', label: 'Copper Bazaar', modes: ['light', 'dark'] },
  { value: 'izakaya', label: 'Izakaya', modes: ['light', 'dark'] },
  { value: 'sakura', label: 'Sakura', modes: ['light', 'dark'] },
  { value: 'provence', label: 'Provence', modes: ['light', 'dark'] },
  { value: 'spice-route', label: 'Spice Route', modes: ['light', 'dark'] },
  { value: 'tuscan-table', label: 'Tuscan Table', modes: ['light', 'dark'] },
  { value: 'espresso-bar', label: 'Espresso Bar', modes: ['light', 'dark'] }
];

export function findExploreStyle(value: string): ExploreStyle {
  return EXPLORE_STYLES.find((style) => style.value === value) ?? EXPLORE_STYLES[0];
}
