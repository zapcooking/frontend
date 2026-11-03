import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  STATIC_NAMES,
  loadHandleDirectory,
  resetHandleDirectoryForTests
} from './handleDirectory.server';

/**
 * /.well-known/nostr.json: dynamic member names from pantry merged with the
 * static names, static winning. `static/.well-known/nostr.json` used to
 * shadow the route entirely on Cloudflare Pages (static assets are served
 * first), so member identities were never served; the file is gone and its
 * names live here.
 */
const LEGACY_STATIC_FILE = {
  jack: 'c5fb6ecc876e0458e3eca9918e370cbcd376901c58460512fe537a46e58c38bb',
  _: '319ad3e790634dbe86f14db9c2995b26ee3c6228be55f89c4c7fea9acc01d50a',
  seth: 'a723805cda67251191c8786f4da58f797e6977582301354ba8e91bcb0342dc9c',
  daniel: 'ee6ea13ab9fe5c4a68eaf9b1a34fe014a66b40117c50ee2a614f4cda959b6e74',
  mishroom: 'f6f30bb15f46869271c245e352921fffc1eef5776d286e3e4894e0ae905a1ad5'
};

const fetchMock = vi.fn();
beforeEach(() => {
  resetHandleDirectoryForTests();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('the handle directory', () => {
  it('keeps every name the static file used to serve', () => {
    for (const [name, pk] of Object.entries(LEGACY_STATIC_FILE)) expect(STATIC_NAMES[name]).toBe(pk);
  });

  it('serves member names from pantry alongside the static ones; a static name wins a collision', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ names: { alice: 'a'.repeat(64), seth: 'b'.repeat(64) } })
    });
    const names = await loadHandleDirectory();
    expect(names.alice).toBe('a'.repeat(64));
    expect(names.seth).toBe(LEGACY_STATIC_FILE.seth);
    expect(names.mishroom).toBe(LEGACY_STATIC_FILE.mishroom);
  });

  it('still serves the static names when pantry is down', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const names = await loadHandleDirectory();
    expect(names).toEqual(STATIC_NAMES);
  });
});
