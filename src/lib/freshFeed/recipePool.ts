import type { FreshClient, PageResult, RelayEvent } from './relay';

/**
 * The recipe-box pool (every recipe the feed relay serves, ~450 long-form
 * events, >1 MB) for the tab: asked for once, when a card first needs it,
 * and kept for later visits to Fresh in the same tab. It used to be
 * requested on every mount right after the first page, scroll or no
 * scroll — the single largest download of a /feed load. A failed load is
 * not kept; the next need asks again.
 */

export const POOL_TTL_MS = 10 * 60 * 1000;

interface Cached {
  events: RelayEvent[];
  at: number;
  inflight: Promise<PageResult> | null;
}

let cache: Cached | null = null;

export async function recipePool(
  client: Pick<FreshClient, 'recipes'>,
  tags: string[],
  now: () => number = Date.now
): Promise<PageResult> {
  const t = now();
  if (cache && !cache.inflight && t - cache.at < POOL_TTL_MS) {
    return { state: 'ok', events: cache.events, end: 'exhausted' };
  }
  if (cache?.inflight) return cache.inflight;
  const inflight = client.recipes(tags).then(
    (r) => {
      if (r.state === 'ok') cache = { events: r.events, at: now(), inflight: null };
      else cache = null;
      return r;
    },
    (err) => {
      cache = null;
      throw err;
    }
  );
  cache = { events: [], at: t, inflight };
  return inflight;
}

/** Tests only. */
export function resetRecipePoolForTests(): void {
  cache = null;
}
