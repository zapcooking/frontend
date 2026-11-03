import { describe, it, expect, vi } from 'vitest';
import { get, writable } from 'svelte/store';
import { withoutBlockedComments, moderatedSubscription, type IsBlocked } from './moderation';
import type { CommentSubscription } from './subscription';
import type { NDKEvent } from '@nostr-dev-kit/ndk';

const AUTHOR = 'a'.repeat(64);
const ALICE = '1'.repeat(64);
const BOB = '2'.repeat(64);
const MALLORY = 'f'.repeat(64);
const RECIPE_ID = 'e'.repeat(64);
const ADDRESS = `30023:${AUTHOR}:pancakes`;

let seq = 0;
const nextId = () => (++seq).toString(16).padStart(64, '0');

/** Top-level NIP-22 comment on the recipe, as postComment builds it. */
function top(pubkey: string, extra: string[][] = []) {
  return {
    id: nextId(),
    pubkey,
    kind: 1111,
    tags: [
      ['A', ADDRESS, ''],
      ['K', '30023'],
      ['P', AUTHOR, ''],
      ['a', ADDRESS, ''],
      ['k', '30023'],
      ['p', AUTHOR, ''],
      ['e', RECIPE_ID, '', AUTHOR],
      ...extra
    ]
  };
}

/** NIP-22 reply to a comment: lowercase `e` names the parent. */
function reply(pubkey: string, parent: { id: string; pubkey: string }) {
  return {
    id: nextId(),
    pubkey,
    kind: 1111,
    tags: [
      ['A', ADDRESS, ''],
      ['K', '30023'],
      ['P', AUTHOR, ''],
      ['e', parent.id, '', parent.pubkey],
      ['k', '1111'],
      ['p', parent.pubkey, '']
    ]
  };
}

const blocking =
  (ids: string[] = [], pubkeys: string[] = []): IsBlocked =>
  ({ eventId, pubkey }) =>
    ids.includes(eventId) || pubkeys.includes(pubkey);

describe('withoutBlockedComments', () => {
  it('returns the same array when nothing is blocked', () => {
    const events = [top(ALICE), top(BOB)];
    expect(withoutBlockedComments(events, blocking())).toBe(events);
  });

  it('removes an ordinary comment by blocked event id', () => {
    const a = top(ALICE);
    const b = top(BOB);
    expect(withoutBlockedComments([a, b], blocking([a.id]))).toEqual([b]);
  });

  it('removes a plated post by blocked event id the same way', () => {
    const plate = top(ALICE, [['t', 'cooked']]);
    const other = top(BOB);
    expect(withoutBlockedComments([plate, other], blocking([plate.id]))).toEqual([other]);
  });

  it('removes every comment by a blocked author', () => {
    const m1 = top(MALLORY);
    const m2 = top(MALLORY, [['t', 'cooked']]);
    const a = top(ALICE);
    expect(withoutBlockedComments([m1, a, m2], blocking([], [MALLORY]))).toEqual([a]);
  });

  it('removes replies under a blocked comment, all the way down', () => {
    const bad = top(MALLORY);
    const r1 = reply(ALICE, bad);
    const r2 = reply(BOB, r1);
    const keep = top(BOB);
    const keepReply = reply(ALICE, keep);
    const out = withoutBlockedComments([bad, r1, r2, keep, keepReply], blocking([], [MALLORY]));
    expect(out).toEqual([keep, keepReply]);
  });

  it('catches a reply that arrives before its blocked parent', () => {
    const bad = top(MALLORY);
    const r1 = reply(ALICE, bad);
    const r2 = reply(BOB, r1);
    expect(withoutBlockedComments([r2, r1, bad], blocking([bad.id]))).toEqual([]);
  });

  it("keeps a blocked author's reply's parent and siblings", () => {
    const parent = top(ALICE);
    const badReply = reply(MALLORY, parent);
    const goodReply = reply(BOB, parent);
    expect(withoutBlockedComments([parent, badReply, goodReply], blocking([], [MALLORY]))).toEqual([
      parent,
      goodReply
    ]);
  });

  it('passes events without an id or pubkey, and survives malformed tags', () => {
    const noId = { pubkey: MALLORY, kind: 1111, tags: [] };
    const junk = { id: nextId(), pubkey: ALICE, kind: 1111, tags: [null as unknown as string[]] };
    const bad = top(MALLORY);
    expect(withoutBlockedComments([noId, junk, bad], blocking([bad.id]))).toEqual([noId, junk]);
  });
});

describe('moderatedSubscription', () => {
  function fakeSub(initial: unknown[]) {
    const events = writable(initial as NDKEvent[]);
    const sub: CommentSubscription = {
      events,
      eosed: writable(true),
      addLocal: vi.fn((ev: NDKEvent) => events.update((l) => [...l, ev])),
      stop: vi.fn()
    };
    return { sub, events };
  }

  it('re-filters when the moderation lists change (overlay arrives)', () => {
    const bad = top(MALLORY);
    const ok = top(ALICE);
    const { sub } = fakeSub([bad, ok]);
    const version = writable(0);
    let blockedIds: string[] = [];
    const shown = moderatedSubscription(sub, version, (p) => blockedIds.includes(p.eventId));

    expect(get(shown.events)).toHaveLength(2);
    blockedIds = [bad.id];
    version.set(1);
    expect(get(shown.events)).toEqual([ok]);
  });

  it('passes addLocal through to the shared subscription and filters what it adds', () => {
    const { sub } = fakeSub([]);
    const shown = moderatedSubscription(sub, writable(0), blocking([], [MALLORY]));
    const mine = top(ALICE) as unknown as NDKEvent;
    shown.addLocal(top(MALLORY) as unknown as NDKEvent);
    shown.addLocal(mine);
    expect(sub.addLocal).toHaveBeenCalledTimes(2);
    expect(get(shown.events)).toEqual([mine]);
  });
});
