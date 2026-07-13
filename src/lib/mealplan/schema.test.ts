import { describe, it, expect } from 'vitest';
import {
  validateMealPlanPayload,
  createEmptyMealPlan,
  serializeMealPlan,
  MEALPLAN_SCHEMA_VERSION,
  type MealPlan
} from './schema';

const WEEK = '2026-W29';

function validPayload(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    week: WEEK,
    days: {
      mon: {
        slots: {
          breakfast: { type: 'recipe', a: '30023:abc:shakshuka', title: 'Shakshuka' },
          lunch: { type: 'text', text: 'Leftovers' }
        },
        notes: 'prep the night before'
      }
    },
    notes: 'light week',
    createdAt: 1789000000,
    updatedAt: 1789000123
  };
}

describe('validateMealPlanPayload', () => {
  it('accepts both tagged-union branches', () => {
    const result = validateMealPlanPayload(validPayload(), WEEK);
    expect(result).not.toBeNull();
    const { plan, readOnly } = result!;
    expect(readOnly).toBe(false);
    expect(plan.days.mon?.slots?.breakfast).toEqual({
      type: 'recipe',
      a: '30023:abc:shakshuka',
      title: 'Shakshuka'
    });
    expect(plan.days.mon?.slots?.lunch).toEqual({ type: 'text', text: 'Leftovers' });
    expect(plan.days.mon?.notes).toBe('prep the night before');
    expect(plan.notes).toBe('light week');
    expect(plan.createdAt).toBe(1789000000);
  });

  it('round-trips: encode → validate → serialize preserves the payload', () => {
    const original = validPayload();
    const validated = validateMealPlanPayload(JSON.parse(JSON.stringify(original)), WEEK)!;
    const roundTripped = JSON.parse(serializeMealPlan(validated.plan));
    expect(roundTripped).toEqual(original);
  });

  it('preserves unknown fields at top, day, and slot level', () => {
    const payload = validPayload();
    payload.futureFeature = { some: 'data' };
    (payload.days as any).mon.dayLevelExtra = 42;
    (payload.days as any).mon.slots.breakfast.servings = 3;

    const { plan } = validateMealPlanPayload(payload, WEEK)!;
    const serialized = JSON.parse(serializeMealPlan(plan));
    expect(serialized.futureFeature).toEqual({ some: 'data' });
    expect(serialized.days.mon.dayLevelExtra).toBe(42);
    expect(serialized.days.mon.slots.breakfast.servings).toBe(3);
  });

  it('flags schemaVersion > 1 as read-only without dropping content', () => {
    const payload = validPayload();
    payload.schemaVersion = 2;
    const result = validateMealPlanPayload(payload, WEEK)!;
    expect(result.readOnly).toBe(true);
    expect(result.plan.schemaVersion).toBe(2);
    expect(result.plan.days.mon?.slots?.breakfast).toBeDefined();
  });

  it('the d-tag week wins over a mismatched payload week', () => {
    const payload = validPayload();
    payload.week = '2020-W01';
    const { plan } = validateMealPlanPayload(payload, WEEK)!;
    expect(plan.week).toBe(WEEK);
  });

  it('drops invalid slot entries but keeps the rest of the day', () => {
    const payload = validPayload();
    (payload.days as any).mon.slots.dinner = { type: 'recipe' }; // missing a
    (payload.days as any).mon.slots.snack = { type: 'mystery', x: 1 }; // unknown type
    const { plan } = validateMealPlanPayload(payload, WEEK)!;
    expect(plan.days.mon?.slots?.dinner).toBeUndefined();
    expect(plan.days.mon?.slots?.snack).toBeUndefined();
    expect(plan.days.mon?.slots?.breakfast).toBeDefined();
    expect(plan.days.mon?.notes).toBe('prep the night before');
  });

  it('ignores unknown day keys and non-object days', () => {
    const payload = validPayload();
    (payload.days as any).funday = { slots: {} };
    (payload.days as any).tue = 'not a day';
    const { plan } = validateMealPlanPayload(payload, WEEK)!;
    expect((plan.days as any).funday).toBeUndefined();
    expect(plan.days.tue).toBeUndefined();
  });

  it('defensively defaults missing fields', () => {
    const { plan, readOnly } = validateMealPlanPayload({}, WEEK)!;
    expect(readOnly).toBe(false);
    expect(plan.schemaVersion).toBe(1);
    expect(plan.week).toBe(WEEK);
    expect(plan.days).toEqual({});
    expect(plan.createdAt).toBeGreaterThan(0);
  });

  it('rejects structurally unusable payloads', () => {
    expect(validateMealPlanPayload(null, WEEK)).toBeNull();
    expect(validateMealPlanPayload('a string', WEEK)).toBeNull();
    expect(validateMealPlanPayload([1, 2], WEEK)).toBeNull();
  });
});

describe('createEmptyMealPlan', () => {
  it('creates a valid v1 skeleton', () => {
    const plan: MealPlan = createEmptyMealPlan(WEEK);
    expect(plan.schemaVersion).toBe(MEALPLAN_SCHEMA_VERSION);
    expect(plan.week).toBe(WEEK);
    expect(plan.days).toEqual({});
    const validated = validateMealPlanPayload(JSON.parse(serializeMealPlan(plan)), WEEK);
    expect(validated?.readOnly).toBe(false);
  });
});
