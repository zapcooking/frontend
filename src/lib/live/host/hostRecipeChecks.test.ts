import { describe, expect, it } from 'vitest';
import { hostCheckRecipeId, hostCheckScope, pruneHostChecks } from './hostRecipeChecks';

function memoryStorage(initial: Record<string, string>) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k)
  };
}

describe('host recipe checks', () => {
  it('scopes the recipe id to the session', () => {
    expect(hostCheckScope('abc')).toBe('live:abc');
    expect(hostCheckRecipeId('abc', 'r1')).toBe('live:abc:r1');
  });

  it('removes earlier streams’ checks and keeps the current one', () => {
    const s = memoryStorage({
      'recipe_ingredients_checked:live:old:r1': '[0]',
      'recipe_ingredients_scale:live:old:r1': '2',
      'recipe_directions_checked:live:old:r1': '[1]',
      'recipe_ingredients_checked:live:cur:r1': '[2]',
      // The recipe page's own checks, and unrelated keys, stay.
      'recipe_ingredients_checked:r1': '[3]',
      'recipe_directions_checked:r1': '[1]',
      'something:live:old': 'x'
    });
    expect(pruneHostChecks(s, 'cur')).toBe(3);
    expect([...s.map.keys()].sort()).toEqual([
      'recipe_directions_checked:r1',
      'recipe_ingredients_checked:live:cur:r1',
      'recipe_ingredients_checked:r1',
      'something:live:old'
    ]);
  });

  it('a session id that is a prefix of another does not keep it', () => {
    const s = memoryStorage({ 'recipe_ingredients_checked:live:ab:r1': '[0]' });
    expect(pruneHostChecks(s, 'a')).toBe(1);
  });

  it('with no current session removes every live scope', () => {
    const s = memoryStorage({
      'recipe_ingredients_checked:live:x:r1': '[0]',
      'recipe_ingredients_checked:r1': '[0]'
    });
    expect(pruneHostChecks(s, null)).toBe(1);
    expect([...s.map.keys()]).toEqual(['recipe_ingredients_checked:r1']);
  });

  it('never throws on missing or broken storage', () => {
    expect(pruneHostChecks(null, 'a')).toBe(0);
    const broken = {
      get length(): number {
        throw new Error('denied');
      },
      key: () => null,
      removeItem: () => undefined
    };
    expect(pruneHostChecks(broken, 'a')).toBe(0);
  });
});
