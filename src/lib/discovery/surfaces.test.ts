import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The recommendation surfaces, each with a configured entry and without:
 * the Fresh feed's recipe box, Cheffy's meal-plan catalog, and the
 * "More from this chef" rail.
 */

const HELD_OUT = 'e'.repeat(64);
const COOK = 'c'.repeat(64);
const config = vi.hoisted(() => ({
  entries: [] as { pubkey: string; reason: string; since: string }[]
}));
vi.mock('$lib/discovery/config', async (importOriginal: () => Promise<unknown>) => ({
  ...((await importOriginal()) as typeof import('./config')),
  get DISCOVERY_EXCLUSIONS() {
    return config.entries;
  }
}));
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
vi.mock('$lib/eventFetch', () => ({ buildPoolRelaySet: () => undefined }));

const ENTRY = [{ pubkey: HELD_OUT, reason: 'test entry', since: '2026-11-25' }];
const CONTENT =
  '## Details\n\n- ⏲️ Prep time: 10 min\n- 🍳 Cook time: 15 min\n- 🍽️ Servings: 2\n\n' +
  '## Ingredients\n\n- 1 salmon fillet\n- 1 cup rice\n\n## Directions\n\n1. Cook the rice.\n2. Sear the salmon.\n';

function recipeEvent(d: string, pubkey: string, created_at: number) {
  return {
    id: `${d}-${created_at}`.padEnd(64, '0'),
    pubkey,
    kind: 30023,
    created_at,
    content: CONTENT,
    sig: 's',
    tags: [
      ['d', d],
      ['title', `Recipe ${d}`],
      ['image', `https://image.nostr.build/${d}.jpg`],
      ['t', 'zapcooking']
    ]
  };
}

function configure(entries: typeof config.entries) {
  config.entries = entries;
  vi.resetModules();
}

beforeEach(() => configure([]));

describe('the Fresh feed recipe box', () => {
  const NOW = 2_000_000_000;
  const OLD = NOW - 30 * 86400;
  const events = [recipeEvent('archived', HELD_OUT, OLD), recipeEvent('pie', COOK, OLD)];

  it('never recommends a held-out author', async () => {
    configure(ENTRY);
    const { buildPool } = await import('$lib/freshFeed/recipeBox');
    expect(buildPool(events, NOW).map((e) => e.pubkey)).toEqual([COOK]);
  });

  it('recommends them again once the entry is removed', async () => {
    const { buildPool } = await import('$lib/freshFeed/recipeBox');
    expect(buildPool(events, NOW).map((e) => e.pubkey)).toEqual([HELD_OUT, COOK]);
  });
});

describe("Cheffy's meal-plan catalog", () => {
  function fakeNdk() {
    return {
      subscribe: () => {
        const handlers: Record<string, (e?: unknown) => void> = {};
        queueMicrotask(() => {
          handlers.event?.(recipeEvent('archived', HELD_OUT, 2));
          handlers.event?.(recipeEvent('pie', COOK, 1));
          handlers.eose?.();
        });
        return {
          on: (name: string, fn: (e?: unknown) => void) => (handlers[name] = fn),
          stop: () => {}
        };
      }
    };
  }
  const discover = async () => {
    const { discoverRecipesForPlanning } = await import('$lib/services/recipeDiscoveryService');
    const found = await discoverRecipesForPlanning({
      ndk: fakeNdk() as never,
      pubkey: 'f'.repeat(64),
      source: 'explore'
    });
    return found.map((r) => r.a);
  };

  it('never offers a held-out author from the public catalog', async () => {
    configure(ENTRY);
    expect(await discover()).toEqual([`30023:${COOK}:pie`]);
  });

  it('offers them again once the entry is removed', async () => {
    expect(await discover()).toEqual([`30023:${HELD_OUT}:archived`, `30023:${COOK}:pie`]);
  });
});

describe('the "More from this chef" rail', () => {
  function fakeNdk() {
    const fetchEvents = vi.fn(
      async (filter: { authors: string[] }) =>
        new Set([
          recipeEvent('one', filter.authors[0], 2),
          recipeEvent('two', filter.authors[0], 1)
        ])
    );
    return { fetchEvents };
  }

  it('does not lead on to a held-out author’s catalog, and does not even fetch it', async () => {
    configure(ENTRY);
    const { fetchAuthorContent } = await import('$lib/authorContent');
    const ndk = fakeNdk();
    expect(await fetchAuthorContent(ndk as never, HELD_OUT)).toEqual({ recipes: [], articles: [] });
    expect(ndk.fetchEvents).not.toHaveBeenCalled();
    // Other authors' rails are unaffected.
    expect((await fetchAuthorContent(ndk as never, COOK)).recipes).toHaveLength(2);
  });

  it('shows the rail again once the entry is removed', async () => {
    const { fetchAuthorContent } = await import('$lib/authorContent');
    const split = await fetchAuthorContent(fakeNdk() as never, HELD_OUT);
    expect(split.recipes.map((r) => r.title)).toEqual(['Recipe one', 'Recipe two']);
  });
});
