import { describe, it, expect } from 'vitest';
import { createEmptyMealPlan } from './schema';
import {
  cartesianSlots,
  filterRecipeCandidates,
  occupiedSlotsFromPlan,
  parseDurationMinutes,
  parseExcludeIngredientsInput,
  parseGenerationRequest,
  resolveTargetSlots,
  totalActiveMinutes,
  validateGeneratedMealPlan,
  type MealPlanGenerationRequest,
  type RecipeCandidate
} from './generation';
import {
  eligibleSlotsForRecipe,
  insufficientSlotCoverageMessage,
  isRecipeEligibleForSlot,
  restrictCandidatesToRequestedSlots
} from './slotEligibility';

function cand(id: string, extra: Partial<RecipeCandidate> = {}): RecipeCandidate {
  return {
    a: `30023:pk:${id}`,
    title: extra.title ?? id,
    tags: extra.tags ?? [],
    ingredients: extra.ingredients ?? [],
    ...extra
  };
}

function baseRequest(
  overrides: Partial<MealPlanGenerationRequest> = {}
): MealPlanGenerationRequest {
  return {
    weekId: '2026-W34',
    days: ['mon', 'tue'],
    mealSlots: ['dinner'],
    preferences: { styles: ['mediterranean'] },
    strategy: 'fill-empty',
    candidates: [
      cand('salmon', { title: 'Mediterranean Salmon', tags: ['mediterranean'] }),
      cand('pasta', { title: 'Pasta' })
    ],
    occupiedSlots: [],
    ...overrides
  };
}

describe('parseDurationMinutes', () => {
  it('parses minutes, hours, and combined strings', () => {
    expect(parseDurationMinutes('30 min')).toBe(30);
    expect(parseDurationMinutes('30 minutes')).toBe(30);
    expect(parseDurationMinutes('1 hour')).toBe(60);
    expect(parseDurationMinutes('1h 15m')).toBe(75);
    expect(parseDurationMinutes('90')).toBe(90);
    expect(parseDurationMinutes('')).toBeNull();
    expect(parseDurationMinutes('until golden')).toBeNull();
  });
});

describe('totalActiveMinutes', () => {
  it('sums prep and cook when both parse', () => {
    expect(totalActiveMinutes('10 min', '20 min')).toBe(30);
    expect(totalActiveMinutes(undefined, '25 minutes')).toBe(25);
    expect(totalActiveMinutes('quick', 'fast')).toBeNull();
  });
});

describe('filterRecipeCandidates', () => {
  it('drops recipes that obviously exceed maxMinutes', () => {
    const out = filterRecipeCandidates(
      [
        cand('slow', { prepTime: '20 min', cookTime: '40 min', title: 'Roast' }),
        cand('fast', { prepTime: '5 min', cookTime: '15 min', title: 'Skillet' }),
        cand('unknown', { title: 'Mystery' })
      ],
      { maxMinutes: 30 }
    );
    const ids = out.map((c) => c.a);
    expect(ids).not.toContain('30023:pk:slow');
    expect(ids).toContain('30023:pk:fast');
    expect(ids).toContain('30023:pk:unknown');
  });

  it('drops recipes whose ingredients obviously match excludes', () => {
    const out = filterRecipeCandidates(
      [
        cand('shrimp', { ingredients: ['1 lb shrimp', 'garlic'], title: 'Garlic Shrimp' }),
        cand('tofu', { ingredients: ['tofu', 'soy sauce'], title: 'Tofu Stir Fry' })
      ],
      { excludeIngredients: ['shellfish', 'shrimp'] }
    );
    expect(out.map((c) => c.a)).toEqual(['30023:pk:tofu']);
  });

  it('drops obvious meat when vegetarian is selected and ingredients are known', () => {
    const out = filterRecipeCandidates(
      [
        cand('steak', { ingredients: ['ribeye steak', 'salt'], title: 'Steak' }),
        cand('salad', {
          ingredients: ['chickpeas', 'cucumber'],
          title: 'Chickpea Salad',
          tags: ['vegetarian']
        })
      ],
      { styles: ['vegetarian'] }
    );
    expect(out.map((c) => c.a)).toEqual(['30023:pk:salad']);
  });

  it('narrows to style matches when there are enough of them', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      cand(`med-${i}`, { title: `Mediterranean Bowl ${i}`, tags: ['mediterranean'] })
    );
    const other = cand('chili', { title: 'Chili', tags: ['spicy'] });
    const out = filterRecipeCandidates([...many, other], {
      styles: ['mediterranean'],
      maxCandidates: 48
    });
    expect(out.map((c) => c.a)).not.toContain('30023:pk:chili');
    expect(out.length).toBe(12);
  });

  it('caps the candidate set', () => {
    const many = Array.from({ length: 80 }, (_, i) => cand(`r${i}`, { title: `Recipe ${i}` }));
    const out = filterRecipeCandidates(many, { maxCandidates: 10 });
    expect(out).toHaveLength(10);
  });

  it('omits excluded coordinates used by swap', () => {
    const out = filterRecipeCandidates([cand('a'), cand('b')], {
      excludeCoordinates: ['30023:pk:a']
    });
    expect(out.map((c) => c.a)).toEqual(['30023:pk:b']);
  });

  it('keeps breakfast-tagged recipes and drops dinner entrees for breakfast slots', () => {
    const out = filterRecipeCandidates(
      [
        cand('oats', { title: 'Whatever', tags: ['breakfast'] }),
        cand('chicken', { title: 'Garlic Parmesan Chicken', tags: ['dinner'] })
      ],
      { mealSlots: ['breakfast'] }
    );
    expect(out.map((c) => c.a)).toEqual(['30023:pk:oats']);
  });

  it('qualifies a breakfast title when tags are absent', () => {
    const out = filterRecipeCandidates(
      [cand('pancakes', { title: 'Blueberry Pancakes' }), cand('stew', { title: 'Beef Stew' })],
      { mealSlots: ['breakfast'] }
    );
    expect(out.map((c) => c.a)).toEqual(['30023:pk:pancakes']);
  });

  it('does not restrict lunch or dinner to breakfast recipes', () => {
    const chicken = cand('chicken', { title: 'Garlic Parmesan Chicken', tags: ['dinner'] });
    const pancakes = cand('pancakes', { title: 'Blueberry Pancakes', tags: ['breakfast'] });
    expect(
      filterRecipeCandidates([chicken, pancakes], { mealSlots: ['dinner'] }).map((c) => c.a)
    ).toEqual(['30023:pk:chicken', '30023:pk:pancakes']);
    expect(
      filterRecipeCandidates([chicken, pancakes], { mealSlots: ['lunch'] }).map((c) => c.a)
    ).toEqual(['30023:pk:chicken', '30023:pk:pancakes']);
  });

  it('does not pad breakfast with dinner recipes when too few breakfast candidates remain', () => {
    const breakfasts = [
      cand('oats', { title: 'Overnight Oats', tags: ['breakfast'] }),
      cand('yogurt', { title: 'Yogurt Parfait' }),
      cand('eggs', { title: 'Scrambled Eggs' })
    ];
    const dinners = Array.from({ length: 10 }, (_, i) =>
      cand(`dinner-${i}`, { title: `Roast Chicken ${i}`, tags: ['dinner'] })
    );
    const out = filterRecipeCandidates([...breakfasts, ...dinners], { mealSlots: ['breakfast'] });
    expect(out).toHaveLength(3);
    expect(out.every((c) => isRecipeEligibleForSlot(c, 'breakfast'))).toBe(true);
  });

  it('prefers higher pantry-match recipes when prioritizePantry is on', () => {
    const high = cand('parm', {
      title: 'Chicken Parmesan',
      ingredients: ['chicken breast', 'parmesan', 'egg'],
      pantry: {
        matchedCount: 5,
        totalCount: 7,
        matchRatio: 5 / 7,
        matchedIngredients: ['chicken breast', 'parmesan', 'egg', 'olive oil', 'garlic'],
        missingIngredients: ['breadcrumbs', 'tomato sauce']
      }
    });
    const low = cand('taco', {
      title: 'Fish Tacos',
      ingredients: ['fish', 'tortilla'],
      pantry: {
        matchedCount: 1,
        totalCount: 8,
        matchRatio: 1 / 8,
        matchedIngredients: ['olive oil'],
        missingIngredients: ['fish']
      }
    });
    const out = filterRecipeCandidates([low, high], { prioritizePantry: true });
    expect(out.map((c) => c.a)).toEqual(['30023:pk:parm', '30023:pk:taco']);
  });

  it('does not let pantry match override vegetarian', () => {
    const steak = cand('steak', {
      title: 'Steak',
      ingredients: ['ribeye steak', 'salt'],
      pantry: {
        matchedCount: 2,
        totalCount: 2,
        matchRatio: 1,
        matchedIngredients: ['ribeye steak', 'salt'],
        missingIngredients: []
      }
    });
    const salad = cand('salad', {
      title: 'Chickpea Salad',
      tags: ['vegetarian'],
      ingredients: ['chickpeas'],
      pantry: {
        matchedCount: 0,
        totalCount: 1,
        matchRatio: 0,
        matchedIngredients: [],
        missingIngredients: ['chickpeas']
      }
    });
    const out = filterRecipeCandidates([steak, salad], {
      styles: ['vegetarian'],
      prioritizePantry: true
    });
    expect(out.map((c) => c.a)).toEqual(['30023:pk:salad']);
  });

  it('still drops excluded ingredients when pantry matching is on', () => {
    const out = filterRecipeCandidates(
      [
        cand('shrimp', {
          ingredients: ['shrimp'],
          pantry: {
            matchedCount: 1,
            totalCount: 1,
            matchRatio: 1,
            matchedIngredients: ['shrimp'],
            missingIngredients: []
          }
        }),
        cand('tofu', { ingredients: ['tofu'] })
      ],
      { excludeIngredients: ['shrimp'], prioritizePantry: true }
    );
    expect(out.map((c) => c.a)).toEqual(['30023:pk:tofu']);
  });

  it('keeps breakfast eligibility ahead of pantry ranking', () => {
    const out = filterRecipeCandidates(
      [
        cand('chicken', {
          title: 'Garlic Parmesan Chicken',
          tags: ['dinner'],
          pantry: {
            matchedCount: 6,
            totalCount: 6,
            matchRatio: 1,
            matchedIngredients: [],
            missingIngredients: []
          }
        }),
        cand('oats', { title: 'Overnight Oats', tags: ['breakfast'] })
      ],
      { mealSlots: ['breakfast'], prioritizePantry: true }
    );
    expect(out.map((c) => c.a)).toEqual(['30023:pk:oats']);
  });

  it('composes breakfast eligibility with max time, excludes, and vegetarian', () => {
    const out = filterRecipeCandidates(
      [
        cand('slow-oats', {
          title: 'Overnight Oats',
          tags: ['breakfast', 'vegetarian'],
          prepTime: '5 min',
          cookTime: '40 min',
          ingredients: ['oats', 'milk']
        }),
        cand('bacon-eggs', {
          title: 'Bacon and Eggs',
          tags: ['breakfast'],
          prepTime: '5 min',
          cookTime: '10 min',
          ingredients: ['bacon', 'eggs']
        }),
        cand('yogurt', {
          title: 'Yogurt Bowl',
          tags: ['breakfast', 'vegetarian'],
          prepTime: '5 min',
          cookTime: '0 min',
          ingredients: ['yogurt', 'berries']
        }),
        cand('tofu-scramble', {
          title: 'Tofu Scramble',
          tags: ['breakfast', 'vegetarian'],
          prepTime: '5 min',
          cookTime: '10 min',
          ingredients: ['tofu', 'peanuts']
        }),
        cand('salad', {
          title: 'Chickpea Salad',
          tags: ['vegetarian', 'lunch'],
          prepTime: '10 min',
          cookTime: '0 min',
          ingredients: ['chickpeas']
        })
      ],
      {
        mealSlots: ['breakfast'],
        maxMinutes: 20,
        styles: ['vegetarian'],
        excludeIngredients: ['peanuts']
      }
    );
    expect(out.map((c) => c.a)).toEqual(['30023:pk:yogurt']);
  });
});

describe('resolveTargetSlots', () => {
  it('skips occupied slots for fill-empty and keeps them for replace-selected', () => {
    const occupied = [{ day: 'mon' as const, slot: 'dinner' as const }];
    const fill = resolveTargetSlots({
      days: ['mon', 'tue'],
      mealSlots: ['dinner'],
      strategy: 'fill-empty',
      occupiedSlots: occupied
    });
    expect(fill).toEqual([{ day: 'tue', slot: 'dinner' }]);

    const replace = resolveTargetSlots({
      days: ['mon', 'tue'],
      mealSlots: ['dinner'],
      strategy: 'replace-selected',
      occupiedSlots: occupied
    });
    expect(replace).toEqual(cartesianSlots(['mon', 'tue'], ['dinner']));
  });

  it('honors fillSlots for a single-meal swap', () => {
    const out = resolveTargetSlots({
      days: ['mon', 'tue'],
      mealSlots: ['dinner'],
      strategy: 'fill-empty',
      fillSlots: [{ day: 'tue', slot: 'dinner' }]
    });
    expect(out).toEqual([{ day: 'tue', slot: 'dinner' }]);
  });
});

describe('occupiedSlotsFromPlan', () => {
  it('reports slots that already have a meal', () => {
    const plan = createEmptyMealPlan('2026-W34');
    plan.days.mon = { slots: { dinner: { type: 'recipe', a: '30023:pk:x', title: 'X' } } };
    expect(occupiedSlotsFromPlan(plan, ['mon', 'tue'], ['dinner'])).toEqual([
      { day: 'mon', slot: 'dinner' }
    ]);
  });
});

describe('parseGenerationRequest', () => {
  it('accepts a well-formed request and sanitizes candidates', () => {
    const parsed = parseGenerationRequest({
      weekId: '2026-W34',
      days: ['mon', 'mon', 'tue'],
      mealSlots: ['dinner'],
      strategy: 'fill-empty',
      candidates: [cand('salmon', { title: 'Salmon' }), { a: 'nope', title: 'Bad' }]
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.request.days).toEqual(['mon', 'tue']);
    expect(parsed.request.candidates).toHaveLength(1);
  });

  it('keeps prioritizePantry and candidate pantry match data', () => {
    const parsed = parseGenerationRequest({
      weekId: '2026-W34',
      days: ['mon'],
      mealSlots: ['dinner'],
      strategy: 'fill-empty',
      prioritizePantry: true,
      candidates: [
        cand('salmon', {
          title: 'Salmon',
          pantry: {
            matchedCount: 2,
            totalCount: 4,
            matchRatio: 0.5,
            matchedIngredients: ['olive oil', 'garlic'],
            missingIngredients: ['salmon', 'lemon']
          }
        })
      ]
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.request.prioritizePantry).toBe(true);
    expect(parsed.request.candidates[0].pantry?.matchedCount).toBe(2);
    expect(parsed.request.candidates[0].pantry?.missingIngredients).toEqual(['salmon', 'lemon']);
  });

  it('keeps pantryIngredients when prioritizePantry is on', () => {
    const parsed = parseGenerationRequest({
      weekId: '2026-W34',
      days: ['mon'],
      mealSlots: ['dinner'],
      strategy: 'fill-empty',
      prioritizePantry: true,
      pantryIngredients: ['chicken breast', 'rice', '  ', 'eggs'],
      candidates: [cand('salmon', { title: 'Salmon' })]
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.request.pantryIngredients).toEqual(['chicken breast', 'rice', 'eggs']);
  });

  it('rejects missing days, slots, or candidates', () => {
    expect(parseGenerationRequest({ weekId: 'nope' }).ok).toBe(false);
    expect(
      parseGenerationRequest({
        weekId: '2026-W34',
        days: [],
        mealSlots: ['dinner'],
        strategy: 'fill-empty',
        candidates: [cand('a')]
      }).ok
    ).toBe(false);
    expect(
      parseGenerationRequest({
        weekId: '2026-W34',
        days: ['mon'],
        mealSlots: ['dinner'],
        strategy: 'fill-empty',
        candidates: []
      })
    ).toMatchObject({ ok: false, error: 'no-candidates' });
  });

  it('rejects fill-empty when every requested slot is occupied', () => {
    const parsed = parseGenerationRequest({
      weekId: '2026-W34',
      days: ['mon'],
      mealSlots: ['dinner'],
      strategy: 'fill-empty',
      occupiedSlots: [{ day: 'mon', slot: 'dinner' }],
      candidates: [cand('a', { title: 'A' })]
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toBe('no-target-slots');
  });
});

describe('validateGeneratedMealPlan', () => {
  it('accepts meals drawn only from the candidate set', () => {
    const req = baseRequest();
    const result = validateGeneratedMealPlan(
      {
        meals: [
          { day: 'mon', slot: 'dinner', a: '30023:pk:salmon', title: 'whatever Cheffy said' },
          { day: 'tue', slot: 'dinner', a: '30023:pk:pasta', title: 'Pasta' }
        ]
      },
      req
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.meals[0].title).toBe('Mediterranean Salmon');
  });

  it('rejects a hallucinated recipe coordinate', () => {
    const result = validateGeneratedMealPlan(
      { meals: [{ day: 'mon', slot: 'dinner', a: '30023:pk:invented', title: 'Ghost Stew' }] },
      baseRequest()
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unknown-recipe');
  });

  it('rejects days or slots that were not requested', () => {
    expect(
      validateGeneratedMealPlan(
        { meals: [{ day: 'sun', slot: 'dinner', a: '30023:pk:salmon', title: 'S' }] },
        baseRequest()
      )
    ).toMatchObject({ ok: false, error: 'unknown-slot' });
    expect(
      validateGeneratedMealPlan(
        { meals: [{ day: 'mon', slot: 'breakfast', a: '30023:pk:salmon', title: 'S' }] },
        baseRequest()
      )
    ).toMatchObject({ ok: false, error: 'unknown-slot' });
  });

  it('rejects duplicate slot assignments', () => {
    const result = validateGeneratedMealPlan(
      {
        meals: [
          { day: 'mon', slot: 'dinner', a: '30023:pk:salmon', title: 'S' },
          { day: 'mon', slot: 'dinner', a: '30023:pk:pasta', title: 'P' }
        ]
      },
      baseRequest()
    );
    expect(result).toMatchObject({ ok: false, error: 'duplicate-slot' });
  });

  it('rejects fill-empty overwrites of occupied slots', () => {
    const result = validateGeneratedMealPlan(
      { meals: [{ day: 'mon', slot: 'dinner', a: '30023:pk:salmon', title: 'S' }] },
      baseRequest({ occupiedSlots: [{ day: 'mon', slot: 'dinner' }] })
    );
    expect(result).toMatchObject({ ok: false, error: 'overwrite-occupied' });
  });

  it('rejects a breakfast assignment of a dinner entree even if it is in the candidate set', () => {
    const result = validateGeneratedMealPlan(
      {
        meals: [
          { day: 'mon', slot: 'breakfast', a: '30023:pk:chicken', title: 'Garlic Parmesan Chicken' }
        ]
      },
      baseRequest({
        mealSlots: ['breakfast', 'dinner'],
        days: ['mon'],
        candidates: [
          cand('chicken', { title: 'Garlic Parmesan Chicken', tags: ['dinner'] }),
          cand('oats', { title: 'Overnight Oats', tags: ['breakfast'] })
        ]
      })
    );
    expect(result).toMatchObject({ ok: false, error: 'ineligible-slot' });
  });

  it('copies pantry match data onto generated meals from the candidate', () => {
    const pantry = {
      matchedCount: 3,
      totalCount: 4,
      matchRatio: 0.75,
      matchedIngredients: ['egg'],
      missingIngredients: ['feta']
    };
    const result = validateGeneratedMealPlan(
      { meals: [{ day: 'mon', slot: 'dinner', a: '30023:pk:salmon', title: 'S' }] },
      baseRequest({
        days: ['mon'],
        candidates: [
          cand('salmon', {
            title: 'Mediterranean Salmon',
            tags: ['mediterranean'],
            pantry
          })
        ]
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.meals[0].pantry).toEqual(pantry);
  });

  it('accepts a breakfast-tagged recipe in a breakfast slot', () => {
    const result = validateGeneratedMealPlan(
      { meals: [{ day: 'mon', slot: 'breakfast', a: '30023:pk:oats', title: 'Overnight Oats' }] },
      baseRequest({
        mealSlots: ['breakfast'],
        days: ['mon'],
        candidates: [cand('oats', { title: 'Overnight Oats', tags: ['breakfast'] })]
      })
    );
    expect(result.ok).toBe(true);
  });
});

describe('slot eligibility', () => {
  it('treats an explicit breakfast tag as breakfast-eligible', () => {
    const recipe = cand('oats', { title: 'Savory Bowl', tags: ['breakfast'] });
    expect(isRecipeEligibleForSlot(recipe, 'breakfast')).toBe(true);
    expect(eligibleSlotsForRecipe(recipe)).toContain('breakfast');
  });

  it('does not treat an obvious dinner entree as breakfast', () => {
    const recipe = cand('chicken', { title: 'Garlic Parmesan Chicken', tags: ['dinner'] });
    expect(isRecipeEligibleForSlot(recipe, 'breakfast')).toBe(false);
    expect(isRecipeEligibleForSlot(recipe, 'dinner')).toBe(true);
    expect(isRecipeEligibleForSlot(recipe, 'lunch')).toBe(true);
  });

  it('does not match eggplant as eggs', () => {
    expect(
      isRecipeEligibleForSlot(cand('eggplant', { title: 'Eggplant Parmesan' }), 'breakfast')
    ).toBe(false);
  });

  it('explains a partial breakfast week instead of inventing fillers', () => {
    expect(
      insufficientSlotCoverageMessage({ mealSlots: ['breakfast'], found: 3, requested: 7 })
    ).toBe(
      'Cheffy found 3 breakfast recipes that match your preferences. Try broadening your preferences to fill the rest of the week.'
    );
  });

  it('keeps dinner recipes when breakfast and dinner are both requested', () => {
    const out = restrictCandidatesToRequestedSlots(
      [
        cand('chicken', { title: 'Garlic Parmesan Chicken' }),
        cand('oats', { title: 'Overnight Oats', tags: ['breakfast'] })
      ],
      ['breakfast', 'dinner']
    );
    expect(out.map((c) => c.a)).toEqual(['30023:pk:chicken', '30023:pk:oats']);
  });
});

describe('parseExcludeIngredientsInput', () => {
  it('splits comma-separated ingredients', () => {
    expect(parseExcludeIngredientsInput('shellfish, peanuts; milk')).toEqual([
      'shellfish',
      'peanuts',
      'milk'
    ]);
  });
});
