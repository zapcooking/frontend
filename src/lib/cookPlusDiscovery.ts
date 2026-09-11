/**
 * Cook+ discovery modal — eligibility, engagement trigger and suppression.
 *
 * Pure logic, no Svelte/DOM imports, so every rule is unit-testable. The
 * component (`CookPlusDiscoveryModal.svelte`) feeds it stores and storage
 * and acts on the verdict; nothing here decides what the modal looks like.
 *
 * Rules, in the order they are checked:
 *   1. Membership is enabled for this deployment (PUBLIC_MEMBERSHIP_ENABLED).
 *   2. The visitor is signed in AND their membership lookup has resolved
 *      inactive. Members never see it; an unresolved lookup — no entry
 *      yet, or the store's placeholder for a failed request — is treated
 *      as "might be a member" and skipped rather than risk pitching to one.
 *   3. The route is not onboarding, a checkout, or a disruptive workflow
 *      (composing/publishing, messaging, wallet, admin), and not a Cook+
 *      tool page — those already carry contextual upgrade prompts, which
 *      convert better than a generic interruption.
 *   4. No other overlay is open (composer, editor, wallet, login, Cheffy).
 *   5. Not already shown this browser session.
 *   6. Not shown within the last 30 days (persisted client-side).
 *
 * The engagement trigger is separate from eligibility: the modal is only
 * *considered* once the visitor has shown intent — a second eligible page
 * in the session, or a minute on one page — and has actually interacted
 * (scrolled, tapped, typed). Eligibility is re-evaluated at fire time.
 */

import type { MembershipStatus } from '$lib/stores/membershipStatus';
import { MEMBERSHIP_PATH } from '$lib/cookPlusPricing';

export { MEMBERSHIP_PATH };

export const DISCOVERY_STORAGE_KEY = 'zapcooking:cook-plus-discovery:v1';
export const DISCOVERY_SESSION_KEY = 'zapcooking:cook-plus-discovery:session';
export const DISCOVERY_VIEWS_KEY = 'zapcooking:cook-plus-discovery:views';
export const DISCOVERY_SUPPRESSION_MS = 30 * 24 * 60 * 60 * 1000;
export const DISCOVERY_MIN_ELIGIBLE_VIEWS = 2;
export const DISCOVERY_DWELL_MS = 60_000;
export const DISCOVERY_SHOW_DELAY_MS = 2_000;

/**
 * Routes where the generic modal must never appear. Prefix match on path
 * segments (`/create` covers `/create/gated`, not `/created`).
 */
export const DISCOVERY_EXCLUDED_PREFIXES = [
  // Onboarding and auth
  '/login',
  '/onboarding',
  // Membership itself, checkout and success pages
  '/membership',
  // Creating / publishing content
  '/create',
  '/drafts',
  '/fork',
  '/feed-post',
  '/my-store/new',
  // Money and account-destructive flows
  '/wallet',
  '/lnurlpay',
  '/boost',
  '/delete-account',
  // Chrome-less or immersive surfaces
  '/messages',
  '/groups',
  '/cheffys-table',
  '/zappy',
  // Cook+ tools carry their own contextual prompts
  '/souschef',
  '/nourish',
  '/cheffy',
  '/pantry',
  // Settings (has its own membership section) and internal routes
  '/settings',
  '/admin',
  '/dev',
  '/debug'
] as const;

export function isDiscoveryRoute(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  return !DISCOVERY_EXCLUDED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

/** True for the membership page and everything under it. */
export function isMembershipRoute(pathname: string): boolean {
  return pathname === MEMBERSHIP_PATH || pathname.startsWith(`${MEMBERSHIP_PATH}/`);
}

// ── Persistence ──────────────────────────────────────────────────

export type DiscoveryAction = 'explore' | 'later' | 'close';

export interface DiscoveryRecord {
  /** Last time the modal was opened. Drives the 30-day cooldown. */
  lastShownAt?: number;
  /** Last time it was closed by any means. */
  lastDismissedAt?: number;
  lastAction?: DiscoveryAction;
}

/** The subset of the Storage interface the module needs. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * @param key Storage key to read. Defaults to the modal's record; the
 * promotional bar (`$lib/cookPlusPromoBar`) keeps its own record under a
 * different key so the two surfaces never share a cooldown.
 */
export function readDiscoveryRecord(
  storage: KeyValueStorage | null | undefined,
  key: string = DISCOVERY_STORAGE_KEY
): DiscoveryRecord {
  if (!storage) return {};
  try {
    const raw = storage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const rec = parsed as Record<string, unknown>;
    const out: DiscoveryRecord = {};
    if (typeof rec.lastShownAt === 'number' && Number.isFinite(rec.lastShownAt)) {
      out.lastShownAt = rec.lastShownAt;
    }
    if (typeof rec.lastDismissedAt === 'number' && Number.isFinite(rec.lastDismissedAt)) {
      out.lastDismissedAt = rec.lastDismissedAt;
    }
    if (rec.lastAction === 'explore' || rec.lastAction === 'later' || rec.lastAction === 'close') {
      out.lastAction = rec.lastAction;
    }
    return out;
  } catch {
    // Corrupt JSON or blocked storage — behave as never shown. The write
    // guard below stops that from turning into a nag loop.
    return {};
  }
}

/** Returns false when the record could not be persisted. */
export function writeDiscoveryRecord(
  storage: KeyValueStorage | null | undefined,
  record: DiscoveryRecord,
  key: string = DISCOVERY_STORAGE_KEY
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/**
 * True while `timestamp` is within the 30-day window before `now`.
 * A missing timestamp never suppresses.
 */
export function isWithinCooldown(timestamp: number | undefined, now: number): boolean {
  if (typeof timestamp !== 'number') return false;
  // A clock that went backwards (or a corrupt future timestamp) must not
  // suppress forever: only a sensible past timestamp counts.
  if (timestamp > now) return true;
  return now - timestamp < DISCOVERY_SUPPRESSION_MS;
}

export function isSuppressedByCooldown(record: DiscoveryRecord, now: number): boolean {
  return isWithinCooldown(record.lastShownAt, now);
}

export function wasShownThisSession(
  session: KeyValueStorage | null | undefined,
  key: string = DISCOVERY_SESSION_KEY
): boolean {
  if (!session) return false;
  try {
    return session.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function markShownThisSession(
  session: KeyValueStorage | null | undefined,
  key: string = DISCOVERY_SESSION_KEY
): void {
  if (!session) return;
  try {
    session.setItem(key, '1');
  } catch {
    // Without session storage the 30-day record still limits repeats.
  }
}

// ── Eligibility ──────────────────────────────────────────────────

export type IneligibleReason =
  | 'disabled'
  | 'signed-out'
  | 'membership-unknown'
  | 'member'
  | 'route'
  | 'overlay'
  | 'session'
  | 'cooldown';

export interface EligibilityInput {
  membershipEnabled: boolean;
  pathname: string;
  signedIn: boolean;
  /** Resolved membership status for the signed-in pubkey, if known yet. */
  membership: MembershipStatus | undefined;
  /** Any other modal/overlay currently open. */
  overlayOpen: boolean;
  shownThisSession: boolean;
  record: DiscoveryRecord;
  now: number;
}

export type EligibilityVerdict = { eligible: true } | { eligible: false; reason: IneligibleReason };

/**
 * The audience gate every Cook+ pitch shares: signed in, lookup resolved,
 * not a member. Returns the reason the visitor is out, or null when they
 * are a resolved non-member.
 */
export function audienceGate(input: {
  membershipEnabled: boolean;
  signedIn: boolean;
  membership: MembershipStatus | undefined;
}): 'disabled' | 'signed-out' | 'membership-unknown' | 'member' | null {
  if (!input.membershipEnabled) return 'disabled';
  if (!input.signedIn) return 'signed-out';
  if (!input.membership || input.membership.unresolved) return 'membership-unknown';
  if (input.membership.active) return 'member';
  return null;
}

export function evaluateDiscoveryEligibility(input: EligibilityInput): EligibilityVerdict {
  const audience = audienceGate(input);
  if (audience) return { eligible: false, reason: audience };
  if (!isDiscoveryRoute(input.pathname)) return { eligible: false, reason: 'route' };
  if (input.overlayOpen) return { eligible: false, reason: 'overlay' };
  if (input.shownThisSession) return { eligible: false, reason: 'session' };
  if (isSuppressedByCooldown(input.record, input.now)) {
    return { eligible: false, reason: 'cooldown' };
  }
  return { eligible: true };
}

// ── Engagement trigger ───────────────────────────────────────────

export interface EngagementTracker {
  /** Call on every client-side navigation (and once on load). */
  noteNavigation(pathname: string, now: number): void;
  /** Call on the first scroll / pointer / key interaction. */
  noteInteraction(): void;
  /** True once the visitor has shown enough intent to be interrupted. */
  isEngaged(now: number): boolean;
  /** When the dwell rule would first be satisfied, or null if it cannot. */
  dwellDeadline(): number | null;
  eligibleViews(): number;
  hasInteracted(): boolean;
  reset(): void;
}

/**
 * @param session Optional session storage. When given, the eligible-view
 * count survives full page loads within the tab (a visitor arriving from
 * two external links still counts as engaged); interaction and dwell are
 * per-load by design.
 */
export function createEngagementTracker(session?: KeyValueStorage | null): EngagementTracker {
  let views = readViews(session);
  let lastPath: string | null = null;
  let interacted = false;
  let dwellStart: number | null = null;

  return {
    noteNavigation(pathname, now) {
      if (pathname === lastPath) return;
      lastPath = pathname;
      if (isDiscoveryRoute(pathname)) {
        views += 1;
        writeViews(session, views);
        dwellStart = now;
      } else {
        dwellStart = null;
      }
    },
    noteInteraction() {
      interacted = true;
    },
    isEngaged(now) {
      if (!interacted) return false;
      if (views >= DISCOVERY_MIN_ELIGIBLE_VIEWS) return true;
      return dwellStart !== null && now - dwellStart >= DISCOVERY_DWELL_MS;
    },
    dwellDeadline() {
      return dwellStart === null ? null : dwellStart + DISCOVERY_DWELL_MS;
    },
    eligibleViews() {
      return views;
    },
    hasInteracted() {
      return interacted;
    },
    reset() {
      views = 0;
      writeViews(session, 0);
      lastPath = null;
      interacted = false;
      dwellStart = null;
    }
  };
}

function readViews(session: KeyValueStorage | null | undefined): number {
  if (!session) return 0;
  try {
    const n = parseInt(session.getItem(DISCOVERY_VIEWS_KEY) || '0', 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeViews(session: KeyValueStorage | null | undefined, views: number): void {
  if (!session) return;
  try {
    session.setItem(DISCOVERY_VIEWS_KEY, String(views));
  } catch {
    // Without session storage the count is per-load, which is still safe.
  }
}
