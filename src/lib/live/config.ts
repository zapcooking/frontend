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

/** Longest SDP offer accepted by the relay, in bytes. Real offers are about 6 KB. */
export const LIVE_OFFER_MAX_BYTES = 32 * 1024;

/** A publish lock older than this is stale and may be taken over. */
export const LIVE_PUBLISH_LOCK_SECONDS = 30;

/**
 * Publish attempts allowed per session (the first Go live plus every
 * reconnect or retry). Each attempt creates a Cloudflare live input, so
 * this bounds what one session can make the server do.
 */
export const LIVE_MAX_PUBLISH_ATTEMPTS = 30;

/** Seconds a client should wait before retrying after a try-again reply. */
export const LIVE_RETRY_AFTER_SECONDS = 2;

/**
 * Guests (viewers who are not confirmed active members) admitted per
 * session when LIVE_GUEST_CAP is not set or not a usable number. Members
 * are never counted.
 */
export const LIVE_GUEST_CAP_DEFAULT = 200;

/** Upper bound accepted from LIVE_GUEST_CAP, so a typo cannot remove the cap. */
export const LIVE_GUEST_CAP_MAX = 10_000;

/**
 * The guest cap from a configured value. Accepts a whole number from 0
 * (no guests at all) to LIVE_GUEST_CAP_MAX; anything else falls back to
 * the default.
 */
export function parseGuestCap(value: string | undefined): number {
  if (value === undefined || !/^\d{1,6}$/.test(value)) return LIVE_GUEST_CAP_DEFAULT;
  const cap = Number(value);
  return cap <= LIVE_GUEST_CAP_MAX ? cap : LIVE_GUEST_CAP_DEFAULT;
}

/**
 * Joins admitted on a rejoin pass, per session, as a multiple of the
 * guest cap. Past it a pass is not honoured and the viewer is treated as
 * a new guest, so a copied pass cannot admit viewers without limit.
 */
export const LIVE_PASS_REJOINS_PER_GUEST = 3;

/** The per-session ceiling on pass rejoins for a given guest cap. */
export function passRejoinCeiling(guestCap: number): number {
  return guestCap * LIVE_PASS_REJOINS_PER_GUEST;
}

// ── Sweep and kill switch ────────────────────────────────────────────

/** A live session is ended this long after it first went live, whatever its status. */
export const LIVE_MAX_SECONDS = 90 * 60;

/** A session that was created but never went live is ended after this long. */
export const LIVE_NEVER_STARTED_SECONDS = 10 * 60;

/** Consecutive "not broadcasting" sweep readings that end a session. */
export const LIVE_STREAK_TO_END = 2;

/** Ended rows are deleted this long after they ended. */
export const LIVE_ROW_RETENTION_SECONDS = 30 * 24 * 60 * 60;

/**
 * The orphan check ignores inputs younger than this. A publish creates its
 * input a moment before recording it on the row; this margin keeps the
 * sweep from deleting an input that is still on its way to being recorded.
 */
export const LIVE_ORPHAN_MIN_AGE_SECONDS = 10 * 60;

/** Most sessions examined in one sweep, and its time budget. */
export const LIVE_SWEEP_BATCH = 25;
export const LIVE_SWEEP_BUDGET_MS = 20_000;

/** KV key (GATED_CONTENT) of the global off flag. Present with value '1' = off. */
export const LIVE_OFF_KEY = 'live:off';

/**
 * Prefix of the operator-facing name of every live input this deployment
 * creates: `<prefix><session id>`. Production and preview share one
 * Cloudflare account, so each environment has its own prefix (set by
 * LIVE_INPUT_PREFIX) and the orphan check only ever touches inputs named
 * with its own.
 */
export const LIVE_INPUT_PREFIX_DEFAULT = 'zc-live-';

/** A usable prefix, or the default. Must start with `zc-live-`. */
export function parseInputPrefix(value: string | undefined): string {
  return value !== undefined && /^zc-live-([a-z0-9]+-)?$/.test(value)
    ? value
    : LIVE_INPUT_PREFIX_DEFAULT;
}
