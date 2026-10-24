import { describe, it, expect } from 'vitest';
import {
  isRecipeEligibleForSlot,
  eligibleSlotsForRecipe,
  restrictCandidatesToRequestedSlots,
  insufficientSlotCoverageMessage,
  noEligibleRecipesMessage
} from './slotEligibility';
import type { MealSlotKey } from './schema';
import fixtures from '../../test/fixtures/mealplan-eligibility.vectors.json';

/**
 * Fixture-driven slot-eligibility tests. Expectations live in
 * src/test/fixtures/mealplan-eligibility.vectors.json (cross-platform contract).
 * Vectors record current Cheffy behavior, including quirks.
 */

const FIXTURE_CASE_ARRAYS = [
  'isRecipeEligibleForSlot',
  'eligibleSlotsForRecipe',
  'restrictCandidatesToRequestedSlots',
  'insufficientSlotCoverageMessage',
  'noEligibleRecipesMessage'
] as const;

describe('mealplan-eligibility fixtures', () => {
  it('executes every case array in the fixture', () => {
    const keys = Object.keys(fixtures)
      .filter((k) => k !== 'description')
      .sort();
    expect(keys).toEqual([...FIXTURE_CASE_ARRAYS].sort());
  });
});

describe('isRecipeEligibleForSlot', () => {
  for (const c of fixtures.isRecipeEligibleForSlot) {
    it(c.id, () => {
      expect(isRecipeEligibleForSlot({ title: c.title, tags: c.tags }, c.slot as MealSlotKey)).toBe(
        c.expected
      );
    });
  }
});

describe('eligibleSlotsForRecipe', () => {
  for (const c of fixtures.eligibleSlotsForRecipe) {
    it(c.id, () => {
      expect(eligibleSlotsForRecipe({ title: c.title, tags: c.tags })).toEqual(c.expected);
    });
  }
});

describe('restrictCandidatesToRequestedSlots', () => {
  for (const c of fixtures.restrictCandidatesToRequestedSlots) {
    it(c.id, () => {
      const surviving = restrictCandidatesToRequestedSlots(
        c.candidates,
        c.mealSlots as MealSlotKey[]
      );
      expect(surviving.map((row) => row.id)).toEqual(c.expected);
    });
  }
});

describe('insufficientSlotCoverageMessage', () => {
  for (const c of fixtures.insufficientSlotCoverageMessage) {
    it(c.id, () => {
      expect(
        insufficientSlotCoverageMessage({
          mealSlots: c.mealSlots as MealSlotKey[],
          found: c.found,
          requested: c.requested
        })
      ).toBe(c.expected);
    });
  }
});

describe('noEligibleRecipesMessage', () => {
  for (const c of fixtures.noEligibleRecipesMessage) {
    it(c.id, () => {
      expect(noEligibleRecipesMessage(c.mealSlots as MealSlotKey[])).toBe(c.expected);
    });
  }
});
