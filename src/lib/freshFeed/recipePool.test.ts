import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recipePool, resetRecipePoolForTests, POOL_TTL_MS } from './recipePool';
import type { PageResult, RelayEvent } from './relay';

/**
 * The recipe-box pool is asked for once per tab and kept: it used to be
 * requested on every Fresh mount (>1 MB each), scroll or no scroll.
 */
const ev = (id: string): RelayEvent => ({ id, pubkey: 'p', created_at: 1, kind: 30023, tags: [], content: '', sig: '' });

function client(result: PageResult | (() => Promise<PageResult>)) {
  const recipes = vi.fn(async () => (typeof result === 'function' ? result() : result));
  return { c: { recipes }, recipes };
}

beforeEach(() => resetRecipePoolForTests());

describe('recipePool', () => {
  it('asks once and serves later visits from the tab until the pool is stale', async () => {
    let now = 1_000_000;
    const { c, recipes } = client({ state: 'ok', events: [ev('a')], end: 'exhausted' });
    expect((await recipePool(c, ['t'], () => now)).events).toHaveLength(1);
    expect((await recipePool(c, ['t'], () => now + 1000)).events).toHaveLength(1);
    expect(recipes).toHaveBeenCalledTimes(1);
    now += POOL_TTL_MS + 1;
    await recipePool(c, ['t'], () => now);
    expect(recipes).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight request', async () => {
    let resolve!: (r: PageResult) => void;
    const { c, recipes } = client(() => new Promise<PageResult>((r) => (resolve = r)));
    const a = recipePool(c, ['t']);
    const b = recipePool(c, ['t']);
    resolve({ state: 'ok', events: [ev('a')], end: 'exhausted' });
    expect((await a).events).toHaveLength(1);
    expect((await b).events).toHaveLength(1);
    expect(recipes).toHaveBeenCalledTimes(1);
  });

  it('does not keep a failed load: the next need asks again', async () => {
    let state: PageResult['state'] = 'unavailable';
    const { c, recipes } = client(() => Promise.resolve({ state, events: state === 'ok' ? [ev('a')] : [] } as PageResult));
    expect((await recipePool(c, ['t'])).state).toBe('unavailable');
    state = 'ok';
    expect((await recipePool(c, ['t'])).state).toBe('ok');
    expect(recipes).toHaveBeenCalledTimes(2);
  });
});
