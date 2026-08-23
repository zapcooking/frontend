/**
 * Cheffy weekly meal-plan generation — types, deterministic filtering,
 * and validation. Shared by the planner UI and POST /api/zappy/meal-plan.
 *
 * Preferences stay here (temporary UI/API state). They are NOT written
 * into the meal-plan payload — that schema is a frozen Android contract.
 */

import {
  DAY_KEYS,
  SLOT_KEYS,
  type MealPlan,
  type MealPlanDayKey,
  type MealSlotKey
} from './schema';
import { isValidWeekId } from './week';
import { isRecipeEligibleForSlot, restrictCandidatesToRequestedSlots } from './slotEligibility';

export const MEAL_PLAN_STRATEGIES = ['fill-empty', 'replace-selected'] as const;
export type MealPlanStrategy = (typeof MEAL_PLAN_STRATEGIES)[number];

export const RECIPE_SOURCES = ['my-recipes', 'saved', 'explore', 'all'] as const;
export type RecipeSource = (typeof RECIPE_SOURCES)[number];

export const PREFERENCE_STYLES = [
  { id: 'easy', label: 'Easy', tags: ['easy', 'quick', 'simple', 'weeknight'] },
  {
    id: 'mediterranean',
    label: 'Mediterranean',
    tags: ['mediterranean', 'greek', 'italian', 'levantine']
  },
  { id: 'keto', label: 'Keto', tags: ['keto', 'low-carb', 'lowcarb', 'low carb'] },
  {
    id: 'high-protein',
    label: 'High Protein',
    tags: ['high-protein', 'highprotein', 'protein', 'high protein']
  },
  { id: 'vegetarian', label: 'Vegetarian', tags: ['vegetarian', 'vegan', 'plant-based'] },
  {
    id: 'family-friendly',
    label: 'Family Friendly',
    tags: ['family', 'kid', 'kids', 'family-friendly', 'kid-friendly']
  },
  { id: 'budget', label: 'Budget', tags: ['budget', 'cheap', 'affordable', 'inexpensive'] },
  { id: 'surprise', label: 'Surprise Me', tags: [] }
] as const;

export type PreferenceStyleId = (typeof PREFERENCE_STYLES)[number]['id'];

export const STYLE_IDS: readonly PreferenceStyleId[] = PREFERENCE_STYLES.map((s) => s.id);

export const MAX_CANDIDATES = 48;
export const MAX_NOTES_CHARS = 500;
export const MAX_EXCLUDE_INGREDIENTS = 20;
export const MAX_PANTRY_INGREDIENTS = 80;
export const MAX_INGREDIENTS_PER_CANDIDATE = 12;
export const MAX_TAGS_PER_CANDIDATE = 8;
export const MAX_TITLE_CHARS = 120;
export const MAX_REASON_CHARS = 160;

export interface CandidatePantryMatch {
  matchedCount: number;
  totalCount: number;
  matchRatio: number;
  matchedIngredients: string[];
  missingIngredients: string[];
}

export interface RecipeCandidate {
  a: string;
  title: string;
  tags: string[];
  ingredients: string[];
  prepTime?: string;
  cookTime?: string;
  servings?: string;
  /** Deterministic pantry match. Never invented by Cheffy. */
  pantry?: CandidatePantryMatch;
}

export interface MealPlanPreferences {
  styles: PreferenceStyleId[];
  maxMinutes?: number;
  servings?: number;
  excludeIngredients?: string[];
  notes?: string;
}

export interface MealSlotRef {
  day: MealPlanDayKey;
  slot: MealSlotKey;
}

export interface MealPlanGenerationRequest {
  weekId: string;
  days: MealPlanDayKey[];
  mealSlots: MealSlotKey[];
  preferences: MealPlanPreferences;
  strategy: MealPlanStrategy;
  /** Rank and prompt Cheffy to prefer recipes that use the user's pantry. */
  prioritizePantry?: boolean;
  /** Display names of pantry ingredients. Prompt-only; never persisted. */
  pantryIngredients?: string[];
  candidates: RecipeCandidate[];
  /** Slots that already have a meal. Required for fill-empty enforcement. */
  occupiedSlots?: MealSlotRef[];
  /**
   * Explicit slots Cheffy should fill. When omitted, the cartesian
   * product of `days` × `mealSlots` is used (minus occupied slots when
   * strategy is fill-empty).
   */
  fillSlots?: MealSlotRef[];
  /** Coordinates already used in the preview — avoid repeating them on swap. */
  excludeCoordinates?: string[];
}

export interface GeneratedMeal {
  day: MealPlanDayKey;
  slot: MealSlotKey;
  a: string;
  title: string;
  reason?: string;
  /** Client-only preview thumbnail. Never written into the meal-plan schema. */
  image?: string;
  /** Client-only pantry match copied from the candidate. Never persisted. */
  pantry?: CandidatePantryMatch;
}

export interface GeneratedMealPlan {
  meals: GeneratedMeal[];
}

export type GenerationValidationError =
  | 'invalid-week'
  | 'invalid-days'
  | 'invalid-slots'
  | 'invalid-strategy'
  | 'no-candidates'
  | 'too-many-candidates'
  | 'no-target-slots'
  | 'unknown-recipe'
  | 'unknown-day'
  | 'unknown-slot'
  | 'duplicate-slot'
  | 'overwrite-occupied'
  | 'ineligible-slot'
  | 'empty-plan';

export interface ValidationResult {
  ok: boolean;
  error?: GenerationValidationError;
  message?: string;
}

const DAY_SET = new Set<string>(DAY_KEYS);
const SLOT_SET = new Set<string>(SLOT_KEYS);
const STYLE_SET = new Set<string>(STYLE_IDS);
const STRATEGY_SET = new Set<string>(MEAL_PLAN_STRATEGIES);

const RECIPE_KIND_PREFIX = '30023:';

const VEGETARIAN_BLOCKLIST = [
  'chicken',
  'beef',
  'pork',
  'lamb',
  'turkey',
  'bacon',
  'sausage',
  'ham',
  'steak',
  'shrimp',
  'salmon',
  'tuna',
  'anchovy',
  'anchovies',
  'fish',
  'seafood',
  'shellfish',
  'crab',
  'lobster',
  'clam',
  'mussel',
  'oyster',
  'duck',
  'venison',
  'pepperoni',
  'salami',
  'prosciutto',
  'pancetta',
  'chorizo',
  'meatball',
  'ground meat',
  'ground beef'
];

export function isMealPlanDayKey(value: unknown): value is MealPlanDayKey {
  return typeof value === 'string' && DAY_SET.has(value);
}

export function isMealSlotKey(value: unknown): value is MealSlotKey {
  return typeof value === 'string' && SLOT_SET.has(value);
}

export function isPreferenceStyleId(value: unknown): value is PreferenceStyleId {
  return typeof value === 'string' && STYLE_SET.has(value);
}

export function isMealPlanStrategy(value: unknown): value is MealPlanStrategy {
  return typeof value === 'string' && STRATEGY_SET.has(value);
}

export function isRecipeCoordinate(a: unknown): a is string {
  if (typeof a !== 'string' || !a.startsWith(RECIPE_KIND_PREFIX)) return false;
  const parts = a.split(':');
  return parts.length === 3 && parts[1].length > 0 && parts[2].length > 0;
}

export function slotKey(day: MealPlanDayKey, slot: MealSlotKey): string {
  return `${day}:${slot}`;
}

export function cartesianSlots(days: MealPlanDayKey[], mealSlots: MealSlotKey[]): MealSlotRef[] {
  const out: MealSlotRef[] = [];
  for (const day of days) {
    for (const slot of mealSlots) {
      out.push({ day, slot });
    }
  }
  return out;
}

export function occupiedSlotSet(occupied: MealSlotRef[] | undefined): Set<string> {
  const set = new Set<string>();
  for (const o of occupied || []) {
    if (isMealPlanDayKey(o.day) && isMealSlotKey(o.slot)) {
      set.add(slotKey(o.day, o.slot));
    }
  }
  return set;
}

/** Slots Cheffy is allowed to fill for this request. */
export function resolveTargetSlots(req: {
  days: MealPlanDayKey[];
  mealSlots: MealSlotKey[];
  strategy: MealPlanStrategy;
  occupiedSlots?: MealSlotRef[];
  fillSlots?: MealSlotRef[];
}): MealSlotRef[] {
  const occupied = occupiedSlotSet(req.occupiedSlots);
  const base = req.fillSlots?.length ? req.fillSlots : cartesianSlots(req.days, req.mealSlots);
  const seen = new Set<string>();
  const out: MealSlotRef[] = [];
  for (const ref of base) {
    if (!isMealPlanDayKey(ref.day) || !isMealSlotKey(ref.slot)) continue;
    const key = slotKey(ref.day, ref.slot);
    if (seen.has(key)) continue;
    seen.add(key);
    if (req.strategy === 'fill-empty' && occupied.has(key)) continue;
    out.push({ day: ref.day, slot: ref.slot });
  }
  return out;
}

export function occupiedSlotsFromPlan(
  plan: MealPlan,
  days: MealPlanDayKey[],
  mealSlots: MealSlotKey[]
): MealSlotRef[] {
  const out: MealSlotRef[] = [];
  for (const day of days) {
    const slots = plan.days[day]?.slots;
    if (!slots) continue;
    for (const slot of mealSlots) {
      if (slots[slot]) out.push({ day, slot });
    }
  }
  return out;
}

/**
 * Parse a human cook/prep time into minutes. Returns null when the
 * string cannot be interpreted — callers must not treat unknown as a
 * violation.
 */
export function parseDurationMinutes(raw: string | undefined | null): number | null {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n > 0 ? n : null;
  }

  let total = 0;
  const hourMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
  const minMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/);
  if (hourMatch) total += parseFloat(hourMatch[1]) * 60;
  if (minMatch) total += parseFloat(minMatch[1]);
  if (total > 0) return Math.round(total);

  const firstNum = s.match(/(\d+)/);
  if (!firstNum) return null;
  const n = Number(firstNum[1]);
  return n > 0 ? n : null;
}

/** Prep + cook when both parse; otherwise whichever is known. */
export function totalActiveMinutes(prepTime?: string, cookTime?: string): number | null {
  const prep = parseDurationMinutes(prepTime);
  const cook = parseDurationMinutes(cookTime);
  if (prep == null && cook == null) return null;
  return (prep ?? 0) + (cook ?? 0);
}

function normalizeNeedle(value: string): string {
  return value.trim().toLowerCase();
}

function textBlob(parts: Array<string | undefined>): string {
  return parts
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .join(' ')
    .toLowerCase();
}

function containsAny(haystack: string, needles: string[]): boolean {
  if (!haystack) return false;
  return needles.some((n) => n && haystack.includes(n));
}

function styleMatchers(styles: PreferenceStyleId[]): { tags: string[]; skip: boolean } {
  const tags: string[] = [];
  let skip = false;
  for (const id of styles) {
    const def = PREFERENCE_STYLES.find((s) => s.id === id);
    if (!def) continue;
    if (id === 'surprise') {
      skip = styles.length === 1;
      continue;
    }
    for (const t of def.tags) tags.push(t.toLowerCase());
  }
  return { tags, skip };
}

function candidateMatchesStyle(c: RecipeCandidate, styleTags: string[]): boolean {
  if (styleTags.length === 0) return false;
  const blob = textBlob([c.title, ...(c.tags || [])]);
  return styleTags.some((t) => blob.includes(t));
}

function obviouslyNotVegetarian(c: RecipeCandidate): boolean {
  if (!c.ingredients?.length) return false;
  const blob = textBlob([c.title, ...c.ingredients]);
  return containsAny(blob, VEGETARIAN_BLOCKLIST);
}

function obviouslyContainsExcluded(c: RecipeCandidate, excluded: string[]): boolean {
  if (excluded.length === 0) return false;
  if (!c.ingredients?.length && !c.title) return false;
  const blob = textBlob([c.title, ...(c.ingredients || [])]);
  return containsAny(blob, excluded);
}

export interface FilterCandidatesOptions {
  maxMinutes?: number;
  excludeIngredients?: string[];
  styles?: PreferenceStyleId[];
  excludeCoordinates?: string[];
  /** Soft-prefer recipes whose tags mention these meal slots. */
  mealSlots?: MealSlotKey[];
  /** Soft-prefer higher pantry match after hard constraints. */
  prioritizePantry?: boolean;
  maxCandidates?: number;
}

/**
 * Deterministic pre-filter. Drops recipes that *obviously* violate hard
 * constraints; keeps unknowns. Then ranks and caps so Cheffy sees a
 * useful, bounded set rather than the whole corpus.
 */
export function filterRecipeCandidates(
  candidates: RecipeCandidate[],
  opts: FilterCandidatesOptions = {}
): RecipeCandidate[] {
  const maxMinutes = opts.maxMinutes && opts.maxMinutes > 0 ? opts.maxMinutes : undefined;
  const excluded = (opts.excludeIngredients || []).map(normalizeNeedle).filter(Boolean);
  const excludeAs = new Set(opts.excludeCoordinates || []);
  const styles = (opts.styles || []).filter(isPreferenceStyleId);
  const vegetarian = styles.includes('vegetarian');
  const { tags: styleTags, skip: surpriseOnly } = styleMatchers(styles);
  const mealSlots = opts.mealSlots || [];
  const cap = opts.maxCandidates ?? MAX_CANDIDATES;

  const hardPassed: RecipeCandidate[] = [];
  for (const c of candidates) {
    if (!isRecipeCoordinate(c.a)) continue;
    if (excludeAs.has(c.a)) continue;
    if (maxMinutes != null) {
      const minutes = totalActiveMinutes(c.prepTime, c.cookTime);
      if (minutes != null && minutes > maxMinutes) continue;
    }
    if (obviouslyContainsExcluded(c, excluded)) continue;
    if (vegetarian && obviouslyNotVegetarian(c)) continue;
    hardPassed.push(c);
  }

  const slotEligible =
    mealSlots.length > 0 ? restrictCandidatesToRequestedSlots(hardPassed, mealSlots) : hardPassed;

  const prioritizePantry = !!opts.prioritizePantry;
  let ranked = slotEligible;
  if (!surpriseOnly && styleTags.length > 0) {
    const matched = slotEligible.filter((c) => candidateMatchesStyle(c, styleTags));
    const unmatched = slotEligible.filter((c) => !candidateMatchesStyle(c, styleTags));
    // If we have enough style matches to cover a week with extras, drop
    // the rest. Otherwise keep unmatched as fallback so Cheffy can still plan.
    ranked = matched.length >= 8 ? matched : [...matched, ...unmatched];
  } else if (surpriseOnly && !prioritizePantry) {
    ranked = shuffleInPlace([...slotEligible]);
  }

  const slotNeedles = mealSlots.map((s) => s.toLowerCase());
  const shouldScore =
    prioritizePantry || (!surpriseOnly && (styleTags.length > 0 || mealSlots.length > 0));
  if (shouldScore) {
    ranked = [...ranked].sort(
      (a, b) =>
        scoreCandidate(b, styleTags, slotNeedles, prioritizePantry) -
        scoreCandidate(a, styleTags, slotNeedles, prioritizePantry)
    );
  }

  return ranked.slice(0, cap);
}

function scoreCandidate(
  c: RecipeCandidate,
  styleTags: string[],
  slotNeedles: string[],
  prioritizePantry: boolean
): number {
  let score = 0;
  const blob = textBlob([c.title, ...(c.tags || [])]);
  if (styleTags.some((t) => blob.includes(t))) score += 3;
  if (slotNeedles.some((t) => blob.includes(t))) score += 2;
  if (c.prepTime || c.cookTime) score += 1;
  if (c.ingredients?.length) score += 1;
  if (prioritizePantry && c.pantry && c.pantry.totalCount > 0) {
    score += c.pantry.matchRatio * 5;
  }
  return score;
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function uniqueDays(values: unknown): MealPlanDayKey[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<MealPlanDayKey>();
  const out: MealPlanDayKey[] = [];
  for (const v of values) {
    if (isMealPlanDayKey(v) && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

export function uniqueSlots(values: unknown): MealSlotKey[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<MealSlotKey>();
  const out: MealSlotKey[] = [];
  for (const v of values) {
    if (isMealSlotKey(v) && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function sanitizeCandidate(raw: unknown): RecipeCandidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isRecipeCoordinate(r.a)) return null;
  const title = typeof r.title === 'string' ? r.title.trim().slice(0, MAX_TITLE_CHARS) : '';
  if (!title) return null;
  const tags = Array.isArray(r.tags)
    ? r.tags
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim().slice(0, 40))
        .slice(0, MAX_TAGS_PER_CANDIDATE)
    : [];
  const ingredients = Array.isArray(r.ingredients)
    ? r.ingredients
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim().slice(0, 80))
        .slice(0, MAX_INGREDIENTS_PER_CANDIDATE)
    : [];
  const candidate: RecipeCandidate = { a: r.a, title, tags, ingredients };
  if (typeof r.prepTime === 'string' && r.prepTime.trim()) {
    candidate.prepTime = r.prepTime.trim().slice(0, 40);
  }
  if (typeof r.cookTime === 'string' && r.cookTime.trim()) {
    candidate.cookTime = r.cookTime.trim().slice(0, 40);
  }
  if (typeof r.servings === 'string' && r.servings.trim()) {
    candidate.servings = r.servings.trim().slice(0, 20);
  }
  const pantry = sanitizeCandidatePantry(r.pantry);
  if (pantry) candidate.pantry = pantry;
  return candidate;
}

function sanitizeCandidatePantry(raw: unknown): CandidatePantryMatch | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as Record<string, unknown>;
  const matchedCount =
    typeof p.matchedCount === 'number' && Number.isFinite(p.matchedCount)
      ? Math.max(0, Math.round(p.matchedCount))
      : 0;
  const totalCount =
    typeof p.totalCount === 'number' && Number.isFinite(p.totalCount)
      ? Math.max(0, Math.round(p.totalCount))
      : 0;
  const matchRatio =
    typeof p.matchRatio === 'number' && Number.isFinite(p.matchRatio)
      ? Math.min(1, Math.max(0, p.matchRatio))
      : totalCount > 0
        ? matchedCount / totalCount
        : 0;
  const names = (value: unknown) =>
    Array.isArray(value)
      ? value
          .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
          .map((t) => t.trim().slice(0, 80))
          .slice(0, MAX_INGREDIENTS_PER_CANDIDATE)
      : [];
  return {
    matchedCount,
    totalCount,
    matchRatio,
    matchedIngredients: names(p.matchedIngredients),
    missingIngredients: names(p.missingIngredients)
  };
}

function sanitizePreferences(raw: unknown): MealPlanPreferences {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const styles = Array.isArray(src.styles)
    ? src.styles.filter(isPreferenceStyleId).slice(0, STYLE_IDS.length)
    : [];
  const prefs: MealPlanPreferences = { styles };
  if (typeof src.maxMinutes === 'number' && Number.isFinite(src.maxMinutes) && src.maxMinutes > 0) {
    prefs.maxMinutes = Math.min(Math.round(src.maxMinutes), 24 * 60);
  }
  if (typeof src.servings === 'number' && Number.isFinite(src.servings) && src.servings > 0) {
    prefs.servings = Math.min(Math.round(src.servings), 24);
  }
  if (Array.isArray(src.excludeIngredients)) {
    prefs.excludeIngredients = src.excludeIngredients
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, MAX_EXCLUDE_INGREDIENTS);
  }
  if (typeof src.notes === 'string') {
    const notes = src.notes.trim().slice(0, MAX_NOTES_CHARS);
    if (notes) prefs.notes = notes;
  }
  return prefs;
}

function sanitizeSlotRefs(raw: unknown): MealSlotRef[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: MealSlotRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (!isMealPlanDayKey(r.day) || !isMealSlotKey(r.slot)) continue;
    const key = slotKey(r.day, r.slot);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ day: r.day, slot: r.slot });
  }
  return out;
}

/**
 * Parse and validate a generation request body. Returns a sanitized
 * request or a validation error — never throws.
 */
export function parseGenerationRequest(
  raw: unknown
):
  | { ok: true; request: MealPlanGenerationRequest }
  | { ok: false; error: GenerationValidationError; message: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'invalid-week', message: 'Request body is required.' };
  }
  const body = raw as Record<string, unknown>;
  if (typeof body.weekId !== 'string' || !isValidWeekId(body.weekId)) {
    return { ok: false, error: 'invalid-week', message: 'A valid week is required.' };
  }
  const days = uniqueDays(body.days);
  if (days.length === 0) {
    return { ok: false, error: 'invalid-days', message: 'Select at least one day.' };
  }
  const mealSlots = uniqueSlots(body.mealSlots);
  if (mealSlots.length === 0) {
    return { ok: false, error: 'invalid-slots', message: 'Select at least one meal.' };
  }
  if (!isMealPlanStrategy(body.strategy)) {
    return {
      ok: false,
      error: 'invalid-strategy',
      message: 'Choose fill-empty or replace-selected.'
    };
  }
  if (!Array.isArray(body.candidates) || body.candidates.length === 0) {
    return {
      ok: false,
      error: 'no-candidates',
      message: 'No recipes were available to plan with.'
    };
  }
  if (body.candidates.length > MAX_CANDIDATES) {
    return {
      ok: false,
      error: 'too-many-candidates',
      message: `Too many candidate recipes (max ${MAX_CANDIDATES}).`
    };
  }

  const seenA = new Set<string>();
  const candidates: RecipeCandidate[] = [];
  for (const rawCandidate of body.candidates) {
    const c = sanitizeCandidate(rawCandidate);
    if (!c || seenA.has(c.a)) continue;
    seenA.add(c.a);
    candidates.push(c);
  }
  if (candidates.length === 0) {
    return {
      ok: false,
      error: 'no-candidates',
      message: 'No valid recipes were available to plan with.'
    };
  }

  const request: MealPlanGenerationRequest = {
    weekId: body.weekId,
    days,
    mealSlots,
    preferences: sanitizePreferences(body.preferences),
    strategy: body.strategy,
    candidates,
    occupiedSlots: sanitizeSlotRefs(body.occupiedSlots),
    fillSlots: sanitizeSlotRefs(body.fillSlots),
    excludeCoordinates: Array.isArray(body.excludeCoordinates)
      ? body.excludeCoordinates.filter(isRecipeCoordinate).slice(0, MAX_CANDIDATES)
      : []
  };
  if (body.prioritizePantry === true) request.prioritizePantry = true;
  if (Array.isArray(body.pantryIngredients)) {
    const pantryIngredients = body.pantryIngredients
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, MAX_PANTRY_INGREDIENTS);
    if (pantryIngredients.length) request.pantryIngredients = pantryIngredients;
  }

  const targets = resolveTargetSlots(request);
  if (targets.length === 0) {
    return {
      ok: false,
      error: 'no-target-slots',
      message:
        request.strategy === 'fill-empty'
          ? 'Those slots already have meals. Switch to replace, or pick empty days.'
          : 'No meal slots to plan.'
    };
  }

  return { ok: true, request };
}

/**
 * Validate a model-produced plan against the request. Unknown recipe
 * coordinates are a hard reject — they must never reach the planner.
 */
export function validateGeneratedMealPlan(
  plan: unknown,
  request: MealPlanGenerationRequest
):
  | { ok: true; plan: GeneratedMealPlan }
  | { ok: false; error: GenerationValidationError; message: string } {
  if (!plan || typeof plan !== 'object') {
    return { ok: false, error: 'empty-plan', message: 'Cheffy did not return a meal plan.' };
  }
  const mealsRaw = (plan as Record<string, unknown>).meals;
  if (!Array.isArray(mealsRaw) || mealsRaw.length === 0) {
    return { ok: false, error: 'empty-plan', message: 'Cheffy did not return any meals.' };
  }

  const candidateByA = new Map(request.candidates.map((c) => [c.a, c]));
  const targets = resolveTargetSlots(request);
  const targetSet = new Set(targets.map((t) => slotKey(t.day, t.slot)));
  const occupied = occupiedSlotSet(request.occupiedSlots);
  const seenSlots = new Set<string>();
  const meals: GeneratedMeal[] = [];

  for (const raw of mealsRaw) {
    if (!raw || typeof raw !== 'object') continue;
    const m = raw as Record<string, unknown>;
    if (!isMealPlanDayKey(m.day)) {
      return {
        ok: false,
        error: 'unknown-day',
        message: 'Cheffy returned a day that was not requested.'
      };
    }
    if (!isMealSlotKey(m.slot)) {
      return {
        ok: false,
        error: 'unknown-slot',
        message: 'Cheffy returned a meal that was not requested.'
      };
    }
    const key = slotKey(m.day, m.slot);
    if (request.strategy === 'fill-empty' && occupied.has(key)) {
      return {
        ok: false,
        error: 'overwrite-occupied',
        message: 'Cheffy tried to overwrite a meal that is already planned.'
      };
    }
    if (!targetSet.has(key)) {
      return {
        ok: false,
        error: 'unknown-slot',
        message: 'Cheffy returned a meal slot that was not requested.'
      };
    }
    if (seenSlots.has(key)) {
      return {
        ok: false,
        error: 'duplicate-slot',
        message: 'Cheffy assigned two recipes to the same slot.'
      };
    }
    seenSlots.add(key);
    if (!isRecipeCoordinate(m.a) || !candidateByA.has(m.a)) {
      return {
        ok: false,
        error: 'unknown-recipe',
        message: 'Cheffy returned a recipe that is not in Zap Cooking.'
      };
    }
    const candidate = candidateByA.get(m.a)!;
    if (!isRecipeEligibleForSlot(candidate, m.slot)) {
      return {
        ok: false,
        error: 'ineligible-slot',
        message: 'Cheffy assigned a recipe that does not fit that meal.'
      };
    }
    const reason =
      typeof m.reason === 'string' && m.reason.trim()
        ? m.reason.trim().slice(0, MAX_REASON_CHARS)
        : undefined;
    const meal: GeneratedMeal = {
      day: m.day,
      slot: m.slot,
      a: candidate.a,
      title: candidate.title,
      reason
    };
    if (candidate.pantry) meal.pantry = candidate.pantry;
    meals.push(meal);
  }

  if (meals.length === 0) {
    return { ok: false, error: 'empty-plan', message: 'Cheffy did not return any meals.' };
  }

  return { ok: true, plan: { meals } };
}

export function parseExcludeIngredientsInput(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_EXCLUDE_INGREDIENTS);
}
