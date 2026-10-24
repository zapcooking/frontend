/**
 * Cheffy meal-planning modes — weighted preferences on the existing
 * planner, not separate planners. Types, ranking signals, prompt copy,
 * and lightweight plan feedback live here so we can add modes later
 * without redesigning generation.
 */

import { normalizeIngredientName } from '$lib/pantry/normalization';

export const PLANNING_MODE_KEYS = [
  'usePantry',
  'budgetFriendly',
  'healthy',
  'highProtein',
  'quickMeals',
  'lowWaste',
  'adventurous'
] as const;

export type PlanningModeKey = (typeof PLANNING_MODE_KEYS)[number];

export interface PlanningPreferences {
  usePantry: boolean;
  budgetFriendly: boolean;
  healthy: boolean;
  highProtein: boolean;
  quickMeals: boolean;
  lowWaste: boolean;
  adventurous: boolean;
}

export interface CandidateNourish {
  /** Nourish overall, 0–10. Omitted when no cached score exists. */
  overall?: number;
  /** Nourish protein dimension, 0–10. */
  protein?: number;
  /** Estimated grams of protein per serving, when macros exist. */
  proteinGrams?: number;
}

export interface ModeScorable {
  a: string;
  title: string;
  tags: string[];
  ingredients: string[];
  pantry?: { matchRatio: number; totalCount: number };
  nourish?: CandidateNourish;
}

export const PLANNING_MODES: readonly {
  key: PlanningModeKey;
  label: string;
  shortLabel: string;
}[] = [
  { key: 'usePantry', label: 'Use My Pantry', shortLabel: 'Pantry' },
  { key: 'budgetFriendly', label: 'Keep It Cheap', shortLabel: 'Cheap' },
  { key: 'healthy', label: 'Healthy Week', shortLabel: 'Healthy' },
  { key: 'highProtein', label: 'High Protein', shortLabel: 'High Protein' },
  { key: 'quickMeals', label: 'Quick Meals', shortLabel: 'Quick' },
  { key: 'lowWaste', label: 'Low Waste', shortLabel: 'Low Waste' },
  { key: 'adventurous', label: 'Try Something New', shortLabel: 'New' }
] as const;

export const QUICK_TARGET_MINUTES = 30;
export const QUICK_SOFT_MAX_MINUTES = 45;
export const QUICK_OBVIOUS_LONG_MINUTES = 90;

const STORAGE_KEY = 'zap.cheffy.planningModes';
const MODE_KEY_SET = new Set<string>(PLANNING_MODE_KEYS);

const CHEAP_SIGNALS = [
  'bean',
  'lentil',
  'chickpea',
  'egg',
  'tofu',
  'rice',
  'pasta',
  'noodle',
  'oat',
  'potato',
  'onion',
  'carrot',
  'cabbage',
  'tomato',
  'garlic',
  'chicken',
  'turkey',
  'tuna',
  'sardine',
  'peanut',
  'black bean',
  'pinto',
  'kidney bean'
];

const PRICEY_SIGNALS = [
  'lobster',
  'scallop',
  'filet',
  'fillet mignon',
  'ribeye',
  'wagyu',
  'truffle',
  'saffron',
  'prosciutto',
  'pine nut',
  'crab',
  'oyster',
  'caviar',
  'foie',
  'veal',
  'lamb chop',
  'duck breast',
  'halibut',
  'sea bass',
  'shrimp',
  'prawn',
  'asparagus',
  'artichoke',
  'goat cheese',
  'manchego',
  'pecorino'
];

const PROTEIN_SIGNALS = [
  'chicken',
  'turkey',
  'beef',
  'pork',
  'tofu',
  'tempeh',
  'egg',
  'yogurt',
  'greek yogurt',
  'cottage cheese',
  'lentil',
  'bean',
  'chickpea',
  'salmon',
  'tuna',
  'cod',
  'shrimp',
  'fish',
  'steak',
  'protein'
];

const HEALTHY_SIGNALS = [
  'vegetable',
  'salad',
  'grain',
  'bowl',
  'lentil',
  'bean',
  'broccoli',
  'spinach',
  'kale',
  'quinoa',
  'oat',
  'yogurt',
  'berry',
  'avocado',
  'nourish',
  'healthy',
  'whole grain'
];

const CUISINE_TAGS = [
  'italian',
  'mexican',
  'tex-mex',
  'thai',
  'indian',
  'japanese',
  'korean',
  'chinese',
  'mediterranean',
  'greek',
  'french',
  'vietnamese',
  'spanish',
  'middle eastern',
  'lebanese',
  'moroccan',
  'ethiopian',
  'caribbean',
  'cajun',
  'american',
  'southern',
  'german',
  'peruvian',
  'brazilian',
  'filipino',
  'indonesian',
  'turkish',
  'persian'
];

/** Salt / water / plain oil — reuse is real but not a useful user metric. */
const FEEDBACK_STAPLES = new Set([
  'salt',
  'pepper',
  'black pepper',
  'water',
  'oil',
  'olive oil',
  'vegetable oil',
  'cooking spray'
]);

const PROTEIN_VARIETY_SOURCES = [
  'chicken',
  'turkey',
  'beef',
  'pork',
  'fish',
  'salmon',
  'tuna',
  'shrimp',
  'tofu',
  'tempeh',
  'egg',
  'lentil',
  'bean',
  'yogurt'
];

export function emptyPlanningPreferences(): PlanningPreferences {
  return {
    usePantry: false,
    budgetFriendly: false,
    healthy: false,
    highProtein: false,
    quickMeals: false,
    lowWaste: false,
    adventurous: false
  };
}

export function isPlanningModeKey(value: unknown): value is PlanningModeKey {
  return typeof value === 'string' && MODE_KEY_SET.has(value);
}

export function sanitizePlanningPreferences(raw: unknown): PlanningPreferences {
  const prefs = emptyPlanningPreferences();
  if (!raw || typeof raw !== 'object') return prefs;
  const src = raw as Record<string, unknown>;
  for (const key of PLANNING_MODE_KEYS) {
    if (src[key] === true) prefs[key] = true;
  }
  return prefs;
}

/** Merge wire prefs with the older prioritizePantry flag. */
export function normalizePlanningPreferences(
  raw?: Partial<PlanningPreferences> | null,
  prioritizePantry?: boolean
): PlanningPreferences {
  const prefs = sanitizePlanningPreferences(raw ?? {});
  if (prioritizePantry) prefs.usePantry = true;
  return prefs;
}

export function hasEnabledPlanningMode(prefs: PlanningPreferences): boolean {
  return PLANNING_MODE_KEYS.some((key) => prefs[key]);
}

export function enabledPlanningModeKeys(prefs: PlanningPreferences): PlanningModeKey[] {
  return PLANNING_MODE_KEYS.filter((key) => prefs[key]);
}

export function togglePlanningMode(
  prefs: PlanningPreferences,
  key: PlanningModeKey
): PlanningPreferences {
  return { ...prefs, [key]: !prefs[key] };
}

export function planningPreferencesFromKeys(keys: Iterable<string>): PlanningPreferences {
  const prefs = emptyPlanningPreferences();
  for (const key of keys) {
    if (isPlanningModeKey(key)) prefs[key] = true;
  }
  return prefs;
}

export function planningModeLabel(key: PlanningModeKey): string {
  return PLANNING_MODES.find((m) => m.key === key)?.label ?? key;
}

export function planningModeShortLabel(key: PlanningModeKey): string {
  return PLANNING_MODES.find((m) => m.key === key)?.shortLabel ?? key;
}

function canUseLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

export function loadPlanningModes(): PlanningPreferences {
  if (!canUseLocalStorage()) return emptyPlanningPreferences();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyPlanningPreferences();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return planningPreferencesFromKeys(parsed);
    return sanitizePlanningPreferences(parsed);
  } catch {
    return emptyPlanningPreferences();
  }
}

export function savePlanningModes(prefs: PlanningPreferences): void {
  if (!canUseLocalStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(enabledPlanningModeKeys(prefs)));
  } catch {
    // private mode / quota — skip
  }
}

function textBlob(parts: Array<string | undefined>): string {
  return parts
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .join(' ')
    .toLowerCase();
}

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => n && haystack.includes(n));
}

function countHits(haystack: string, needles: string[]): number {
  let n = 0;
  for (const needle of needles) {
    if (needle && haystack.includes(needle)) n += 1;
  }
  return n;
}

export function cuisineTagsOf(c: { title: string; tags: string[] }): string[] {
  const blob = textBlob([c.title, ...(c.tags || [])]);
  return CUISINE_TAGS.filter((tag) => blob.includes(tag));
}

export function collectFamiliarCuisines(
  candidates: Array<{ a: string; title: string; tags: string[] }>,
  familiar: Set<string>
): Set<string> {
  const out = new Set<string>();
  for (const c of candidates) {
    if (!familiar.has(c.a)) continue;
    for (const tag of cuisineTagsOf(c)) out.add(tag);
  }
  return out;
}

export function uniqueNormalizedIngredients(ingredients: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ingredients || []) {
    const name = normalizeIngredientName(raw);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export function buildIngredientFrequency(
  candidates: Array<{ ingredients: string[] }>
): Map<string, number> {
  const freq = new Map<string, number>();
  for (const c of candidates) {
    for (const name of uniqueNormalizedIngredients(c.ingredients || [])) {
      freq.set(name, (freq.get(name) ?? 0) + 1);
    }
  }
  return freq;
}

/** Shared ingredients that appear in 2+ candidates — a Low Waste hint. */
export function overlappingIngredientHints(
  candidates: Array<{ ingredients: string[] }>,
  cap = 16
): string[] {
  const freq = buildIngredientFrequency(candidates);
  return [...freq.entries()]
    .filter(([name, count]) => count >= 2 && !FEEDBACK_STAPLES.has(name))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, cap)
    .map(([name]) => name);
}

export function costHint(c: ModeScorable): 'budget' | 'pricey' | 'typical' {
  const blob = textBlob([c.title, ...(c.tags || []), ...(c.ingredients || [])]);
  const cheap = countHits(blob, CHEAP_SIGNALS);
  const pricey = countHits(blob, PRICEY_SIGNALS);
  if (pricey >= 2 || (pricey >= 1 && cheap === 0 && (c.ingredients?.length ?? 0) > 8)) {
    return 'pricey';
  }
  if (cheap >= 2 && pricey === 0) return 'budget';
  if (pricey >= 1 && cheap === 0) return 'pricey';
  return 'typical';
}

function proteinSourceCount(blob: string): number {
  return countHits(blob, PROTEIN_VARIETY_SOURCES);
}

export interface ModeScoreContext {
  minutes: number | null;
  ingredientFrequency: Map<string, number>;
  familiarCoordinates: Set<string>;
  familiarCuisines: Set<string>;
}

/**
 * Soft score for enabled modes. Hard constraints (allergies, vegetarian,
 * breakfast eligibility, explicit time limits) are applied elsewhere.
 */
export function scorePlanningModes(
  c: ModeScorable,
  prefs: PlanningPreferences,
  ctx: ModeScoreContext
): number {
  let score = 0;
  const blob = textBlob([c.title, ...(c.tags || []), ...(c.ingredients || [])]);

  if (prefs.usePantry && c.pantry && c.pantry.totalCount > 0) {
    score += c.pantry.matchRatio * 5;
  }

  if (prefs.budgetFriendly) {
    const hint = costHint(c);
    if (hint === 'budget') score += 3;
    else if (hint === 'pricey') score -= 3;
    const extras = Math.max(0, (c.ingredients?.length ?? 0) - 8);
    score -= extras * 0.25;
  }

  if (prefs.healthy) {
    if (typeof c.nourish?.overall === 'number') {
      score += (c.nourish.overall / 10) * 4;
    } else {
      score += Math.min(2, countHits(blob, HEALTHY_SIGNALS) * 0.6);
    }
  }

  if (prefs.highProtein) {
    if (typeof c.nourish?.proteinGrams === 'number' && c.nourish.proteinGrams > 0) {
      score += Math.min(4, c.nourish.proteinGrams / 10);
    } else if (typeof c.nourish?.protein === 'number') {
      score += (c.nourish.protein / 10) * 4;
    } else {
      score += Math.min(2.5, countHits(blob, PROTEIN_SIGNALS) * 0.7);
    }
    // Variety: a second protein family is a small plus; chicken-only is enough.
    if (proteinSourceCount(blob) >= 2) score += 0.4;
  }

  if (prefs.quickMeals) {
    if (ctx.minutes != null) {
      if (ctx.minutes <= QUICK_TARGET_MINUTES) score += 4;
      else if (ctx.minutes <= QUICK_SOFT_MAX_MINUTES) score += 2;
      else if (ctx.minutes <= QUICK_OBVIOUS_LONG_MINUTES) score -= 2;
      else score -= 4;
    }
  }

  if (prefs.lowWaste) {
    const names = uniqueNormalizedIngredients(c.ingredients || []);
    let overlap = 0;
    for (const name of names) {
      if (FEEDBACK_STAPLES.has(name)) continue;
      const freq = ctx.ingredientFrequency.get(name) ?? 0;
      if (freq >= 2) overlap += 1;
    }
    score += Math.min(4, overlap * 0.7);
  }

  if (prefs.adventurous) {
    if (ctx.familiarCoordinates.size >= 3) {
      if (ctx.familiarCoordinates.has(c.a)) score -= 2.5;
      else score += 1.5;
      const cuisines = cuisineTagsOf(c);
      if (cuisines.some((tag) => !ctx.familiarCuisines.has(tag))) score += 1.5;
    } else if (cuisineTagsOf(c).length > 0) {
      score += 0.8;
    }
  }

  return score;
}

export function planningModePromptLines(prefs: PlanningPreferences): string[] {
  if (!hasEnabledPlanningMode(prefs)) return [];
  const labels = enabledPlanningModeKeys(prefs).map(planningModeLabel);
  const lines = [
    `Planning modes (weighted preferences, not hard requirements): ${labels.join(', ')}`,
    'Dietary exclusions, vegetarian requests, breakfast eligibility, and explicit cooking-time limits still win over planning modes. If modes conflict, pick the best overall fit. Do not fail the request or leave slots empty because modes disagree.'
  ];

  if (prefs.usePantry) {
    lines.push(
      'Use My Pantry: Prefer recipes that naturally use ingredients the user already has. Minimize extra grocery purchases. Allow missing ingredients when they make the meal better. Do not force a poor recipe just to use pantry items.'
    );
  }
  if (prefs.budgetFriendly) {
    lines.push(
      'Keep It Cheap: Prefer inexpensive proteins (beans, eggs, chicken, tofu), rice, pasta, and common produce. Favor recipes with fewer specialty ingredients and reuse ingredients across the week. Avoid premium cuts and one-off specialty items unless nothing else fits. Do not invent dollar amounts or prices.'
    );
  }
  if (prefs.healthy) {
    lines.push(
      'Healthy Week: Prefer meals with stronger overall nutritional balance — protein, fiber, vegetables, and reasonable calorie density. Use Nourish overall scores when present on a candidate. This is not a medical or restrictive diet. Do not invent nutrition numbers.'
    );
  }
  if (prefs.highProtein) {
    lines.push(
      'High Protein: Prefer meals with meaningful protein. Use Nourish protein scores or protein grams when present; otherwise use recipe-level signals (eggs, yogurt, legumes, fish, poultry, tofu). Keep variety — do not fill the week with the same chicken recipe. Do not invent precise macros.'
    );
  }
  if (prefs.quickMeals) {
    lines.push(
      `Quick Meals: Prefer recipes that are about ${QUICK_TARGET_MINUTES} minutes or less of active cooking when timing is known. Avoid obviously long-cook meals (braises, all-day roasts, multi-hour projects). If timing is missing, use the recipe title and tags conservatively.`
    );
  }
  if (prefs.lowWaste) {
    lines.push(
      'Low Waste: Intentionally reuse ingredients across the week — produce, herbs, proteins, dairy, sauces, and pantry staples. Overlap ingredients, not meals. The week should feel varied while sharing a shopping basket. Do not repeat the same recipe to create reuse.'
    );
  }
  if (prefs.adventurous) {
    lines.push(
      'Try Something New: Prefer recipes the user has not already saved or planned, and a broader mix of cuisines and styles. Introduce variety without becoming random or overly exotic. If history is thin, still favor a wider mix. Never block planning because history is missing.'
    );
  }
  return lines;
}

export function candidateModeBits(
  c: ModeScorable & { prepTime?: string; cookTime?: string },
  prefs: PlanningPreferences,
  familiarCoordinates?: Set<string>
): string[] {
  const bits: string[] = [];
  if (prefs.budgetFriendly) bits.push(`cost=${costHint(c)}`);
  if ((prefs.healthy || prefs.highProtein) && c.nourish) {
    const n: string[] = [];
    if (typeof c.nourish.overall === 'number') n.push(`overall ${c.nourish.overall}/10`);
    if (typeof c.nourish.protein === 'number') n.push(`protein ${c.nourish.protein}/10`);
    if (typeof c.nourish.proteinGrams === 'number') n.push(`${c.nourish.proteinGrams}g protein`);
    if (n.length) bits.push(`nourish=${n.join(', ')}`);
  }
  if (prefs.adventurous && familiarCoordinates?.has(c.a)) {
    bits.push('familiar=yes');
  }
  return bits;
}

export interface PlanModeFeedback {
  labels: string[];
  summary: string | null;
}

export function summarizePlanningModeFeedback(opts: {
  preferences: PlanningPreferences;
  meals: Array<{ a: string; pantry?: { matchedIngredients?: string[] } }>;
  recipes: Array<{
    a: string;
    ingredients?: string[];
    prepTime?: string;
    cookTime?: string;
    minutes?: number | null;
  }>;
}): PlanModeFeedback | null {
  const { preferences: prefs, meals, recipes } = opts;
  if (!hasEnabledPlanningMode(prefs) || meals.length === 0) return null;

  const labels = enabledPlanningModeKeys(prefs).map(planningModeShortLabel);
  const byA = new Map(recipes.map((r) => [r.a, r]));
  const metrics: string[] = [];

  if (prefs.usePantry) {
    const used = new Set<string>();
    for (const meal of meals) {
      for (const name of meal.pantry?.matchedIngredients || []) {
        const key = normalizeIngredientName(name) || name.toLowerCase();
        if (key) used.add(key);
      }
    }
    if (used.size > 0) {
      metrics.push(`${used.size} pantry ingredient${used.size === 1 ? '' : 's'} used`);
    }
  }

  if (prefs.lowWaste) {
    const freq = new Map<string, number>();
    for (const meal of meals) {
      const recipe = byA.get(meal.a);
      for (const name of uniqueNormalizedIngredients(recipe?.ingredients || [])) {
        if (FEEDBACK_STAPLES.has(name)) continue;
        freq.set(name, (freq.get(name) ?? 0) + 1);
      }
    }
    const reused = [...freq.values()].filter((n) => n >= 2).length;
    if (reused > 0) {
      metrics.push(`${reused} ingredient${reused === 1 ? '' : 's'} reused across meals`);
    }
  }

  if (prefs.quickMeals) {
    const times: number[] = [];
    for (const meal of meals) {
      const recipe = byA.get(meal.a);
      if (typeof recipe?.minutes === 'number') {
        times.push(recipe.minutes);
        continue;
      }
    }
    if (times.length >= Math.ceil(meals.length / 2)) {
      const quick = times.filter((m) => m <= QUICK_SOFT_MAX_MINUTES).length;
      if (quick >= times.length * 0.6) {
        metrics.push(`Most meals are ready in about ${QUICK_TARGET_MINUTES} minutes.`);
      }
    }
  }

  return {
    labels,
    summary: metrics.length ? metrics.join(' · ') : null
  };
}

export function familiarCoordinatesFromSources(opts: {
  savedAs?: Iterable<string>;
  plannedAs?: Iterable<string>;
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of [opts.savedAs, opts.plannedAs]) {
    if (!group) continue;
    for (const a of group) {
      if (typeof a !== 'string' || !a || seen.has(a)) continue;
      seen.add(a);
      out.push(a);
    }
  }
  return out;
}
