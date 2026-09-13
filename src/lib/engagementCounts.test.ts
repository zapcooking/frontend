import { describe, expect, it } from 'vitest';
import { raiseCount } from './engagementCounts';

/**
 * The COUNT fast path is a partial view: it asks a fixed pair of relays,
 * and a relay that never saw a reaction answers zero honestly. These
 * tests pin the rule that keeps a partial zero from erasing engagement
 * the subscription already found.
 */
describe('engagement count reconciliation', () => {
  it('ignores a zero from relays that never saw the reactions', () => {
    // The subscription found 7 on the author's relays; the COUNT relays
    // hold none of them and answer 0.
    expect(raiseCount(7, 0)).toBe(7);
  });

  it('takes a higher count from the COUNT relays', () => {
    // COUNT saw more than our subscription did — believe the larger view.
    expect(raiseCount(2, 9)).toBe(9);
  });

  it('leaves the count untouched when a relay could not answer', () => {
    // null means "no answer", which is different from "zero of them".
    expect(raiseCount(4, null)).toBe(4);
  });

  it('accepts a real zero on a note with no engagement', () => {
    expect(raiseCount(0, 0)).toBe(0);
  });

  it('treats a missing value like an unanswered one', () => {
    expect(raiseCount(4, undefined)).toBe(4);
  });
});
