/**
 * The preview model, end to end, against the real nostr-tools Relay over a
 * fake socket that answers like wss://feed.zap.cooking:
 *
 * - the NIP-42 challenge on open;
 * - the anonymous preview (a `topic:` search within the free window, or a
 *   past window, each with a small limit) answered to anyone — or, on a
 *   relay without the preview query, CLOSED auth-required;
 * - the full topic feed (a `topic:` search without the window) and history
 *   past the window: auth-required before AUTH, events after.
 *
 * What the feed guarantees: the cards (spotlights, memories) load for
 * everyone with no login and no signer prompt; opening the full view is
 * the gate — a local key is logged in on load, a prompting signer is asked
 * exactly once, at that click, and a decline holds for the session with
 * nothing retrying on its own; a relay that refuses previews is never a
 * lock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useWebSocketImplementation } from 'nostr-tools/relay';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { FreshClient, FREE_WINDOW_SECONDS, PREVIEW_LIMIT } from './relay';
import { MemberLogin, type AuthTemplate, type SignedAuthEvent } from './memberLogin';
import { SpecialsLoader, SpecialsSession } from './specialsLoader';
import { SpecialsFlow, EMPTY_RETRY_MS } from './specialsFlow';
import { SPECIALS } from './specialsConfig';
import { declinedNow, topicGate } from './topicGate';
import type { TopicGroup } from './topicList';

const NOW0 = Date.UTC(2026, 9, 9, 12, 0, 0);
let nowMs = NOW0;
const sec = () => Math.floor(nowMs / 1000);
const floor = () => sec() - FREE_WINDOW_SECONDS;

const memberSk = generateSecretKey();
const memberPk = getPublicKey(memberSk);
const labelerSk = generateSecretKey();

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

/** `n` signed posts (distinct authors, with images) in (since, until]. */
function posts(slug: string, since: number, until: number, n: number) {
  return Array.from({ length: n }, (_, i) =>
    finalizeEvent(
      {
        kind: 1,
        created_at: until - i * 60 - 1,
        tags: [['t', slug]],
        content: `${slug} ${i} https://img.example/${slug}${i}.jpg`
      },
      generateSecretKey()
    )
  ).filter((e) => e.created_at > since);
}

type Req = { filter: Record<string, unknown>; authed: boolean; answered: string };

/** The scripted relay behind every FakeWS of a test. */
class Server {
  authed = false;
  /** The relay serves the anonymous preview query. */
  previews = true;
  authFrames: SignedAuthEvent[] = [];
  reqs: Req[] = [];
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
    const rec: Req = { filter: f, authed: this.authed, answered: '' };
    this.reqs.push(rec);
    const send = (events: ReturnType<typeof posts>, what: string) => {
      rec.answered = what;
      for (const e of events) ws.push(['EVENT', sub, e]);
      ws.push(['EOSE', sub]);
    };
    const refuse = (reason: string) => {
      rec.answered = reason.split(':')[0];
      if (reason.startsWith('auth-required')) {
        this.challenges++;
        ws.push(['AUTH', `chal-${this.challenges}`]);
      }
      ws.push(['CLOSED', sub, reason]);
    };
    const limit = typeof f.limit === 'number' ? f.limit : 500;
    const since = typeof f.since === 'number' ? f.since : undefined;
    const until = typeof f.until === 'number' ? f.until : undefined;
    const search = typeof f.search === 'string' ? f.search : '';
    if (search.startsWith('topic:')) {
      const slug = search.slice(6);
      const preview = since !== undefined && since >= floor() && limit <= PREVIEW_LIMIT;
      if (this.authed)
        return send(posts(slug, since ?? 0, until ?? sec(), Math.min(limit, 8)), 'events');
      if (preview && this.previews) return send(posts(slug, since, sec(), limit), 'preview');
      return refuse('auth-required: topic: search is for Zap Cooking members; log in with NIP-42');
    }
    if (until !== undefined && until < floor()) {
      // History (the archive) has no anonymous preview: members only.
      if (this.authed)
        return send(posts('archive', since ?? 0, until, Math.min(limit, 4)), 'events');
      return refuse(
        'auth-required: posts older than 14 days are for Zap Cooking members; log in with NIP-42'
      );
    }
    if (Array.isArray(f.kinds) && (f.kinds as number[]).includes(1985)) {
      // The labeler's labels for the archive posts: every post labeled.
      const ids = (f['#e'] as string[]) ?? [];
      return send(
        ids.map((id) =>
          finalizeEvent(
            {
              kind: 1985,
              created_at: sec(),
              tags: [
                ['e', id],
                ['l', 'archive', 'cooking.zap.topic']
              ],
              content: ''
            },
            labelerSk
          )
        ) as never,
        'labels'
      );
    }
    send([], 'eose');
  }
}

let server: Server;

class FakeWS {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  constructor(public url: string) {
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

function setup(o: { member?: boolean; decline?: boolean; silent?: boolean } = {}) {
  const member = o.member ?? true;
  const sign = vi.fn(async (t: AuthTemplate): Promise<SignedAuthEvent> => {
    if (o.decline) throw new Error('User rejected');
    return finalizeEvent(t, memberSk) as unknown as SignedAuthEvent;
  });
  const login = new MemberLogin({
    pubkey: () => memberPk,
    isMember: () => member,
    sign,
    signerPrompts: () => !o.silent,
    timeoutMs: 2_000,
    challengeWaitMs: 1,
    now: () => nowMs
  });
  const client = new FreshClient({ login, now: sec, timeoutMs: 2_000 });
  const loader = new SpecialsLoader(
    client,
    {
      member: () => member,
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
  const onReady = vi.fn();
  const flow = new SpecialsFlow({ loader, onReady, setTimer: timers.set });
  const loginState = () => {
    let s = '';
    login.state.subscribe((v) => (s = v))();
    return s;
  };
  return { sign, login, client, loader, flow, timers, onReady, loginState, member };
}

const topicReqs = () =>
  server.reqs.filter((r) => String(r.filter.search ?? '').startsWith('topic:'));
const previewReqs = () => server.reqs.filter((r) => r.answered === 'preview');
const historyReqs = () =>
  server.reqs.filter(
    (r) => typeof r.filter.until === 'number' && (r.filter.until as number) < floor()
  );

/** The feed's first page (so the connection is open and challenged), then the cards. */
async function firstPageAndCards(s: ReturnType<typeof setup>) {
  await s.client.page();
  s.flow.prepare('spotlight');
  s.flow.prepare('memory');
  await settle();
}

beforeEach(() => {
  nowMs = NOW0;
  server = new Server();
  useWebSocketImplementation(FakeWS as unknown as typeof WebSocket);
});
afterEach(() => {
  useWebSocketImplementation(WebSocket);
});

describe('a non-member', () => {
  it('sees previews (no login, no prompt) and gets the pitch when opening the full topic', async () => {
    const s = setup({ member: false });
    await firstPageAndCards(s);
    expect(s.loader.spotlight?.type).toBe('spotlight');
    // Memories are members-only: no card, and nothing asked of the archive.
    expect(s.loader.memory).toBeNull();
    expect(historyReqs()).toHaveLength(0);
    expect(s.sign).not.toHaveBeenCalled();
    expect(server.authFrames).toHaveLength(0);
    // Every topic request was the anonymous preview: in the free window, capped.
    expect(topicReqs().length).toBeGreaterThan(0);
    for (const q of topicReqs()) {
      expect(q.authed).toBe(false);
      expect(q.answered).toBe('preview');
      expect(q.filter.since).toBe(floor());
      expect(q.filter.limit).toBe(PREVIEW_LIMIT);
      expect(q.filter.until).toBeUndefined();
    }
    const card = s.loader.spotlight;
    if (card?.type !== 'spotlight') throw new Error('not a spotlight');
    expect(card.posts).toHaveLength(SPECIALS.spotlight.posts);
    // The click: the gate, not a request.
    expect(topicGate({ signedIn: true, member: false, membershipKnown: true })).toBe('pitch');
    expect(topicGate({ signedIn: false, member: false, membershipKnown: false })).toBe('pitch');
    expect(server.reqs.filter((r) => r.answered === 'auth-required')).toHaveLength(0);
  });
});

describe('a member on a local key (silent signer)', () => {
  it('is logged in on load without a prompt, and opens the full topic straight away', async () => {
    const s = setup({ silent: true });
    expect(s.login.silent).toBe(true);
    // FreshFeed's silent path on load: a local key signs without a prompt.
    await s.client.page();
    await s.login.access(await s.client.connection());
    expect(s.sign).toHaveBeenCalledTimes(1); // signed, not prompted
    expect(server.authFrames).toHaveLength(1);
    s.flow.prepare('spotlight');
    s.flow.prepare('memory');
    await settle();
    expect(s.loader.spotlight?.type).toBe('spotlight');
    // Logged in on load: the archive is asked for too, on the logged-in
    // connection and only there (the card itself is proven in the loader's
    // unit tests: this fake relay cannot sign as the feed's labeler, so the
    // labeled-only rule leaves no post for a card here).
    expect(historyReqs().length).toBeGreaterThan(0);
    expect(historyReqs().every((q) => q.authed)).toBe(true);
    expect(s.loader.waitingForLogin()).toBe(false);
    expect(s.sign).toHaveBeenCalledTimes(1);
    // The click: the full topic feed, no further AUTH, events from the first request.
    const r = await s.client.topic('sourdough', new Set());
    expect(r.state).toBe('ok');
    expect(r.events.length).toBeGreaterThan(0);
    expect(s.sign).toHaveBeenCalledTimes(1);
    expect(server.authFrames).toHaveLength(1);
    const full = topicReqs().filter((q) => q.filter.since === undefined);
    expect(full).toHaveLength(1);
    expect(full[0].authed).toBe(true);
    expect(topicGate({ signedIn: true, member: true, membershipKnown: true })).toBe('open');
  });
});

describe('a member on a prompting signer', () => {
  it('sees previews with no prompt; the click prompts exactly once, then the full feed', async () => {
    const s = setup();
    await firstPageAndCards(s);
    expect(s.loader.spotlight?.type).toBe('spotlight');
    // Not logged in to the feed yet: no memory card, one authedOnly try that
    // was refused (auth-required), no prompt, and the type waits.
    expect(s.loader.memory).toBeNull();
    expect(s.loader.waitingForLogin()).toBe(true);
    expect(s.sign).not.toHaveBeenCalled();
    expect(server.authFrames).toHaveLength(0);
    expect(previewReqs().length).toBeGreaterThan(0);

    // The click: one prompt, one AUTH, then the topic's full feed.
    const before = s.loginState();
    const r = await s.client.topic('sourdough', new Set());
    expect(r.state).toBe('ok');
    expect(r.events.length).toBeGreaterThan(0);
    expect(s.sign).toHaveBeenCalledTimes(1);
    expect(server.authFrames).toHaveLength(1);
    expect(declinedNow(before, s.loginState())).toBe(false);
    // The next page, and the cards that keep coming: no more prompts.
    const r2 = await s.client.topic('sourdough', new Set(), r.nextUntil);
    expect(r2.state).toBe('ok');
    s.loader.takeSpotlight();
    s.flow.prepare('spotlight');
    // The feed login counts now: the feed prepares memories (what
    // reloadExploreAfterLogin does) — on the logged-in connection, no prompt.
    const historyBefore = historyReqs().length;
    s.loader.loggedIn();
    s.flow.prepare('memory');
    await settle();
    expect(s.loader.spotlight?.type).toBe('spotlight');
    // The archive was asked for on the logged-in connection, with no new
    // prompt (the card itself: loader unit tests; this fake relay cannot
    // sign as the labeler).
    expect(historyReqs().length).toBeGreaterThan(historyBefore);
    expect(
      historyReqs()
        .slice(historyBefore)
        .every((q) => q.authed)
    ).toBe(true);
    expect(s.loader.waitingForLogin()).toBe(false);
    expect(s.sign).toHaveBeenCalledTimes(1);
    expect(server.authFrames).toHaveLength(1);
  });

  it('a decline returns to the preview: no lock, no retry loop, no prompt until the reader asks again', async () => {
    const s = setup({ decline: true });
    await firstPageAndCards(s);
    expect(s.loader.spotlight?.type).toBe('spotlight');
    expect(s.sign).not.toHaveBeenCalled();

    const before = s.loginState();
    const r = await s.client.topic('sourdough', new Set());
    expect(r.state).toBe('auth-required');
    expect(s.sign).toHaveBeenCalledTimes(1);
    expect(server.authFrames).toHaveLength(0);
    expect(declinedNow(before, s.loginState())).toBe(true); // → back to the feed

    // Spotlights keep coming (previews don't need the login), nothing
    // prompts; memories wait for a login (no retry timer, no prompt).
    s.loader.takeSpotlight();
    s.flow.prepare('spotlight');
    s.flow.prepare('memory');
    await settle();
    expect(s.loader.spotlight?.type).toBe('spotlight');
    expect(s.loader.memory).toBeNull();
    expect(s.sign).toHaveBeenCalledTimes(1);
    expect(s.loader.waitingForLogin()).toBe(true);
    expect(s.loader.denied).toBe(false);
    expect(s.loader.previewHoldLeftMs()).toBe(0);
    // Retries that fire later never prompt either.
    await s.timers.advance(EMPTY_RETRY_MS * 3);
    expect(s.sign).toHaveBeenCalledTimes(1);

    // Opening a topic again: no automatic prompt (the view shows its button);
    // only the button (manual) asks again.
    const again = await s.client.topic('sourdough', new Set());
    expect(again.state).toBe('auth-required');
    expect(s.sign).toHaveBeenCalledTimes(1);
    expect(declinedNow(s.loginState(), s.loginState())).toBe(false);
    await s.login.access(await s.client.connection(), true);
    expect(s.sign).toHaveBeenCalledTimes(2);
  });
});

describe('a relay that does not serve previews', () => {
  it('refuses the anonymous preview: no cards, no lock, no prompt; asked again later, and served once it can', async () => {
    server.previews = false;
    const s = setup();
    await firstPageAndCards(s);
    expect(s.loader.spotlight).toBeNull();
    expect(s.loader.memory).toBeNull();
    expect(s.sign).not.toHaveBeenCalled();
    expect(server.authFrames).toHaveLength(0);
    expect(server.reqs.some((r) => r.answered === 'auth-required')).toBe(true);
    expect(s.loader.denied).toBe(false);
    expect(s.loader.isOut('spotlight')).toBe(false);
    expect(s.loader.previewHoldLeftMs()).toBe(SPECIALS.preview.retryMs);
    const asked = server.reqs.length;
    await s.timers.advance(SPECIALS.preview.retryMs / 2);
    expect(server.reqs.length).toBe(asked); // held
    // The relay gains the preview query; the retry at the hold's end delivers.
    server.previews = true;
    await s.timers.advance(SPECIALS.preview.retryMs);
    expect(s.loader.spotlight?.type).toBe('spotlight');
    expect(s.sign).not.toHaveBeenCalled();
    expect(server.authFrames).toHaveLength(0);
    expect(s.loader.previewHoldLeftMs()).toBe(0);
  });

  it('a member on a prompting signer is not prompted to get around the refusal', async () => {
    server.previews = false;
    const s = setup();
    await firstPageAndCards(s);
    await s.timers.advance(SPECIALS.preview.retryMs * 4);
    expect(s.sign).not.toHaveBeenCalled();
    expect(server.authFrames).toHaveLength(0);
    expect(s.loader.spotlight).toBeNull();
  });
});
