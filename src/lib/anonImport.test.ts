import { describe, expect, it } from 'vitest';
import {
  ANON_IMPORT_HANDOFF_KEY,
  ANON_IMPORT_MAX_AGE_MS,
  readImportHandoff,
  writeImportHandoff,
  sourceUrl,
  withSourceAttribution,
  type AnonImportHandoff
} from './anonImport';

const recipe = {
  title: 'Soup',
  summary: '',
  chefsnotes: '',
  preptime: '',
  cooktime: '',
  servings: '',
  ingredients: ['onion'],
  directions: ['Simmer'],
  tags: ['Soup'],
  imageUrls: []
};
const makeStore = () => {
  const entries = new Map<string, string>();
  return {
    getItem: (k: string) => entries.get(k) ?? null,
    setItem: (k: string, v: string) => {
      entries.set(k, v);
    },
    removeItem: (k: string) => {
      entries.delete(k);
    }
  };
};
describe('anonymous import staging', () => {
  it('keeps edits and attribution through multiple reads, navigation and sign-in', () => {
    const storage = makeStore();
    const staged: AnonImportHandoff = { recipe, sourceUrl: 'https://example.com/soup', at: 1000 };
    expect(writeImportHandoff(storage, staged)).toBe(true);
    expect(readImportHandoff(storage, 2000)).toEqual(staged);
    const edited = {
      ...staged,
      recipe: { ...recipe, title: 'Onion soup' },
      additionalMarkdown: 'Serve warm.',
      at: 2000
    };
    writeImportHandoff(storage, edited);
    expect(readImportHandoff(storage, 3000)).toEqual(edited);
    expect(readImportHandoff(storage, 4000)).toEqual(edited);
  });
  it('rejects expired or malformed data without breaking the editor', () => {
    const storage = makeStore();
    writeImportHandoff(storage, { recipe, sourceUrl: 'https://example.com', at: 1 });
    expect(readImportHandoff(storage, ANON_IMPORT_MAX_AGE_MS + 2)).toBeNull();
    expect(storage.getItem(ANON_IMPORT_HANDOFF_KEY)).toBeNull();
    storage.setItem(ANON_IMPORT_HANDOFF_KEY, '{');
    expect(readImportHandoff(storage)).toBeNull();
    storage.setItem(ANON_IMPORT_HANDOFF_KEY, JSON.stringify({ recipe: { title: [] }, at: 1 }));
    expect(readImportHandoff(storage, 2)).toBeNull();
  });
  it('reports unavailable storage so sign-in navigation can be stopped', () => {
    expect(
      writeImportHandoff(
        {
          setItem: () => {
            throw Error('quota');
          }
        },
        { recipe, sourceUrl: 'https://example.com', at: 1 }
      )
    ).toBe(false);
  });
});
describe('recipe attribution', () => {
  it('keeps visible source attribution exactly once through draft/publish cycles', () => {
    const attributed = withSourceAttribution('Serve hot.', 'https://example.com/soup#recipe');
    expect(attributed).toBe('Serve hot.\n\nOriginal recipe: <https://example.com/soup>');
    expect(withSourceAttribution(attributed, 'https://example.com/soup')).toBe(attributed);
  });
  it('rejects credentials and non-web sources and escapes markdown delimiters', () => {
    expect(sourceUrl('https://user:password@example.com')).toBe('');
    expect(withSourceAttribution('Recipe', 'javascript:alert(1)')).toBe('Recipe');
    expect(withSourceAttribution('', 'https://example.com/?x=>')).not.toContain('?x=>');
  });
});
