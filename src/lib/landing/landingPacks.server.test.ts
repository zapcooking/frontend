import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { standardRelays } from '$lib/consts';
import { FakeWebSocket, ev, pk, relay, relays, testVerify } from './fakeRelay.testutil';
import { packCard } from './packs';
import {
  buildLandingData,
  emptyLandingData,
  mergeWithLastGood,
  moderateLandingData,
  getLandingData,
  __resetLandingMemo,
  FRESH_FOR_MS,
  MAX_PACK_REVISIONS,
  CACHE_KEY,
  type CacheLike
} from './landingData.server';

const NOW = 1_800_000_000;
const author = pk('a');
const makePack = (d: string, created_at = NOW) =>
  ev({
    kind: 30004,
    pubkey: author,
    created_at,
    tags: [
      ['d', d],
      ['title', `Pack ${d}`],
      ['t', 'recipe-pack'],
      ['a', `30023:${pk('b')}:pasta`]
    ]
  });
const deps = { now: () => NOW, verify: testVerify, fetchNip11: async () => null, timeoutMs: 40 };

beforeEach(() => {
  relays.clear();
  __resetLandingMemo();
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
  for (const url of standardRelays) relay(url);
});
afterEach(() => {
  delete (globalThis as { WebSocket?: unknown }).WebSocket;
});

describe('Explore public recipe pack discovery', () => {
  it('uses the same public discovery relays as /packs, verifies revisions and shows the newest three', async () => {
    const first = makePack('first', NOW - 3);
    relay(standardRelays[0], [
      first,
      makePack('first', NOW - 10),
      { ...makePack('first', NOW + 1), sig: 'forged' },
      makePack('second', NOW - 2),
      { ...makePack('forged'), sig: 'forged' }
    ]);
    relay(standardRelays[2], [
      first,
      makePack('third', NOW - 1),
      makePack('fourth', NOW - 4),
      ev({ kind: 0, pubkey: author, content: '{"name":"A cook"}' })
    ]);
    const data = await buildLandingData(deps);
    expect(data.packs?.map((card) => card.title)).toEqual([
      'Pack third',
      'Pack second',
      'Pack first'
    ]);
    expect(data.packs?.map((card) => card.author.name)).toEqual(['A cook', 'A cook', 'A cook']);
    for (const url of standardRelays)
      expect(relays.get(url)!.reqs).toContainEqual({
        kinds: [30004],
        '#t': ['zap-cooking', 'recipe-pack'],
        limit: 60
      });
    expect(data.settled).toContain('packs');
  });

  it('does not revive an old revision when its newest signed revision has no recipes', async () => {
    const old = makePack('emptied', NOW - 1);
    relay(standardRelays[0], [old]);
    relay(standardRelays[2], [
      { ...makePack('emptied'), tags: old.tags.filter((tag) => tag[0] !== 'a') }
    ]);
    expect((await buildLandingData(deps)).packs).toEqual([]);
  });

  it('keeps last-good packs on outage or auth-required responses, but clears a complete empty result', async () => {
    const last = { ...emptyLandingData(NOW - 10), packs: [packCard(makePack('old'))!] };
    relay(standardRelays[0], [], 'closed');
    const closed = await buildLandingData(deps);
    expect(closed.settled).not.toContain('packs');
    expect(mergeWithLastGood(closed, last).data.packs).toEqual(last.packs);
    relay(standardRelays[0], [], 'down');
    expect(mergeWithLastGood(await buildLandingData(deps), last).data.packs).toEqual(last.packs);
    relay(standardRelays[0]);
    expect(mergeWithLastGood(await buildLandingData(deps), last).data.packs).toEqual([]);
  });

  it('handles old cached payloads without packs and rechecks cached pack blocks', () => {
    const old = emptyLandingData(NOW);
    delete old.packs;
    expect(mergeWithLastGood(emptyLandingData(NOW + 1), old).data.packs).toEqual([]);
    const card = packCard(makePack('blocked'))!;
    const blocked = moderateLandingData(
      { ...old, packs: [card] },
      { blockedPubkeys: [author], blockedEventIds: [], blockedNaddrs: [], denylist: [] }
    );
    expect(blocked.packs).toEqual([]);
  });

  it('drops a known emptied revision during partial outage while retaining unrelated or newer cached packs', async () => {
    const removed = makePack('removed', NOW - 1);
    const unrelated = packCard(makePack('unrelated', NOW - 1))!;
    const last = { ...emptyLandingData(NOW - 1), packs: [packCard(removed)!, unrelated] };
    const empty = makePack('removed');
    relay(standardRelays[0], [{ ...empty, tags: empty.tags.filter((tag) => tag[0] !== 'a') }]);
    relay(standardRelays[1], [], 'closed');
    const next = await buildLandingData(deps);
    expect(next.settled).not.toContain('packs');
    expect(mergeWithLastGood(next, last).data.packs).toEqual([unrelated]);

    // An older empty version must not undo a later pack already in the cache.
    const newer = { ...last, packs: [packCard(makePack('removed', NOW + 1))!] };
    expect(mergeWithLastGood(next, newer).data.packs).toEqual(newer.packs);
    const staleValid = { ...emptyLandingData(NOW + 2), packs: [packCard(removed)!] };
    expect(mergeWithLastGood(staleValid, newer).data.packs).toEqual(newer.packs);
  });

  it('bounds remembered signed revisions while keeping the highest observed version per coordinate', () => {
    const revisions = Array.from({ length: MAX_PACK_REVISIONS + 5 }, (_, i) => ({
      coordinate: `30004:${author}:pack-${i}`,
      version: i
    }));
    const last = { ...emptyLandingData(NOW), packRevisions: revisions };
    const next = {
      ...emptyLandingData(NOW + 1),
      packRevisions: [{ coordinate: revisions[0].coordinate, version: NOW }]
    };
    const merged = mergeWithLastGood(next, last).data.packRevisions!;
    expect(merged).toHaveLength(MAX_PACK_REVISIONS);
    expect(merged[0]).toEqual(next.packRevisions[0]);
    expect(
      merged.filter((revision) => revision.coordinate === revisions[0].coordinate)
    ).toHaveLength(1);
  });

  it('stores a packs-only build and persists a known removal even when another relay is unavailable', async () => {
    const stored = new Map<string, string>();
    const cache: CacheLike = {
      match: async (req) => (stored.has(req.url) ? new Response(stored.get(req.url)) : undefined),
      put: async (req, res) => {
        stored.set(req.url, await res.text());
      }
    };
    const initial = { ...emptyLandingData(NOW - 1), packs: [packCard(makePack('only', NOW - 1))!] };
    await getLandingData({ cache, clock: () => 1, build: async () => initial });
    expect(stored.has(CACHE_KEY)).toBe(true);
    const empty = makePack('only');
    relay(standardRelays[0], [{ ...empty, tags: empty.tags.filter((tag) => tag[0] !== 'a') }]);
    relay(standardRelays[1], [], 'down');
    const next = await buildLandingData(deps);
    expect(next.settled).not.toContain('packs');
    const waits: Promise<unknown>[] = [];
    await getLandingData({
      cache,
      clock: () => FRESH_FOR_MS + 2,
      waitUntil: (promise) => waits.push(promise),
      build: async () => next
    });
    await Promise.all(waits);
    __resetLandingMemo();
    const removed = await getLandingData({ cache, clock: () => FRESH_FOR_MS + 3 });
    expect(removed.packs).toEqual([]);

    // The relay with the signed empty version is now unavailable. Another
    // source replays the old valid version: a third refresh must not revive it.
    relay(standardRelays[0], [], 'down');
    relay(standardRelays[2], [makePack('only', NOW - 1)]);
    const replay = await buildLandingData(deps);
    expect(replay.packs).toHaveLength(1);
    const moreWaits: Promise<unknown>[] = [];
    await getLandingData({
      cache,
      clock: () => 2 * FRESH_FOR_MS + 4,
      waitUntil: (promise) => moreWaits.push(promise),
      build: async () => replay
    });
    await Promise.all(moreWaits);
    __resetLandingMemo();
    const stillRemoved = await getLandingData({ cache, clock: () => 2 * FRESH_FOR_MS + 5 });
    expect(stillRemoved.packs).toEqual([]);
    expect(stillRemoved.packRevisions).toContainEqual({
      coordinate: initial.packs[0].coordinate,
      version: NOW
    });
  });
});
