import { describe, expect, it } from 'vitest';
import { arrangeFeed, splitOpening } from './authorCap';
import { RECIPE_FEED_AUTHOR_CAP, RECIPE_FEED_CAP_WINDOW } from './config';

interface R {
  id: string;
  author: string;
  rank: number;
}
const authorOf = (r: R) => r.author;

/** A ranked catalog: `pattern` is one author letter per recipe, best first. */
function catalog(pattern: string): R[] {
  return [...pattern].map((author, rank) => ({ id: `${author}${rank}`, author, rank }));
}
const count = (items: R[], author: string) => items.filter((r) => r.author === author).length;
const ranksAscend = (items: R[]) => items.every((r, i) => i === 0 || items[i - 1].rank < r.rank);
const ids = (items: R[]) => items.map((r) => r.id);

/** 60 recipes, about half from one author (D), the rest from nine other cooks. */
const DOMINATED = catalog('DDDaDbDDcDDDdDeDDfDgDDhDiDDaDbDDcDdDDeDfDDgDhDDiDaDDbDcDDdDeD');

describe('splitOpening', () => {
  it('ships with four per author in the first twenty', () => {
    expect(RECIPE_FEED_AUTHOR_CAP).toBe(4);
    expect(RECIPE_FEED_CAP_WINDOW).toBe(20);
  });

  it('gives a dominant author at most four of the first twenty', () => {
    const { opening, full } = splitOpening(DOMINATED, authorOf);
    expect(full).toBe(true);
    expect(opening).toHaveLength(20);
    expect(count(opening, 'D')).toBe(4);
    // Uncapped, the same twenty slots would hold many more.
    expect(count(DOMINATED.slice(0, 20), 'D')).toBeGreaterThan(4);
  });

  it('applies the cap to every author alike', () => {
    const { opening } = splitOpening(catalog('aaaaaabbbbbbccccccddddddeeeeeeffffff'), authorOf);
    for (const author of 'abcdef') expect(count(opening, author)).toBeLessThanOrEqual(4);
    expect(opening).toHaveLength(20);
  });

  it('works with the cap set to three', () => {
    const { opening } = splitOpening(DOMINATED, authorOf, { cap: 3 });
    expect(opening).toHaveLength(20);
    expect(count(opening, 'D')).toBe(3);
    for (const author of 'abcdefghi') expect(count(opening, author)).toBeLessThanOrEqual(3);
  });

  it('keeps the ranking among eligible recipes, and among the rest', () => {
    const { opening, rest } = splitOpening(DOMINATED, authorOf);
    expect(ranksAscend(opening)).toBe(true);
    expect(ranksAscend(rest)).toBe(true);
    // The author's four are their four best; every other cook's keep their order.
    expect(ids(opening.filter((r) => r.author === 'D'))).toEqual(
      ids(DOMINATED.filter((r) => r.author === 'D').slice(0, 4))
    );
    const others = opening.filter((r) => r.author !== 'D');
    expect(ids(others)).toEqual(ids(DOMINATED.filter((r) => r.author !== 'D').slice(0, 16)));
  });

  it('defers rather than drops: every recipe appears exactly once', () => {
    const { opening, rest, deferred } = splitOpening(DOMINATED, authorOf);
    const all = [...opening, ...rest];
    expect(all).toHaveLength(DOMINATED.length);
    expect(new Set(ids(all)).size).toBe(DOMINATED.length);
    expect(new Set(ids(all))).toEqual(new Set(ids(DOMINATED)));
    expect(deferred).toBeGreaterThan(0);
  });

  it('leaves a feed nobody dominates exactly as ranked', () => {
    const even = catalog('abcdefghijabcdefghijabcdefghij');
    const { opening, rest, deferred } = splitOpening(even, authorOf);
    expect(ids([...opening, ...rest])).toEqual(ids(even));
    expect(deferred).toBe(0);
  });

  it('ignores a nonsense cap or window instead of emptying the feed', () => {
    const { opening } = splitOpening(DOMINATED, authorOf, { cap: 0, window: Number.NaN });
    expect(opening).toHaveLength(20);
    expect(count(opening, 'D')).toBe(4);
  });
});

describe('arrangeFeed', () => {
  it('follows a full opening with everything else, deferred recipes included', () => {
    const { visible, held } = arrangeFeed(DOMINATED, authorOf);
    expect(held).toBe(0);
    expect(visible).toHaveLength(DOMINATED.length);
    expect(count(visible.slice(0, 20), 'D')).toBe(4);
    expect(count(visible, 'D')).toBe(count(DOMINATED, 'D'));
  });

  it('shows a shorter opening when a small catalog cannot fill twenty slots', () => {
    // 12 recipes: 9 from one author, 3 from others.
    const small = catalog('DDDaDDbDDDcD');
    const waiting = arrangeFeed(small, authorOf);
    expect(ids(waiting.visible)).toEqual(['D0', 'D1', 'D2', 'a3', 'D4', 'b6', 'c10']);
    expect(waiting.visible.length).toBeLessThan(20);
    expect(count(waiting.visible, 'D')).toBe(4);
    expect(waiting.held).toBe(5);

    // Once the source has nothing more to give, the deferred recipes follow.
    const done = arrangeFeed(small, authorOf, { sourceExhausted: true });
    expect(done.held).toBe(0);
    expect(ids(done.visible)).toEqual([
      ...['D0', 'D1', 'D2', 'a3', 'D4', 'b6', 'c10'],
      ...['D5', 'D7', 'D8', 'D9', 'D11']
    ]);
    expect(new Set(ids(done.visible))).toEqual(new Set(ids(small)));
  });

  it('holds nothing when a short catalog has nothing over the cap', () => {
    const tiny = catalog('abcab');
    expect(arrangeFeed(tiny, authorOf)).toEqual({ visible: tiny, held: 0 });
  });
});

/**
 * The /recipes page's flow, reduced to its rule: ranked results arrive a
 * page at a time; after each page the feed shows `arrangeFeed` of everything
 * loaded so far, exhausted once a page comes back empty.
 */
function paginate(source: R[], pageSizes: number[]) {
  const loaded: R[] = [];
  const steps: R[][] = [];
  let at = 0;
  for (let i = 0; ; i++) {
    const size = pageSizes[Math.min(i, pageSizes.length - 1)];
    const page = source.slice(at, at + size);
    at += page.length;
    loaded.push(...page);
    const exhausted = page.length === 0;
    steps.push(arrangeFeed(loaded, authorOf, { sourceExhausted: exhausted }).visible);
    if (exhausted) break;
  }
  return steps;
}

describe('the cap across page boundaries', () => {
  const allAtOnce = arrangeFeed(DOMINATED, authorOf, { sourceExhausted: true }).visible;

  for (const pageSizes of [[5], [7], [3, 11, 2], [20], [19, 1], [60]]) {
    it(`gives the same feed for page sizes ${JSON.stringify(pageSizes)} as for one load`, () => {
      const steps = paginate(DOMINATED, pageSizes);
      const final = steps[steps.length - 1];
      expect(ids(final)).toEqual(ids(allAtOnce));
      expect(ids(final.slice(0, 20))).toEqual(ids(allAtOnce.slice(0, 20)));
    });
  }

  it('never lets an author past the cap in the first twenty at any step', () => {
    for (const pageSizes of [[5], [7], [3, 11, 2], [1]]) {
      for (const visible of paginate(DOMINATED, pageSizes)) {
        const first = visible.slice(0, 20);
        for (const author of new Set(first.map(authorOf))) {
          expect(count(first, author)).toBeLessThanOrEqual(4);
        }
        expect(new Set(ids(visible)).size).toBe(visible.length); // no duplicates
      }
    }
  });

  it('never reshuffles what is already on screen once the opening is full', () => {
    const steps = paginate(DOMINATED, [25, 10]);
    for (let i = 1; i < steps.length; i++) {
      expect(ids(steps[i].slice(0, steps[i - 1].length))).toEqual(ids(steps[i - 1]));
    }
  });

  it('reaches every recipe of a small catalog through load more, once each', () => {
    const small = catalog('DDDaDDbDDDcDDDD');
    for (const pageSizes of [[4], [6], [15], [1]]) {
      const steps = paginate(small, pageSizes);
      const final = steps[steps.length - 1];
      expect(ids(final).sort()).toEqual(ids(small).sort());
      expect(count(final.slice(0, 7), 'D')).toBe(4); // the short opening leads
      expect(ids(final.slice(0, 7))).toEqual(['D0', 'D1', 'D2', 'a3', 'D4', 'b6', 'c10']);
    }
  });

  it('respects a cap of three across page boundaries too', () => {
    const loaded: R[] = [];
    for (let at = 0; at < DOMINATED.length; at += 6) {
      loaded.push(...DOMINATED.slice(at, at + 6));
      const first = arrangeFeed(loaded, authorOf, { cap: 3 }).visible.slice(0, 20);
      expect(count(first, 'D')).toBeLessThanOrEqual(3);
    }
    const one = arrangeFeed(DOMINATED, authorOf, { cap: 3 }).visible;
    expect(ids(arrangeFeed(loaded, authorOf, { cap: 3 }).visible)).toEqual(ids(one));
  });
});
