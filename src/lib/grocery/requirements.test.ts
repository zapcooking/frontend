import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: false }));

import { createEmptyMealPlan } from '$lib/mealplan/schema';
import {
  applySnapshotToList,
  buildGrocerySnapshot,
  dropStaleSourcesFromList,
  isManualGroceryItem,
  movePantryCoveredToList,
  removeGroceryItemFromList,
  returnOverrideToPantry,
  unresolvedRecipeSources,
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

  it('preserves manual items when the week is recalculated', () => {
    const list: SnapshotList = {
      ...emptyList(),
      items: [
        {
          id: 'manual-1',
          name: 'Paper towels',
          quantity: '1',
          category: 'other',
          checked: true,
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
    const towels = next.items.find((item) => item.name === 'Paper towels');
    expect(towels && isManualGroceryItem(towels)).toBe(true);
    expect(towels?.checked).toBe(true);
    const chicken = next.items.find((item) => item.normalizedName === 'chicken breast');
    expect(chicken?.id).toBe('recipe-1');
    expect(chicken?.quantity).toBe('4');
    expect(chicken?.checked).toBe(false);
  });
});

describe('checked state vs requirement changes', () => {
  function withChickenChecked(list: SnapshotList): SnapshotList {
    return {
      ...list,
      items: list.items.map((item) =>
        item.normalizedName === 'chicken breast' ? { ...item, checked: true } : item
      )
    };
  }

  it('keeps a checked item checked when the requirement is unchanged', () => {
    const snapshot = buildGrocerySnapshot([row('chicken breast', '2 lb', 'parm', 'mon:dinner')], []);
    const checked = withChickenChecked(applySnapshotToList(emptyList(), snapshot));
    const next = applySnapshotToList(checked, snapshot);
    const chicken = next.items.find((item) => item.normalizedName === 'chicken breast');
    expect(chicken?.quantity).toBe('2 lb');
    expect(chicken?.checked).toBe(true);
  });

  it('unchecks when quantity increases', () => {
    const first = buildGrocerySnapshot([row('chicken breast', '2 lb', 'parm', 'mon:dinner')], []);
    const checked = withChickenChecked(applySnapshotToList(emptyList(), first));
    const next = applySnapshotToList(
      checked,
      buildGrocerySnapshot(
        [
          row('chicken breast', '2 lb', 'parm', 'mon:dinner'),
          row('chicken breast', '2 lb', 'tacos', 'tue:dinner')
        ],
        []
      )
    );
    const chicken = next.items.find((item) => item.normalizedName === 'chicken breast');
    expect(chicken?.quantity).toBe('4 lb');
    expect(chicken?.checked).toBe(false);
  });

  it('unchecks when recipe sources change at the same quantity', () => {
    const first = buildGrocerySnapshot([row('chicken breast', '2 lb', 'parm', 'mon:dinner')], []);
    const checked = withChickenChecked(applySnapshotToList(emptyList(), first));
    const next = applySnapshotToList(
      checked,
      buildGrocerySnapshot([row('chicken breast', '2 lb', 'tacos', 'tue:dinner')], [])
    );
    const chicken = next.items.find((item) => item.normalizedName === 'chicken breast');
    expect(chicken?.quantity).toBe('2 lb');
    expect(chicken?.checked).toBe(false);
  });

  it('unchecks remaining quantity after a meal is removed', () => {
    const snapshot = buildGrocerySnapshot(
      [
        row('chicken breast', '2 lb', 'parm', 'mon:dinner'),
        row('chicken breast', '2 lb', 'tacos', 'tue:dinner')
      ],
      []
    );
    const list = applySnapshotToList(emptyList(), snapshot);
    const checked = {
      ...list,
      items: list.items.map((item) =>
        item.normalizedName === 'chicken breast' ? { ...item, checked: true } : item
      )
    };
    const plan = createEmptyMealPlan('2026-W29');
    plan.days.tue = {
      slots: {
        dinner: { type: 'recipe', a: 'tacos', title: 'Chicken Tacos' }
      }
    };
    const next = dropStaleSourcesFromList(checked, plan);
    const chicken = next.items.find((item) => item.normalizedName === 'chicken breast');
    expect(chicken?.quantity).toBe('2 lb');
    expect(chicken?.checked).toBe(false);
  });
});

describe('unresolved recipe sources', () => {
  it('retains unresolved recipes on the generated list and retry rebuilds without duplicating', () => {
    const occurrences = [
      { a: 'parm', title: 'Chicken Parm' },
      { a: 'tacos', title: 'Chicken Tacos' }
    ];
    const unresolved = unresolvedRecipeSources(occurrences, ['parm']);
    expect(unresolved).toEqual([{ a: 'tacos', title: 'Chicken Tacos' }]);

    const partial = buildGrocerySnapshot([row('chicken breast', '2 lb', 'parm', 'mon:dinner')], [], {
      unresolvedRecipes: unresolved,
      sourceWeekId: '2026-W29'
    });
    expect(partial.toBuy).toHaveLength(1);
    expect(partial.unresolvedRecipes).toEqual([{ a: 'tacos', title: 'Chicken Tacos' }]);

    const list = applySnapshotToList(emptyList(), partial);
    expect(list.unresolvedRecipes).toHaveLength(1);
    expect(list.items.filter((item) => item.normalizedName === 'chicken breast')).toHaveLength(1);

    const resolved = buildGrocerySnapshot(
      [
        row('chicken breast', '2 lb', 'parm', 'mon:dinner'),
        row('chicken breast', '2 lb', 'tacos', 'tue:dinner')
      ],
      [],
      { sourceWeekId: '2026-W29', unresolvedRecipes: [] }
    );
    const retried = applySnapshotToList(list, resolved);
    expect(retried.unresolvedRecipes).toBeUndefined();
    const chicken = retried.items.filter((item) => item.normalizedName === 'chicken breast');
    expect(chicken).toHaveLength(1);
    expect(chicken[0].quantity).toBe('4 lb');
  });

  it('drops unresolved recipes that are no longer on the meal plan', () => {
    const list = applySnapshotToList(
      emptyList(),
      buildGrocerySnapshot([row('chicken breast', '2 lb', 'parm', 'mon:dinner')], [], {
        unresolvedRecipes: [{ a: 'tacos', title: 'Chicken Tacos' }]
      })
    );
    const plan = createEmptyMealPlan('2026-W29');
    plan.days.mon = {
      slots: {
        dinner: { type: 'recipe', a: 'parm', title: 'Chicken Parm' }
      }
    };
    const next = dropStaleSourcesFromList(list, plan);
    expect(next.unresolvedRecipes).toBeUndefined();
  });
});

describe('pantry override reversal', () => {
  it('includes after I still need this, excludes after I have this, and stays excluded on rebuild', () => {
    const pantry = [{ name: 'Olive oil', normalizedName: 'olive oil' }];
    const oliveRow = row('olive oil', '', 'parm', 'mon:dinner');

    const initial = applySnapshotToList(emptyList(), buildGrocerySnapshot([oliveRow], pantry));
    expect(initial.items).toHaveLength(0);
    expect(initial.pantryCovered?.map((item) => item.normalizedName)).toEqual(['olive oil']);

    const overridden = movePantryCoveredToList(initial, 0);
    expect(overridden.added?.pantryOverride).toBe(true);
    expect(overridden.list.items).toHaveLength(1);
    expect(overridden.list.pantryCovered).toBeUndefined();
    expect(overridden.list.pantryOverrides).toEqual(['olive oil']);

    const included = applySnapshotToList(
      overridden.list,
      buildGrocerySnapshot([oliveRow], pantry, { pantryOverrides: overridden.list.pantryOverrides })
    );
    expect(included.items).toHaveLength(1);
    expect(included.items[0].pantryOverride).toBe(true);
    expect(included.pantryOverrides).toEqual(['olive oil']);

    const reversed = returnOverrideToPantry(included, included.items[0].id);
    expect(reversed.items).toHaveLength(0);
    expect(reversed.pantryCovered?.map((item) => item.normalizedName)).toEqual(['olive oil']);
    expect(reversed.pantryOverrides).toBeUndefined();

    const rebuilt = applySnapshotToList(
      reversed,
      buildGrocerySnapshot([oliveRow], pantry, { pantryOverrides: reversed.pantryOverrides })
    );
    expect(rebuilt.items).toHaveLength(0);
    expect(rebuilt.pantryCovered?.map((item) => item.normalizedName)).toEqual(['olive oil']);
    expect(rebuilt.pantryOverrides).toBeUndefined();
  });

  it('does not resurrect an override after the grocery item is removed', () => {
    const pantry = [{ name: 'Olive oil', normalizedName: 'olive oil' }];
    const oliveRow = row('olive oil', '', 'parm', 'mon:dinner');
    const initial = applySnapshotToList(emptyList(), buildGrocerySnapshot([oliveRow], pantry));
    const overridden = movePantryCoveredToList(initial, 0);
    const removed = removeGroceryItemFromList(overridden.list, overridden.added!.id);
    expect(removed.items).toHaveLength(0);
    expect(removed.pantryOverrides).toBeUndefined();

    const rebuilt = applySnapshotToList(
      removed,
      buildGrocerySnapshot([oliveRow], pantry, { pantryOverrides: removed.pantryOverrides })
    );
    expect(rebuilt.items).toHaveLength(0);
    expect(rebuilt.pantryCovered?.map((item) => item.normalizedName)).toEqual(['olive oil']);
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
