import { describe, it, expect } from 'vitest';
import {
  costHint,
  emptyPlanningPreferences,
  familiarCoordinatesFromSources,
  hasEnabledPlanningMode,
  normalizePlanningPreferences,
  overlappingIngredientHints,
  planningModePromptLines,
  planningPreferencesFromKeys,
  sanitizePlanningPreferences,
  scorePlanningModes,
  summarizePlanningModeFeedback,
  togglePlanningMode
} from './planningModes';

describe('sanitizePlanningPreferences', () => {
  it('defaults every mode off and ignores unknown keys', () => {
    expect(sanitizePlanningPreferences(undefined)).toEqual(emptyPlanningPreferences());
    expect(
      sanitizePlanningPreferences({ usePantry: true, notAMode: true, healthy: 'yes' })
    ).toEqual({
      ...emptyPlanningPreferences(),
      usePantry: true
    });
  });

  it('treats prioritizePantry as Use My Pantry', () => {
    const prefs = normalizePlanningPreferences(undefined, true);
    expect(prefs.usePantry).toBe(true);
    expect(hasEnabledPlanningMode(prefs)).toBe(true);
  });
});

describe('togglePlanningMode', () => {
  it('toggles a single mode without clearing others', () => {
    const start = planningPreferencesFromKeys(['healthy']);
    const next = togglePlanningMode(start, 'quickMeals');
    expect(next.healthy).toBe(true);
    expect(next.quickMeals).toBe(true);
    expect(togglePlanningMode(next, 'healthy').healthy).toBe(false);
  });
});

describe('scorePlanningModes', () => {
  const emptyCtx = {
    minutes: null as number | null,
    ingredientFrequency: new Map<string, number>(),
    familiarCoordinates: new Set<string>(),
    familiarCuisines: new Set<string>()
  };

  it('scores budget vs pricey without inventing prices', () => {
    const cheap = scorePlanningModes(
      {
        a: '30023:pk:beans',
        title: 'Rice and Beans',
        tags: [],
        ingredients: ['rice', 'black beans', 'onion']
      },
      { ...emptyPlanningPreferences(), budgetFriendly: true },
      emptyCtx
    );
    const pricey = scorePlanningModes(
      {
        a: '30023:pk:surf',
        title: 'Truffle Lobster',
        tags: [],
        ingredients: ['lobster', 'truffle', 'saffron']
      },
      { ...emptyPlanningPreferences(), budgetFriendly: true },
      emptyCtx
    );
    expect(costHint({ a: 'x', title: 'Rice and Beans', tags: [], ingredients: ['rice', 'beans'] })).toBe(
      'budget'
    );
    expect(cheap).toBeGreaterThan(pricey);
  });

  it('uses nourish protein grams ahead of title keywords', () => {
    const withMacros = scorePlanningModes(
      {
        a: '30023:pk:a',
        title: 'Salad',
        tags: [],
        ingredients: ['lettuce'],
        nourish: { proteinGrams: 40, protein: 8 }
      },
      { ...emptyPlanningPreferences(), highProtein: true },
      emptyCtx
    );
    const keywordsOnly = scorePlanningModes(
      {
        a: '30023:pk:b',
        title: 'Chicken Chicken',
        tags: ['protein'],
        ingredients: ['chicken']
      },
      { ...emptyPlanningPreferences(), highProtein: true },
      emptyCtx
    );
    expect(withMacros).toBeGreaterThan(keywordsOnly);
  });
});

describe('planningModePromptLines', () => {
  it('emits an explicit instruction per enabled mode', () => {
    const lines = planningModePromptLines({
      ...emptyPlanningPreferences(),
      usePantry: true,
      budgetFriendly: true,
      quickMeals: true
    });
    const text = lines.join('\n');
    expect(text).toContain('Use My Pantry:');
    expect(text).toContain('Keep It Cheap:');
    expect(text).toContain('Quick Meals:');
    expect(text).not.toContain('Make this healthy and cheap');
    expect(text).toContain('weighted preferences');
  });

  it('returns nothing when no modes are on', () => {
    expect(planningModePromptLines(emptyPlanningPreferences())).toEqual([]);
  });
});

describe('summarizePlanningModeFeedback', () => {
  it('only reports pantry and reuse counts that can be counted', () => {
    const feedback = summarizePlanningModeFeedback({
      preferences: {
        ...emptyPlanningPreferences(),
        usePantry: true,
        lowWaste: true,
        budgetFriendly: true
      },
      meals: [
        {
          a: '30023:pk:tacos',
          pantry: { matchedIngredients: ['chicken', 'spinach'] }
        },
        {
          a: '30023:pk:quesadilla',
          pantry: { matchedIngredients: ['spinach'] }
        }
      ],
      recipes: [
        { a: '30023:pk:tacos', ingredients: ['chicken', 'spinach', 'tortillas', 'salt'] },
        { a: '30023:pk:quesadilla', ingredients: ['spinach', 'tortillas', 'cheese'] }
      ]
    });
    expect(feedback?.labels).toEqual(['Pantry', 'Cheap', 'Low Waste']);
    expect(feedback?.summary).toContain('2 pantry ingredients used');
    expect(feedback?.summary).toContain('2 ingredients reused across meals');
    expect(feedback?.summary).not.toMatch(/\$|saved|calories/);
  });

  it('mentions 30 minutes only when most meals have known short times', () => {
    const feedback = summarizePlanningModeFeedback({
      preferences: { ...emptyPlanningPreferences(), quickMeals: true },
      meals: [{ a: '30023:pk:a' }, { a: '30023:pk:b' }],
      recipes: [
        { a: '30023:pk:a', minutes: 20 },
        { a: '30023:pk:b', minutes: 25 }
      ]
    });
    expect(feedback?.summary).toBe('Most meals are ready in about 30 minutes.');
  });
});

describe('overlappingIngredientHints', () => {
  it('lists ingredients that appear in more than one recipe', () => {
    expect(
      overlappingIngredientHints([
        { ingredients: ['chicken', 'spinach', 'salt'] },
        { ingredients: ['spinach', 'tortillas'] },
        { ingredients: ['tuna'] }
      ])
    ).toEqual(['spinach']);
  });
});

describe('familiarCoordinatesFromSources', () => {
  it('dedupes saved and planned coordinates', () => {
    expect(
      familiarCoordinatesFromSources({
        savedAs: ['30023:pk:a', '30023:pk:b'],
        plannedAs: ['30023:pk:b', '30023:pk:c']
      })
    ).toEqual(['30023:pk:a', '30023:pk:b', '30023:pk:c']);
  });
});
