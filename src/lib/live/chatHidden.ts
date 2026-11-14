/**
 * Who a Go live host has hidden from their stream's comments.
 *
 * Zap Cooking keeps a user's mutes private (encrypted in their kind 10000
 * list), so viewers cannot read them. A host who hides someone from the
 * live chat therefore also puts them on a PUBLIC list that viewers read: a
 * NIP-51 people set (kind 30000) with the d tag below. It carries over to
 * the host's later streams. Viewers also honour the public `p` tags of the
 * host's kind 10000 mute list, for mutes made public elsewhere.
 *
 * Nothing about viewers is read or stored here.
 */
import type { SimplePool } from 'nostr-tools/pool';
import type { Filter } from 'nostr-tools/filter';
import { relayPage } from '$lib/streams/relayPage';
import type { NostrEventLike } from '$lib/streams/types';

export const LIVE_HIDDEN_KIND = 30000;
export const LIVE_HIDDEN_D = 'zapcooking-live-chat-hidden';
export const LIVE_HIDDEN_TITLE = 'Hidden from Zap Cooking live chat';
const MUTE_LIST_KIND = 10000;
const HEX64 = /^[0-9a-f]{64}$/;

function newest(events: NostrEventLike[], match: (e: NostrEventLike) => boolean) {
  return events
    .filter(match)
    .sort((a, b) => b.created_at - a.created_at || String(a.id).localeCompare(String(b.id)))[0];
}

const dTag = (e: NostrEventLike) => e.tags.find((t) => t[0] === 'd')?.[1];

/** The host's live-chat hidden list among `events`, newest wins. */
export function liveHiddenListOf(host: string, events: NostrEventLike[]): NostrEventLike | null {
  return (
    newest(
      events,
      (e) => e.pubkey === host && e.kind === LIVE_HIDDEN_KIND && dTag(e) === LIVE_HIDDEN_D
    ) ?? null
  );
}

/**
 * Pure: everyone the host has hidden, from their live-chat hidden list and
 * the public part of their mute list (newest of each).
 */
export function hiddenAuthorsFrom(host: string, events: NostrEventLike[]): Set<string> {
  const out = new Set<string>();
  const lists = [
    liveHiddenListOf(host, events),
    newest(events, (e) => e.pubkey === host && e.kind === MUTE_LIST_KIND) ?? null
  ];
  for (const list of lists) {
    for (const t of list?.tags ?? []) {
      if (t[0] === 'p' && HEX64.test(t[1] ?? '') && t[1] !== host) out.add(t[1]);
    }
  }
  return out;
}

/** Read the host's hidden authors from `relays`. Empty when nothing answers. */
export async function fetchHiddenAuthors(
  pool: SimplePool,
  relays: string[],
  host: string,
  timeoutMs = 5000
): Promise<Set<string>> {
  if (!HEX64.test(host)) return new Set();
  try {
    const events = (await pool.querySync(
      relays,
      { kinds: [LIVE_HIDDEN_KIND, MUTE_LIST_KIND], authors: [host] } as Filter,
      { maxWait: timeoutMs }
    )) as unknown as NostrEventLike[];
    return hiddenAuthorsFrom(host, events);
  } catch {
    return new Set();
  }
}

/**
 * The host's current hidden list, or 'unavailable' when no relay answered
 * in full: an edit must never be published over a list that could not be
 * read (it would wipe it).
 */
export async function fetchLiveHiddenListStrict(
  pool: SimplePool,
  relays: string[],
  host: string,
  timeoutMs = 5000
): Promise<NostrEventLike | null | 'unavailable'> {
  const signal = new AbortController().signal;
  const filter = { kinds: [LIVE_HIDDEN_KIND], authors: [host], '#d': [LIVE_HIDDEN_D] } as Filter;
  const pages = await Promise.all(
    relays.map((relay) =>
      relayPage<NostrEventLike>(pool, relay, filter, signal, timeoutMs).catch(() => null)
    )
  );
  if (!pages.some((p) => p?.complete)) return 'unavailable';
  return liveHiddenListOf(
    host,
    pages.flatMap((p) => p?.events ?? [])
  );
}

/**
 * Pure: the tags of the hidden list with `pubkey` added, keeping every
 * other tag of the existing list. Null when it is already there.
 */
export function addHiddenTags(existing: string[][] | null, pubkey: string): string[][] | null {
  const tags = existing ? existing.map((t) => [...t]) : [];
  if (tags.some((t) => t[0] === 'p' && t[1] === pubkey)) return null;
  if (!tags.some((t) => t[0] === 'd')) tags.unshift(['d', LIVE_HIDDEN_D]);
  if (!tags.some((t) => t[0] === 'title')) tags.push(['title', LIVE_HIDDEN_TITLE]);
  tags.push(['p', pubkey]);
  return tags;
}
