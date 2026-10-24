import { describe, it, expect } from 'vitest';
import {
  validateMealPlanPayload,
  createEmptyMealPlan,
  serializeMealPlan,
  MEALPLAN_SCHEMA_VERSION,
  type MealPlan
} from './schema';
import fixtures from '../../test/fixtures/mealplan-schema.vectors.json';

const WEEK = fixtures.week;

function resolvePayload(ref: unknown): Record<string, unknown> | unknown {
  if (ref === '$validPayload') {
    return JSON.parse(JSON.stringify(fixtures.validPayload));
  }
  return ref;
}

function applyOverrides(
  payload: Record<string, unknown>,
  overrides?: Record<string, unknown>
): Record<string, unknown> {
  if (!overrides) return payload;
  return { ...payload, ...overrides };
}

describe('validateMealPlanPayload (fixture-driven)', () => {
  for (const c of fixtures.cases) {
    it(c.id, () => {
      switch (c.kind) {
        case 'validate': {
          const base = resolvePayload(c.payload) as Record<string, unknown>;
          const payload = applyOverrides(base, c.overrides as Record<string, unknown> | undefined);
          const result = validateMealPlanPayload(payload, WEEK);
          expect(result).not.toBeNull();
          const { plan, readOnly } = result!;
          const exp = c.expected as Record<string, unknown>;
          if ('readOnly' in exp) expect(readOnly).toBe(exp.readOnly);
          if ('schemaVersion' in exp) expect(plan.schemaVersion).toBe(exp.schemaVersion);
          if ('week' in exp) expect(plan.week).toBe(exp.week);
          if ('breakfast' in exp) expect(plan.days.mon?.slots?.breakfast).toEqual(exp.breakfast);
          if ('lunch' in exp) expect(plan.days.mon?.slots?.lunch).toEqual(exp.lunch);
          if ('dayNotes' in exp) expect(plan.days.mon?.notes).toBe(exp.dayNotes);
          if ('weekNotes' in exp) expect(plan.notes).toBe(exp.weekNotes);
          if ('createdAt' in exp) expect(plan.createdAt).toBe(exp.createdAt);
          if (exp.breakfastPresent) expect(plan.days.mon?.slots?.breakfast).toBeDefined();
          break;
        }
        case 'roundTrip': {
          const original = resolvePayload(c.payload) as Record<string, unknown>;
          const validated = validateMealPlanPayload(
            JSON.parse(JSON.stringify(original)),
            WEEK
          )!;
          const roundTripped = JSON.parse(serializeMealPlan(validated.plan));
          expect(roundTripped).toEqual(original);
          break;
        }
        case 'unknownFields': {
          const payload = resolvePayload(c.payload) as Record<string, unknown>;
          const inject = c.inject as {
            top: Record<string, unknown>;
            day: Record<string, unknown>;
            slot: Record<string, unknown>;
          };
          Object.assign(payload, inject.top);
          Object.assign((payload.days as any).mon, inject.day);
          Object.assign((payload.days as any).mon.slots.breakfast, inject.slot);
          const { plan } = validateMealPlanPayload(payload, WEEK)!;
          const serialized = JSON.parse(serializeMealPlan(plan));
          const exp = c.expected as Record<string, unknown>;
          expect(serialized.futureFeature).toEqual(exp.futureFeature);
          expect(serialized.days.mon.dayLevelExtra).toBe(exp.dayLevelExtra);
          expect(serialized.days.mon.slots.breakfast.servings).toBe(exp.servings);
          break;
        }
        case 'dropInvalidSlots': {
          const payload = resolvePayload(c.payload) as Record<string, unknown>;
          Object.assign((payload.days as any).mon.slots, c.injectSlots);
          const { plan } = validateMealPlanPayload(payload, WEEK)!;
          const exp = c.expected as Record<string, unknown>;
          if (exp.dinnerAbsent) expect(plan.days.mon?.slots?.dinner).toBeUndefined();
          if (exp.snackAbsent) expect(plan.days.mon?.slots?.snack).toBeUndefined();
          if (exp.breakfastPresent) expect(plan.days.mon?.slots?.breakfast).toBeDefined();
          if ('dayNotes' in exp) expect(plan.days.mon?.notes).toBe(exp.dayNotes);
          break;
        }
        case 'ignoreUnknownDays': {
          const payload = resolvePayload(c.payload) as Record<string, unknown>;
          Object.assign(payload.days as object, c.injectDays);
          const { plan } = validateMealPlanPayload(payload, WEEK)!;
          expect((plan.days as any).funday).toBeUndefined();
          expect(plan.days.tue).toBeUndefined();
          break;
        }
        case 'defaults': {
          const result = validateMealPlanPayload(c.payload as Record<string, unknown>, WEEK)!;
          const exp = c.expected as Record<string, unknown>;
          expect(result.readOnly).toBe(exp.readOnly);
          expect(result.plan.schemaVersion).toBe(exp.schemaVersion);
          expect(result.plan.week).toBe(exp.week);
          expect(result.plan.days).toEqual(exp.days);
          if (exp.createdAtPositive) expect(result.plan.createdAt).toBeGreaterThan(0);
          break;
        }
        case 'reject': {
          for (const p of c.payloads as unknown[]) {
            expect(validateMealPlanPayload(p, WEEK)).toBeNull();
          }
          break;
        }
        case 'createEmpty': {
          const plan: MealPlan = createEmptyMealPlan(WEEK);
          const exp = c.expected as Record<string, unknown>;
          expect(plan.schemaVersion).toBe(MEALPLAN_SCHEMA_VERSION);
          expect(plan.schemaVersion).toBe(exp.schemaVersion);
          expect(plan.week).toBe(exp.week);
          expect(plan.days).toEqual(exp.days);
          const validated = validateMealPlanPayload(JSON.parse(serializeMealPlan(plan)), WEEK);
          expect(validated?.readOnly).toBe(exp.readOnly);
          break;
        }
        default:
          throw new Error(`unknown case kind: ${(c as { kind: string }).kind}`);
      }
    });
  }
});
