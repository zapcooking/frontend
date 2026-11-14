/**
 * Go live (live cook-alongs) — configuration shared by client and server.
 *
 * Who may host, decided by the server after NIP-98:
 *  - an active member (Cook+; the tri-state check, where an outage is
 *    "try again", never "not a member"),
 *  - not blocked by the admin (live_blocked_hosts), not under a
 *    temporary safety suspension (live_host_suspensions),
 *  - and, while the hosting mode is "approved" (the default), on the
 *    approved-hosts list (live_approved_hosts). In "members" mode the
 *    list is not consulted.
 * The mode is switched from /admin/live, with no deploy. On the client,
 * `goLiveAccess` only decides how the Go live controls LOOK.
 */
import type { MembershipStatus } from '$lib/stores/membershipStatus';

/**
 * How the Go live controls look for the signed-in account:
 *   member      the normal Go live button
 *   non_member  confirmed not a member: Go live with a Cook+ label,
 *               leading to the membership page
 *   unknown     not signed in, not looked up yet, or the lookup failed:
 *               the normal button, and the server decides
 * Only a confirmed `inactive` answer counts as non_member, so a
 * membership outage never shows a member the upgrade path.
 */
export type GoLiveAccess = 'member' | 'non_member' | 'unknown';

export function goLiveAccess(status: MembershipStatus | undefined | null): GoLiveAccess {
  if (status?.state === 'active') return 'member';
  if (status?.state === 'inactive') return 'non_member';
  return 'unknown';
}

/** Where the Cook+ label on Go live leads a non-member. */
export const LIVE_MEMBERSHIP_PATH = '/membership';

/**
 * Sessions that may be open (created or live) at once, across all hosts,
 * when LIVE_MAX_OPEN_SESSIONS is not set or not a usable number. Past it a
 * create is refused with `live_full`, so the service reaches a limit we
 * chose before any limit of Cloudflare's that we do not know.
 */
export const LIVE_MAX_OPEN_SESSIONS_DEFAULT = 20;

/** Upper bound accepted from LIVE_MAX_OPEN_SESSIONS, so a typo cannot remove the cap. */
export const LIVE_MAX_OPEN_SESSIONS_MAX = 1000;

/** The open-session cap from a configured value: 1 to the maximum, else the default. */
export function parseMaxOpenSessions(value: string | undefined): number {
  if (value === undefined || !/^\d{1,4}$/.test(value)) return LIVE_MAX_OPEN_SESSIONS_DEFAULT;
  const cap = Number(value);
  return cap >= 1 && cap <= LIVE_MAX_OPEN_SESSIONS_MAX ? cap : LIVE_MAX_OPEN_SESSIONS_DEFAULT;
}

// ── Staged rollout ───────────────────────────────────────────────────

/**
 * Who may host:
 *   approved  only accounts on the approved-hosts list (the default)
 *   members   any active member
 */
export type LiveHostingMode = 'approved' | 'members';

/** KV key (GATED_CONTENT) of the hosting mode. Anything but 'members' reads as 'approved'. */
export const LIVE_HOSTING_MODE_KEY = 'live:hosting_mode';

export function parseHostingMode(value: unknown): LiveHostingMode {
  return value === 'members' ? 'members' : 'approved';
}

/** One "Request access" DM per account in this many seconds. */
export const LIVE_ACCESS_REQUEST_THROTTLE_SECONDS = 24 * 60 * 60;

// ── Reports and safety ───────────────────────────────────────────────

/** Reasons a stream or a comment can be reported for. */
export const LIVE_REPORT_REASONS = [
  'child_safety',
  'nudity',
  'violence',
  'spam',
  'other'
] as const;
export type LiveReportReason = (typeof LIVE_REPORT_REASONS)[number];

export function isLiveReportReason(value: unknown): value is LiveReportReason {
  return typeof value === 'string' && (LIVE_REPORT_REASONS as readonly string[]).includes(value);
}

/** Reasons that alert the admin every time, never throttled. */
export const LIVE_URGENT_REASONS: readonly LiveReportReason[] = ['child_safety', 'violence'];

/** Longest note a reporter may add. */
export const LIVE_REPORT_DETAILS_MAX = 300;

/**
 * The admin is DM'd about a reported session at most once in this many
 * seconds, so a burst of reports is one message. An urgent report
 * (child safety, violence) is never held back by it.
 */
export const LIVE_REPORT_ALERT_THROTTLE_SECONDS = 10 * 60;

/**
 * Automatic stream end (only when LIVE_SAFETY_AUTO_END is 'true'): this
 * many distinct reporters of the STREAM (not of comments) end it and
 * suspend the host for LIVE_AUTO_END_SUSPENSION_SECONDS. A reporter is a
 * daily-salted IP hash, not a verified person, so this stays off until
 * it has been proven.
 */
export const LIVE_AUTO_END_THRESHOLD = 3;
export const LIVE_AUTO_END_SUSPENSION_SECONDS = 60 * 60;

/** Reports (and released holds) are deleted this long after the report, unless a hold is open. */
export const LIVE_REPORT_RETENTION_SECONDS = 90 * 24 * 60 * 60;

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
