import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: false }));
vi.mock('$lib/offlineStorage', () => ({
  offlineStorage: { getRecipes: async () => [], saveRecipeFromEvent: async () => {} }
}));
vi.mock('$lib/stores/cookbookStore', () => ({
  cookbookStore: { load: async () => {} },
  cookbookLists: {
    subscribe: (fn: (v: unknown[]) => void) => {
      fn([]);
      return () => {};
    }
  }
}));
vi.mock('$lib/myRecipesPack', () => ({ fetchMyAuthoredRecipeEvents: async () => [] }));

import {
  attachDiscoveredImages,
  candidateFromCached,
  toWireCandidate
} from './recipeDiscoveryService';

function cached(overrides: Record<string, unknown> = {}) {
  return {
    id: '30023:pk:salmon-bowl',
    title: 'Mediterranean Salmon Bowl',
    content:
      '# Salmon Bowl\n\n## Details\n⏲️ Prep time: 10 min\n🍳 Cook time: 15 min\n🍽️ Servings: 2\n\n## Ingredients\n- 1 salmon fillet\n- 1 cup rice\n',
    ingredients: ['1 salmon fillet', '1 cup rice'],
    tags: ['zapcooking', 'mediterranean', 'dinner'],
    authorPubkey: 'pk',
    createdAt: 1,
    cachedAt: 1,
    eventKind: 30023,
    eventDTag: 'salmon-bowl',
    eventTags: [],
    ...overrides
  } as any;
}

describe('candidateFromCached', () => {
  it('drops zapcooking meta tags and keeps useful recipe tags', () => {
    const c = candidateFromCached(cached());
    expect(c?.a).toBe('30023:pk:salmon-bowl');
    expect(c?.title).toBe('Mediterranean Salmon Bowl');
    expect(c?.tags).toEqual(['mediterranean', 'dinner']);
    expect(c?.ingredients.length).toBeGreaterThan(0);
  });

  it('ignores hidden test-recipe coordinates', () => {
    expect(
      candidateFromCached(
        cached({
          id: '30023:8b739c62ed2a9b76c2836a18a6bc9a480b6f8d902b8f702083dfae20bf6b15b9:pr10-pancakes'
        })
      )
    ).toBeNull();
  });

  it('toWireCandidate omits image', () => {
    const discovered = candidateFromCached(cached({ image: 'https://example.com/s.jpg' }));
    expect(discovered?.image).toBe('https://example.com/s.jpg');
    expect(toWireCandidate(discovered!)).not.toHaveProperty('image');
    expect(toWireCandidate(discovered!).a).toBe(discovered!.a);
  });

  it('attaches discovered images onto generated meals by coordinate', () => {
    const meals = attachDiscoveredImages(
      [
        { a: '30023:pk:salmon-bowl', title: 'Salmon' },
        { a: '30023:pk:missing', title: 'No photo' }
      ],
      [
        {
          a: '30023:pk:salmon-bowl',
          title: 'Salmon',
          tags: [],
          ingredients: [],
          image: 'https://example.com/s.jpg'
        },
        { a: '30023:pk:other', title: 'Other', tags: [], ingredients: [] }
      ]
    );
    expect(meals[0].image).toBe('https://example.com/s.jpg');
    expect(meals[1].image).toBeUndefined();
  });
});
