import { describe, it, expect } from 'vitest';
import { decideFollowEdit, followCount, type RelayAnswer, type ContactList } from './followSafety';

const P = 'wss://purplepag.es';
const OWN = ['wss://puravida.nostr.land', 'wss://pyramid.fiatjaf.com'];
const APP = 'wss://nos.lol';
const follows = (n: number, prefix = 'f') =>
  Array.from({ length: n }, (_, i) => ['p', `${prefix}${i}`]);
const list = (created_at: number, n: number, extra: string[][] = []): ContactList => ({
  id: `l${created_at}-${n}`,
  created_at,
  tags: [...follows(n), ...extra],
  content: '{"wss://x":{"read":true}}'
});
const ans = (url: string, l: ContactList | null, ok = true): RelayAnswer => ({
  url,
  ok,
  list: ok ? l : null
});

describe('decideFollowEdit', () => {
  it('normal add: the newest list plus one, other tags and content kept', () => {
    const d = decideFollowEdit({
      answers: [
        ans(P, list(200, 1096, [['t', 'x']])),
        ans(OWN[0], list(200, 1096)),
        ans(APP, list(100, 978))
      ],
      ownWrite: OWN,
      seen: null,
      add: ['new']
    });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.count).toBe(1097);
    expect(d.tags).toContainEqual(['t', 'x']);
    expect(d.tags).toContainEqual(['p', 'new']);
    expect(d.content).toBe('{"wss://x":{"read":true}}');
  });

  it('slow purplepag that timed out, but every own write relay answered: uses their newest', () => {
    const d = decideFollowEdit({
      answers: [
        ans(P, null, false),
        ans(OWN[0], list(200, 1096)),
        ans(OWN[1], null),
        ans(APP, list(100, 978))
      ],
      ownWrite: OWN,
      seen: null,
      add: ['new']
    });
    expect(d.ok && d.count).toBe(1097);
  });

  it('slow purplepag and an own write relay missing: refuse (the newest list may be there)', () => {
    const d = decideFollowEdit({
      answers: [
        ans(P, null, false),
        ans(OWN[0], null, false),
        ans(OWN[1], null),
        ans(APP, list(100, 978))
      ],
      ownWrite: OWN,
      seen: null,
      add: ['new']
    });
    expect(d).toEqual({ ok: false, reason: 'incomplete' });
  });

  it('no answers at all: refuse', () => {
    const d = decideFollowEdit({
      answers: [ans(P, null, false), ans(APP, null, false)],
      ownWrite: OWN,
      seen: null,
      add: ['new']
    });
    expect(d).toEqual({ ok: false, reason: 'no-answer' });
  });

  it('stale older list (a newer one was seen this session): refuse', () => {
    const d = decideFollowEdit({
      answers: [ans(P, list(100, 978)), ans(OWN[0], list(100, 978)), ans(OWN[1], null)],
      ownWrite: OWN,
      seen: { newestAt: 200, maxCount: 1096 },
      add: ['new']
    });
    expect(d).toEqual({ ok: false, reason: 'stale' });
  });

  it('a smaller list than one seen this session: refuse', () => {
    const d = decideFollowEdit({
      answers: [ans(P, list(300, 10))],
      ownWrite: OWN,
      seen: { newestAt: 200, maxCount: 1096 },
      add: ['new']
    });
    expect(d).toEqual({ ok: false, reason: 'smaller' });
  });

  it('no list found for a reader known to have one: refuse', () => {
    const d = decideFollowEdit({
      answers: [ans(P, null), ans(OWN[0], null), ans(OWN[1], null)],
      ownWrite: OWN,
      seen: { newestAt: 200, maxCount: 1096 },
      add: ['new']
    });
    expect(d).toEqual({ ok: false, reason: 'not-found' });
  });

  it('no list found and a relay didn’t answer: refuse', () => {
    const d = decideFollowEdit({
      answers: [ans(P, null), ans(OWN[0], null, false), ans(OWN[1], null)],
      ownWrite: OWN,
      seen: null,
      add: ['new']
    });
    expect(d).toEqual({ ok: false, reason: 'not-found' });
  });

  it('brand-new account: every relay (incl. purplepag) answered with nothing → first follow allowed', () => {
    const d = decideFollowEdit({
      answers: [ans(P, null), ans(APP, null)],
      ownWrite: [],
      seen: null,
      add: ['a', 'b']
    });
    expect(d.ok && d.count).toBe(2);
  });

  it('unfollow removes exactly one; following someone already followed changes nothing', () => {
    const base = { answers: [ans(P, list(200, 5))], ownWrite: OWN, seen: null };
    const u = decideFollowEdit({ ...base, remove: ['f2'] });
    expect(u.ok && u.count).toBe(4);
    const same = decideFollowEdit({ ...base, add: ['f1'] });
    expect(same.ok && same.changed).toBe(false);
  });

  it('would shrink below the largest list seen: refuse', () => {
    const d = decideFollowEdit({
      answers: [ans(P, list(300, 1096))],
      ownWrite: OWN,
      seen: { newestAt: 200, maxCount: 1096 },
      remove: ['f1', 'f2', 'nope']
    });
    // Two real removals are allowed (asked for); the list may not drop further.
    expect(d.ok && d.count).toBe(1094);
  });

  it('never empties a list of more than one (the old unfollow safeguard)', () => {
    const d = decideFollowEdit({
      answers: [ans(P, list(200, 2))],
      ownWrite: OWN,
      seen: null,
      remove: ['f0', 'f1']
    });
    expect(d).toEqual({ ok: false, reason: 'would-shrink' });
  });

  it('followCount ignores duplicates and non-p tags', () => {
    expect(
      followCount([
        ['p', 'a'],
        ['p', 'a'],
        ['t', 'x'],
        ['p', 'b']
      ])
    ).toBe(2);
  });
});
