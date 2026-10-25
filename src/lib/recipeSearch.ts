/** Shared recipe-only rules for search results and header suggestions. */
import { nip19 } from 'nostr-tools';
import type { NDKFilter, NDKKind } from '@nostr-dev-kit/ndk';
import { GATED_RECIPE_KIND, RECIPE_TAGS, isHiddenRecipeEvent } from './consts';

export interface RecipeSearchEvent {
  kind?: number;
  pubkey: string;
  tags: string[][];
}
export interface RecipeSearchResult {
  title: string;
  naddr: string;
  author: string;
}

/** Kind 30023 also holds articles; kind 35000 is the legacy dedicated recipe kind. */
export function recipeSearchFilters(query: string, limit: number): NDKFilter[] {
  return [
    { kinds: [30023], search: query, '#t': [...RECIPE_TAGS], limit },
    { kinds: [GATED_RECIPE_KIND as NDKKind], search: query, limit }
  ];
}

/** Recheck relay responses: some search relays ignore tag/kind constraints. */
export function recipeSearchResult(event: RecipeSearchEvent): RecipeSearchResult | null {
  const taggedRecipe = event.tags.some(
    (tag) => tag[0] === 't' && RECIPE_TAGS.includes((tag[1] || '').toLowerCase())
  );
  if (event.kind !== GATED_RECIPE_KIND && (event.kind !== 30023 || !taggedRecipe)) return null;
  if (isHiddenRecipeEvent(event)) return null;
  const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1];
  if (!identifier || !/^[a-f0-9]{64}$/i.test(event.pubkey)) return null;
  try {
    return {
      title: event.tags.find((tag) => tag[0] === 'title')?.[1]?.trim() || identifier,
      naddr: nip19.naddrEncode({ kind: event.kind!, pubkey: event.pubkey, identifier }),
      author: event.pubkey
    };
  } catch {
    return null;
  }
}

interface SearchDependencies<E extends RecipeSearchEvent> {
  connect: () => Promise<unknown>;
  subscribe: (
    filters: NDKFilter[],
    onEvent: (event: E) => void,
    onComplete: () => void
  ) => { stop: () => void };
  isBlocked: (event: E) => boolean;
  onResults: (results: RecipeSearchResult[]) => void;
  onLoading: (loading: boolean) => void;
  limit?: number;
  timeoutMs?: number;
}

/** A query owns its connection wait, subscription and timer; old queries cannot update new ones. */
export function createRecipeSearch<E extends RecipeSearchEvent>(deps: SearchDependencies<E>) {
  let generation = 0;
  let subscription: { stop: () => void } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = deps.limit ?? 25;
  function stop() {
    generation++;
    if (timer) clearTimeout(timer);
    timer = undefined;
    try {
      subscription?.stop();
    } catch {
      /* already closed */
    }
    subscription = undefined;
    deps.onLoading(false);
  }
  async function run(rawQuery: string) {
    stop();
    const query = rawQuery.trim();
    deps.onResults([]);
    if (!query) return;
    const current = generation;
    const results: RecipeSearchResult[] = [];
    const seen = new Set<string>();
    deps.onLoading(true);
    const finish = () => {
      if (current === generation) stop();
    };
    // Includes connection time, so an unreachable relay cannot leave the spinner indefinitely.
    timer = setTimeout(finish, deps.timeoutMs ?? 6000);
    try {
      await deps.connect();
      if (current !== generation) return;
      const nextSubscription = deps.subscribe(
        recipeSearchFilters(query, limit),
        (event) => {
          if (current !== generation || deps.isBlocked(event)) return;
          const result = recipeSearchResult(event);
          if (!result || seen.has(result.naddr) || results.length >= limit) return;
          seen.add(result.naddr);
          results.push(result);
          deps.onResults([...results]);
        },
        finish
      );
      if (current === generation) subscription = nextSubscription;
      else nextSubscription.stop();
    } catch {
      finish();
    }
  }
  return { run, stop };
}
