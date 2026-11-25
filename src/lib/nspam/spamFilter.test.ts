import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

// Shared state for the module mocks, which are hoisted above these imports.
const h = vi.hoisted(() => ({
  me: '11'.repeat(32),
  follows: new Set<string>()
}));

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return { ndk: writable({}), userPublickey: writable(h.me) };
});
vi.mock('$lib/followListCache', async () => {
  const { writable } = await import('svelte/store');
  return {
    followListReady: writable(false),
    followPubkeysReady: writable(false),
    followListSize: writable(0),
    getFollowedPubkeys: () => h.follows,
    loadFollowListProfiles: async () => new Map()
  };
});
vi.mock('$lib/muteListStore', async () => {
  const { writable } = await import('svelte/store');
  const state = writable({ muteList: null });
  return {
    mutedPubkeys: writable(new Set<string>()),
    muteListStore: { subscribe: state.subscribe, load: vi.fn().mockResolvedValue(undefined) }
  };
});

import { userPublickey } from '$lib/nostr';
import { followPubkeysReady } from '$lib/followListCache';
import { load, score } from './nspam';
import { judgeReplies, nspamHiddenAuthors, nspamSpammers, spamVerdict } from './spamFilter';
import { createCommentSubscription } from '$lib/comments/subscription';
import type { NDKEvent } from '@nostr-dev-kit/ndk';

const ROOT = resolve(__dirname, '../../..');
const bin = readFileSync(resolve(ROOT, 'static/models/nspam.bin'));
const MODEL = load(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length) as ArrayBuffer);

// The reference bundles as reply events: kind 1, from one author each.
const fixtures: {
  label: number;
  pubkey: string;
  notes: { id: string; content: string; tags: string[][]; created_at: number }[];
  expected_calibrated_score: number;
}[] = readFileSync(resolve(ROOT, 'src/test/fixtures/nspam/parity_fixtures.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));
const hasETag = (n: { tags?: string[][] }) =>
  Array.isArray(n.tags) && n.tags.some((t) => t && t[0] === 'e');
const fullyScorable = (c: { notes: { tags: string[][] }[] }) => c.notes.every(hasETag);
// Bundles whose every note carries an e tag, so the judge scores exactly what the
// fixture's expected_calibrated_score was computed from.
const person = fixtures.find((c) => c.label === 0 && c.notes.length >= 3 && fullyScorable(c))!;
const bot = fixtures.find((c) => c.label === 1 && c.notes.length >= 3 && fullyScorable(c))!;
const asEvents = (c: { pubkey: string; notes: unknown[] }) =>
  c.notes.map((n) => ({ ...(n as object), kind: 1, pubkey: c.pubkey })) as unknown as NDKEvent[];

function serveModel() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Uint8Array(bin)))
  );
}

beforeEach(() => {
  h.follows.clear();
  followPubkeysReady.set(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the nspam judge', () => {
  it('with no model loaded nothing is judged and nothing is hidden — fail open', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    judgeReplies(asEvents(bot));
    await Promise.resolve();
    expect(spamVerdict(bot.pubkey)).toBeUndefined();
    expect(get(nspamSpammers).size).toBe(0);
    expect(get(nspamHiddenAuthors).size).toBe(0);
  });

  it('a bot whose replies score >= 0.9 is a known spammer; a person is not', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(bin)));
    vi.stubGlobal('fetch', fetchMock);
    judgeReplies(asEvents(person));
    judgeReplies(asEvents(bot));
    await vi.waitFor(() => expect(spamVerdict(bot.pubkey)).toBeDefined());
    expect(fetchMock.mock.calls[0][0]).toBe('/models/nspam.bin');
    // The bundles remembered before the model landed are scored when it arrives.
    expect(spamVerdict(person.pubkey)).toBeCloseTo(person.expected_calibrated_score, 9);
    expect(spamVerdict(bot.pubkey)).toBeCloseTo(bot.expected_calibrated_score, 9);
    expect(get(nspamSpammers).has(bot.pubkey)).toBe(true);
    expect(get(nspamSpammers).has(person.pubkey)).toBe(false);
  });

  it('verdicts hide strangers but never anyone you follow', () => {
    followPubkeysReady.set(true);
    h.follows.add(person.pubkey);
    expect(get(nspamHiddenAuthors).has(bot.pubkey)).toBe(true);
    expect(get(nspamHiddenAuthors).has(person.pubkey)).toBe(false);
    // Before the follow list has been read, no one is a stranger yet.
    followPubkeysReady.set(false);
    expect(get(nspamHiddenAuthors).size).toBe(0);
  });

  it('events the model was never trained to read leave no verdict', () => {
    const reaction = {
      id: 'r'.repeat(64),
      kind: 7,
      pubkey: '22'.repeat(32),
      content: '+',
      tags: [['e', 'x']],
      created_at: 1
    } as unknown as NDKEvent;
    judgeReplies([reaction]);
    expect(spamVerdict('22'.repeat(32))).toBeUndefined();
  });

  it('your own replies are never judged', () => {
    const me = '55'.repeat(32);
    const mine = asEvents(bot).map((e) => ({ ...e, pubkey: me })) as unknown as NDKEvent[];
    (userPublickey as unknown as { set: (pk: string) => void }).set(me);
    try {
      judgeReplies(mine);
      expect(spamVerdict(me)).toBeUndefined();
    } finally {
      (userPublickey as unknown as { set: (pk: string) => void }).set(h.me);
    }
  });

  it('a bundle is the newest ten replies, so late arrivals re-score the window', () => {
    serveModel();
    const pk = '33'.repeat(32);
    const events = Array.from({ length: 14 }, (_, i) => {
      const n = bot.notes[i % bot.notes.length];
      return {
        id: `ev-${i}`,
        kind: 1,
        pubkey: pk,
        content: n.content,
        tags: n.tags,
        created_at: 1767000000 + i
      } as unknown as NDKEvent;
    });
    judgeReplies(events);
    const newestTen = events
      .slice(4)
      .map((e) => ({ content: e.content, tags: e.tags, created_at: e.created_at }))
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    expect(spamVerdict(pk)).toBeCloseTo(score(MODEL, newestTen)!.score, 9);
  });

  it('comment subscriptions drop a known spammer\u2019s replies and keep the rest', async () => {
    vi.useFakeTimers();
    serveModel();
    const handlers = new Map<string, (...args: never[]) => void>();
    const sub = {
      on: (name: string, handler: (...args: never[]) => void) => handlers.set(name, handler),
      stop: vi.fn()
    };
    const ndk = { subscribe: () => sub } as unknown as Parameters<
      typeof createCommentSubscription
    >[0];
    const root = { id: 'root', kind: 1, tags: [] } as unknown as NDKEvent;
    const comment = createCommentSubscription(ndk, root, { applyMuteFilter: false });
    handlers.get('event')!(asEvents(person)[0] as never);
    handlers.get('event')!(asEvents(bot)[0] as never);
    await vi.advanceTimersByTimeAsync(250);

    expect(get(comment.events).some((e) => e.pubkey === person.pubkey)).toBe(true);
    expect(get(comment.events).some((e) => e.pubkey === bot.pubkey)).toBe(false);
    // The raw store keeps the event: a re-verdict brings the row back, reactively.
    nspamSpammers.set(new Set());
    expect(get(comment.events).some((e) => e.pubkey === bot.pubkey)).toBe(true);
    comment.stop();
  });
});
