import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import type { SimplePool } from 'nostr-tools/pool';
import {
  ChatMessages,
  chatFilters,
  chatTemplate,
  chatReplyParent,
  fetchChatPage,
  goLiveChatScope,
  mentionPubkeys,
  subscribeChat,
  type ChatScope
} from './chat';
import type { NostrEventLike, EventVerifier } from './types';

const HOST = 'a'.repeat(64);
const STREAMER = 'b'.repeat(64);
const MENTIONED = 'c'.repeat(64);
const ADDRESS = `30311:${HOST}:my-stream`;
const GOOD_SIGNATURE = 'f'.repeat(128);
const verify: EventVerifier = () => true;

function chatEvent(overrides: Partial<NostrEventLike> = {}, tags: string[][] = []): NostrEventLike {
  return {
    id: '1'.repeat(64),
    pubkey: STREAMER,
    created_at: Math.floor(Date.now() / 1000) - 10,
    kind: 1311,
    tags: [['a', ADDRESS], ...tags],
    content: 'hello stream',
    sig: GOOD_SIGNATURE,
    ...overrides
  };
}

describe('chatTemplate', () => {
  it('targets the stream with an a tag and no e tag', () => {
    const tpl = chatTemplate(ADDRESS, 'hello!');
    expect(tpl.kind).toBe(1311);
    expect(tpl.tags[0]).toEqual(['a', ADDRESS]);
    expect(tpl.tags.some((t) => t[0] === 'e')).toBe(false);
    expect(tpl.content).toBe('hello!');
  });

  it('adds e+p tags for a reply', () => {
    const tpl = chatTemplate(ADDRESS, 'nice', { id: '2'.repeat(64), pubkey: HOST });
    expect(tpl.tags).toContainEqual(['e', '2'.repeat(64)]);
    expect(tpl.tags).toContainEqual(['p', HOST]);
  });

  it('adds mention p tags from nostr entities', () => {
    const npub = nip19.npubEncode(MENTIONED);
    const tpl = chatTemplate(ADDRESS, `hey nostr:${npub} look at this`);
    expect(tpl.tags).toContainEqual(['p', MENTIONED]);
  });

  it('rejects a bad address, empty content, and oversized content', () => {
    expect(() => chatTemplate('not-an-address', 'hi')).toThrow('Invalid chat message');
    expect(() => chatTemplate(ADDRESS, '   ')).toThrow('Invalid chat message');
    expect(() => chatTemplate(ADDRESS, 'x'.repeat(4001))).toThrow('Invalid chat message');
  });
});

describe('mentionPubkeys', () => {
  it('extracts npub and nprofile entities, deduped', () => {
    const nprofile = nip19.nprofileEncode({ pubkey: HOST });
    const text = `nostr:${nip19.npubEncode(MENTIONED)} and ${nprofile} and nostr:${nip19.npubEncode(MENTIONED)}`;
    expect(mentionPubkeys(text).sort()).toEqual([HOST, MENTIONED].sort());
  });

  it('ignores non-entity text and malformed entities', () => {
    expect(mentionPubkeys('just #hashtags and https://example.com')).toEqual([]);
    expect(mentionPubkeys('nostr:npub1notreal')).toEqual([]);
  });
});

describe('ChatMessages.accept', () => {
  it('accepts valid messages for the address', () => {
    const model = new ChatMessages(ADDRESS);
    expect(model.accept(chatEvent(), verify)).toBe(true);
    expect(model.size).toBe(1);
    expect(model.rows()[0].content).toBe('hello stream');
  });

  it('rejects other addresses, kinds, oversized content, and future timestamps', () => {
    const model = new ChatMessages(ADDRESS);
    expect(model.accept(chatEvent({ tags: [['a', `30311:${HOST}:other`]] }), verify)).toBe(false);
    expect(model.accept(chatEvent({ kind: 1 }), verify)).toBe(false);
    expect(model.accept(chatEvent({ content: 'x'.repeat(4001) }), verify)).toBe(false);
    expect(model.accept(chatEvent({ created_at: Date.now() / 1000 + 3600 }), verify)).toBe(false);
    expect(model.size).toBe(0);
  });

  it('rejects unverifiable signatures and duplicate ids', () => {
    const model = new ChatMessages(ADDRESS);
    const bad: EventVerifier = () => false;
    expect(model.accept(chatEvent(), bad)).toBe(false);
    expect(model.accept(chatEvent(), verify)).toBe(true);
    expect(model.accept(chatEvent(), verify)).toBe(false);
    expect(model.size).toBe(1);
  });

  it('caps the model at 1000 by dropping the oldest', () => {
    const model = new ChatMessages(ADDRESS);
    for (let i = 0; i < 1001; i++) {
      model.accept(chatEvent({ id: String(i).padStart(64, '0'), created_at: i + 1 }), verify);
    }
    expect(model.size).toBe(1000);
    expect(model.rows()[0].id).toBe(String(1).padStart(64, '0'));
    expect(model.rows()[999].id).toBe(String(1000).padStart(64, '0'));
  });
});

describe('chatReplyParent', () => {
  it('reads the reply parent from e/p tags', () => {
    const reply = chatEvent(undefined, [
      ['e', '2'.repeat(64)],
      ['p', HOST]
    ]);
    expect(chatReplyParent(reply)).toEqual({ id: '2'.repeat(64), pubkey: HOST });
    expect(chatReplyParent(chatEvent())).toBeNull();
  });
});

describe('note chat (Go live "Live now" note)', () => {
  const NOTE = '9'.repeat(64);
  const reply = (overrides: Partial<NostrEventLike> = {}, tags: string[][] = []) =>
    chatEvent({ kind: 1, tags: [['e', NOTE, '', 'root'], ['p', HOST], ...tags], ...overrides }, []);

  it('builds a NIP-10 reply to the note, tagging its author', () => {
    const tpl = chatTemplate(NOTE, 'looks great', null, undefined, HOST);
    expect(tpl.kind).toBe(1);
    expect(tpl.tags).toEqual([
      ['e', NOTE, '', 'root'],
      ['p', HOST]
    ]);
    expect(tpl.tags.some((t) => t[0] === 'a')).toBe(false);
  });

  it('marks a reply to a message as "reply" and tags its author once', () => {
    const tpl = chatTemplate(
      NOTE,
      'agreed',
      { id: '2'.repeat(64), pubkey: STREAMER },
      undefined,
      HOST
    );
    expect(tpl.tags).toEqual([
      ['e', NOTE, '', 'root'],
      ['p', HOST],
      ['e', '2'.repeat(64), '', 'reply'],
      ['p', STREAMER]
    ]);
  });

  it('refuses a note target without its author', () => {
    expect(() => chatTemplate(NOTE, 'hi')).toThrow('Invalid chat message');
  });

  it('accepts kind 1 replies to the note, not the note itself, kind 1311, or other notes', () => {
    const model = new ChatMessages(NOTE);
    expect(model.accept(reply(), verify)).toBe(true);
    expect(model.accept(reply({ id: NOTE, pubkey: HOST }), verify)).toBe(false);
    expect(model.accept(reply({ id: '3'.repeat(64), kind: 1311 }), verify)).toBe(false);
    expect(
      model.accept(
        chatEvent({ id: '4'.repeat(64), kind: 1, tags: [['e', '8'.repeat(64)]] }),
        verify
      )
    ).toBe(false);
    expect(model.size).toBe(1);
  });

  it("takes only the note's thread: not mentions, not another thread's posts", () => {
    const model = new ChatMessages(NOTE);
    const other = '8'.repeat(64);
    // Positional (unmarked) root, as older clients write it: a comment.
    expect(
      model.accept(chatEvent({ id: '5'.repeat(64), kind: 1, tags: [['e', NOTE]] }), verify)
    ).toBe(true);
    // Only mentions the note.
    expect(
      model.accept(
        chatEvent({ id: '6'.repeat(64), kind: 1, tags: [['e', NOTE, '', 'mention']] }),
        verify
      )
    ).toBe(false);
    // Belongs to another thread, citing the note along the way.
    expect(
      model.accept(
        chatEvent({
          id: '7'.repeat(64),
          kind: 1,
          tags: [
            ['e', other, '', 'root'],
            ['e', NOTE, '', 'reply']
          ]
        }),
        verify
      )
    ).toBe(false);
    expect(model.size).toBe(1);
  });

  it('does not take the root e tag for a parent', () => {
    expect(chatReplyParent(reply(), NOTE)).toBeNull();
    const nested = reply({}, [
      ['e', '2'.repeat(64), '', 'reply'],
      ['p', STREAMER]
    ]);
    expect(chatReplyParent(nested, NOTE)).toEqual({ id: '2'.repeat(64), pubkey: STREAMER });
  });
});

describe('Go live chat scope (kind 1311 on the session address)', () => {
  const NOTE = '9'.repeat(64);
  const SESSION = '0123456789abcdef0123456789abcdef';
  const LIVE = `30311:${HOST}:${SESSION}`;
  const scope = goLiveChatScope(HOST, SESSION, NOTE) as ChatScope;
  const noNote = goLiveChatScope(HOST, SESSION) as ChatScope;
  const id = (n: number) => n.toString(16).padStart(64, '0');
  const live = (overrides: Partial<NostrEventLike> = {}, tags: string[][] = []) =>
    chatEvent({ tags: [['a', LIVE], ['p', HOST], ...tags], ...overrides });
  const noteReply = (overrides: Partial<NostrEventLike> = {}, tags: string[][] = []) =>
    chatEvent({ kind: 1, tags: [['e', NOTE, '', 'root'], ['p', HOST], ...tags], ...overrides });

  it('is built from the host and the session id, with or without a note', () => {
    expect(scope).toEqual({ address: LIVE, host: HOST, noteId: NOTE });
    expect(noNote).toEqual({ address: LIVE, host: HOST, noteId: null });
    expect(goLiveChatScope(HOST.toUpperCase(), SESSION)?.address).toBe(LIVE);
    // A bad note id is dropped, not fatal: the address still has a chat.
    expect(goLiveChatScope(HOST, SESSION, 'not-an-id')?.noteId).toBeNull();
    expect(goLiveChatScope('npub1abc', SESSION)).toBeNull();
    expect(goLiveChatScope(HOST, '')).toBeNull();
  });

  it('writes kind 1311 with the address and the host, never a kind 1 reply', () => {
    for (const s of [scope, noNote]) {
      const tpl = chatTemplate(s, ' looks great ');
      expect(tpl.kind).toBe(1311);
      expect(tpl.content).toBe('looks great');
      expect(tpl.tags).toEqual([
        ['a', LIVE],
        ['p', HOST]
      ]);
    }
  });

  it('replies with e + p, whichever kind the parent is, and tags the host once', () => {
    expect(chatTemplate(scope, 'agreed', { id: id(2), pubkey: STREAMER }).tags).toEqual([
      ['a', LIVE],
      ['p', HOST],
      ['e', id(2)],
      ['p', STREAMER]
    ]);
    // Replying to the host: one p tag.
    expect(chatTemplate(scope, 'thanks', { id: id(2), pubkey: HOST }).tags).toEqual([
      ['a', LIVE],
      ['p', HOST],
      ['e', id(2)]
    ]);
    const mention = chatTemplate(scope, `hi nostr:${nip19.npubEncode(MENTIONED)}`);
    expect(mention.tags).toEqual([
      ['a', LIVE],
      ['p', HOST],
      ['p', MENTIONED]
    ]);
  });

  it('refuses a scope with a bad host or address', () => {
    expect(() => chatTemplate({ ...scope, host: 'nope' }, 'hi')).toThrow('Invalid chat message');
    expect(() => chatTemplate({ ...scope, address: NOTE }, 'hi')).toThrow('Invalid chat message');
    expect(() => chatTemplate(scope, '   ')).toThrow('Invalid chat message');
  });

  it('leaves a plain NIP-53 address untouched: no host tag', () => {
    expect(chatTemplate(ADDRESS, 'hi', null, undefined, HOST).tags).toEqual([['a', ADDRESS]]);
  });

  it('reads the address and the note thread with one filter each', () => {
    expect(chatFilters(scope)).toEqual([
      { kinds: [1311], '#a': [LIVE] },
      { kinds: [1], '#e': [NOTE] }
    ]);
    expect(chatFilters(noNote)).toEqual([{ kinds: [1311], '#a': [LIVE] }]);
    // Plain targets keep their single filter.
    expect(chatFilters(ADDRESS)).toEqual([{ kinds: [1311], '#a': [ADDRESS] }]);
    expect(chatFilters(NOTE)).toEqual([{ kinds: [1], '#e': [NOTE] }]);
  });

  it('takes kind 1311 on the address and kind 1 replies to the note, in one list', () => {
    const model = new ChatMessages(scope);
    expect(model.address).toBe(LIVE);
    expect(model.accept(live({ id: id(1), created_at: 100 }), verify)).toBe(true);
    expect(model.accept(noteReply({ id: id(2), created_at: 90 }), verify)).toBe(true);
    // From another app: a 1311 with no host tag still belongs to the chat.
    expect(
      model.accept(chatEvent({ id: id(3), created_at: 110, tags: [['a', LIVE]] }), verify)
    ).toBe(true);
    expect(model.rows().map((e) => e.id)).toEqual([id(2), id(1), id(3)]);
  });

  it("leaves out the host's pinned watch-link message, and only that", () => {
    const text = `Watch live on Zap Cooking: https://zap.cooking/live/s/${SESSION}`;
    const model = new ChatMessages(scope);
    expect(model.accept(live({ id: id(1), pubkey: HOST, content: text }), verify)).toBe(false);
    // The same words from a viewer are a comment like any other.
    expect(model.accept(live({ id: id(2), pubkey: STREAMER, content: text }), verify)).toBe(true);
    // The host's other messages show.
    expect(model.accept(live({ id: id(3), pubkey: HOST, content: 'hello' }), verify)).toBe(true);
    expect(model.size).toBe(2);
    // A plain NIP-53 stream (no scope) hides nothing.
    const plain = new ChatMessages(LIVE);
    expect(plain.accept(live({ id: id(1), pubkey: HOST, content: text }), verify)).toBe(true);
  });

  it('holds one event id once, however it arrives', () => {
    const model = new ChatMessages(scope);
    const message = live({ id: id(1) });
    expect(model.accept(message, verify)).toBe(true);
    expect(model.accept({ ...message }, verify)).toBe(false);
    expect(model.size).toBe(1);
  });

  it('leaves out what is not this chat', () => {
    const model = new ChatMessages(scope);
    // Another stream's chat.
    expect(model.accept(chatEvent({ id: id(1) }), verify)).toBe(false);
    // A kind 1 that carries the address but is not in the note's thread.
    expect(model.accept(chatEvent({ id: id(2), kind: 1, tags: [['a', LIVE]] }), verify)).toBe(
      false
    );
    // A kind 1311 that only points at the note.
    expect(model.accept(chatEvent({ id: id(3), tags: [['e', NOTE, '', 'root']] }), verify)).toBe(
      false
    );
    // The note itself, a mention of it, and another note's reply.
    expect(model.accept(noteReply({ id: NOTE, pubkey: HOST }), verify)).toBe(false);
    expect(
      model.accept(chatEvent({ id: id(4), kind: 1, tags: [['e', NOTE, '', 'mention']] }), verify)
    ).toBe(false);
    expect(model.accept(chatEvent({ id: id(5), kind: 1, tags: [['e', id(8)]] }), verify)).toBe(
      false
    );
    // A bad signature, on either kind.
    expect(model.accept(live({ id: id(6) }), () => false)).toBe(false);
    expect(model.accept(noteReply({ id: id(7) }), () => false)).toBe(false);
    expect(model.size).toBe(0);
  });

  it('without a note, reads the address only', () => {
    const model = new ChatMessages(noNote);
    expect(model.accept(live({ id: id(1) }), verify)).toBe(true);
    expect(model.accept(noteReply({ id: id(2) }), verify)).toBe(false);
  });

  it('finds the reply parent on both kinds (the note root is not a parent)', () => {
    expect(chatReplyParent(live(), NOTE)).toBeNull();
    expect(
      chatReplyParent(
        live({}, [
          ['e', id(2)],
          ['p', STREAMER]
        ]),
        NOTE
      )
    ).toEqual({
      id: id(2),
      pubkey: STREAMER
    });
    expect(chatReplyParent(noteReply(), NOTE)).toBeNull();
  });
});

// ── Relay reads, against a pool that answers from memory ──────────────

type Stored = NostrEventLike;

/**
 * A stand-in for the nostr-tools pool: each relay holds events and answers
 * a filter newest first up to `limit`, then EOSE. A relay listed in
 * `silent` connects and never answers (the read times out).
 */
function fakePool(relays: Record<string, Stored[]>, silent: string[] = []) {
  const requests: { relay: string; filter: Record<string, unknown> }[] = [];
  const live: { relays: string[]; filter: Record<string, unknown>; closed: boolean }[] = [];
  const matches = (e: Stored, f: Record<string, unknown>) =>
    (f.kinds as number[]).includes(e.kind) &&
    (!f['#a'] || e.tags.some((t) => t[0] === 'a' && (f['#a'] as string[]).includes(t[1]))) &&
    (!f['#e'] || e.tags.some((t) => t[0] === 'e' && (f['#e'] as string[]).includes(t[1]))) &&
    (f.until == null || e.created_at <= (f.until as number));
  const pool = {
    ensureRelay: async (url: string) => ({
      subscribe: (
        filters: Record<string, unknown>[],
        params: { onevent: (e: Stored) => void; oneose: () => void }
      ) => {
        const filter = filters[0];
        requests.push({ relay: url, filter });
        if (!silent.includes(url)) {
          queueMicrotask(() => {
            (relays[url] || [])
              .filter((e) => matches(e, filter))
              .sort((a, b) => b.created_at - a.created_at)
              .slice(0, filter.limit as number)
              .forEach((e) => params.onevent(e));
            params.oneose();
          });
        }
        return { close: () => {} };
      }
    }),
    subscribeMany: (urls: string[], filter: Record<string, unknown>) => {
      const sub = { relays: urls, filter, closed: false };
      live.push(sub);
      return { close: () => (sub.closed = true) };
    }
  };
  return { pool: pool as unknown as SimplePool, requests, live };
}

describe('fetchChatPage and subscribeChat for a Go live scope', () => {
  const NOTE = '9'.repeat(64);
  const SESSION = '0123456789abcdef0123456789abcdef';
  const LIVE = `30311:${HOST}:${SESSION}`;
  const scope = goLiveChatScope(HOST, SESSION, NOTE) as ChatScope;
  const id = (n: number) => n.toString(16).padStart(64, '0');
  const chat = (n: number, at: number): Stored =>
    chatEvent({
      id: id(n),
      created_at: at,
      tags: [
        ['a', LIVE],
        ['p', HOST]
      ]
    });
  const noteReply = (n: number, at: number): Stored =>
    chatEvent({ id: id(n), created_at: at, kind: 1, tags: [['e', NOTE, '', 'root']] });
  const signal = new AbortController().signal;

  it('reads both kinds from every relay and merges them by event id', async () => {
    const shared = chat(1, 100);
    const { pool, requests } = fakePool({
      'wss://a': [shared, noteReply(2, 90)],
      'wss://b': [shared, chat(3, 110)]
    });
    const page = await fetchChatPage({
      pool,
      sources: ['wss://a', 'wss://b'],
      address: scope,
      signal
    });
    expect(page.events.map((e) => e.id)).toEqual([id(2), id(1), id(3)]);
    expect(page.complete).toBe(true);
    expect(page.answered).toBe(2);
    expect(page.next).toBeNull(); // every read ran dry
    // One read per relay per filter, never one filter with both tags.
    expect(requests.map((r) => `${r.relay} ${(r.filter.kinds as number[])[0]}`).sort()).toEqual([
      'wss://a 1',
      'wss://a 1311',
      'wss://b 1',
      'wss://b 1311'
    ]);
    for (const r of requests) expect('#a' in r.filter && '#e' in r.filter).toBe(false);
  });

  it('pages on from the busy read, not from the oldest note reply', async () => {
    // 30 chat messages at 1000..1029 and one note reply long before them.
    const busy = Array.from({ length: 30 }, (_, i) => chat(100 + i, 1000 + i));
    const { pool } = fakePool({ 'wss://a': [...busy, noteReply(1, 10)] });
    const model = new ChatMessages(scope);
    const first = await fetchChatPage({
      pool,
      sources: ['wss://a'],
      address: scope,
      signal,
      pageSize: 10
    });
    for (const e of first.events) model.accept(e, verify);
    // The note reply came back whole; the chat has only reached 1020.
    expect(first.events.some((e) => e.id === id(1))).toBe(true);
    expect(first.next).toBe(1020);

    // Walking on from `next` reaches every message; from the oldest event
    // held (10) it would have skipped 1000..1019.
    let next = first.next;
    for (let guard = 0; next != null && guard < 10; guard++) {
      const page = await fetchChatPage({
        pool,
        sources: ['wss://a'],
        address: scope,
        signal,
        pageSize: 10,
        until: next
      });
      for (const e of page.events) model.accept(e, verify);
      next = page.next;
    }
    expect(next).toBeNull();
    expect(model.size).toBe(31);
  });

  it('says so when a relay does not answer, and keeps what the others sent', async () => {
    const { pool } = fakePool({ 'wss://a': [chat(1, 100)] }, ['wss://quiet']);
    const page = await fetchChatPage({
      pool,
      sources: ['wss://a', 'wss://quiet'],
      address: scope,
      signal,
      timeout: 20
    });
    expect(page.events.map((e) => e.id)).toEqual([id(1)]);
    expect(page.complete).toBe(false);
    expect(page.answered).toBe(1);
    expect(page.next).not.toBeNull(); // the quiet relay may still hold history
  });

  it('keeps the single read for a plain address', async () => {
    const { pool, requests } = fakePool({
      'wss://a': [chatEvent({ id: id(1), created_at: 100 })]
    });
    const page = await fetchChatPage({ pool, sources: ['wss://a'], address: ADDRESS, signal });
    expect(page.events).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(requests[0].filter).toMatchObject({ kinds: [1311], '#a': [ADDRESS] });
  });

  it('subscribes to both kinds and closes both', () => {
    const { pool, live } = fakePool({});
    const sub = subscribeChat({ pool, sources: ['wss://a'], address: scope, onEvent: () => {} });
    expect(live.map(({ filter }) => ({ ...filter, since: typeof filter.since }))).toEqual([
      { kinds: [1311], '#a': [LIVE], since: 'number' },
      { kinds: [1], '#e': [NOTE], since: 'number' }
    ]);
    sub.close();
    expect(live.every((s) => s.closed)).toBe(true);

    const plain = fakePool({});
    subscribeChat({ pool: plain.pool, sources: ['wss://a'], address: ADDRESS, onEvent: () => {} });
    expect(plain.live).toHaveLength(1);
  });
});
