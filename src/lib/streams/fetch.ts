/**
 * Stream lookups for the UI layer.
 *
 * Thin wrappers over a nostr-tools pool so components can resolve a stream
 * announcement (kind 30311) from its address without importing relay
 * plumbing. Signatures and verification come from the shared pool in
 * `relayPage.ts`.
 */

import type { SimplePool } from 'nostr-tools/pool';
import type { Filter } from 'nostr-tools/filter';
import { parseStreamEvent } from './parse';
import type { NostrEventLike, StreamItem } from './types';

const LOOKUP_MAX_WAIT_MS = 5000;

export interface ResolvedStream {
  item: StreamItem;
  event: NostrEventLike;
}

/**
 * Fetch the newest announcement for an address, taking the winner across
 * the given relays (newest created_at, then id). Null when nothing usable
 * answered.
 */
export async function fetchStreamItem(
  pool: SimplePool,
  relays: string[],
  address: { pubkey: string; identifier: string },
  extraRelays: string[] = []
): Promise<ResolvedStream | null> {
  const urls = [...new Set([...relays, ...extraRelays])];
  const events = (await pool.querySync(
    urls,
    {
      kinds: [30311],
      authors: [address.pubkey],
      '#d': [address.identifier]
    } as Filter,
    { maxWait: LOOKUP_MAX_WAIT_MS }
  )) as unknown as NostrEventLike[];

  const key = `30311:${address.pubkey}:${address.identifier}`;
  let winner: ResolvedStream | null = null;
  for (const event of events) {
    const item = parseStreamEvent(event);
    if (item?.key !== key) continue;
    // Same-second replacements pick the smaller event ID, matching the
    // directory's tie-breaker so player and directory agree.
    if (
      !winner ||
      item.updated > winner.item.updated ||
      (item.updated === winner.item.updated && String(event.id) < String(winner.event.id))
    )
      winner = { item, event };
  }
  return winner;
}

/** Convenience: resolve from a parsed naddr, honoring the relays it names. */
export function fetchStreamByNaddr(
  pool: SimplePool,
  baseRelays: string[],
  naddr: { pubkey: string; identifier: string; relays?: string[] }
): Promise<ResolvedStream | null> {
  return fetchStreamItem(pool, baseRelays, naddr, naddr.relays || []);
}

export interface HostProfile {
  name: string | null;
  displayName: string | null;
  picture: string | null;
  /** Lightning address (NIP-57 zap target), when the profile declares one. */
  lud16: string | null;
}

/** Parse a kind:0 payload into the display fields the player shows. */
export function parseProfileContent(raw: string): HostProfile {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    data = {};
  }
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    name: str(data.name),
    displayName: str(data.display_name),
    picture: str(data.picture),
    lud16: str(data.lud16)
  };
}

/**
 * Newest kind:0 for a pubkey across the given relays. Announcements are
 * often published by a service account (zap.stream et al.) while the host
 * `p` tag carries the streamer — callers must resolve the host pubkey, and
 * this reads it straight from relays instead of any app profile cache,
 * which has been observed to return unrelated profiles.
 */
export async function fetchProfile(
  pool: SimplePool,
  relays: string[],
  pubkey: string
): Promise<HostProfile | null> {
  const events = (await pool.querySync(
    relays,
    { kinds: [0], authors: [pubkey], limit: 10 } as Filter,
    { maxWait: 6000 }
  )) as unknown as NostrEventLike[];
  const newest = events
    .filter((e) => e.pubkey === pubkey)
    .sort((a, b) => b.created_at - a.created_at || String(a.id).localeCompare(String(b.id)))[0];
  return newest ? parseProfileContent(newest.content) : null;
}
