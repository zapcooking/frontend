import { afterEach, describe, expect, it, vi } from 'vitest';
import { nip19 } from 'nostr-tools';
import type { NDKFilter } from '@nostr-dev-kit/ndk';
import {
  createRecipeSearch,
  recipeSearchFilters,
  recipeSearchResult,
  type RecipeSearchEvent
} from './recipeSearch';

const pubkey = 'a'.repeat(64);
const recipe = (identifier = 'soup', kind = 30023, tag = 'zapcooking'): RecipeSearchEvent => ({
  kind,
  pubkey,
  tags: [
    ['d', identifier],
    ['title', identifier],
    ['t', tag]
  ]
});

describe('recipe-only search results', () => {
  it('excludes ordinary articles even when their title is about food', () => {
    expect(
      recipeSearchResult({
        kind: 30023,
        pubkey,
        tags: [
          ['d', 'soup-history'],
          ['title', 'The history of soup'],
          ['t', 'food']
        ]
      })
    ).toBeNull();
    expect(recipeSearchResult(recipe('not-a-recipe', 1))).toBeNull();
    expect(recipeSearchResult(recipe('category-only', 30023, 'zapcooking-soup'))).toBeNull();
  });
  it('accepts current and legacy recipe tags, preserving colon-containing identifiers', () => {
    for (const tag of ['zapcooking', 'nostrcooking', 'ZAPCOOKING']) {
      const result = recipeSearchResult(recipe('soup:weeknight', 30023, tag))!;
      expect(result.title).toBe('soup:weeknight');
      expect(nip19.decode(result.naddr)).toMatchObject({
        type: 'naddr',
        data: { kind: 30023, identifier: 'soup:weeknight', pubkey }
      });
    }
  });
  it('keeps dedicated legacy recipes on their correct kind-specific route', () => {
    const result = recipeSearchResult(recipe('legacy', 35000, 'food'))!;
    expect(nip19.decode(result.naddr)).toMatchObject({
      type: 'naddr',
      data: { kind: 35000, identifier: 'legacy' }
    });
  });
  it('rejects hidden test recipes and malformed navigation data', () => {
    expect(recipeSearchResult(recipe('ios-2.3-live-publish-test'))).toBeNull();
    expect(recipeSearchResult({ ...recipe(), pubkey: 'bad' })).toBeNull();
    expect(recipeSearchResult({ ...recipe(), tags: [['t', 'zapcooking']] })).toBeNull();
  });
  it('constrains generic long-form at the relay as well as in the response filter', () => {
    expect(recipeSearchFilters('soup', 25)).toEqual([
      { kinds: [30023], search: 'soup', '#t': ['zapcooking', 'nostrcooking'], limit: 25 },
      { kinds: [35000], search: 'soup', limit: 25 }
    ]);
  });
});

function harness(connect: () => Promise<unknown> = async () => {}) {
  const requests: {
    onEvent: (event: RecipeSearchEvent) => void;
    finish: () => void;
    stop: ReturnType<typeof vi.fn>;
  }[] = [];
  const onResults = vi.fn();
  const onLoading = vi.fn();
  const subscribe = vi.fn(
    (_filters: NDKFilter[], onEvent: (event: RecipeSearchEvent) => void, finish: () => void) => {
      const sub = { onEvent, finish, stop: vi.fn() };
      requests.push(sub);
      return sub;
    }
  );
  const search = createRecipeSearch({
    connect,
    subscribe,
    onResults,
    onLoading,
    isBlocked: (event: RecipeSearchEvent) => event.tags.some((tag) => tag[0] === 'blocked'),
    timeoutMs: 100,
    limit: 2
  });
  return { search, requests, subscribe, onResults, onLoading };
}

afterEach(() => vi.useRealTimers());
describe('recipe search lifecycle', () => {
  it('filters articles/moderation, deduplicates coordinates and caps displayed results', async () => {
    const h = harness();
    await h.search.run('soup');
    const emit = h.requests[0].onEvent;
    emit(recipe('article', 30023, 'food'));
    emit({ ...recipe('blocked'), tags: [...recipe('blocked').tags, ['blocked']] });
    emit(recipe('one'));
    emit(recipe('one'));
    emit(recipe('two'));
    emit(recipe('three'));
    expect(h.onResults.mock.lastCall?.[0].map((r: { title: string }) => r.title)).toEqual([
      'one',
      'two'
    ]);
    h.search.stop();
  });
  it('ignores stale events and completion callbacks after a new query starts', async () => {
    const h = harness();
    await h.search.run('old');
    await h.search.run('new');
    h.requests[0].onEvent(recipe('old'));
    h.requests[0].finish();
    expect(h.requests[0].stop).toHaveBeenCalledOnce();
    expect(h.onLoading.mock.lastCall?.[0]).toBe(true);
    h.requests[1].onEvent(recipe('new'));
    expect(h.onResults.mock.lastCall?.[0][0].title).toBe('new');
    h.search.stop();
  });
  it('never subscribes a superseded query after a slow connection completes', async () => {
    let resolve!: () => void;
    const connection = new Promise<void>((r) => {
      resolve = r;
    });
    const h = harness(() => connection);
    const old = h.search.run('old');
    const current = h.search.run('new');
    resolve();
    await Promise.all([old, current]);
    expect(h.subscribe).toHaveBeenCalledOnce();
    expect(h.subscribe.mock.calls[0][0][0].search).toBe('new');
    h.search.stop();
  });
  it('clearing the query cancels pending work and leaves no stale results', async () => {
    const h = harness();
    await h.search.run('soup');
    await h.search.run('');
    h.requests[0].onEvent(recipe());
    expect(h.onResults.mock.lastCall?.[0]).toEqual([]);
    expect(h.onLoading.mock.lastCall?.[0]).toBe(false);
  });
  it('bounds connection time and ignores a connection that completes after timeout', async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    const h = harness(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        })
    );
    const pending = h.search.run('soup');
    await vi.advanceTimersByTimeAsync(100);
    expect(h.onLoading.mock.lastCall?.[0]).toBe(false);
    resolve();
    await pending;
    expect(h.subscribe).not.toHaveBeenCalled();
  });
  it('stops the subscription at the deadline and rejects late results', async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.search.run('soup');
    await vi.advanceTimersByTimeAsync(100);
    h.requests[0].onEvent(recipe());
    expect(h.requests[0].stop).toHaveBeenCalledOnce();
    expect(h.onResults.mock.lastCall?.[0]).toEqual([]);
    expect(h.onLoading.mock.lastCall?.[0]).toBe(false);
  });
});
