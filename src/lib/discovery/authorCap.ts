/**
 * The opening of the default recipe feed: no author takes more than
 * `cap` of the first `window` results.
 *
 * Pure, and a function of the whole ranked list loaded so far, so the result
 * is the same however the list arrived (one page or several load-more
 * calls). It only reorders: every input item is in `opening` or `rest`,
 * exactly once.
 */

import { RECIPE_FEED_AUTHOR_CAP, RECIPE_FEED_CAP_WINDOW } from './config';

export interface OpeningOptions {
  cap?: number;
  window?: number;
}

export interface Opening<T> {
  /** The first results, in ranking order, at most `cap` per author and `window` long. */
  opening: T[];
  /** Everything else, in ranking order: over-cap items first met, then the tail. */
  rest: T[];
  /** How many of `rest` were passed over while filling the opening. */
  deferred: number;
  /** True when the opening reached `window`. */
  full: boolean;
}

function positiveInt(n: number | undefined, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

/**
 * Walk `ranked` in order. An item joins the opening while its author is
 * under the cap; otherwise it is deferred and the walk continues to the next
 * author. The walk stops when the opening is full; whatever is left keeps
 * its place after the deferred items it outranks.
 */
export function splitOpening<T>(
  ranked: readonly T[],
  authorOf: (item: T) => string,
  options: OpeningOptions = {}
): Opening<T> {
  const cap = positiveInt(options.cap, RECIPE_FEED_AUTHOR_CAP);
  const window = positiveInt(options.window, RECIPE_FEED_CAP_WINDOW);
  const opening: T[] = [];
  const rest: T[] = [];
  const perAuthor = new Map<string, number>();
  let deferred = 0;
  let i = 0;
  for (; i < ranked.length && opening.length < window; i++) {
    const item = ranked[i];
    const author = authorOf(item);
    const n = perAuthor.get(author) ?? 0;
    if (n < cap) {
      perAuthor.set(author, n + 1);
      opening.push(item);
    } else {
      rest.push(item);
      deferred++;
    }
  }
  for (; i < ranked.length; i++) rest.push(ranked[i]);
  return { opening, rest, deferred, full: opening.length >= window };
}

export interface ArrangedFeed<T> {
  /** What to show, in order. */
  visible: T[];
  /**
   * Deferred items not shown yet: the opening is short and more results may
   * still arrive to fill it. Load more; they show once it fills or the source
   * runs out.
   */
  held: number;
}

/**
 * The feed as shown. A full opening is followed by everything else. A short
 * opening stands alone while more results can still be loaded, so over-cap
 * recipes never pad the first `window` slots; once the source is exhausted
 * (`sourceExhausted`) the deferred recipes follow it, so nothing is lost
 * from a small catalog.
 */
export function arrangeFeed<T>(
  ranked: readonly T[],
  authorOf: (item: T) => string,
  options: OpeningOptions & { sourceExhausted?: boolean } = {}
): ArrangedFeed<T> {
  const { opening, rest, deferred, full } = splitOpening(ranked, authorOf, options);
  if (full || options.sourceExhausted || deferred === 0) {
    return { visible: [...opening, ...rest], held: 0 };
  }
  return { visible: opening, held: rest.length };
}
