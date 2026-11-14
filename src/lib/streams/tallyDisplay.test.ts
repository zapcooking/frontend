import { describe, expect, it } from 'vitest';
import { keepHigherTally } from './tallyDisplay';
import type { StreamZapTally } from './streamZaps';

const tally = (totalSats: number, zapCount: number, zappers: [string, number][] = []) =>
  ({ totalSats, zapCount, satsByZapper: new Map(zappers) }) as StreamZapTally;

describe('keepHigherTally', () => {
  it('shows the first reading', () => {
    const first = tally(1000, 1);
    expect(keepHigherTally(null, first)).toBe(first);
  });

  it('moves up when a scan finds more', () => {
    const shown = tally(1000, 1);
    const fuller = tally(2234, 4);
    expect(keepHigherTally(shown, fuller)).toBe(fuller);
  });

  it('never replaces a higher total with a lower reading (partial or flaky re-scan)', () => {
    const shown = tally(2234, 4, [['a', 1050], ['b', 1000], ['c', 100], ['d', 84]]);
    const partial = tally(1000, 1, [['b', 1000]]);
    expect(keepHigherTally(shown, partial)).toBe(shown);
  });

  it('takes an equal total so fresher per-zapper detail is not lost', () => {
    const shown = tally(500, 2, [['a', 500]]);
    const same = tally(500, 2, [['a', 300], ['b', 200]]);
    expect(keepHigherTally(shown, same)).toBe(same);
  });

  it('keeps the current tally when the total ties but fewer zaps were found', () => {
    const shown = tally(500, 3);
    const fewer = tally(500, 2);
    expect(keepHigherTally(shown, fewer)).toBe(shown);
  });
});
