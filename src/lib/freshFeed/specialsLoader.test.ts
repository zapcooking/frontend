import { describe, it, expect, vi } from 'vitest';
import { SpecialsLoader, SpecialsSession, type SpecialsSource } from './specialsLoader';
import { SPECIALS } from './specialsConfig';
import { LABELER_PUBKEY, type HistoryResult, type PageResult, type RelayEvent } from './relay';
import type { TopicGroup } from './topicList';

const GROUPS: TopicGroup[] = [
  {
    slug: 'baking',
    name: 'Baking',
    count14d: 0,
    topics: [
      { slug: 'sourdough', name: 'Sourdough', count14d: 0 },
      { slug: 'bread', name: 'Bread', count14d: 0 }
    ]
  },
  {
    slug: 'drinks',
    name: 'Drinks',
    count14d: 0,
    topics: [{ slug: 'coffee', name: 'Coffee', count14d: 0 }]
  }
];

const img = (id: string, pubkey = `pk-${id}`): RelayEvent => ({
  id,
  pubkey,
  created_at: 1,
  kind: 1,
  tags: [],
  content: `https://img.example/${id}.jpg`,
  sig: ''
});

type TopicOpts = { authedOnly?: boolean; preview?: boolean } | undefined;
type HistoryOpts = { authedOnly?: boolean; limit?: number } | undefined;

function source(
  o: {
    topics?: Record<string, RelayEvent[]>;
    state?: PageResult['state'];
    history?: (since: number, until: number, opts: HistoryOpts) => HistoryResult;
  } = {}
) {
  const topicOpts: TopicOpts[] = [];
  const historyOpts: HistoryOpts[] = [];
  const topic = vi.fn(
    async (
      slug: string,
      _seen: Set<string>,
      _u?: number,
      _l?: number,
      opts?: TopicOpts
    ): Promise<PageResult> => {
      topicOpts.push(opts);
      if (o.state && o.state !== 'ok') return { state: o.state, events: [] };
      return { state: 'ok', events: o.topics?.[slug] ?? [], end: 'exhausted' };
    }
  );
  const history = vi.fn(
    async (since: number, until: number, opts?: HistoryOpts): Promise<HistoryResult> => {
      historyOpts.push(opts);
      return (
        o.history?.(since, until, opts) ?? { state: 'ok', events: [], labels: [], end: 'exhausted' }
      );
    }
  );
  const src: SpecialsSource = { topic, history, floor: () => 1_000_000 };
  return { src, topic, history, topicOpts, historyOpts };
}

let clock = Date.UTC(2026, 9, 7, 12);

function makeLoader(
  src: SpecialsSource,
  o: { member: boolean; hidden?: string[]; shown?: Map<string, number>; groups?: TopicGroup[] },
  session = new SpecialsSession()
) {
  return new SpecialsLoader(
    src,
    {
      member: () => o.member,
      groups: () => o.groups ?? GROUPS,
      hiddenTopics: () => o.hidden ?? [],
      shown: () => o.shown ?? new Map(),
      exclude: () => new Set(),
      accept: () => true,
      topicHistory: () => new Map(),
      now: () => new Date(clock),
      rng: () => 0
    },
    session
  );
}

describe('everyone gets previews (no login involved)', () => {
  it('a non-member: a spotlight from the anonymous preview, no authedOnly, no member request', async () => {
    const { src, topic, topicOpts } = source({
      topics: { sourdough: ['a', 'b', 'c'].map((x) => img(x)) }
    });
    const l = makeLoader(src, { member: false });
    await l.prepareSpotlight();
    expect(l.spotlight?.type).toBe('spotlight');
    expect(topic).toHaveBeenCalledTimes(1);
    expect(topicOpts).toEqual([{ preview: true }]);
    expect(l.needsLogin).toBe(false);
    expect(l.denied).toBe(false);
  });

  it('a member: the same preview request (nothing asks the signer in the background)', async () => {
    const { src, topicOpts } = source({
      topics: { sourdough: ['a', 'b', 'c'].map((x) => img(x)) }
    });
    const l = makeLoader(src, { member: true });
    await l.prepareSpotlight();
    expect(l.spotlight?.type).toBe('spotlight');
    expect(topicOpts).toEqual([{ preview: true }]);
  });

  it('a spotlight skips thin topics (fewer than minPosts eligible)', async () => {
    const { src } = source({
      topics: {
        sourdough: [img('s1')], // thin
        bread: [img('b1'), img('b2'), img('b3')],
        coffee: [img('c1'), img('c2'), img('c3')]
      }
    });
    const l = makeLoader(src, { member: false });
    await l.prepareSpotlight();
    const s = l.spotlight as Extract<typeof l.spotlight, { type: 'spotlight' }>;
    expect(s.posts).toHaveLength(SPECIALS.spotlight.posts);
    expect(s.slug).not.toBe('sourdough');
  });

  it('no topic repeats within a session, and a hidden topic is never asked for', async () => {
    const three = (p: string) => [img(`${p}1`), img(`${p}2`), img(`${p}3`)];
    const { src, topic } = source({
      topics: { sourdough: three('s'), bread: three('b'), coffee: three('c') }
    });
    const session = new SpecialsSession();
    const l = makeLoader(src, { member: false, hidden: ['bread'] }, session);
    const first = await l.buildSpotlight(null);
    const second = await l.buildSpotlight(null);
    const third = await l.buildSpotlight(null);
    const slugs = [first, second].map((s) => (s && s.type === 'spotlight' ? s.slug : null));
    expect(new Set(slugs).size).toBe(2);
    expect(third).toBeNull();
    expect(topic.mock.calls.map((c: unknown[]) => c[0])).not.toContain('bread');
  });

  it('a non-member never asks for memories (no history request at all)', async () => {
    const { src, history } = source();
    const l = makeLoader(src, { member: false, groups: [] });
    await l.prepareMemory();
    expect(l.memory).toBeNull();
    expect(history).not.toHaveBeenCalled();
    expect(l.memberAccess()).toBe(false);
  });
});

describe('memories are members-only, on a logged-in connection', () => {
  it('"on this day" is asked for with authedOnly (never the signer) and labeled posts only', async () => {
    const label = (id: string): RelayEvent => ({
      id: `label-${id}`,
      pubkey: LABELER_PUBKEY,
      created_at: 1,
      kind: 1985,
      tags: [
        ['e', id],
        ['l', 'bread', 'cooking.zap.topic']
      ],
      content: '',
      sig: ''
    });
    const { src, historyOpts } = source({
      history: (since) => {
        const events = [img('d1', 'pk-1'), img('u1', 'pk-2')].map((e, i) => ({
          ...e,
          created_at: since + 60 + i
        }));
        return { state: 'ok', events, labels: [label('d1')], end: 'exhausted' };
      }
    });
    const session = new SpecialsSession();
    session.lastMemory = 'archive'; // next: on this day
    const l = makeLoader(src, { member: true, groups: [] }, session);
    await l.prepareMemory();
    expect(l.memory?.type).toBe('memory');
    if (l.memory?.type === 'memory') {
      expect(l.memory.variant).toBe('day');
      expect(l.memory.posts.map((p) => p.id)).toEqual(['d1']); // the unlabeled post is not a memory
    }
    expect(historyOpts.every((o) => o?.authedOnly === true)).toBe(true);
  });

  it('a member whose feed login has not happened yet: one authedOnly try, then the type waits for loggedIn()', async () => {
    const { src, history } = source({
      history: () => ({ state: 'auth-required', events: [], labels: [] })
    });
    const l = makeLoader(src, { member: true, groups: [] });
    await l.prepareMemory();
    expect(l.memory).toBeNull();
    expect(l.needsLogin).toBe(true);
    expect(l.waitingForLogin()).toBe(true);
    expect(l.memberAccess()).toBe(false);
    await l.prepareMemory();
    expect(history).toHaveBeenCalledTimes(1); // nothing more until the login counts
    expect(l.isOut('memory')).toBe(false); // not "no content"
  });

  it('"From the archive" only asks for months that end before the free window, and remembers the month', async () => {
    const floor = Math.floor(new Date(2026, 9, 7).getTime() / 1000) - 14 * 86400;
    const windows: [number, number][] = [];
    const label = (id: string): RelayEvent => ({
      id: `label-${id}`,
      pubkey: LABELER_PUBKEY,
      created_at: 1,
      kind: 1985,
      tags: [
        ['e', id],
        ['l', 'bread', 'cooking.zap.topic']
      ],
      content: '',
      sig: ''
    });
    const src: SpecialsSource = {
      topic: async () => ({ state: 'ok', events: [], end: 'exhausted' }),
      history: async (since, until, opts) => {
        windows.push([since, until]);
        expect(opts?.authedOnly).toBe(true);
        const e = { ...img('m1'), created_at: since + 60 };
        return { state: 'ok', events: [e], labels: [label(e.id)], end: 'exhausted' };
      },
      floor: () => floor
    };
    const session = new SpecialsSession();
    session.lastMemory = 'day'; // next: from the archive
    const l = makeLoader(src, { member: true, groups: [] }, session);
    await l.prepareMemory();
    expect(windows.length).toBeGreaterThan(0);
    for (const [, until] of windows) expect(until).toBeLessThan(floor + 1);
    expect(l.memory?.type).toBe('memory');
    if (l.memory?.type === 'memory') {
      expect(l.memory.variant).toBe('archive');
      expect(l.memory.monthKey).toMatch(/^\d{4}-\d{2}$/);
    }
  });
});

describe('a relay that refuses previews', () => {
  it('auth-required (previews not served): a hold with a growing wait, nothing marked used, no lock', async () => {
    const { src, topic } = source({ state: 'auth-required' });
    const session = new SpecialsSession();
    const l = makeLoader(src, { member: false }, session);
    await l.prepareSpotlight();
    expect(l.spotlight).toBeNull();
    expect(topic).toHaveBeenCalledTimes(1);
    expect(session.usedTopics.size).toBe(0); // a refusal is never "thin"
    expect(l.isOut('spotlight')).toBe(false);
    expect(l.needsLogin).toBe(false);
    expect(l.denied).toBe(false);
    expect(l.previewHoldLeftMs()).toBe(SPECIALS.preview.retryMs);
    // Held: nothing more is asked (spotlight or memory) until the hold ends.
    await l.prepareSpotlight();
    await l.prepareMemory();
    expect(topic).toHaveBeenCalledTimes(1);
    // The hold ends: asked again; refused again → a longer wait.
    clock += SPECIALS.preview.retryMs;
    expect(l.previewHoldLeftMs()).toBe(0);
    await l.prepareSpotlight();
    expect(topic).toHaveBeenCalledTimes(2);
    expect(l.previewHoldLeftMs()).toBe(SPECIALS.preview.retryMs * 2);
    clock += SPECIALS.preview.retryMs * 2;
    await l.prepareSpotlight();
    expect(l.previewHoldLeftMs()).toBe(SPECIALS.preview.retryMs * 4);
  });

  it('the wait is capped, and an answered preview ends the hold and its backoff', async () => {
    let state: PageResult['state'] = 'restricted';
    const topic = vi.fn(
      async (): Promise<PageResult> =>
        state === 'ok'
          ? { state: 'ok', events: [img('a'), img('b'), img('c')], end: 'exhausted' }
          : { state, events: [] }
    );
    const src: SpecialsSource = {
      topic,
      history: async () => ({ state: 'ok', events: [], labels: [], end: 'exhausted' }),
      floor: () => 1_000_000
    };
    const l = makeLoader(src, { member: true });
    for (let i = 0; i < 12; i++) {
      await l.prepareSpotlight();
      clock += l.previewHoldLeftMs();
    }
    expect(l.previewHoldLeftMs()).toBe(0);
    await l.prepareSpotlight();
    expect(l.previewHoldLeftMs()).toBe(SPECIALS.preview.retryMaxMs);
    clock += SPECIALS.preview.retryMaxMs;
    state = 'ok';
    await l.prepareSpotlight();
    expect(l.spotlight?.type).toBe('spotlight');
    expect(l.previewHoldLeftMs()).toBe(0);
    l.takeSpotlight();
    state = 'restricted';
    await l.prepareSpotlight();
    expect(l.previewHoldLeftMs()).toBe(SPECIALS.preview.retryMs); // back to the first wait
  });
});

describe('keep exploring', () => {
  const three = (p: string, pubkeyBase = p) =>
    [1, 2, 3].map((n) => img(`${p}${n}`, `${pubkeyBase}-${n}`));

  it('members: the full on this day (may log in), then two preview spotlights from different parent groups, then the recipes', async () => {
    const { src, history, historyOpts, topicOpts } = source({
      topics: { sourdough: three('s'), bread: three('b'), coffee: three('c') }
    });
    const l = makeLoader(src, { member: true });
    const recipes = [img('r1')];
    const e = await l.explore(recipes);
    expect(history).toHaveBeenCalled();
    expect(historyOpts.every((o) => o?.authedOnly === false)).toBe(true);
    expect(e.spotlights).toHaveLength(2);
    expect(topicOpts.every((o) => o?.preview === true)).toBe(true);
    const parents = e.spotlights.map((s) => (s.type === 'spotlight' ? s.parent : null));
    expect(parents[0]).not.toBe(parents[1]);
    expect(e.recipes).toBe(recipes);
  });

  it('non-members: the preview spotlights and the recipes, no day and no history request', async () => {
    const { src, history, topicOpts } = source({
      topics: { sourdough: three('s'), bread: three('b'), coffee: three('c') }
    });
    const l = makeLoader(src, { member: false });
    const e = await l.explore([img('r1')]);
    expect(e.day).toBeNull();
    expect(e.spotlights).toHaveLength(2);
    expect(history).not.toHaveBeenCalled();
    expect(topicOpts.every((o) => o?.preview === true)).toBe(true);
    expect(l.needsLogin).toBe(false);
  });
});

describe('members-only content (keep exploring) and the feed login', () => {
  it('"auth-required" (a declined login) waits for a login; after it, the full day is asked again', async () => {
    let state: HistoryResult['state'] = 'auth-required';
    const history = vi.fn(
      async (since: number): Promise<HistoryResult> =>
        state === 'ok'
          ? {
              state: 'ok',
              events: [{ ...img('d1'), created_at: since + 60 }],
              labels: [],
              end: 'exhausted'
            }
          : { state, events: [], labels: [] }
    );
    const src: SpecialsSource = {
      topic: async () => ({ state: 'ok', events: [], end: 'exhausted' }),
      history,
      floor: () => 1_000_000
    };
    const l = makeLoader(src, { member: true, groups: [] });
    await l.explore([]);
    expect(l.needsLogin).toBe(true);
    expect(l.denied).toBe(false);
    const asked = history.mock.calls.length;
    expect(await l.onThisDay()).toBeNull();
    expect(history.mock.calls.length).toBe(asked); // no retry before a login
    state = 'ok';
    l.loggedIn();
    expect(l.needsLogin).toBe(false);
    expect(await l.onThisDay()).not.toBeNull();
  });

  it('"restricted" is a hold, not a verdict: once the login counts again, requests go again', async () => {
    let state: HistoryResult['state'] = 'restricted';
    const history = vi.fn(
      async (): Promise<HistoryResult> =>
        state === 'ok'
          ? { state: 'ok', events: [], labels: [], end: 'exhausted' }
          : { state, events: [], labels: [] }
    );
    const src: SpecialsSource = {
      topic: async () => ({ state: 'ok', events: [], end: 'exhausted' }),
      history,
      floor: () => 1_000_000
    };
    const l = makeLoader(src, { member: true, groups: [] });
    await l.explore([]);
    expect(l.denied).toBe(true);
    const asked = history.mock.calls.length;
    await l.onThisDay();
    expect(history.mock.calls.length).toBe(asked); // nothing more while held
    state = 'ok';
    l.loggedIn();
    expect(l.denied).toBe(false);
    await l.onThisDay();
    expect(history.mock.calls.length).toBeGreaterThan(asked);
  });

  it('an empty full day gathered while the relay refused the login is not reused after it', async () => {
    let denied = true;
    const label = (id: string): RelayEvent => ({
      id: `label-${id}`,
      pubkey: LABELER_PUBKEY,
      created_at: 1,
      kind: 1985,
      tags: [
        ['e', id],
        ['l', 'bread', 'cooking.zap.topic']
      ],
      content: '',
      sig: ''
    });
    const history = vi.fn(async (since: number): Promise<HistoryResult> => {
      if (denied) return { state: 'ok', events: [], labels: [], end: 'exhausted' };
      const events = [{ ...img('d1'), created_at: since + 60 }];
      return { state: 'ok', events, labels: events.map((e) => label(e.id)), end: 'exhausted' };
    });
    const src: SpecialsSource = {
      topic: async () => ({ state: 'ok', events: [], end: 'exhausted' }),
      history,
      floor: () => 1_000_000
    };
    const l = makeLoader(src, { member: true, groups: [] });
    await l.explore([]);
    const asked = history.mock.calls.length;
    l.needsLogin = true; // what a refusal leaves behind
    denied = false;
    l.loggedIn();
    expect((await l.onThisDay())?.some((s) => s.posts.length)).toBe(true);
    expect(history.mock.calls.length).toBeGreaterThan(asked);
  });
});
