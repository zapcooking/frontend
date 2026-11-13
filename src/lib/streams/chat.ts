/**
 * NIP-53 live chat (kind 1311).
 *
 * Ported from Sidecar's stream-chat model: a chat message targets the
 * stream announcement with an `a` tag (never an `e` root), replies add the
 * parent's `e`+`p`, and mentions add `p` tags for every nostr entity in
 * the text. `ChatMessages` verifies, dedupes and caps the model; history
 * pages backward through a relay set with a real EOSE-vs-timeout answer.
 *
 * @see https://nips.nostr.com/53
 */

import { nip19 } from 'nostr-tools';
import type { SimplePool } from 'nostr-tools/pool';
import type { Filter } from 'nostr-tools/filter';
import { relayPage, type RelayPageResult } from './relayPage';
import type { EventVerifier, NostrEventLike } from './types';

export const CHAT_KIND = 1311;
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
 * bad address, empty or oversized content — callers show that as a normal
 * input error.
 */
export function chatTemplate(
  address: string,
  content: string,
  reply?: { id: string; pubkey: string } | null,
  decode?: (encoded: string) => { type: string; data: Record<string, unknown> }
): ChatTemplate {
  const text = typeof content === 'string' ? content.trim() : '';
  if (!ADDRESS_RE.test(address || '') || !text || text.length > CHAT_MAX_LEN) {
    throw new Error('Invalid chat message');
  }
  const tags: string[][] = [['a', address]];
  if (
    reply &&
    ID_RE.test(reply.id) &&
    ID_RE.test(reply.pubkey) &&
    !tags.some((t) => t[0] === 'e' && t[1] === reply.id)
  ) {
    tags.push(['e', reply.id], ['p', reply.pubkey]);
  }
  for (const pubkey of mentionPubkeys(text, decode)) {
    if (!tags.some((t) => t[0] === 'p' && t[1] === pubkey)) tags.push(['p', pubkey]);
  }
  return { kind: CHAT_KIND, created_at: Math.floor(Date.now() / 1000), content: text, tags };
}

// ── Model ──────────────────────────────────────────────────────────────

/** Verified, deduped chat messages for one stream address. */
export class ChatMessages {
  readonly events = new Map<string, NostrEventLike>();

  constructor(readonly address: string) {}

  get size(): number {
    return this.events.size;
  }

  accept(event: NostrEventLike, verify: EventVerifier): boolean {
    if (
      !event ||
      event.kind !== CHAT_KIND ||
      !Array.isArray(event.tags) ||
      !event.tags.some((t) => Array.isArray(t) && t[0] === 'a' && t[1] === this.address) ||
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

/** The `e`-tag parent of a chat reply, when present. */
export function chatReplyParent(event: NostrEventLike): { id: string; pubkey: string } | null {
  const id = event.tags.filter((t) => Array.isArray(t) && t[0] === 'e').at(-1)?.[1];
  const pubkey = event.tags.filter((t) => Array.isArray(t) && t[0] === 'p').at(-1)?.[1];
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
}

/**
 * One backward page of chat history, merged across the relay set. Unlike a
 * plain querySync, the distinction between an empty EOSE and failure
 * survives: `complete` is false when any relay timed out or closed.
 */
export async function fetchChatPage(opts: {
  pool: SimplePool;
  sources: string[];
  address: string;
  signal: AbortSignal;
  until?: number;
  pageSize?: number;
  timeout?: number;
}): Promise<ChatPage> {
  const { pool, sources, address, signal, until, pageSize = 50, timeout = 6500 } = opts;
  const filter: Filter = { kinds: [CHAT_KIND], '#a': [address], limit: pageSize };
  if (until != null) filter.until = until;
  const results = await Promise.all(
    sources.map((relay) => relayPage<NostrEventLike>(pool, relay, filter, signal, timeout))
  );
  const merged = [
    ...new Map(
      results.flatMap((r: RelayPageResult<NostrEventLike>) => r.events).map((e) => [e.id, e])
    ).values()
  ];
  return {
    events: merged,
    complete: results.every((r) => r.complete),
    answered: results.filter((r) => r.complete).length
  };
}

/** Live subscription for new chat messages. Returns the closer. */
export function subscribeChat(opts: {
  pool: SimplePool;
  sources: string[];
  address: string;
  onEvent: (event: NostrEventLike) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): { close: () => void } {
  const { pool, sources, address, onEvent } = opts;
  const since = Math.floor(Date.now() / 1000) - 10;
  const closer = pool.subscribeMany(
    sources,
    { kinds: [CHAT_KIND], '#a': [address], since } as Filter,
    {
      onevent: (event: unknown) => onEvent(event as NostrEventLike)
    } as never
  );
  return { close: () => closer.close() };
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
