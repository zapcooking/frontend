/**
 * NIP-53 stream announcement parsing (kind 30311).
 *
 * Ported from Sidecar's stream-core `parse` / `streamAddress` /
 * `parseStreamAddress` / `cocktailName` so both clients read the same events
 * the same way. Everything is defensive: an announcement with a malformed
 * tag, a future timestamp, or a non-HTTPS media address yields null or a
 * stripped field rather than a broken item downstream.
 */

import { nip19 } from 'nostr-tools';
import { getAnonChefName } from '$lib/anonName';
import type { NostrEventLike, StreamItem } from './types';

/** Absolute https URL with no credentials, or null. */
export function httpsUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function tagValue(event: NostrEventLike, key: string): string | undefined {
  return event.tags.find((t) => Array.isArray(t) && t[0] === key)?.[1];
}

function timestampTag(event: NostrEventLike, key: string): number | null {
  const raw = tagValue(event, key);
  if (!/^\d+$/.test(raw || '')) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 && n <= 8640000000000 ? n : null;
}

/**
 * Parse a kind:30311 announcement into a {@link StreamItem}, or null when the
 * event is not a usable stream announcement.
 */
export function parseStreamEvent(
  event: NostrEventLike,
  now = Date.now() / 1000
): StreamItem | null {
  if (
    !event ||
    event.kind !== 30311 ||
    !Array.isArray(event.tags) ||
    !/^[a-f0-9]{64}$/.test(event.pubkey || '') ||
    !Number.isFinite(event.created_at) ||
    event.created_at > now + 60
  ) {
    return null;
  }
  const d = tagValue(event, 'd');
  if (typeof d !== 'string') return null;

  const status = tagValue(event, 'status') || null;
  const ends = timestampTag(event, 'ends');
  return {
    key: `30311:${event.pubkey}:${d}`,
    id: event.id,
    updated: event.created_at,
    title: String(tagValue(event, 'title') || 'Untitled livestream').slice(0, 240),
    url: httpsUrl(tagValue(event, 'streaming')),
    recording: httpsUrl(tagValue(event, 'recording')),
    status,
    image: httpsUrl(tagValue(event, 'image')),
    thumb: httpsUrl(tagValue(event, 'thumb')),
    summary: String(tagValue(event, 'summary') || '').slice(0, 12000),
    starts: timestampTag(event, 'starts'),
    ends: ends !== null && ends <= now ? ends : null,
    categories: event.tags
      .filter((t) => Array.isArray(t) && t[0] === 't' && typeof t[1] === 'string')
      .slice(0, 12)
      .map((t) => t[1].slice(0, 80)),
    live: status === 'live' && now - event.created_at < 3600,
    viewers:
      /^\d+$/.test(tagValue(event, 'current_participants') || '') &&
      Number.isSafeInteger(Number(tagValue(event, 'current_participants')))
        ? Number(tagValue(event, 'current_participants'))
        : null,
    relays: event.tags
      .filter((t) => Array.isArray(t) && t[0] === 'relays')
      .flatMap((t) => t.slice(1))
      .filter((u) => typeof u === 'string' && u.startsWith('wss://'))
      .slice(0, 6),
    host:
      event.tags.find(
        (t) =>
          Array.isArray(t) &&
          t[0] === 'p' &&
          typeof t[3] === 'string' &&
          t[3].toLowerCase() === 'host' &&
          /^[a-f0-9]{64}$/.test(t[1])
      )?.[1] || event.pubkey
  };
}

/** nip19 data an {@link StreamItem} encodes from, or null for a bare video link. */
export interface StreamAddress {
  kind: 30311;
  pubkey: string;
  identifier: string;
  relays: string[];
}

/**
 * The address of a stream announcement, in the shape nip19.naddrEncode takes,
 * or null for a stream with no event behind it (a saved video link). The `d`
 * tag may itself hold colons, so only the first two segments separate.
 */
export function streamAddress(item: Pick<StreamItem, 'key' | 'relays'>): StreamAddress | null {
  const match = /^30311:([a-f0-9]{64}):([\s\S]+)$/.exec(item?.key || '');
  if (!match) return null;
  const relays = (item.relays || [])
    .filter((u) => typeof u === 'string' && u.startsWith('wss://'))
    .slice(0, 3);
  return { kind: 30311, pubkey: match[1], identifier: match[2], relays };
}

export type ParsedStreamAddress =
  | { naddr: { pubkey: string; identifier: string; relays: string[] } }
  | { url: string }
  | { error: 'not-a-stream' | 'invalid' };

/**
 * What was typed into a stream box: an https video address, or the naddr of a
 * stream announcement (kind 30311), with or without a `nostr:` prefix.
 * `decode` is injectable for tests; anything unparsable is an error the
 * caller can word: `not-a-stream` for a well-formed naddr of another kind,
 * `invalid` for the rest.
 */
export function parseStreamAddress(
  text: unknown,
  decode: (encoded: string) => {
    type: string;
    data: Record<string, unknown>;
  } = nip19.decode as never
): ParsedStreamAddress {
  const value = String(text || '')
    .trim()
    .replace(/^nostr:/i, '');
  if (!value) return { error: 'invalid' };
  if (/^naddr1[0-9a-z]+$/i.test(value)) {
    let data: Record<string, unknown>;
    try {
      const result = decode(value);
      if (!result || result.type !== 'naddr') return { error: 'invalid' };
      data = result.data;
    } catch {
      return { error: 'invalid' };
    }
    if (data.kind !== 30311) return { error: 'not-a-stream' };
    if (!/^[a-f0-9]{64}$/.test(String(data.pubkey)) || typeof data.identifier !== 'string') {
      return { error: 'invalid' };
    }
    const relays = (Array.isArray(data.relays) ? data.relays : [])
      .filter((url): url is string => typeof url === 'string' && url.startsWith('wss://'))
      .slice(0, 6);
    return { naddr: { pubkey: String(data.pubkey), identifier: data.identifier, relays } };
  }
  const url = httpsUrl(value);
  return url ? { url } : { error: 'invalid' };
}

/**
 * Encode a stream address to an naddr bech32 string, for URLs and shares.
 */
export function naddrEncode(address: StreamAddress): string {
  return nip19.naddrEncode({
    kind: address.kind,
    pubkey: address.pubkey,
    identifier: address.identifier,
    relays: address.relays
  });
}

/**
 * Stable pseudonym for a pubkey, following the app's anon-chef convention
 * (`$lib/anonName` — "Whisk Wizard", "Sourdough Stranger", …) rather than
 * Sidecar's cocktails: the same author shows the same food name across
 * pages and reloads.
 */
export function pseudonym(pubkey: string): string {
  return getAnonChefName(pubkey);
}

/** How long a stream marked `starts` has been running, or null if not running. */
export function runtime(
  starts: number | null,
  now = Date.now() / 1000
): { days: number; hours: number; minutes: number } | null {
  if (!Number.isSafeInteger(starts) || !starts || starts <= 0 || starts > now) return null;
  const minutes = Math.floor((now - (starts as number)) / 60);
  return {
    days: Math.floor(minutes / 1440),
    hours: Math.floor(minutes / 60) % 24,
    minutes: minutes % 60
  };
}
