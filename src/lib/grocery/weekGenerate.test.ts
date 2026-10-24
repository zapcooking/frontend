import { describe, it, expect, vi } from 'vitest';
import { writable } from 'svelte/store';

const { fetchEvent } = vi.hoisted(() => ({ fetchEvent: vi.fn() }));

vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return { ndk: writable({ fetchEvent }) };
});
vi.mock('$app/environment', () => ({ browser: false, dev: false }));
vi.mock('$lib/connectionMonitor', () => ({ isOnline: writable(true) }));
vi.mock('$lib/offlineStorage', () => ({ offlineStorage: { getRecipes: vi.fn(async () => []) } }));
vi.mock('$lib/stores/groceryStore', () => ({ groceryStore: {}, groceryInitialized: writable(true) }));
vi.mock('$lib/stores/plannerStore', () => ({ plannerStore: {} }));
vi.mock('$lib/stores/pantryStore', () => ({
  pantryStore: {},
  pantryItems: writable([]),
  pantryInitialized: writable(true)
}));

import { loadRecipeLinesByATag } from './weekGenerate';

const P = 'c'.repeat(64);

describe('loadRecipeLinesByATag', () => {
  it('fetches recipes whose d-tag contains colons', async () => {
    const colon = `30023:${P}:pasta:-weeknight`;
    const url = `30023:${P}:https://example.com/r/1`;
    fetchEvent.mockImplementation(async () => ({ content: '## Ingredients\n\n- 1 cup flour\n' }));

    const lines = await loadRecipeLinesByATag([colon, url, 'garbage']);

    expect(fetchEvent.mock.calls.map((c: [{ '#d': string[] }]) => c[0]['#d'])).toEqual([
      ['pasta:-weeknight'],
      ['https://example.com/r/1']
    ]);
    expect([...lines.keys()]).toEqual([colon, url]);
  });
});
