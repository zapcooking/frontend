import { describe, it, expect, vi } from 'vitest';
import { SpecialsLoader, SpecialsSession, type SpecialsSource } from './specialsLoader';
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

function source(
  o: {
    topics?: Record<string, RelayEvent[]>;
    state?: PageResult['state'];
  } = {}
) {
  const topic = vi.fn(async (slug: string): Promise<PageResult> => {
    if (o.state && o.state !== 'ok') return { state: o.state, events: [] };
    return { state: 'ok', events: o.topics?.[slug] ?? [], end: 'exhausted' };
  });
  const history = vi.fn(
    async (): Promise<HistoryResult> => ({ state: 'ok', events: [], labels: [], end: 'exhausted' })
  );
  const src: SpecialsSource = { topic, history, floor: () => 1_000_000 };
  return { src, topic, history };
}

function deps(member: boolean, extra: Partial<Parameters<typeof makeLoader>[1]> = {}) {
  return { member, ...extra };
}

function makeLoader(
  src: SpecialsSource,
  o: { member: boolean; hidden?: string[]; shown?: Map<string, number> },
  session = new SpecialsSession()
) {
  return new SpecialsLoader(
    src,
    {
      member: () => o.member,
      groups: () => GROUPS,
      hiddenTopics: () => o.hidden ?? [],
      shown: () => o.shown ?? new Map(),
      exclude: () => new Set(),
      accept: () => true,
      topicHistory: () => new Map(),
      rng: () => 0
    },
    session
  );
}

describe('non-members', () => {
  it('send no topic or archive requests at all', async () => {
    const { src, topic, history } = source({
      topics: { sourdough: ['a', 'b', 'c'].map((x) => img(x)) }
    });
    const l = makeLoader(src, deps(false));
    await l.prepareSpotlight();
    await l.prepareMemory();
    expect(await l.buildSpotlight()).toBeNull();
    expect(await l.onThisDay()).toBeNull();
    expect(topic).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
    expect(l.spotlight).toBeNull();
    expect(l.memory).toBeNull();
  });

  it('get a locked teaser from the catalog without any request', () => {
    const { src, topic } = source();
    const t = makeLoader(src, deps(false)).teaser();
    expect(t?.type).toBe('teaser');
    expect(topic).not.toHaveBeenCalled();
  });
});

describe('members', () => {
  it('a spotlight asks for the topic archive (older than the free window) and skips thin topics', async () => {
    const { src, topic } = source({
      topics: {
        sourdough: [img('s1')], // thin
        bread: [img('b1'), img('b2'), img('b3')],
        coffee: [img('c1'), img('c2'), img('c3')]
      }
    });
    const l = makeLoader(src, deps(true));
    await l.prepareSpotlight();
    expect(l.spotlight?.type).toBe('spotlight');
    for (const call of topic.mock.calls) expect(call[2]).toBe(1_000_000 - 1);
    const s = l.spotlight as Extract<typeof l.spotlight, { type: 'spotlight' }>;
    expect(s.posts).toHaveLength(3);
    expect(s.slug).not.toBe('sourdough');
  });

  it('no topic repeats within a session, and a hidden topic is never asked for', async () => {
    const three = (p: string) => [img(`${p}1`), img(`${p}2`), img(`${p}3`)];
    const { src, topic } = source({
      topics: { sourdough: three('s'), bread: three('b'), coffee: three('c') }
    });
    const session = new SpecialsSession();
    const l = makeLoader(src, deps(true, { hidden: ['bread'] }), session);
    const first = await l.buildSpotlight(null);
    const second = await l.buildSpotlight(null);
    const third = await l.buildSpotlight(null);
    const slugs = [first, second].map((s) => (s && s.type === 'spotlight' ? s.slug : null));
    expect(new Set(slugs).size).toBe(2);
    expect(third).toBeNull();
    expect(topic.mock.calls.map((c: unknown[]) => c[0])).not.toContain('bread');
  });

  it('a relay "not a member" holds further requests until the login counts again', async () => {
    const { src, topic } = source({ state: 'restricted' });
    const l = makeLoader(src, deps(true));
    await l.prepareSpotlight();
    expect(l.denied).toBe(true);
    await l.prepareSpotlight();
    await l.prepareMemory();
    expect(topic).toHaveBeenCalledTimes(1);
  });
});

describe('memories', () => {
  it('"From the archive" only asks for months that end before the free window', async () => {
    const floor = Math.floor(new Date(2026, 9, 7).getTime() / 1000) - 14 * 86400;
    const windows: [number, number][] = [];
    const src: SpecialsSource = {
      topic: async () => ({ state: 'ok', events: [], end: 'exhausted' }),
      history: async (since, until) => {
        windows.push([since, until]);
        return { state: 'ok', events: [], labels: [], end: 'exhausted' };
      },
      floor: () => floor
    };
    const session = new SpecialsSession();
    session.lastMemory = 'day'; // next: from the archive
    const l = new SpecialsLoader(
      src,
      {
        member: () => true,
        groups: () => [],
        hiddenTopics: () => [],
        shown: () => new Map(),
        exclude: () => new Set(),
        accept: () => true,
        topicHistory: () => new Map(),
        now: () => new Date(2026, 9, 7),
        rng: () => 0
      },
      session
    );
    await l.prepareMemory();
    expect(windows.length).toBeGreaterThan(0);
    for (const [, until] of windows) expect(until).toBeLessThan(floor + 1);
  });
});

describe('keep exploring', () => {
  const three = (p: string, pubkeyBase = p) =>
    [1, 2, 3].map((n) => img(`${p}${n}`, `${pubkeyBase}-${n}`));

  it('members: on this day, then two spotlights from different parent groups, then the recipes', async () => {
    const { src, history } = source({
      topics: { sourdough: three('s'), bread: three('b'), coffee: three('c') }
    });
    const l = makeLoader(src, deps(true));
    const recipes = [img('r1')];
    const e = await l.explore(recipes);
    expect(history).toHaveBeenCalled();
    expect(e.spotlights).toHaveLength(2);
    const parents = e.spotlights.map((s) => (s.type === 'spotlight' ? s.parent : null));
    expect(parents[0]).not.toBe(parents[1]);
    expect(e.recipes).toBe(recipes);
  });

  it('non-members: only the recipes, and no request is sent', async () => {
    const { src, topic, history } = source({ topics: { sourdough: three('s') } });
    const l = makeLoader(src, deps(false));
    const e = await l.explore([img('r1')]);
    expect(e).toEqual({ day: null, spotlights: [], recipes: [img('r1')] });
    expect(topic).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
  });
});

describe('feed login', () => {
  it('"auth-required" (a declined login) waits for a login; after it, requests go again', async () => {
    let state: PageResult['state'] = 'auth-required';
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
    const l = makeLoader(src, deps(true));
    await l.prepareSpotlight();
    expect(l.needsLogin).toBe(true);
    expect(l.denied).toBe(false);
    await l.prepareSpotlight();
    expect(topic).toHaveBeenCalledTimes(1); // no retry before a login
    state = 'ok';
    l.loggedIn();
    await l.prepareSpotlight();
    expect(l.spotlight?.type).toBe('spotlight');
  });

  it('"restricted" is a hold, not a verdict: once the login counts again, requests go again', async () => {
    // The relay answers restricted: for a minute after a failed or unresolved
    // membership lookup (feed-relay access.go, IsMember fail-closed). Before
    // this a single restricted: ended members-only cards for the session.
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
    const l = makeLoader(src, deps(true));
    await l.prepareSpotlight();
    expect(l.denied).toBe(true);
    await l.prepareSpotlight();
    expect(topic).toHaveBeenCalledTimes(1); // nothing more while held
    state = 'ok';
    l.loggedIn();
    expect(l.denied).toBe(false);
    await l.prepareSpotlight();
    expect(l.spotlight?.type).toBe('spotlight');
  });

  it('results gathered while the relay refused the login are not reused after it', async () => {
    // An empty "on this day" and the months that came back empty were the
    // relay's answer to a connection it took for a non-member's: forgotten
    // on login, asked again.
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
      const events = [1, 2, 3].map((n) => ({ ...img(`m${n}`, `pk-m${n}`), created_at: since + n * 60 }));
      return { state: 'ok', events, labels: events.map((e) => label(e.id)), end: 'exhausted' };
    });
    const src: SpecialsSource = {
      topic: async () => ({ state: 'ok', events: [], end: 'exhausted' }),
      history,
      floor: () => Math.floor(new Date(2026, 9, 7).getTime() / 1000) - 14 * 86400
    };
    const session = new SpecialsSession();
    const l = new SpecialsLoader(
      src,
      {
        member: () => true,
        groups: () => [],
        hiddenTopics: () => [],
        shown: () => new Map(),
        exclude: () => new Set(),
        accept: () => true,
        topicHistory: () => new Map(),
        now: () => new Date(2026, 9, 7),
        rng: () => 0
      },
      session
    );
    // Three empty prepares while the relay held: the memory type is given up on.
    for (let i = 0; i < 3; i++) await l.prepareMemory();
    expect(l.memory).toBeNull();
    expect(l.isOut('memory')).toBe(true);
    const asked = history.mock.calls.length;
    // The hold ends (the relay said restricted: elsewhere; the login counts again).
    l.needsLogin = true; // what a refusal leaves behind
    denied = false;
    l.loggedIn();
    expect(l.isOut('memory')).toBe(false);
    await l.prepareMemory();
    expect(history.mock.calls.length).toBeGreaterThan(asked); // asked again, not served from the empty cache
    expect(l.memory?.type).toBe('memory');
  });
});

describe('no prompt before the tap', () => {
  it('background spotlights and memories only ask on a logged-in connection (authedOnly)', async () => {
    const topicOpts: unknown[] = [];
    const historyOpts: unknown[] = [];
    const src: SpecialsSource = {
      topic: async (_s, _seen, _u, _l, opts) => {
        topicOpts.push(opts);
        return { state: 'auth-required', events: [] };
      },
      history: async (_since, _until, opts) => {
        historyOpts.push(opts);
        return { state: 'auth-required', events: [], labels: [] };
      },
      floor: () => 1_000_000
    };
    const l = makeLoader(src, deps(true));
    await l.prepareSpotlight();
    await l.prepareMemory();
    expect(topicOpts).toEqual([{ authedOnly: true }]);
    expect(historyOpts.every((o) => (o as { authedOnly?: boolean })?.authedOnly === true)).toBe(
      true
    );
    expect(l.needsLogin).toBe(true); // → the feed offers "Tap to unlock"
  });

  it('"Keep exploring" is a tap, so it may ask', async () => {
    const topicOpts: unknown[] = [];
    const src: SpecialsSource = {
      topic: async (_s, _seen, _u, _l, opts) => {
        topicOpts.push(opts);
        return { state: 'ok', events: [img('a'), img('b'), img('c')], end: 'exhausted' };
      },
      history: async () => ({ state: 'ok', events: [], labels: [], end: 'exhausted' }),
      floor: () => 1_000_000
    };
    const l = makeLoader(src, deps(true));
    await l.explore([]);
    expect(topicOpts[0]).toEqual({ authedOnly: false });
  });
});
