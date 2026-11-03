import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

/**
 * Tests for the persisted "Hide recipes without images" toggle and the
 * `hasRecipeImage` helper that backs the grid filter.
 *
 * The store reads localStorage at module load, so each case that depends on a
 * stored value re-imports the module with `vi.resetModules()` after seeding
 * the stub.
 */

class LocalStorageStub {
  private data = new Map<string, string>();
  throwOnGet = false;
  throwOnSet = false;

  getItem(key: string): string | null {
    if (this.throwOnGet) throw new Error('denied');
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    if (this.throwOnSet) throw new Error('quota');
    this.data.set(key, value);
  }

  seed(key: string, value: string): void {
    this.data.set(key, value);
  }

  raw(key: string): string | undefined {
    return this.data.get(key);
  }
}

const STORAGE_KEY = 'zapcooking_hide_imageless_recipes';

let stub: LocalStorageStub;

async function loadModule() {
  vi.resetModules();
  return await import('./recipeImageFilterSettings');
}

// Minimal event shape — hasRecipeImage only reads `tags`.
function eventWithTags(tags: string[][]) {
  return { tags } as any;
}

beforeEach(() => {
  stub = new LocalStorageStub();
  (globalThis as any).localStorage = stub;
});

afterEach(() => {
  delete (globalThis as any).localStorage;
  vi.restoreAllMocks();
});

describe('readStoredHideImagelessRecipes', () => {
  it('defaults to on when nothing is stored', async () => {
    const { readStoredHideImagelessRecipes } = await loadModule();
    expect(readStoredHideImagelessRecipes()).toBe(true);
  });

  it('reads a stored "true"', async () => {
    stub.seed(STORAGE_KEY, 'true');
    const { readStoredHideImagelessRecipes } = await loadModule();
    expect(readStoredHideImagelessRecipes()).toBe(true);
  });

  it('reads a stored "false"', async () => {
    stub.seed(STORAGE_KEY, 'false');
    const { readStoredHideImagelessRecipes } = await loadModule();
    expect(readStoredHideImagelessRecipes()).toBe(false);
  });

  it('falls back to the default on a value we never write', async () => {
    // Boolean('0') is true — a coercing read would turn junk into "on".
    stub.seed(STORAGE_KEY, '0');
    const { readStoredHideImagelessRecipes } = await loadModule();
    expect(readStoredHideImagelessRecipes()).toBe(true);
  });

  it('falls back to the default when localStorage throws', async () => {
    stub.throwOnGet = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { readStoredHideImagelessRecipes } = await loadModule();
    expect(readStoredHideImagelessRecipes()).toBe(true);
  });

  it('falls back to the default when localStorage is absent (SSR)', async () => {
    delete (globalThis as any).localStorage;
    const { readStoredHideImagelessRecipes } = await loadModule();
    expect(readStoredHideImagelessRecipes()).toBe(true);
  });
});

describe('hideImagelessRecipesSetting store', () => {
  it('starts from the persisted value', async () => {
    stub.seed(STORAGE_KEY, 'false');
    const { hideImagelessRecipesSetting } = await loadModule();
    expect(get(hideImagelessRecipesSetting)).toBe(false);
  });

  it('starts on when nothing is persisted', async () => {
    const { hideImagelessRecipesSetting } = await loadModule();
    expect(get(hideImagelessRecipesSetting)).toBe(true);
  });

  it('writes the choice through to localStorage', async () => {
    const { hideImagelessRecipesSetting } = await loadModule();

    hideImagelessRecipesSetting.setEnabled(true);
    expect(get(hideImagelessRecipesSetting)).toBe(true);
    expect(stub.raw(STORAGE_KEY)).toBe('true');

    hideImagelessRecipesSetting.setEnabled(false);
    expect(get(hideImagelessRecipesSetting)).toBe(false);
    expect(stub.raw(STORAGE_KEY)).toBe('false');
  });

  it('survives a reload — a stored choice is what the next load reads', async () => {
    const first = await loadModule();
    first.hideImagelessRecipesSetting.setEnabled(true);

    const second = await loadModule();
    expect(get(second.hideImagelessRecipesSetting)).toBe(true);
  });

  it('still updates the store when localStorage refuses the write', async () => {
    const { hideImagelessRecipesSetting } = await loadModule();
    stub.throwOnSet = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});

    hideImagelessRecipesSetting.setEnabled(true);

    expect(get(hideImagelessRecipesSetting)).toBe(true);
    expect(stub.raw(STORAGE_KEY)).toBeUndefined();
  });
});

describe('hasRecipeImage', () => {
  it('true when the event carries a non-empty image tag', async () => {
    const { hasRecipeImage } = await loadModule();
    expect(
      hasRecipeImage(eventWithTags([['image', 'https://example.com/soup.jpg']]))
    ).toBe(true);
  });

  it('false when there is no image tag', async () => {
    const { hasRecipeImage } = await loadModule();
    expect(hasRecipeImage(eventWithTags([['title', 'Soup']]))).toBe(false);
  });

  it('false when the image tag is empty or whitespace', async () => {
    const { hasRecipeImage } = await loadModule();
    expect(hasRecipeImage(eventWithTags([['image', '']]))).toBe(false);
    expect(hasRecipeImage(eventWithTags([['image', '   ']]))).toBe(false);
  });

  it('false for known-broken image URLs (host error pages)', async () => {
    const { hasRecipeImage } = await loadModule();
    expect(
      hasRecipeImage(eventWithTags([['image', 'https://example.com/Ooops/sorry.png']]))
    ).toBe(false);
  });

  it('false when only a picture tag is present — RecipeCard renders the image tag only', async () => {
    const { hasRecipeImage } = await loadModule();
    expect(
      hasRecipeImage(eventWithTags([['picture', 'https://example.com/soup.jpg']]))
    ).toBe(false);
  });
});
