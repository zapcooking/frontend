import { describe, it, expect } from 'vitest';
import { SPECIALS, type SpecialType } from './specialsConfig';
import {
  Rotation,
  Slots,
  allTopics,
  archiveStandout,
  capsFor,
  choosePosts,
  dayMemory,
  pickTopic,
  placeSpecials,
  spotlightPosts,
  type Special,
  type TopicPick
} from './specials';
import { SPOTLIGHT_TITLES, spotlightTitle } from './spotlightTitles';
import type { RelayEvent } from './relay';
import type { TopicGroup } from './topicList';

/** A seeded generator, so "random" runs repeat. */
function seeded(seed: number) {
  // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const post = (id: string, o: Partial<RelayEvent> = {}): RelayEvent => ({
  id,
  pubkey: o.pubkey ?? `pk-${id}`,
  created_at: o.created_at ?? 1,
  kind: o.kind ?? 1,
  tags: o.tags ?? [],
  content: o.content ?? id,
  sig: ''
});
const withImage = (id: string, o: Partial<RelayEvent> = {}) =>
  post(id, { ...o, content: `${id} https://img.example/${id}.jpg` });

/** The relay's real catalog shape: 10 groups, 44 topics. */
const GROUPS: TopicGroup[] = (
  [
    ['baking', ['sourdough', 'bread', 'pastry', 'cakes', 'cookies']],
    ['fermentation-preserving', ['pickles', 'kimchi', 'sauerkraut', 'kombucha', 'canning']],
    ['bbq-grilling', ['bbq', 'smoking', 'grilling']],
    ['meat-seafood', ['beef', 'pork', 'poultry', 'seafood', 'charcuterie']],
    ['plant-based', ['vegetables', 'salads', 'vegan', 'legumes']],
    ['drinks', ['coffee', 'tea', 'beer', 'wine', 'cocktails']],
    ['world-cuisines', ['italian', 'mexican', 'japanese', 'indian', 'chinese']],
    ['meals', ['breakfast', 'soups-stews', 'pasta', 'pizza', 'sandwiches']],
    ['growing-sourcing', ['gardening', 'foraging', 'homesteading', 'cheese-dairy']],
    ['sweets', ['desserts', 'chocolate', 'ice-cream']]
  ] as [string, string[]][]
).map(([slug, topics]) => ({
  slug,
  name: slug,
  count14d: 0,
  topics: topics.map((t) => ({ slug: t, name: t[0].toUpperCase() + t.slice(1), count14d: 0 }))
}));

const NO_FEWER = { fewer: { recipe: false, spotlight: false, memory: false } };

describe('slots: spacing and jitter', () => {
  it('first card at position 6–8, then 7–9 posts apart, never in the first 5', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const anchors = new Slots(seeded(seed)).upTo(200);
      // A card after the a-th post sits at feed position a + 1 (+ earlier cards).
      expect(anchors[0] + 1).toBeGreaterThanOrEqual(SPECIALS.firstPosition.min);
      expect(anchors[0] + 1).toBeLessThanOrEqual(SPECIALS.firstPosition.max);
      expect(anchors[0]).toBeGreaterThanOrEqual(SPECIALS.leadPosts);
      for (let i = 1; i < anchors.length; i++) {
        const gap = anchors[i] - anchors[i - 1];
        expect(gap).toBeGreaterThanOrEqual(SPECIALS.gap.min);
        expect(gap).toBeLessThanOrEqual(SPECIALS.gap.max);
      }
    }
  });

  it('is jittered, not a fixed interval', () => {
    const gaps = new Set<number>();
    const firsts = new Set<number>();
    for (let seed = 1; seed <= 50; seed++) {
      const a = new Slots(seeded(seed)).upTo(100);
      firsts.add(a[0]);
      for (let i = 1; i < a.length; i++) gaps.add(a[i] - a[i - 1]);
    }
    expect(firsts.size).toBe(3);
    expect(gaps.size).toBe(3);
  });

  it('is stable: the same Slots returns the same positions as the feed grows', () => {
    const s = new Slots(seeded(7));
    const early = s.upTo(30);
    expect(s.upTo(90).slice(0, early.length)).toEqual(early);
  });
});

describe('rotation', () => {
  const all = () => true;
  const run = (
    n: number,
    ready: (t: SpecialType) => boolean,
    available: (t: SpecialType) => boolean = () => true,
    prefs = NO_FEWER
  ) => {
    const r = new Rotation();
    const caps = capsFor(prefs);
    const seq: SpecialType[] = [];
    for (let i = 0; i < n; i++) {
      const t = r.choose(ready, caps, prefs, false, available);
      if (!t) continue; // a skipped slot
      r.record(t);
      seq.push(t);
    }
    return seq;
  };

  it('recipe → spotlight → recipe → spotlight → memory, repeating (a memory every 5th)', () => {
    expect(run(10, all)).toEqual([
      'recipe',
      'spotlight',
      'recipe',
      'spotlight',
      'memory',
      'recipe',
      'spotlight',
      'recipe',
      'spotlight',
      'memory'
    ]);
  });

  it('no caps exhaustion: ~150 posts of slots keep every type coming', () => {
    const anchors = new Slots(seeded(11)).upTo(150);
    expect(anchors.length).toBeGreaterThanOrEqual(16);
    const seq = run(anchors.length, all);
    expect(seq).toHaveLength(anchors.length);
    const last5 = seq.slice(-5);
    expect(new Set(last5)).toEqual(new Set(['recipe', 'spotlight', 'memory']));
  });

  it('never the same type twice in a row while another type is available', () => {
    const seq = run(40, all);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
  });

  it('a type out of unshown content is skipped; the rest keep alternating', () => {
    const r = new Rotation();
    const caps = capsFor(NO_FEWER);
    const noSpotlights = (t: SpecialType) => t !== 'spotlight';
    const seq: SpecialType[] = [];
    for (let i = 0; i < 6; i++) {
      const t = r.choose(all, caps, NO_FEWER, false, noSpotlights)!;
      r.record(t);
      seq.push(t);
    }
    expect(seq).toEqual(['recipe', 'memory', 'recipe', 'memory', 'recipe', 'memory']);
  });

  it('only one type available (the others out of unshown content): it may repeat', () => {
    const seq = run(6, all, (t) => t === 'recipe');
    expect(seq).toEqual(['recipe', 'recipe', 'recipe', 'recipe', 'recipe', 'recipe']);
  });

  it('a type with nothing ready yields to the next ready type; nothing ready skips the slot', () => {
    const r = new Rotation();
    const caps = capsFor(NO_FEWER);
    r.record('recipe');
    expect(r.choose((t) => t !== 'spotlight', caps, NO_FEWER)).toBe('memory');
    expect(r.choose(() => false, caps, NO_FEWER)).toBeNull();
  });

  it('strict (slot far below the screen): waits for the pattern’s own type instead of another', () => {
    const r = new Rotation();
    const caps = capsFor(NO_FEWER);
    const notRecipe = (t: SpecialType) => t !== 'recipe';
    expect(r.choose(notRecipe, caps, NO_FEWER, true)).toBeNull();
    expect(r.choose(notRecipe, caps, NO_FEWER, false)).toBe('spotlight');
  });

  it('the same caps for everyone: every card is a preview, nothing is capped per session', () => {
    expect(capsFor(NO_FEWER)).toEqual({ recipe: Infinity, spotlight: Infinity, memory: Infinity });
  });
});

describe('"Show fewer like this" overrides the defaults', () => {
  it('gives the type a per-session cap', () => {
    const prefs = { fewer: { recipe: false, spotlight: true, memory: false } };
    expect(capsFor(prefs).spotlight).toBe(SPECIALS.fewerCap);
    expect(capsFor(prefs).recipe).toBe(Infinity);
  });

  it('lowers the frequency: the type takes only every other turn, then stops at its cap', () => {
    const prefs = { fewer: { recipe: false, spotlight: true, memory: false } };
    const caps = capsFor(prefs);
    const r = new Rotation();
    const seq: SpecialType[] = [];
    for (let i = 0; i < 40; i++) {
      const t = r.choose(() => true, caps, prefs);
      if (!t) continue;
      r.record(t);
      seq.push(t);
    }
    const spot = seq.filter((t) => t === 'spotlight').length;
    expect(spot).toBe(SPECIALS.fewerCap);
    const first10 = seq.slice(0, 10).filter((t) => t === 'spotlight').length;
    expect(first10).toBeLessThan(4); // normally 4 in 10
  });
});

describe('topic spotlight variety', () => {
  it('rotates across all 44 topics, every one with a title', () => {
    const topics = allTopics(GROUPS);
    expect(topics).toHaveLength(44);
    for (const t of topics) expect(SPOTLIGHT_TITLES[t.slug]).toBeTruthy();
    expect(spotlightTitle('unknown-slug', 'Unknown')).toBe('Unknown');
  });

  it('never the same parent group twice in a row, never a topic twice in a session', () => {
    const used = new Set<string>();
    let lastParent: string | null = null;
    const rng = seeded(3);
    for (let i = 0; i < 30; i++) {
      const t: TopicPick = pickTopic(GROUPS, {
        hidden: [],
        used,
        lastParent,
        history: new Map(),
        rng
      })!;
      expect(t.parent).not.toBe(lastParent);
      expect(used.has(t.slug)).toBe(false);
      used.add(t.slug);
      lastParent = t.parent;
    }
  });

  it('favors topics not shown recently on this device', () => {
    const history = new Map(allTopics(GROUPS).map((t) => [t.slug, 1000] as [string, number]));
    history.delete('kimchi');
    history.set('pizza', 5);
    const t = pickTopic(GROUPS, { hidden: [], used: new Set(), lastParent: null, history });
    expect(t!.slug).toBe('kimchi'); // never shown beats shown long ago
    history.set('kimchi', 2000);
    expect(
      pickTopic(GROUPS, { hidden: [], used: new Set(), lastParent: null, history })!.slug
    ).toBe('pizza');
  });

  it('"Hide this topic": a hidden topic is never picked', () => {
    const hidden = allTopics(GROUPS)
      .map((t) => t.slug)
      .filter((s) => s !== 'tea');
    const t = pickTopic(GROUPS, { hidden, used: new Set(), lastParent: null, history: new Map() });
    expect(t!.slug).toBe('tea');
    expect(
      pickTopic(GROUPS, {
        hidden: [...hidden, 'tea'],
        used: new Set(),
        lastParent: null,
        history: new Map()
      })
    ).toBeNull();
  });

  it('skips a thin topic (fewer than 3 eligible posts)', () => {
    expect(
      spotlightPosts([withImage('a'), withImage('b')], { shown: new Map(), exclude: new Set() })
    ).toBeNull();
  });
});

describe('card posts', () => {
  it('prefer images, one post per author', () => {
    const events = [
      post('t1', { pubkey: 'x' }),
      withImage('i1', { pubkey: 'x' }),
      withImage('i2', { pubkey: 'x' }),
      withImage('i3', { pubkey: 'y' }),
      post('t2', { pubkey: 'z' })
    ];
    const picked = choosePosts(events, { shown: new Map(), exclude: new Set(), max: 3 });
    expect(picked.map((e) => e.id)).toEqual(['i1', 'i3', 't2']);
  });

  it('never shows a post this device has shown, or one already on screen', () => {
    const events = ['a', 'b', 'c', 'd', 'e'].map((id) => withImage(id));
    const shown = new Map([['a', 1]]);
    const picked = spotlightPosts(events, { shown, exclude: new Set(['b']) })!;
    expect(picked.map((e) => e.id)).toEqual(['c', 'd', 'e']);
  });

  it('memory "on this day": nearest year with an eligible post, 1–2 posts', () => {
    const sections = [
      { yearsBack: 2, window: { since: 0, until: 0 }, posts: [withImage('two')] },
      { yearsBack: 1, window: { since: 0, until: 0 }, posts: [withImage('seen')] }
    ];
    const m = dayMemory(sections, { shown: new Map([['seen', 1]]), exclude: new Set() });
    expect(m).toEqual({ yearsBack: 2, posts: [sections[0].posts[0]] });
  });

  it('memory "from the archive": one standout (image first, then the most to read)', () => {
    const p = archiveStandout([post('long', { content: 'x'.repeat(500) }), withImage('pic')], {
      shown: new Map(),
      exclude: new Set()
    });
    expect(p!.id).toBe('pic');
  });
});

describe('placing cards', () => {
  it('each card follows its anchor post; posts prepended later leave cards where they were', () => {
    const p = (id: string) => ({ raw: { id } });
    const card: Special = { type: 'recipe', post: post('r') };
    const slots = new Map([['p6', { anchorId: 'p6', key: 'sp:0', special: card }]]);
    const feed = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map(p);
    const rows = placeSpecials(feed, slots);
    expect(rows.findIndex((r) => r.box)).toBe(6);
    const refreshed = placeSpecials([p('new1'), p('new2'), ...feed], slots);
    const at = refreshed.findIndex((r) => r.box);
    expect(refreshed[at - 1].key).toBe('p6');
  });
});
