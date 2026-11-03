import { describe, it, expect } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import {
  activeMemberSellers,
  collectAuthors,
  memberListingEvents,
  membershipUnavailable,
  pageAnswered
} from './memberSellers';

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
  type Ev = { id: string; pubkey: string; created_at: number };
  /** A relay holding `history` (newest first), serving `size` per page with an inclusive `until`. */
  function relay(history: Ev[], size: number, answered = true) {
    const calls: (number | undefined)[] = [];
    const fetchPage = async (until: number | undefined) => {
      calls.push(until);
      const events = history
        .filter((e) => until === undefined || e.created_at <= until)
        .slice(0, size);
      return { events, answered };
    };
    return { fetchPage, calls };
  }
  const ev = (id: string, pubkey: string, created_at: number): Ev => ({ id, pubkey, created_at });

  it('pages back through the whole history, so an old seller is found behind a flood', async () => {
    const flood = Array.from({ length: 250 }, (_, i) => ev(`s${i}`, 'spam', 10_000 - i));
    const { fetchPage, calls } = relay([...flood, ev('m', 'member', 100)], 100);
    const r = await collectAuthors(fetchPage, 10);
    expect(r.authors).toEqual(new Set(['spam', 'member']));
    expect(calls).toEqual([undefined, 9_901, 9_802, 100, 99]);
  });

  it('a page whose oldest equals the cursor is valid, and a second split across pages is read in full', async () => {
    // Two per page: the second at 900 holds two shops, split across pages;
    // the member is one second older still.
    const history = [
      ev('a', 'p902', 902),
      ev('b', 'p901', 901),
      ev('c', 'p900a', 900),
      ev('d', 'p900b', 900),
      ev('e', 'member', 899)
    ];
    const r = await collectAuthors(relay(history, 2).fetchPage, 10);
    expect(r.authors).toEqual(new Set(['p902', 'p901', 'p900a', 'p900b', 'member']));
  });

  it('stops after maxPages, at an empty page, and at a relay that ignores until', async () => {
    const many = Array.from({ length: 1000 }, (_, i) => ev(`x${i}`, `p${i}`, 5000 - i));
    expect((await collectAuthors(relay(many, 100).fetchPage, 2)).authors.size).toBe(199);
    expect((await collectAuthors(relay([], 100).fetchPage, 5)).authors).toEqual(new Set());
    let n = 0;
    const ignoresUntil = async () => (n++, { events: [ev('same', 'same', 50)], answered: true });
    await collectAuthors(ignoresUntil, 10);
    expect(n).toBe(3);
  });

  it('says whether any page was answered: a silent relay is a failure, not an empty history', async () => {
    expect((await collectAuthors(relay([], 100, false).fetchPage, 3)).answered).toBe(false);
    expect((await collectAuthors(relay([], 100, true).fetchPage, 3)).answered).toBe(true);
  });

  it('is partial when the relay answered some pages and then stopped answering', async () => {
    const history = Array.from({ length: 300 }, (_, i) => ev(`h${i}`, `p${i}`, 3000 - i));
    let n = 0;
    const drops = async (until: number | undefined) => {
      n++;
      const events = history
        .filter((e) => until === undefined || e.created_at <= until)
        .slice(0, 100);
      return n === 1 ? { events, answered: true } : { events: [], answered: false };
    };
    const r = await collectAuthors(drops, 10);
    expect([r.answered, r.partial, r.authors.size]).toEqual([true, true, 100]);
    const whole = await collectAuthors(relay(history, 100).fetchPage, 10);
    expect([whole.answered, whole.partial]).toEqual([true, false]);
    const silent = await collectAuthors(relay(history, 100, false).fetchPage, 10);
    expect([silent.answered, silent.partial]).toEqual([false, false]);
  });
});

describe('memberListingEvents', () => {
  const memberKey = generateSecretKey();
  const strangerKey = generateSecretKey();
  const member = getPublicKey(memberKey);
  // Through JSON, as events arrive from a relay: nostr-tools marks the events
  // it signs as verified (a symbol `verifyEvent` trusts), and a copy keeps it.
  const sign = (key: Uint8Array, kind: number) =>
    JSON.parse(
      JSON.stringify(
        finalizeEvent({ kind, created_at: 1_760_000_000, tags: [['d', 'x']], content: '' }, key)
      )
    );
  const o = { members: new Set([member]), kinds: [30402, 30018], verify: verifyEvent };

  it("keeps a member's signed listing", () => {
    const e = sign(memberKey, 30402);
    expect(memberListingEvents([e], o)).toEqual([e]);
  });

  it('drops a stranger, a kind not asked for, a forged member event and a broken one, one by one', () => {
    const good = sign(memberKey, 30018);
    const stranger = sign(strangerKey, 30402);
    const wrongKind = sign(memberKey, 1);
    // A stranger's signed event relabelled with the member's pubkey.
    const forged = { ...sign(strangerKey, 30402), pubkey: member };
    const tampered = { ...sign(memberKey, 30402), content: 'changed' };
    const throws = { ...good, id: 'x' };
    const kept = memberListingEvents([stranger, wrongKind, forged, tampered, throws, good], {
      ...o,
      verify: (e) => {
        if (e.id === 'x') throw new Error('bad');
        return verifyEvent(e);
      }
    });
    expect(kept).toEqual([good]);
  });
});

describe('pageAnswered', () => {
  it('only an EOSE is an answer: not a CLOSED, a timeout or a dropped socket', () => {
    expect(pageAnswered({ done: { p: true }, closed: {} })).toBe(true);
    expect(pageAnswered({ done: { p: true }, closed: { p: 'auth-required: members only' } })).toBe(
      false
    );
    expect(pageAnswered({ done: { p: true }, closed: { p: '' } })).toBe(false);
    expect(pageAnswered({ done: { p: false }, closed: {} })).toBe(false);
  });
});
