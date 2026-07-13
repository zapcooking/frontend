/**
 * Meal-plan payload schema (schemaVersion 1) — the decrypted JSON
 * contract shared verbatim with Android. See docs/mealplan-contract.md;
 * that document is frozen and this module implements it.
 *
 * Validation is defensive, mirroring decryptGroceryEvent's posture:
 * invalid slot entries are dropped, unknown fields are PRESERVED on
 * round-trip, and schemaVersion > 1 flags the plan read-only rather
 * than failing.
 */

export const MEALPLAN_SCHEMA_VERSION = 1;

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type MealPlanDayKey = (typeof DAY_KEYS)[number];

export const SLOT_KEYS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealSlotKey = (typeof SLOT_KEYS)[number];

export type MealSlot =
  | { type: 'recipe'; a: string; title?: string; [key: string]: unknown }
  | { type: 'text'; text: string; [key: string]: unknown };

export interface MealPlanDay {
  slots?: Partial<Record<MealSlotKey, MealSlot>>;
  notes?: string;
  [key: string]: unknown;
}

export interface MealPlan {
  schemaVersion: number;
  week: string;
  days: Partial<Record<MealPlanDayKey, MealPlanDay>>;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  [key: string]: unknown;
}

export interface ValidatedMealPlan {
  plan: MealPlan;
  /** True when schemaVersion > MEALPLAN_SCHEMA_VERSION — render, never write back. */
  readOnly: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate one slot entry; null drops it (contract rule 9). */
function validateSlot(raw: unknown): MealSlot | null {
  if (!isRecord(raw)) return null;
  if (raw.type === 'recipe' && typeof raw.a === 'string' && raw.a.length > 0) {
    return raw as MealSlot;
  }
  if (raw.type === 'text' && typeof raw.text === 'string' && raw.text.length > 0) {
    return raw as MealSlot;
  }
  return null;
}

function validateDay(raw: unknown): MealPlanDay | null {
  if (!isRecord(raw)) return null;
  // Preserve unknown day-level fields; rebuild only `slots` with the
  // invalid entries dropped.
  const day: MealPlanDay = { ...raw } as MealPlanDay;
  if (raw.slots !== undefined) {
    if (!isRecord(raw.slots)) {
      delete day.slots;
    } else {
      const slots: Partial<Record<MealSlotKey, MealSlot>> = {};
      for (const key of SLOT_KEYS) {
        const slot = validateSlot(raw.slots[key]);
        if (slot) slots[key] = slot;
      }
      day.slots = slots;
    }
  }
  if (raw.notes !== undefined && typeof raw.notes !== 'string') {
    delete day.notes;
  }
  return day;
}

/**
 * Validate a decrypted payload against schemaVersion 1.
 *
 * Returns null only when the payload is structurally unusable (not an
 * object). Unknown top-level fields are preserved; `weekId` (from the
 * d-tag, which wins per contract rule 2) backfills a missing/mismatched
 * `week`.
 */
export function validateMealPlanPayload(raw: unknown, weekId: string): ValidatedMealPlan | null {
  if (!isRecord(raw)) return null;

  const schemaVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
  const readOnly = schemaVersion > MEALPLAN_SCHEMA_VERSION;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const plan: MealPlan = {
    ...raw,
    schemaVersion,
    week: weekId,
    days: {},
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : nowSeconds,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : nowSeconds
  } as MealPlan;

  if (raw.notes !== undefined && typeof raw.notes !== 'string') {
    delete plan.notes;
  }

  if (isRecord(raw.days)) {
    for (const key of DAY_KEYS) {
      const day = validateDay(raw.days[key]);
      if (day) plan.days[key] = day;
    }
  }

  return { plan, readOnly };
}

export function createEmptyMealPlan(weekId: string): MealPlan {
  const now = Math.floor(Date.now() / 1000);
  return {
    schemaVersion: MEALPLAN_SCHEMA_VERSION,
    week: weekId,
    days: {},
    createdAt: now,
    updatedAt: now
  };
}

/** Serialize for encryption — plain JSON keeps unknown fields intact. */
export function serializeMealPlan(plan: MealPlan): string {
  return JSON.stringify(plan);
}
