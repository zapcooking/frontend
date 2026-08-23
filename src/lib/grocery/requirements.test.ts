import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: false }));

import { createEmptyMealPlan } from '$lib/mealplan/schema';
import {
  applySnapshotToList,
  buildGrocerySnapshot,
  dropStaleSourcesFromList,
  isManualGroceryItem,
  type SnapshotList
} from './requirements';
import type { ConsolidationRow } from './consolidation';

function row(name: string, quantity: string, recipeId: string, occurrenceId: string): ConsolidationRow {
  return {
    ingredient: { name, quantity },
    recipeId,
    recipeTitle: recipeId,
    occurrenceId
  };
}

function emptyList(): SnapshotList {
  return {
    id: 'list-1',
    title: 'Groceries',
    items: [],
    recipeLinks: [],
    createdAt: 1,
    updatedAt: 1
  };
}

describe('buildGrocerySnapshot', () => {
  it('excludes pantry matches and keeps missing items', () => {
    const snapshot = buildGrocerySnapshot(
      [
        row('chicken breast', '1 lb', 'parm', 'mon:dinner'),
        row('rice', '1 cup', 'parm', 'mon:dinner'),
        row('broccoli', '1 head', 'parm', 'mon:dinner'),
        row('olive oil', '', 'parm', 'mon:dinner'),
        row('garlic', '3 cloves', 'parm', 'mon:dinner')
      ],
      [
        { name: 'Chicken breast', normalizedName: 'chicken breast' },
        { name: 'Rice', normalizedName: 'rice' },
        { name: 'Olive oil', normalizedName: 'olive oil' }
      ]
    );
    expect(snapshot.toBuy.map((i) => i.normalizedName).sort()).toEqual(['broccoli', 'garlic']);
    expect(snapshot.inPantry.map((i) => i.normalizedName).sort()).toEqual([
      'chicken breast',
      'olive oil',
      'rice'
    ]);
    expect(snapshot.stats).toEqual({
      totalIngredients: 5,
      pantryCoveredCount: 3,
      addedCount: 2
    });
  });

  it('honors pantry overrides', () => {
    const snapshot = buildGrocerySnapshot(
      [row('rice', '1 cup', 'a', 'mon:dinner')],
      [{ name: 'Rice', normalizedName: 'rice' }],
      { pantryOverrides: ['rice'] }
    );
    expect(snapshot.toBuy).toHaveLength(1);
    expect(snapshot.toBuy[0].pantryOverride).toBe(true);
    expect(snapshot.inPantry).toHaveLength(0);
  });
});

describe('applySnapshotToList', () => {
  it('does not double quantities when the same week is applied twice', () => {
    const snapshot = buildGrocerySnapshot(
      [
        row('chicken breast', '2', 'parm', 'mon:dinner'),
        row('chicken breast', '2', 'tacos', 'tue:dinner')
      ],
      []
    );
    const first = applySnapshotToList(emptyList(), snapshot);
    const second = applySnapshotToList(first, snapshot);
    const chicken = second.items.find((item) => item.normalizedName === 'chicken breast');
    expect(chicken?.quantity).toBe('4');
    expect(second.items.filter((item) => item.normalizedName === 'chicken breast')).toHaveLength(1);
  });

  it('preserves manual items and checked state', () => {
    const list: SnapshotList = {
      ...emptyList(),
      items: [
        {
          id: 'manual-1',
          name: 'Paper towels',
          quantity: '1',
          category: 'other',
          checked: false,
          addedAt: 1,
          origin: 'manual'
        },
        {
          id: 'recipe-1',
          name: 'Chicken Breast',
          quantity: '2',
          category: 'meat-seafood',
          checked: true,
          addedAt: 1,
          origin: 'recipe',
          normalizedName: 'chicken breast',
          sources: [
            {
              recipeId: 'parm',
              occurrenceId: 'mon:dinner',
              quantity: '2',
              recipeTitle: 'parm'
            }
          ]
        }
      ]
    };
    const snapshot = buildGrocerySnapshot(
      [
        row('chicken breast', '2', 'parm', 'mon:dinner'),
        row('chicken breast', '2', 'tacos', 'tue:dinner')
      ],
      []
    );
    const next = applySnapshotToList(list, snapshot);
    expect(next.items.some((item) => item.name === 'Paper towels' && isManualGroceryItem(item))).toBe(
      true
    );
    const chicken = next.items.find((item) => item.normalizedName === 'chicken breast');
    expect(chicken?.checked).toBe(true);
    expect(chicken?.id).toBe('recipe-1');
    expect(chicken?.quantity).toBe('4');
  });
});

describe('dropStaleSourcesFromList', () => {
  it('recalculates remaining quantities when a meal is removed', () => {
    const snapshot = buildGrocerySnapshot(
      [
        row('chicken breast', '2', 'parm', 'mon:dinner'),
        row('chicken breast', '2', 'tacos', 'tue:dinner')
      ],
      []
    );
    const list = applySnapshotToList(emptyList(), snapshot);
    const plan = createEmptyMealPlan('2026-W29');
    plan.days.tue = {
      slots: {
        dinner: { type: 'recipe', a: 'tacos', title: 'Chicken Tacos' }
      }
    };

    const next = dropStaleSourcesFromList(list, plan);
    const chicken = next.items.find((item) => item.normalizedName === 'chicken breast');
    expect(chicken?.quantity).toBe('2');
    expect(chicken?.sources).toHaveLength(1);
    expect(chicken?.sources?.[0].recipeId).toBe('tacos');
  });

  it('removes a grocery item when no recipes still need it', () => {
    const snapshot = buildGrocerySnapshot(
      [row('broccoli', '1 head', 'parm', 'mon:dinner')],
      []
    );
    const list = applySnapshotToList(emptyList(), snapshot);
    const next = dropStaleSourcesFromList(list, createEmptyMealPlan('2026-W29'));
    expect(next.items).toHaveLength(0);
  });
});
