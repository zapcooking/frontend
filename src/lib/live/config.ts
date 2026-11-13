/**
 * Go live (live cook-alongs) — configuration shared by client and server.
 *
 * LIVE_HOSTS is the v1 host allowlist: the hex pubkeys allowed to start a
 * live session. An empty list means nobody can, which is how the feature
 * stays dark. On the client this list only decides whether to SHOW the
 * Go live controls; the server enforces it after NIP-98 (the same split
 * as ADMIN_PUBKEY / isAdmin in $lib/adminAuth). Membership is checked as
 * well, so opening hosting to all Cook+ members later means removing the
 * list check, not adding a membership one.
 */
import { ADMIN_PUBKEY } from '$lib/adminAuth';

export const LIVE_HOSTS: readonly string[] = [
  // Seth (the `seth` zap.cooking handle; same key as ADMIN_PUBKEY).
  ADMIN_PUBKEY
];

/** True when this pubkey may host. Case-insensitive on the hex. */
export function isLiveHost(
  pubkey: string | null | undefined,
  hosts: readonly string[] = LIVE_HOSTS
): boolean {
  if (!pubkey) return false;
  const pk = pubkey.toLowerCase();
  return hosts.some((h) => h.toLowerCase() === pk);
}

/** Longest session title, in characters, after trimming. */
export const LIVE_TITLE_MAX = 120;

/** Longest recipe `d` identifier accepted in an attached recipe address. */
export const LIVE_RECIPE_D_MAX = 200;

/** Sessions one host may create per rolling hour (counted by row creation time). */
export const LIVE_CREATES_PER_HOUR = 6;

/** Kinds a session may attach as its recipe: long-form recipes and premium recipes. */
export const LIVE_RECIPE_KINDS: readonly number[] = [30023, 35000];
