/**
 * The discovery exclusion check: one place every targeted surface asks
 * "is this author held out of discovery?". The list itself is in `./config`.
 */

import { DISCOVERY_EXCLUSIONS, type DiscoveryExclusion } from './config';

const HEX64 = /^[0-9a-f]{64}$/;

/** A pubkey as the list keys it: trimmed, lower-case, 64 hex. Null otherwise. */
export function canonicalPubkey(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const pk = raw.trim().toLowerCase();
  return HEX64.test(pk) ? pk : null;
}

/** The canonical pubkeys of a list of entries (invalid entries dropped). */
export function exclusionSet(
  entries: readonly Pick<DiscoveryExclusion, 'pubkey'>[]
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const entry of entries) {
    const pk = canonicalPubkey(entry.pubkey);
    if (pk) out.add(pk);
  }
  return out;
}

/** The configured list, compiled once. */
export const DISCOVERY_EXCLUDED_PUBKEYS: ReadonlySet<string> = exclusionSet(DISCOVERY_EXCLUSIONS);

/**
 * True when the author is held out of discovery. `excluded` is injectable so
 * tests (and callers with their own list) don't depend on what is configured.
 */
export function isDiscoveryExcluded(
  pubkey: string | null | undefined,
  excluded: ReadonlySet<string> = DISCOVERY_EXCLUDED_PUBKEYS
): boolean {
  if (excluded.size === 0) return false;
  const pk = canonicalPubkey(pubkey);
  return !!pk && excluded.has(pk);
}
