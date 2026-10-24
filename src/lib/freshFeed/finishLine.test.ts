import { describe, it, expect } from 'vitest';
import { finishLine } from './finishLine';

const member = { kind: 'none' } as const;
const join = { kind: 'join', signedIn: false } as const;

describe('caught up → keep exploring', () => {
  it('nothing until the end of the 14-day window', () => {
    const f = finishLine({
      reached: false,
      atFloor: false,
      membershipKnown: true,
      prompt: member,
      explore: 'closed'
    });
    expect(Object.values(f).some(Boolean)).toBe(false);
  });

  it('member: caught-up card and the Keep exploring button; no archive until tapped', () => {
    const f = finishLine({
      reached: true,
      atFloor: true,
      membershipKnown: true,
      prompt: member,
      explore: 'closed'
    });
    expect(f).toEqual({
      caughtUp: true,
      exploreButton: true,
      explore: false,
      older: false,
      floorCard: false
    });
  });

  it('member: tapping opens the explore section, which ends with Older posts', () => {
    expect(
      finishLine({
        reached: true,
        atFloor: true,
        membershipKnown: true,
        prompt: member,
        explore: 'loading'
      })
    ).toMatchObject({ exploreButton: false, explore: true, older: false });
    expect(
      finishLine({
        reached: true,
        atFloor: true,
        membershipKnown: true,
        prompt: member,
        explore: 'open'
      })
    ).toMatchObject({ explore: true, older: true });
  });

  it('Older posts goes away once older posts are loading (the history follows below)', () => {
    const f = finishLine({
      reached: true,
      atFloor: false,
      membershipKnown: true,
      prompt: member,
      explore: 'open'
    });
    expect(f.older).toBe(false);
    expect(f.caughtUp).toBe(true);
  });

  it('non-members: caught-up card, explore (recipes), the membership card, never Older posts', () => {
    const f = finishLine({
      reached: true,
      atFloor: true,
      membershipKnown: true,
      prompt: join,
      explore: 'open'
    });
    expect(f).toEqual({
      caughtUp: true,
      exploreButton: false,
      explore: true,
      older: false,
      floorCard: true
    });
  });

  it('waits for the membership answer (no flash of the wrong card)', () => {
    const f = finishLine({
      reached: true,
      atFloor: true,
      membershipKnown: false,
      prompt: join,
      explore: 'closed'
    });
    expect(f.caughtUp).toBe(false);
    expect(f.floorCard).toBe(false);
  });
});
