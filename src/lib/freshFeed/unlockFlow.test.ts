/**
 * Tap to unlock, end to end, against the real nostr-tools Relay over a fake
 * socket that answers like wss://feed.zap.cooking:
 *
 * - the NIP-42 challenge on open; members-only requests (topic search,
 *   history past the free window) CLOSED auth-required before AUTH;
 * - after AUTH, real topic results — or, for a while, `restricted:`: the
 *   relay caches a failed or unresolved membership lookup as "not a member"
 *   for a minute (feed-relay internal/access/access.go, IsMember), so a
 *   member's first request right after a successful login can be refused.
 *
 * Before this fix one such `restricted:` ended members-only cards for the
 * whole session (SpecialsLoader.locked), the tapped card vanished, and the
 * next slot offered the unlock card again (the login was taken for lost).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useWebSocketImplementation } from 'nostr-tools/relay';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { FreshClient, FREE_WINDOW_SECONDS } from './relay';
import { MemberLogin, RELAY_DENIAL_TTL_MS, type AuthTemplate, type SignedAuthEvent } from './memberLogin';
import { MemberUnlock } from './memberUnlock';
import { SpecialsLoader, SpecialsSession } from './specialsLoader';
import { UnlockFlow, MAX_HOLDS } from './unlockFlow';
import type { Special } from './specials';
import type { TopicGroup } from './topicList';

const NOW0 = Date.UTC(2026, 9, 9, 12, 0, 0);
let nowMs = NOW0;
const sec = () => Math.floor(nowMs / 1000);
const floor = () => sec() - FREE_WINDOW_SECONDS;

const memberSk = generateSecretKey();
const memberPk = getPublicKey(memberSk);

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
    topics: [
      { slug: 'coffee', name: 'Coffee', count14d: 0 },
      { slug: 'tea', name: 'Tea', count14d: 0 }
    ]
  }
];

/** Three signed posts (three authors, with images) older than `until`. */
function topicPosts(slug: string, until: number) {
  return [1, 2, 3].map((n) =>
    finalizeEvent(
      {
        kind: 1,
        created_at: until - n * 3600,
        tags: [['t', slug]],
        content: `${slug} ${n} https://img.example/${slug}${n}.jpg`
      },
      generateSecretKey()
    )
  );
}

/** The scripted relay behind every FakeWS of a test. */
class Server {
  authed = false;
  /** While authed and before this clock: topic → restricted, history → empty. */
  staleUntil = 0;
  authFrames: SignedAuthEvent[] = [];
  reqs: { filter: Record<string, unknown>; authed: boolean; answered: string }[] = [];
  challenges = 0;
  answer(ws: FakeWS, msg: unknown[]) {
    if (msg[0] === 'AUTH') {
      const ev = msg[1] as SignedAuthEvent;
      this.authFrames.push(ev);
      const ok = verifyEvent(ev as never) && ev.kind === 22242 && ev.pubkey === memberPk;
      if (ok) this.authed = true;
      ws.push(['OK', ev.id, ok, ok ? '' : 'auth-required: bad']);
      return;
    }
    if (msg[0] !== 'REQ') return;
    const sub = msg[1] as string;
    const f = msg[2] as Record<string, unknown>;
    const rec = { filter: f, authed: this.authed, answered: '' };
    this.reqs.push(rec);
    const stale = this.authed && nowMs < this.staleUntil;
    const search = typeof f.search === 'string' ? f.search : '';
    if (search.startsWith('topic:')) {
      if (!this.authed) {
        rec.answered = 'auth-required';
        this.challenges++;
        ws.push(['AUTH', `chal-${this.challenges}`]);
        ws.push(['CLOSED', sub, 'auth-required: topic: search is for Zap Cooking members; log in with NIP-42']);
        return;
      }
      if (stale) {
        rec.answered = 'restricted';
        ws.push(['CLOSED', sub, 'restricted: topic: search is for Zap Cooking members']);
        return;
      }
      rec.answered = 'events';
      const until = typeof f.until === 'number' ? f.until : floor();
      for (const e of topicPosts(search.slice(6), until)) ws.push(['EVENT', sub, e]);
      ws.push(['EOSE', sub]);
      return;
    }
    if (typeof f.until === 'number' && f.until < floor()) {
      if (!this.authed) {
        rec.answered = 'auth-required';
        ws.push(['CLOSED', sub, 'auth-required: posts older than 14 days are for Zap Cooking members; log in with NIP-42']);
        return;
      }
      rec.answered = stale ? 'empty' : 'events';
      if (!stale && typeof f.since === 'number') {
        const e = finalizeEvent(
          { kind: 1, created_at: f.since + 60, tags: [], content: 'archive https://img.example/a.jpg' },
          generateSecretKey()
        );
        ws.push(['EVENT', sub, e]);
      }
      ws.push(['EOSE', sub]);
      return;
    }
    rec.answered = 'eose';
    ws.push(['EOSE', sub]);
  }
}

let server: Server;

class FakeWS {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWS[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  constructor(public url: string) {
    FakeWS.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
      server.challenges++;
      this.push(['AUTH', `chal-${server.challenges}`]);
    });
  }
  send(m: string) {
    const msg = JSON.parse(m);
    queueMicrotask(() => server.answer(this, msg));
  }
  close() {
    this.readyState = 3;
  }
  push(msg: unknown[]) {
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(msg) }));
  }
}

/** Timers the flow schedules (retries), run by the test clock. */
class Timers {
  due: { at: number; fn: () => void }[] = [];
  set = (fn: () => void, ms: number) => {
    const t = { at: nowMs + ms, fn };
    this.due.push(t);
    return () => {
      this.due = this.due.filter((x) => x !== t);
    };
  };
  async advance(ms: number) {
    const target = nowMs + ms;
    for (;;) {
      const next = this.due.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      nowMs = Math.max(nowMs, next.at);
      this.due = this.due.filter((t) => t !== next);
      next.fn();
      await settle();
    }
    nowMs = target;
  }
}

/** Let the fake socket, nostr-tools and the loader's promise chains run. */
async function settle(rounds = 40) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
}

function setup(o: { decline?: boolean } = {}) {
  const sign = vi.fn(async (t: AuthTemplate): Promise<SignedAuthEvent> => {
    if (o.decline) throw new Error('User rejected');
    return finalizeEvent(t, memberSk) as unknown as SignedAuthEvent;
  });
  const login = new MemberLogin({
    pubkey: () => memberPk,
    isMember: () => true,
    sign,
    signerPrompts: () => true,
    timeoutMs: 2_000,
    challengeWaitMs: 1,
    now: () => nowMs
  });
  const client = new FreshClient({ login, now: sec, timeoutMs: 2_000 });
  const unlock = new MemberUnlock(async () => login.access(await client.connection(), true), () => memberPk);
  const loader = new SpecialsLoader(
    client,
    {
      member: () => true,
      groups: () => GROUPS,
      hiddenTopics: () => [],
      shown: () => new Map(),
      exclude: () => new Set(),
      accept: () => true,
      topicHistory: () => new Map(),
      now: () => new Date(nowMs),
      rng: () => 0
    },
    new SpecialsSession()
  );
  const timers = new Timers();
  const fills: (Special | null)[] = [];
  const onReady = vi.fn();
  const flow = new UnlockFlow({
    login,
    loader,
    unlock,
    authedNow: () => client.authedNow(),
    member: () => true,
    onReady,
    onFill: (s) => fills.push(s),
    setTimer: timers.set
  });
  return { sign, login, client, unlock, loader, flow, timers, fills, onReady };
}

const topicReqs = () => server.reqs.filter((r) => String(r.filter.search ?? '').startsWith('topic:'));

beforeEach(() => {
  nowMs = NOW0;
  server = new Server();
  FakeWS.instances = [];
  useWebSocketImplementation(FakeWS as unknown as typeof WebSocket);
});
afterEach(() => {
  useWebSocketImplementation(WebSocket);
});

describe('locked → tap → auth → the spotlight renders', () => {
  it('one prompt, one AUTH; the tapped card gets its topic posts, and the next slot is ready too', async () => {
    const { sign, flow, unlock, loader, client, login } = setup();
    // Members-only cards start loading after the first page: on a connection
    // that isn't logged in nothing is sent, and the first slot offers the card.
    await client.page();
    flow.prepare('spotlight');
    flow.prepare('memory');
    await settle();
    expect(topicReqs()).toHaveLength(0);
    expect(server.authFrames).toHaveLength(0);
    expect(flow.open()).toBe(false);
    expect(unlock.canOffer).toBe(true);
    unlock.offer();

    const r = await flow.tap('spotlight');
    expect(sign).toHaveBeenCalledTimes(1);
    expect(server.authFrames).toHaveLength(1);
    expect(r).not.toBe('loading');
    expect(r).not.toBe('declined');
    const card = r as Special;
    expect(card.type).toBe('spotlight');
    if (card.type !== 'spotlight') throw new Error('not a spotlight');
    expect(card.posts).toHaveLength(3);
    // Every topic request went out after the login was accepted.
    expect(topicReqs().every((q) => q.authed && q.answered === 'events')).toBe(true);
    expect(login.authed(await client.connection())).toBe(true);

    // The next spotlight slot: prepared in the background, a different topic.
    await settle();
    const next = loader.takeSpotlight();
    expect(next?.type).toBe('spotlight');
    if (next?.type === 'spotlight') expect(next.slug).not.toBe(card.slug);
    expect(sign).toHaveBeenCalledTimes(1);
    expect(unlock.state).toBe('unlocked');
  });

  it('a decline keeps the card declined, sends no AUTH and asks no topic', async () => {
    const { sign, flow, unlock, client } = setup({ decline: true });
    await client.page();
    unlock.offer();
    expect(await flow.tap('spotlight')).toBe('declined');
    expect(sign).toHaveBeenCalledTimes(1);
    expect(server.authFrames).toHaveLength(0);
    expect(topicReqs()).toHaveLength(0);
    expect(unlock.state).toBe('declined');
  });
});

describe("the relay's stale 'not a member' after a successful login", () => {
  it('the tapped card waits through the hold, then fills — no new prompt, no new unlock card', async () => {
    server.staleUntil = NOW0 + RELAY_DENIAL_TTL_MS; // the relay's failed-lookup cache
    const { sign, flow, unlock, loader, client, login, timers, fills } = setup();
    await client.page();
    unlock.offer();

    expect(await flow.tap('spotlight')).toBe('loading');
    expect(server.authFrames).toHaveLength(1);
    expect(topicReqs().some((q) => q.answered === 'restricted')).toBe(true);
    expect(login.held).toBe(true);
    expect(loader.denied).toBe(true);
    expect(flow.pendingFor).toBe('spotlight');
    // Not taken for a lost login: no second unlock card, the login stays.
    expect(flow.open()).toBe(false);
    expect(unlock.state).toBe('unlocked');
    expect(unlock.canOffer).toBe(false);
    // Nothing more is asked while the hold lasts.
    const asked = server.reqs.length;
    await timers.advance(RELAY_DENIAL_TTL_MS / 2);
    expect(server.reqs.length).toBe(asked);

    // The hold ends: the same login counts again, the retry fills the card.
    await timers.advance(RELAY_DENIAL_TTL_MS / 2 + 100);
    await settle();
    expect(fills).toHaveLength(1);
    expect(fills[0]?.type).toBe('spotlight');
    expect(flow.pendingFor).toBeNull();
    expect(sign).toHaveBeenCalledTimes(1);
    expect(server.authFrames).toHaveLength(1);
    expect(login.authed(await client.connection())).toBe(true);
    expect(loader.denied).toBe(false);

    // And the rotation has spotlights again for the rest of the session.
    await settle();
    expect(loader.takeSpotlight()?.type).toBe('spotlight');
  });

  it('keeps refusing: the tapped card gives up after a few holds instead of loading forever', async () => {
    server.staleUntil = Number.MAX_SAFE_INTEGER;
    const { flow, unlock, client, timers, fills, sign } = setup();
    await client.page();
    unlock.offer();
    expect(await flow.tap('spotlight')).toBe('loading');
    for (let i = 0; i <= MAX_HOLDS; i++) await timers.advance(RELAY_DENIAL_TTL_MS + 100);
    await settle();
    expect(fills).toEqual([null]);
    expect(flow.pendingFor).toBeNull();
    expect(sign).toHaveBeenCalledTimes(1);
    expect(unlock.state).toBe('unlocked');
  });
});

describe('what was gathered before the login is not content', () => {
  it('an auth-required close is not "no topic": nothing is marked used or thin by it', async () => {
    const { flow, unlock, loader, client } = setup();
    await client.page();
    // A topic asked for on the open connection (Keep exploring is a tap and
    // may ask): the relay wants a login first.
    const before = await client.topic('sourdough', new Set(), floor() - 1, 40, { authedOnly: true });
    expect(before.state).toBe('auth-required');
    expect(loader.session.usedTopics.size).toBe(0);
    unlock.offer();
    const r = await flow.tap('spotlight');
    expect((r as Special).type).toBe('spotlight');
    // The first pick is still available after the login: it was not spent.
    expect((r as Special & { slug: string }).slug).toBe('sourdough');
  });
});
