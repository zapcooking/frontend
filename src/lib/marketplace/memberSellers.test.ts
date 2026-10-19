import { describe, it, expect } from 'vitest';
import { activeMemberSellers, collectAuthors, membershipUnavailable } from './memberSellers';

describe('activeMemberSellers', () => {
  it('keeps active members of any tier, including tiers the app has no badge for', () => {
    expect(
      activeMemberSellers({
        org: { active: true }, // the pantry's `standard`
        life: { active: true },
        lapsed: { active: false },
        stranger: undefined
      })
    ).toEqual(new Set(['org', 'life']));
  });

  it('leaves out a seller whose lookup failed (never shown on an unanswered check)', () => {
    expect(activeMemberSellers({ x: { active: true, unresolved: true } })).toEqual(new Set());
    expect(activeMemberSellers({})).toEqual(new Set());
  });
});

describe('membershipUnavailable', () => {
  it('is an outage only when nobody could be checked', () => {
    expect(membershipUnavailable({ a: { unresolved: true }, b: { unresolved: true } })).toBe(true);
    expect(membershipUnavailable({ a: { unresolved: true }, b: {} })).toBe(false);
    expect(membershipUnavailable({})).toBe(false);
  });
});

describe('collectAuthors', () => {
  /** A relay holding `history` (newest first), serving `size` per page with an inclusive `until`. */
  function relay(history: { pubkey: string; created_at: number }[], size: number) {
    const calls: (number | undefined)[] = [];
    const fetchPage = async (until: number | undefined) => {
      calls.push(until);
      return history.filter((e) => until === undefined || e.created_at <= until).slice(0, size);
    };
    return { fetchPage, calls };
  }

  it('pages back through the whole history, so an old seller is found behind a flood', () => {
    const flood = Array.from({ length: 250 }, (_, i) => ({
      pubkey: 'spam',
      created_at: 10_000 - i
    }));
    const { fetchPage, calls } = relay([...flood, { pubkey: 'member', created_at: 100 }], 100);
    return collectAuthors(fetchPage, 10).then((authors) => {
      expect(authors).toEqual(new Set(['spam', 'member']));
      expect(calls).toEqual([undefined, 9_900, 9_800, 99]);
    });
  });

  it('stops after maxPages, at an empty page, and at a page that does not get older', async () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({
      pubkey: `p${i}`,
      created_at: 5000 - i
    }));
    expect((await collectAuthors(relay(many, 100).fetchPage, 2)).size).toBe(200);
    expect(await collectAuthors(relay([], 100).fetchPage, 5)).toEqual(new Set());
    const stuck = async () => [{ pubkey: 'same', created_at: 50 }];
    let n = 0;
    const counting = async (u: number | undefined) => (n++, stuck());
    await collectAuthors(counting, 10);
    expect(n).toBe(2);
  });
});
