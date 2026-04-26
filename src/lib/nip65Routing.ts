/**
 * NIP-65 inbox routing helpers.
 *
 * Per NIP-65, when an event tags users via `p` tags (replies, mentions,
 * reactions, zap requests), clients SHOULD include those users' *read*
 * (inbox) relays in the publish target set so the events actually land
 * where the recipients read them.
 *
 * This module is the single source of truth for that augmentation. It
 * sits on top of `relayListCache` (which already implements SWR caching
 * with IndexedDB persistence), so the typical lookup is a memory hit.
 *
 * Callers fall into two shapes:
 *   1. Resilient queue (publishQueue.ts) — supplies its own base relay
 *      URLs from the user's relayMode and unions inbox URLs in.
 *   2. Direct publishers (publishReaction.ts, comments/postComment.ts) —
 *      fall back to the NDK pool's relays when no base set is supplied,
 *      with inbox URLs unioned on top.
 *
 * Both paths cap the total at MAX_PUBLISH_RELAYS to prevent a heavily
 * p-tagged event from fanning out to dozens of relays. NDK uses fast-
 * quorum confirmation on publish, so the cap is mostly a sanity bound.
 */

import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent, NDKRelaySet, NDKRelay } from '@nostr-dev-kit/ndk';
import { normalizeRelayUrl } from '$lib/relayListCache';

const HEX64_RE = /^[0-9a-fA-F]{64}$/;

/** Bound for the total relay set per publish. */
export const MAX_PUBLISH_RELAYS = 16;

/**
 * Bound for inbox-cache lookup. Cache is SWR-backed, so the typical
 * path resolves in microseconds. The bound is for the network-fetch
 * branch — a hung discovery relay can't stall the publish path.
 */
export const INBOX_LOOKUP_TIMEOUT_MS = 1500;

/**
 * Resolve recipient inbox (kind:10002 read) relay URLs for every
 * non-self pubkey in the event's `p` tags.
 *
 * Returns an empty array when:
 *   - The event has no `p` tags (no recipient targeting)
 *   - All `p` tags reference the event's own author
 *   - The cache lookup fails / times out (additive feature, never blocks)
 */
export async function getRecipientInboxRelays(event: NDKEvent): Promise<string[]> {
  const targets = new Set<string>();
  for (const tag of event.tags) {
    if (tag[0] !== 'p' || !tag[1] || !HEX64_RE.test(tag[1])) continue;
    // Skip self — no need to publish to our own inbox.
    if (event.pubkey && tag[1] === event.pubkey) continue;
    targets.add(tag[1]);
  }
  if (targets.size === 0) return [];

  try {
    const { relayListCache } = await import('$lib/relayListCache');
    const lookupPromise = relayListCache.getMany([...targets]);
    const timeoutPromise = new Promise<Map<string, { read: string[] }>>((resolve) =>
      setTimeout(() => resolve(new Map()), INBOX_LOOKUP_TIMEOUT_MS)
    );
    const lists = await Promise.race([lookupPromise, timeoutPromise]);

    const inbox = new Set<string>();
    for (const list of lists.values()) {
      if (!list || !Array.isArray(list.read)) continue;
      for (const url of list.read) inbox.add(url);
    }
    return [...inbox];
  } catch (err) {
    console.warn('[nip65Routing] inbox lookup failed:', err);
    return [];
  }
}

/**
 * Build a deduped, capped list of relay URLs unioning a caller-supplied
 * base set with NIP-65 inbox relays for the event's tagged recipients.
 *
 * Order in the result favors the base URLs (caller's intent) so when
 * the cap kicks in, base relays are kept and inbox URLs may be dropped.
 *
 * Dedupes by normalized URL (`relayListCache.normalizeRelayUrl`) so
 * `wss://example.com` and `wss://example.com/` don't both count toward
 * the cap. The first-seen original spelling is preserved in the result
 * — NDK's relay pool keys by raw URL, so passing the variant we've
 * already seen elsewhere keeps the existing connection state intact.
 */
export async function unionInboxRelayUrls(event: NDKEvent, baseUrls: string[]): Promise<string[]> {
  const inboxUrls = await getRecipientInboxRelays(event);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of [...baseUrls, ...inboxUrls]) {
    if (out.length >= MAX_PUBLISH_RELAYS) break;
    const key = normalizeRelayUrl(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

/**
 * Build an NDKRelaySet for an event using NIP-65 inbox routing.
 *
 * When `baseUrls` is omitted, falls back to the NDK pool's current
 * relay list (matches the prior `event.publish()` no-args behavior),
 * and adds recipient inbox relays on top. Best-effort connect with a
 * short settle delay so freshly-instantiated relays have a chance to
 * open before we hand them to NDK's publish.
 *
 * Returns null when no relays could be resolved at all — caller should
 * either fall back to `event.publish()` (NDK default) or surface an
 * error, depending on context.
 */
export async function buildInboxAwareRelaySet(opts: {
  event: NDKEvent;
  ndk: NDK;
  baseUrls?: string[];
}): Promise<NDKRelaySet | null> {
  const { event, ndk } = opts;

  // Fall back to the pool's current relays when no base set is given.
  let baseUrls = opts.baseUrls;
  if (!baseUrls) {
    baseUrls = [];
    const poolRelays = (ndk as unknown as { pool?: { relays?: Map<string, unknown> } }).pool
      ?.relays;
    if (poolRelays) {
      for (const [url] of poolRelays) baseUrls.push(url);
    }
  }

  const targetUrls = await unionInboxRelayUrls(event, baseUrls);
  if (targetUrls.length === 0) return null;

  const { NDKRelaySet } = await import('@nostr-dev-kit/ndk');
  const pool = (
    ndk as unknown as {
      pool: {
        getRelay: (url: string, autoConnect: boolean, createIfMissing: boolean) => NDKRelay | null;
      };
    }
  ).pool;

  const relays: NDKRelay[] = [];
  for (const url of targetUrls) {
    const relay = pool.getRelay(url, true, true);
    if (relay) relays.push(relay);
  }

  if (relays.length === 0) return null;

  // Best-effort parallel connect; failures are tolerated because the
  // NDKRelaySet publish path will skip relays that aren't ready and we
  // just want fast-quorum confirmation, not strict all-relay delivery.
  await Promise.all(
    relays.map((r) =>
      (r as unknown as { connect: () => Promise<unknown> }).connect().catch(() => {})
    )
  );
  await new Promise((resolve) => setTimeout(resolve, 100));

  return new NDKRelaySet(new Set(relays), ndk);
}
