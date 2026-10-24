import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: false }));

import { sanitizePantryCovered } from './groceryService';

describe('sanitizePantryCovered', () => {
  it('keeps well-formed rows and drops nulls', () => {
    expect(
      sanitizePantryCovered([
        { name: 'Olive oil', quantity: '', recipeId: '30023:pk:x' },
        null,
        { name: '  ', quantity: '1' },
        { name: 'Eggs', quantity: '8' }
      ])
    ).toEqual([
      { name: 'Olive oil', quantity: '', recipeId: '30023:pk:x' },
      { name: 'Eggs', quantity: '8' }
    ]);
  });

  it('returns undefined for missing or empty payloads', () => {
    expect(sanitizePantryCovered(undefined)).toBeUndefined();
    expect(sanitizePantryCovered('nope')).toBeUndefined();
    expect(sanitizePantryCovered([null, { name: '' }])).toBeUndefined();
  });
});
