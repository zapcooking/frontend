import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

/**
 * Tests for the persisted "Only Food" toggle.
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

const STORAGE_KEY = 'zapcooking_food_filter';

let stub: LocalStorageStub;

async function loadModule() {
  vi.resetModules();
  return await import('./foodFilterSettings');
}

beforeEach(() => {
  stub = new LocalStorageStub();
  (globalThis as any).localStorage = stub;
});

afterEach(() => {
  delete (globalThis as any).localStorage;
  vi.restoreAllMocks();
});

describe('readStoredFoodFilter', () => {
  it('defaults to off when nothing is stored', async () => {
    const { readStoredFoodFilter } = await loadModule();
    expect(readStoredFoodFilter()).toBe(false);
  });

  it('reads a stored "true"', async () => {
    stub.seed(STORAGE_KEY, 'true');
    const { readStoredFoodFilter } = await loadModule();
    expect(readStoredFoodFilter()).toBe(true);
  });

  it('reads a stored "false"', async () => {
    stub.seed(STORAGE_KEY, 'false');
    const { readStoredFoodFilter } = await loadModule();
    expect(readStoredFoodFilter()).toBe(false);
  });

  it('falls back to the default on a value we never write', async () => {
    // Boolean('0') is true — a coercing read would turn junk into "on".
    stub.seed(STORAGE_KEY, '0');
    const { readStoredFoodFilter } = await loadModule();
    expect(readStoredFoodFilter()).toBe(false);
  });

  it('falls back to the default when localStorage throws', async () => {
    stub.throwOnGet = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { readStoredFoodFilter } = await loadModule();
    expect(readStoredFoodFilter()).toBe(false);
  });

  it('falls back to the default when localStorage is absent (SSR)', async () => {
    delete (globalThis as any).localStorage;
    const { readStoredFoodFilter } = await loadModule();
    expect(readStoredFoodFilter()).toBe(false);
  });

  it('falls back to the default when merely accessing localStorage throws', async () => {
    // Some environments throw SecurityError on the identifier itself, before getItem.
    delete (globalThis as any).localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      }
    });
    const { readStoredFoodFilter } = await loadModule();
    expect(readStoredFoodFilter()).toBe(false);
  });
});

describe('foodFilterSetting store', () => {
  it('starts from the persisted value', async () => {
    stub.seed(STORAGE_KEY, 'true');
    const { foodFilterSetting } = await loadModule();
    expect(get(foodFilterSetting)).toBe(true);
  });

  it('starts off when nothing is persisted', async () => {
    const { foodFilterSetting } = await loadModule();
    expect(get(foodFilterSetting)).toBe(false);
  });

  it('writes the choice through to localStorage', async () => {
    const { foodFilterSetting } = await loadModule();

    foodFilterSetting.setEnabled(true);
    expect(get(foodFilterSetting)).toBe(true);
    expect(stub.raw(STORAGE_KEY)).toBe('true');

    foodFilterSetting.setEnabled(false);
    expect(get(foodFilterSetting)).toBe(false);
    expect(stub.raw(STORAGE_KEY)).toBe('false');
  });

  it('survives a reload — a stored choice is what the next load reads', async () => {
    const first = await loadModule();
    first.foodFilterSetting.setEnabled(true);

    const second = await loadModule();
    expect(get(second.foodFilterSetting)).toBe(true);
  });

  it('still updates the store when localStorage refuses the write', async () => {
    const { foodFilterSetting } = await loadModule();
    stub.throwOnSet = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});

    foodFilterSetting.setEnabled(true);

    expect(get(foodFilterSetting)).toBe(true);
    expect(stub.raw(STORAGE_KEY)).toBeUndefined();
  });
});
