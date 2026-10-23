import { describe, it, expect } from 'vitest';
import {
  buildSavedListEdit,
  decideSavedListBase,
  type ListEvent,
  type ListRelayAnswer
} from './savedListSafety';

const NOS = 'wss://nos.lol';
const PRIMAL = 'wss://relay.primal.net';
const PURPLE = 'wss://purplepag.es';
const WINE = 'wss://nostr.wine';
const PYRAMID = 'wss://pyramid.fiatjaf.com';

const empty = (url: string): ListRelayAnswer => ({ url, ok: true, list: null });
const silent = (url: string): ListRelayAnswer => ({ url, ok: false, list: null });
const has = (url: string, list: ListEvent): ListRelayAnswer => ({ url, ok: true, list });

const list = (created_at: number, recipes: string[], extra: string[][] = []): ListEvent => ({
  id: `id-${created_at}`,
  created_at,
  tags: [
    ['d', 'nostrcooking-bookmarks'],
    ['title', 'Saved'],
    ...extra,
    ...recipes.map((a) => ['a', a])
  ],
  content: ''
});

const decide = (o: Partial<Parameters<typeof decideSavedListBase>[0]>) =>
  decideSavedListBase({ answers: [], ownWrite: [], local: null, seen: null, fresh: false, ...o });

describe('decideSavedListBase — when may the list be edited, and on what', () => {
  it('confirms absence: two relays that can hold the list answered empty', () => {
    expect(decide({ answers: [empty(NOS), empty(PRIMAL)] })).toEqual({ ok: true, base: null });
  });

  it('never treats one silent relay as absence', () => {
    expect(decide({ answers: [silent(NOS)] }).ok).toBe(false);
  });

  it('one empty answer is not enough', () => {
    expect(decide({ answers: [empty(NOS), silent(PRIMAL)] }).ok).toBe(false);
  });

  it("doesn't count relays that refuse kind-30001 writes as evidence", () => {
    // purplepag.es blocks the kind; nostr.wine is paid-only — empty proves nothing.
    expect(decide({ answers: [empty(PURPLE), empty(WINE), empty(NOS)] }).ok).toBe(false);
  });

  it('needs a majority of the member’s own list-capable write relays, not all of them', () => {
    const DEAD = 'wss://dead.example';
    const OTHER = 'wss://relay.other.example';
    // 3 write relays, one dead: 2/3 answered → proceed.
    expect(
      decide({
        answers: [empty(NOS), empty(PRIMAL), empty(PYRAMID), empty(OTHER), silent(DEAD)],
        ownWrite: [PYRAMID, OTHER, DEAD]
      }).ok
    ).toBe(true);
    // 3 write relays, two dead: 1/3 → refuse, even with the app relays answering.
    expect(
      decide({
        answers: [empty(NOS), empty(PRIMAL), empty(PYRAMID), silent(OTHER), silent(DEAD)],
        ownWrite: [PYRAMID, OTHER, DEAD]
      }).ok
    ).toBe(false);
  });

  it('a strict majority: one of two write relays is not enough', () => {
    expect(
      decide({
        answers: [empty(NOS), empty(PRIMAL), empty(PYRAMID), silent('wss://dead.example')],
        ownWrite: [PYRAMID, 'wss://dead.example']
      }).ok
    ).toBe(false);
  });

  it('a single own write relay must answer', () => {
    const answers = [empty(NOS), empty(PRIMAL), silent(PYRAMID)];
    expect(decide({ answers, ownWrite: [PYRAMID] }).ok).toBe(false);
    expect(
      decide({ answers: [empty(NOS), empty(PRIMAL), empty(PYRAMID)], ownWrite: [PYRAMID] }).ok
    ).toBe(true);
  });

  it("paid / kind-blocking relays in the member's list don't count toward the majority", () => {
    // purplepag.es + nostr.wine listed as write relays: list-capable = pyramid only.
    expect(
      decide({
        answers: [empty(NOS), empty(PRIMAL), empty(PYRAMID), silent(WINE), silent(PURPLE)],
        ownWrite: [PYRAMID, WINE, PURPLE]
      }).ok
    ).toBe(true);
  });

  it('still needs 2 list-capable answers overall, majority or not', () => {
    expect(
      decide({ answers: [empty(PYRAMID), silent(NOS), silent(PRIMAL)], ownWrite: [PYRAMID] }).ok
    ).toBe(false);
  });

  it('a list found on one relay is not enough when the read is incomplete', () => {
    // The newest copy may sit on the own write relay that didn't answer.
    const answers = [has(NOS, list(100, ['30023:x:a'])), silent(PYRAMID), empty(PRIMAL)];
    expect(decide({ answers, ownWrite: [PYRAMID] }).ok).toBe(false);
  });

  it('builds on the newest of the relays, a signed local copy and this session', () => {
    const relay = list(100, ['a1']);
    const local = list(200, ['a1', 'a2']);
    const seen = list(150, ['a1']);
    const d = decide({ answers: [has(NOS, relay), empty(PRIMAL)], local, seen });
    expect(d).toEqual({ ok: true, base: local });
  });

  it('a local copy never stands in for an incomplete read', () => {
    expect(decide({ answers: [silent(NOS), silent(PRIMAL)], local: list(200, ['a1']) }).ok).toBe(
      false
    );
  });

  it('fresh account (key generated this session): no network needed', () => {
    expect(decide({ fresh: true })).toEqual({ ok: true, base: null });
    const mine = list(300, ['a1']);
    expect(decide({ fresh: true, seen: mine })).toEqual({ ok: true, base: mine });
  });

  it('matches relay URLs regardless of a trailing slash or case', () => {
    expect(
      decide({
        answers: [empty('wss://NOS.lol/'), empty(PRIMAL), empty('wss://Pyramid.fiatjaf.com/')],
        ownWrite: [PYRAMID]
      }).ok
    ).toBe(true);
  });
});

describe('buildSavedListEdit — one event per edit', () => {
  const opts = { dTag: 'nostrcooking-bookmarks', title: 'Saved', now: 1000, floor: 0 };

  it('a first save is the whole list with the recipe in it', () => {
    const next = buildSavedListEdit(null, { add: ['30023:x:r1'] }, opts);
    expect(next.tags).toEqual([
      ['d', 'nostrcooking-bookmarks'],
      ['title', 'Saved'],
      ['cover', '30023:x:r1'],
      ['a', '30023:x:r1']
    ]);
    expect(next.changed).toBe(true);
  });

  it('keeps the cover and every other tag of the base (My Kitchen cover survives a save)', () => {
    const base = list(
      500,
      ['30023:x:r1', '30023:x:r2'],
      [
        ['summary', 'weeknight wins'],
        ['image', 'https://img/legacy.jpg'],
        ['cover', '30023:x:r2'],
        ['x-other-client', 'keep me']
      ]
    );
    const next = buildSavedListEdit(base, { add: ['30023:x:r3'] }, opts);
    expect(next.tags).toContainEqual(['cover', '30023:x:r2']);
    expect(next.tags).toContainEqual(['summary', 'weeknight wins']);
    expect(next.tags).toContainEqual(['image', 'https://img/legacy.jpg']);
    expect(next.tags).toContainEqual(['x-other-client', 'keep me']);
    expect(next.tags.filter((t) => t[0] === 'a').map((t) => t[1])).toEqual([
      '30023:x:r1',
      '30023:x:r2',
      '30023:x:r3'
    ]);
  });

  it('keeps the encrypted private content verbatim', () => {
    const base = { ...list(500, ['30023:x:r1']), content: 'nip44-ciphertext' };
    expect(buildSavedListEdit(base, { add: ['30023:x:r2'] }, opts).content).toBe(
      'nip44-ciphertext'
    );
  });

  it('adding a recipe that is already there changes nothing', () => {
    const next = buildSavedListEdit(list(500, ['30023:x:r1']), { add: ['30023:x:r1'] }, opts);
    expect(next.changed).toBe(false);
  });

  it('the cover follows a removed recipe to the next one', () => {
    const base = list(500, ['30023:x:r1', '30023:x:r2'], [['cover', '30023:x:r1']]);
    const next = buildSavedListEdit(base, { remove: ['30023:x:r1'] }, opts);
    expect(next.tags).toContainEqual(['cover', '30023:x:r2']);
    expect(next.tags.filter((t) => t[0] === 'a')).toEqual([['a', '30023:x:r2']]);
  });

  it('created_at is strictly newer than the base and than the last publish', () => {
    expect(
      buildSavedListEdit(list(2000, []), { add: ['a'] }, { ...opts, now: 1000 }).created_at
    ).toBe(2001);
    expect(
      buildSavedListEdit(null, { add: ['a'] }, { ...opts, now: 1000, floor: 1000 }).created_at
    ).toBe(1001);
    expect(
      buildSavedListEdit(null, { add: ['a'] }, { ...opts, now: 5000, floor: 1000 }).created_at
    ).toBe(5000);
  });

  it("drops the base's client tag (the publisher adds its own)", () => {
    const base = list(500, [], [['client', 'Other App']]);
    expect(buildSavedListEdit(base, { add: ['a'] }, opts).tags.some((t) => t[0] === 'client')).toBe(
      false
    );
  });
});
