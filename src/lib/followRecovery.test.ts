import { describe, it, expect } from 'vitest';
import {
  selectRecoveryCandidates,
  pickRecommendedRecovery,
  type FollowListCandidate
} from './followRecovery';

/**
 * The rule this pins: recovery never offers an EMPTY follow list.
 *
 * Restoring a zero-follow version publishes a kind:3 with no follows —
 * wiping the list the user came here to rescue. Empty versions are also
 * noise on a screen someone reaches while stressed.
 *
 * The awkward part is that an empty list is often the user's CURRENT one,
 * so it still has to count for the "is this better than what I have?"
 * comparison even though it can't be offered.
 */

function candidate(
  eventId: string,
  followCount: number,
  createdAt: number
): FollowListCandidate {
  return {
    event: { id: eventId } as any,
    eventId,
    createdAt,
    followCount,
    followPubkeys: Array.from({ length: followCount }, (_, i) => `pk${i}`),
    foundOnRelays: ['wss://relay.example'],
    isCurrent: false,
    isRecommended: false
  };
}

/** Newest first — the order scanFollowListHistory produces. */
const newestFirst = (...c: FollowListCandidate[]) =>
  [...c].sort((a, b) => b.createdAt - a.createdAt);

describe('empty versions are never offered', () => {
  it('drops a zero-follow version from the candidate list', () => {
    const result = selectRecoveryCandidates(
      newestFirst(candidate('empty', 0, 300), candidate('good', 120, 200))
    );

    expect(result.candidates.map((c) => c.eventId)).toEqual(['good']);
  });

  it('drops every empty version, keeping order', () => {
    const result = selectRecoveryCandidates(
      newestFirst(
        candidate('e1', 0, 500),
        candidate('a', 50, 400),
        candidate('e2', 0, 300),
        candidate('b', 90, 200)
      )
    );

    expect(result.candidates.map((c) => c.eventId)).toEqual(['a', 'b']);
  });

  it('returns nothing to offer when every version is empty', () => {
    const result = selectRecoveryCandidates(
      newestFirst(candidate('e1', 0, 200), candidate('e2', 0, 100))
    );

    expect(result.candidates).toEqual([]);
    expect(result.recommended).toBeNull();
  });

  it('never recommends an empty version', () => {
    const result = selectRecoveryCandidates(
      newestFirst(candidate('empty', 0, 300), candidate('good', 10, 200))
    );

    expect(result.recommended?.followCount).toBeGreaterThan(0);
  });
});

describe('current is still computed from the unfiltered list', () => {
  it('marks the newest version as current even when it is empty', () => {
    // The whole reason someone is here: their live list got wiped.
    const result = selectRecoveryCandidates(
      newestFirst(candidate('wiped', 0, 300), candidate('good', 120, 200))
    );

    expect(result.current?.eventId).toBe('wiped');
    expect(result.current?.isCurrent).toBe(true);
  });

  it('does not promote an older non-empty version to current', () => {
    const result = selectRecoveryCandidates(
      newestFirst(candidate('wiped', 0, 300), candidate('good', 120, 200))
    );

    const good = result.candidates.find((c) => c.eventId === 'good');
    expect(good?.isCurrent).toBe(false);
  });

  it('recommends recovery when the current list is empty', () => {
    const result = selectRecoveryCandidates(
      newestFirst(candidate('wiped', 0, 300), candidate('good', 120, 200))
    );

    expect(result.recommended?.eventId).toBe('good');
  });
});

describe('recommendation', () => {
  it('prefers the largest list over merely the newest', () => {
    const result = selectRecoveryCandidates(
      newestFirst(
        candidate('current', 5, 400),
        candidate('small', 20, 300),
        candidate('big', 300, 200)
      )
    );

    expect(result.recommended?.eventId).toBe('big');
  });

  it('recommends nothing when current is already the biggest', () => {
    const result = selectRecoveryCandidates(
      newestFirst(candidate('current', 500, 400), candidate('older', 100, 300))
    );

    expect(result.recommended).toBeNull();
  });

  it('never recommends the current version itself', () => {
    const result = selectRecoveryCandidates(
      newestFirst(candidate('current', 100, 400), candidate('older', 100, 300))
    );

    expect(result.recommended?.eventId).not.toBe('current');
  });
});

describe('edge cases', () => {
  it('handles an empty scan', () => {
    const result = selectRecoveryCandidates([]);

    expect(result.current).toBeNull();
    expect(result.candidates).toEqual([]);
    expect(result.recommended).toBeNull();
  });

  it('offers nothing when the only version is the current non-empty one', () => {
    const result = selectRecoveryCandidates([candidate('only', 42, 100)]);

    expect(result.candidates.map((c) => c.eventId)).toEqual(['only']);
    expect(result.recommended).toBeNull();
  });

  it('pickRecommendedRecovery still filters empties when called directly', () => {
    // Defense in depth: the helper is exported and used elsewhere.
    const empty = candidate('empty', 0, 300);
    expect(pickRecommendedRecovery([empty], null)).toBeNull();
  });
});
