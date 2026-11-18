/**
 * Live chat for a stream: NIP-53 live chat (kind 1311) for a NIP-53
 * stream, or kind 1 replies to the "Live now" note for a Go live session.
 * The target string decides which (see ./target): an address `30311:…`
 * or a note id.
 *
 * For a note, a message is a NIP-10 reply: `e` <note> "root" and `p` the
 * note's author; replying to a message adds `e` <message> "reply" and its
 * author's `p`. Other Nostr apps show them as replies to the note.
 *
 * NIP-53 live chat (kind 1311):
 *
 * Ported from Sidecar's stream-chat model: a chat message targets the
 * stream announcement with an `a` tag (never an `e` root), replies add the
 * parent's `e`+`p`, and mentions add `p` tags for every nostr entity in
 * the text. `ChatMessages` verifies, dedupes and caps the model; history
 * pages backward through a relay set with a real EOSE-vs-timeout answer.
 *
 * Go live chat on the session's own address (`ChatScope`):
 *
 * A Go live session's chat is NIP-53 live chat too, on the address built
 * from the host and the session id (see ./target `goLiveAddress`). It is
 * written as kind 1311 only, tagged `a` <address> and `p` <host>. It is
 * read as kind 1311 on that address AND kind 1 replies in the "Live now"
 * note's thread (when the session has a note), so comments made from
 * apps that only reply to the note still show. One event id is one row.
 * The host's pinned "Watch live on Zap Cooking: <link>" message (posted
 * for other apps' viewers, see $lib/live/liveNote) is left out here.
 *
 * @see https://nips.nostr.com/53
 */

import { nip19 } from 'nostr-tools';
import type { SimplePool } from 'nostr-tools/pool';
import type { Filter } from 'nostr-tools/filter';
import { relayPage } from './relayPage';
import { goLiveAddress, isEventTarget } from './target';
import { getThreadRootId } from '$lib/thread/replyParent';
import { isLiveWatchMessage } from '$lib/live/liveNote';
import type { EventVerifier, NostrEventLike } from './types';

export const CHAT_KIND = 1311;
/** Replies to a "Live now" note. */
export const NOTE_REPLY_KIND = 1;

/** The chat event kind for a target: 1311 for a stream address, 1 for a note. */
export function chatKindFor(target: string): number {
  return isEventTarget(target) ? NOTE_REPLY_KIND : CHAT_KIND;
}

/**
 * A Go live session's chat: written to `address` as kind 1311, read from
 * `address` (kind 1311) and from the `noteId` thread (kind 1 replies).
 */
export interface ChatScope {
  /** `30311:<host>:<session id>`. */
  address: string;
  /** The host's pubkey: every message tags it. */
  host: string;
  /** The "Live now" note, when the session has one: its replies are read too. */
  noteId?: string | null;
}

/** A plain target (a stream address, or a note id) or a Go live scope. */
export type ChatTarget = string | ChatScope;

/**
 * The chat scope for a Go live session, from the session's own facts.
 * Null when the host or the session id is unusable. A malformed note id
 * is dropped (the chat then reads the address alone).
 */
export function goLiveChatScope(
  hostPubkey: string | null | undefined,
  sessionId: string | null | undefined,
  noteId?: string | null
): ChatScope | null {
  const address = goLiveAddress(hostPubkey, sessionId);
  if (!address) return null;
  return {
    address,
    host: (hostPubkey as string).toLowerCase(),
    noteId: noteId && ID_RE.test(noteId) ? noteId : null
  };
}

/** What a target reads: its address (kind 1311) and/or its note thread (kind 1). */
function readsOf(target: ChatTarget): { address: string | null; noteId: string | null } {
  if (typeof target !== 'string') {
    return {
      address: ADDRESS_RE.test(target.address || '') ? target.address : null,
      noteId: target.noteId && ID_RE.test(target.noteId) ? target.noteId : null
    };
  }
  return isEventTarget(target)
    ? { address: null, noteId: target }
    : { address: target, noteId: null };
}

/**
 * One relay filter per thing the target reads. Kept apart (never one
 * filter with both tags, which a relay would AND together), and each
 * pages on its own: a busy chat and a quiet note thread have different
 * depths.
 */
export function chatFilters(target: ChatTarget): Filter[] {
  const { address, noteId } = readsOf(target);
  const filters: Filter[] = [];
  if (address) filters.push({ kinds: [CHAT_KIND], '#a': [address] } as Filter);
  if (noteId) filters.push({ kinds: [NOTE_REPLY_KIND], '#e': [noteId] } as Filter);
  return filters;
}

export const CHAT_MAX_LEN = 4000;
export const CHAT_MAX_EVENTS = 1000;

const ADDRESS_RE = /^30311:[a-f0-9]{64}:.*$/;
const ID_RE = /^[a-f0-9]{64}$/;

// ── Templates ──────────────────────────────────────────────────────────

/** nostr: npub/nprofile entities, for mention p-tags. */
export function mentionPubkeys(
  content: string,
  decode: (encoded: string) => {
    type: string;
    data: Record<string, unknown>;
  } = nip19.decode as never
): string[] {
  const found: string[] = [];
  const pattern = /(?:nostr:)?(?:npub|nprofile)1[02-9ac-hj-np-z]+/g;
  for (const match of content.matchAll(pattern)) {
    try {
      const decoded = decode(match[0].replace(/^nostr:/, ''));
      const pubkey =
        decoded.type === 'npub'
          ? decoded.data
          : decoded.type === 'nprofile'
            ? (decoded.data.pubkey as string)
            : null;
      if (typeof pubkey === 'string' && ID_RE.test(pubkey) && !found.includes(pubkey)) {
        found.push(pubkey);
      }
    } catch {
      // An unparsable entity is rendered as text, not a mention.
    }
  }
  return found;
}

export interface ChatTemplate {
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
}

/**
 * Build a chat message event template. Throws `Invalid chat message` on a
 * bad target, empty or oversized content, or a note target without its
 * author — callers show that as a normal input error.
 *
 * `rootAuthor` is the note's author (the host), required for a note target.
 *
 * A Go live scope always writes kind 1311 on its address, tagging the
 * host; it never writes a kind 1 reply, note or no note. A reply to a
 * comment that arrived as a kind 1 note reply is still a kind 1311.
 */
export function chatTemplate(
  target: ChatTarget,
  content: string,
  reply?: { id: string; pubkey: string } | null,
  decode?: (encoded: string) => { type: string; data: Record<string, unknown> },
  rootAuthor?: string | null
): ChatTemplate {
  const text = typeof content === 'string' ? content.trim() : '';
  const scope = typeof target === 'string' ? null : target;
  const address = scope ? scope.address : (target as string);
  const note = !scope && isEventTarget(address);
  if (
    !(note ? ID_RE.test(rootAuthor || '') : ADDRESS_RE.test(address || '')) ||
    (scope && !ID_RE.test(scope.host || '')) ||
    !text ||
    text.length > CHAT_MAX_LEN
  ) {
    throw new Error('Invalid chat message');
  }
  const tags: string[][] = note
    ? [
        ['e', address, '', 'root'],
        ['p', rootAuthor as string]
      ]
    : scope
      ? [
          ['a', address],
          ['p', scope.host]
        ]
      : [['a', address]];
  if (
    reply &&
    ID_RE.test(reply.id) &&
    ID_RE.test(reply.pubkey) &&
    !tags.some((t) => t[0] === 'e' && t[1] === reply.id)
  ) {
    if (note) tags.push(['e', reply.id, '', 'reply']);
    else tags.push(['e', reply.id]);
    if (!tags.some((t) => t[0] === 'p' && t[1] === reply.pubkey)) tags.push(['p', reply.pubkey]);
  }
  for (const pubkey of mentionPubkeys(text, decode)) {
    if (!tags.some((t) => t[0] === 'p' && t[1] === pubkey)) tags.push(['p', pubkey]);
  }
  return {
    kind: scope ? CHAT_KIND : chatKindFor(address),
    created_at: Math.floor(Date.now() / 1000),
    content: text,
    tags
  };
}

// ── Model ──────────────────────────────────────────────────────────────

/**
 * Verified, deduped chat messages for one target: a stream address (kind
 * 1311), a note id (kind 1 replies), or a Go live scope (both, in one
 * list; an event id is held once whichever way it arrived).
 */
export class ChatMessages {
  readonly events = new Map<string, NostrEventLike>();
  /** The plain target, or a scope's address. */
  readonly address: string;
  private readonly chatAddress: string | null;
  private readonly noteId: string | null;
  /** A Go live scope's host: their pinned watch-link message is not a row. */
  private readonly host: string | null;

  constructor(target: ChatTarget) {
    this.address = typeof target === 'string' ? target : target.address;
    this.host = typeof target === 'string' ? null : target.host;
    const reads = readsOf(target);
    this.chatAddress = reads.address;
    this.noteId = reads.noteId;
  }

  /** A kind 1311 message tagged with the address. */
  private isChat(event: NostrEventLike): boolean {
    const address = this.chatAddress;
    return (
      !!address &&
      event.kind === CHAT_KIND &&
      event.tags.some((t) => Array.isArray(t) && t[0] === 'a' && t[1] === address)
    );
  }

  /**
   * A kind 1 comment in the note's thread: the NIP-10 root (marked, or the
   * first positional `e`) must be the note. A post that only mentions the
   * note, or belongs to another thread, is not a comment; nor is the note.
   */
  private isNoteReply(event: NostrEventLike): boolean {
    return (
      !!this.noteId &&
      event.kind === NOTE_REPLY_KIND &&
      event.id !== this.noteId &&
      getThreadRootId(event) === this.noteId
    );
  }

  get size(): number {
    return this.events.size;
  }

  accept(event: NostrEventLike, verify: EventVerifier): boolean {
    if (
      !event ||
      !Array.isArray(event.tags) ||
      !(this.isChat(event) || this.isNoteReply(event)) ||
      isLiveWatchMessage(event, this.host) ||
      typeof event.content !== 'string' ||
      event.content.length > CHAT_MAX_LEN ||
      !Number.isSafeInteger(event.created_at) ||
      event.created_at < 0 ||
      event.created_at > Date.now() / 1000 + 60 ||
      this.events.has(event.id) ||
      !verify(event)
    ) {
      return false;
    }
    this.events.set(event.id, event);
    if (this.events.size > CHAT_MAX_EVENTS) {
      this.events.delete(this.rows()[0].id);
    }
    return true;
  }

  /** Chronological, oldest first. */
  rows(): NostrEventLike[] {
    return [...this.events.values()].sort(
      (a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id)
    );
  }
}

/**
 * The `e`-tag parent of a chat reply, when present. For note chat pass the
 * note id as `root`: the root `e` tag every message carries is not a
 * parent, and a NIP-10 "reply" marker wins over position.
 */
export function chatReplyParent(
  event: NostrEventLike,
  root?: string | null
): { id: string; pubkey: string } | null {
  const eTags = event.tags.filter((t) => Array.isArray(t) && t[0] === 'e' && t[1] !== root);
  const id = (eTags.find((t) => t[3] === 'reply') ?? eTags.at(-1))?.[1];
  const pTags = event.tags.filter((t) => Array.isArray(t) && t[0] === 'p');
  const pubkey = pTags.at(-1)?.[1];
  if (!id || !ID_RE.test(id)) return null;
  return { id, pubkey: pubkey && ID_RE.test(pubkey) ? pubkey : '' };
}

// ── Relay reads ────────────────────────────────────────────────────────

export interface ChatPage {
  events: NostrEventLike[];
  /** Every relay answered with EOSE (nothing further to page back through). */
  complete: boolean;
  /** How many relays answered at all. */
  answered: number;
  /**
   * Where the next older page starts: pass it as `until` (inclusive; the
   * model drops the repeats). Null when every read ran dry, so there is
   * no older history to ask for.
   *
   * It is the NEWEST of the points the unfinished reads stopped at, not
   * the oldest event returned: a quiet read (three note replies from an
   * hour ago) comes back whole while a busy one (the chat) has only gone
   * back a minute, and paging from the oldest event would skip the hour
   * of chat in between.
   */
  next: number | null;
}

/** One relay reading one filter backward. */
interface ChatLane {
  events: NostrEventLike[];
  /** The relay answered every round with EOSE. */
  complete: boolean;
  /** The relay has nothing older for this filter. */
  dry: boolean;
  /** The oldest point this read reached (its `until` when it got nothing). */
  reached: number | null;
}

/**
 * One backward page of chat history, merged across the relay set. Unlike a
 * plain querySync, the distinction between an empty EOSE and failure
 * survives: `complete` is false when any relay timed out or closed.
 *
 * `address` is the chat target: a stream address, a note id, or a Go live
 * scope (which reads its address and its note thread, each on its own).
 */
export async function fetchChatPage(opts: {
  pool: SimplePool;
  sources: string[];
  address: ChatTarget;
  signal: AbortSignal;
  until?: number;
  pageSize?: number;
  timeout?: number;
}): Promise<ChatPage> {
  const { pool, sources, address, signal, until, pageSize = 50, timeout = 6500 } = opts;
  const filters = chatFilters(address);

  // Per-relay cursors: each relay walks backward with its OWN boundary
  // (inclusive, deduped by id) until it fills its share or runs dry. A
  // shared global cursor skips messages whenever one relay's page is older
  // than another's — small relays would lose their tail forever.
  const perRelay = Math.ceil(pageSize / Math.max(1, sources.length));
  const rounds = 4;
  const walk = async (relay: string, base: Filter): Promise<ChatLane> => {
    const collected: NostrEventLike[] = [];
    const seen = new Set<string>();
    let cursor = until;
    let complete = false;
    let dry = false;
    for (let round = 0; round < rounds && collected.length < perRelay; round++) {
      const filter: Filter = { ...base, limit: perRelay };
      if (cursor != null) filter.until = cursor;
      const page = await relayPage<NostrEventLike>(pool, relay, filter, signal, timeout);
      const fresh = page.events.filter((e) => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return cursor == null || e.created_at <= cursor;
      });
      collected.push(...fresh);
      complete = page.complete;
      // An EOSE with fewer events than asked for is the end of this
      // relay's history; so is an EOSE that brought nothing new.
      if (page.complete && (!fresh.length || page.events.length < perRelay)) dry = true;
      if (!fresh.length || dry) break;
      cursor = Math.min(...fresh.map((e) => e.created_at));
      if (round === rounds - 1) complete = false;
    }
    return {
      events: collected,
      complete,
      dry,
      reached: collected.length ? Math.min(...collected.map((e) => e.created_at)) : (until ?? null)
    };
  };
  const perSource = await Promise.all(
    sources.map((relay) => Promise.all(filters.map((filter) => walk(relay, filter))))
  );
  const lanes = perSource.flat();
  const merged = [
    ...new Map(lanes.flatMap((lane) => lane.events).map((e) => [e.id, e])).values()
  ].sort((a, b) => a.created_at - b.created_at);
  // The next page starts at the newest stopping point among reads that
  // may still hold older messages. A read that never got an answer and
  // had no `until` stopped at "now": start the next page from now too.
  const open = lanes.filter((lane) => !lane.dry);
  const now = Math.floor(Date.now() / 1000);
  return {
    events: merged,
    complete: lanes.every((lane) => lane.complete),
    answered: perSource.filter((relayLanes) => relayLanes.every((lane) => lane.complete)).length,
    next: open.length ? Math.max(...open.map((lane) => lane.reached ?? now)) : null
  };
}

/**
 * Live subscription for new chat messages. Returns the closer. A Go live
 * scope opens one subscription per filter (the chat, the note thread);
 * the model holds an event id once, so a message is never shown twice.
 */
export function subscribeChat(opts: {
  pool: SimplePool;
  sources: string[];
  address: ChatTarget;
  onEvent: (event: NostrEventLike) => void;
}): { close: () => void } {
  const { pool, sources, address, onEvent } = opts;
  const since = Math.floor(Date.now() / 1000) - 10;
  const closers = chatFilters(address).map((filter) =>
    pool.subscribeMany(
      sources,
      { ...filter, since } as Filter,
      {
        onevent: (event: unknown) => onEvent(event as NostrEventLike)
      } as never
    )
  );
  return { close: () => closers.forEach((closer) => closer.close()) };
}

// ── Profiles ───────────────────────────────────────────────────────────

export interface ChatProfile {
  name: string | null;
  displayName: string | null;
  picture: string | null;
}

/** Newest kind:0 per pubkey, one request across the relay set. */
export async function fetchChatProfiles(opts: {
  pool: SimplePool;
  sources: string[];
  keys: string[];
  timeout?: number;
}): Promise<Map<string, ChatProfile>> {
  const { pool, sources, keys, timeout = 5000 } = opts;
  const wanted = [...new Set(keys)].filter((k) => /^[a-f0-9]{64}$/.test(k));
  const found = new Map<string, ChatProfile>();
  if (!wanted.length) return found;
  const events = (await pool.querySync(
    sources,
    { kinds: [0], authors: wanted, limit: Math.max(100, wanted.length) } as Filter,
    { maxWait: timeout }
  )) as unknown as NostrEventLike[];
  const newest = new Map<string, NostrEventLike>();
  for (const event of events) {
    const current = newest.get(event.pubkey);
    if (!current || event.created_at > current.created_at) newest.set(event.pubkey, event);
  }
  for (const [pubkey, event] of newest) {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(event.content) as Record<string, unknown>;
    } catch {
      continue;
    }
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    found.set(pubkey, {
      name: str(data.name),
      displayName: str(data.display_name),
      picture: str(data.picture)
    });
  }
  return found;
}
