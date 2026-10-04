import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { isAdmin } from '../adminAuth';

/**
 * Who sees the Fresh beta feed. The store reads localStorage at module load,
 * so cases with a stored value re-import the module after seeding the stub.
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

const ORG = '319ad3e790634dbe86f14db9c2995b26ee3c6228be55f89c4c7fea9acc01d50a';
const SETH = 'a723805cda67251191c8786f4da58f797e6977582301354ba8e91bcb0342dc9c';
const MEMBER = 'b'.repeat(64);

let stub: LocalStorageStub;

async function load() {
  vi.resetModules();
  return await import('./visibility');
}

beforeEach(() => {
  stub = new LocalStorageStub();
  (globalThis as any).localStorage = stub;
});

afterEach(() => {
  delete (globalThis as any).localStorage;
  vi.restoreAllMocks();
});

describe('isFreshVisible', () => {
  it('defaults on for the two default-on keys and off for everyone else', async () => {
    const { isFreshVisible } = await load();
    expect(isFreshVisible(ORG, null)).toBe(true);
    expect(isFreshVisible(SETH, null)).toBe(true);
    expect(isFreshVisible(SETH.toUpperCase(), null)).toBe(true);
    expect(isFreshVisible(MEMBER, null)).toBe(false);
  });

  it('lets an explicit choice win in both directions', async () => {
    const { isFreshVisible } = await load();
    expect(isFreshVisible(MEMBER, 'on')).toBe(true);
    expect(isFreshVisible(ORG, 'off')).toBe(false);
  });

  it('hides Fresh when signed out, whatever is stored', async () => {
    const { isFreshVisible } = await load();
    for (const pk of ['', null, undefined]) {
      expect(isFreshVisible(pk, 'on')).toBe(false);
      expect(isFreshVisible(pk, null)).toBe(false);
    }
  });

  it('keeps the default-on list separate from isAdmin (which must not widen)', async () => {
    const { FRESH_DEFAULT_ON_PUBKEYS } = await load();
    expect(FRESH_DEFAULT_ON_PUBKEYS.has(ORG)).toBe(true);
    expect(isAdmin(ORG)).toBe(false);
    expect(isAdmin(SETH)).toBe(true);
  });
});

describe('freshPreference store', () => {
  it('starts unset with nothing stored', async () => {
    const { freshPreference, readStoredFreshPreference } = await load();
    expect(readStoredFreshPreference()).toBe(null);
    expect(get(freshPreference)).toBe(null);
  });

  it('reads a stored choice', async () => {
    stub.seed('zapcooking_fresh_feed', 'off');
    const { freshPreference } = await load();
    expect(get(freshPreference)).toBe('off');
  });

  it('treats a corrupt or throwing store as unset', async () => {
    stub.seed('zapcooking_fresh_feed', 'true');
    let m = await load();
    expect(get(m.freshPreference)).toBe(null);
    stub.throwOnGet = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    m = await load();
    expect(get(m.freshPreference)).toBe(null);
  });

  it('persists the switch and survives a reload', async () => {
    const { freshPreference } = await load();
    freshPreference.setEnabled(true);
    expect(get(freshPreference)).toBe('on');
    expect(stub.raw('zapcooking_fresh_feed')).toBe('on');
    const reloaded = await load();
    expect(get(reloaded.freshPreference)).toBe('on');
  });

  it('still updates in memory when localStorage refuses to write', async () => {
    stub.throwOnSet = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { freshPreference } = await load();
    freshPreference.setEnabled(false);
    expect(get(freshPreference)).toBe('off');
  });

  it('works with no localStorage at all (SSR)', async () => {
    delete (globalThis as any).localStorage;
    const { freshPreference, isFreshVisible } = await load();
    freshPreference.setEnabled(true);
    expect(get(freshPreference)).toBe('on');
    expect(isFreshVisible(MEMBER, get(freshPreference))).toBe(true);
  });
});
