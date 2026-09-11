/**
 * Cook+ promotional bottom bar — eligibility, once-per-session and
 * dismissal rules, and the bottom-dock handshake.
 *
 * Pure logic, no Svelte/DOM imports, so every rule is unit-testable. The
 * component (`CookPlusPromoBar.svelte`) feeds it stores and storage and
 * renders whatever state comes back; nothing here decides what the bar
 * looks like.
 *
 * The bar is the quiet sibling of the discovery modal: same audience
 * (signed-in, resolved non-members), same persistence helpers, but its own
 * storage keys so the two never share a cooldown, and a much narrower set
 * of routes — the main feed and recipe detail only.
 *
 * Rules:
 *   1. Membership is enabled for this deployment (PUBLIC_MEMBERSHIP_ENABLED).
 *   2. Signed in AND the membership lookup has resolved inactive.
 *   3. The URL is the main feed (/community, not its Groups tab) or a
 *      recipe detail page.
 *   4. No other overlay is open. An overlay only hides the bar; it comes
 *      back when the overlay closes.
 *   5. Not already presented this browser session. Visiting /membership
 *      counts as presented for the rest of the session.
 *   6. Not dismissed within the last 30 days (persisted client-side).
 *
 * "Once per session" means one contiguous appearance: the bar stays up
 * while the visitor moves between eligible pages, and retires for the
 * session the first time it leaves them, is dismissed, or its audience
 * gate closes (sign-out, membership resolving active).
 */

import type { MembershipStatus } from '$lib/stores/membershipStatus';
import {
  DISCOVERY_SUPPRESSION_MS,
  MEMBERSHIP_PATH,
  audienceGate,
  isMembershipRoute,
  isWithinCooldown,
  markShownThisSession,
  readDiscoveryRecord,
  wasShownThisSession,
  writeDiscoveryRecord,
  type DiscoveryRecord,
  type KeyValueStorage
} from '$lib/cookPlusDiscovery';

export const PROMO_BAR_STORAGE_KEY = 'zapcooking:cook-plus-promo-bar:v1';
export const PROMO_BAR_SESSION_KEY = 'zapcooking:cook-plus-promo-bar:session';
export const PROMO_BAR_SUPPRESSION_MS = DISCOVERY_SUPPRESSION_MS;
/** The CTA goes to the membership page, never straight into checkout. */
export const PROMO_BAR_CTA_HREF = MEMBERSHIP_PATH;

// ── Routes and copy ──────────────────────────────────────────────

export type PromoBarSurface = 'feed' | 'recipe';

export interface PromoBarCopy {
  title: string;
  body: string;
  cta: string;
}

export const PROMO_BAR_COPY: Record<PromoBarSurface, PromoBarCopy> = {
  feed: {
    title: 'Cook+',
    body: 'Sous Chef, Nourish & Cheffy',
    cta: 'Unlock Cook+'
  },
  recipe: {
    title: 'Cook+',
    body: 'Analyze this recipe, save it, or ask Cheffy',
    cta: 'Unlock Cook+'
  }
};

/** The parts of a URL the route rule needs (a `URL` satisfies it). */
export interface UrlParts {
  pathname: string;
  search: string;
}

/**
 * Which surface a URL is, or null when the bar must not show there.
 * The feed's Groups tab (`?tab=members`) is a chat surface and is out.
 */
export function promoBarSurfaceFor(url: UrlParts): PromoBarSurface | null {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/community') {
    const tab = new URLSearchParams(url.search).get('tab');
    return tab === 'members' ? null : 'feed';
  }
  if (/^\/recipe\/[^/]+$/.test(path)) return 'recipe';
  return null;
}

export function isPromoBarRoute(url: UrlParts): boolean {
  return promoBarSurfaceFor(url) !== null;
}

// ── Persistence ──────────────────────────────────────────────────

export function readPromoBarRecord(storage: KeyValueStorage | null | undefined): DiscoveryRecord {
  return readDiscoveryRecord(storage, PROMO_BAR_STORAGE_KEY);
}

export function writePromoBarRecord(
  storage: KeyValueStorage | null | undefined,
  record: DiscoveryRecord
): boolean {
  return writeDiscoveryRecord(storage, record, PROMO_BAR_STORAGE_KEY);
}

/** Unlike the modal, the bar's cooldown keys on dismissal, not on showing. */
export function isPromoBarSuppressedByDismissal(record: DiscoveryRecord, now: number): boolean {
  return isWithinCooldown(record.lastDismissedAt, now);
}

export function wasPromoBarPresentedThisSession(
  session: KeyValueStorage | null | undefined
): boolean {
  return wasShownThisSession(session, PROMO_BAR_SESSION_KEY);
}

export function markPromoBarPresentedThisSession(
  session: KeyValueStorage | null | undefined
): void {
  markShownThisSession(session, PROMO_BAR_SESSION_KEY);
}

// ── Eligibility ──────────────────────────────────────────────────

export type PromoBarIneligibleReason =
  | 'disabled'
  | 'signed-out'
  | 'membership-unknown'
  | 'member'
  | 'route'
  | 'overlay'
  | 'session'
  | 'dismissed';

export interface PromoBarEligibilityInput {
  membershipEnabled: boolean;
  url: UrlParts;
  signedIn: boolean;
  membership: MembershipStatus | undefined;
  overlayOpen: boolean;
  presentedThisSession: boolean;
  record: DiscoveryRecord;
  now: number;
}

export type PromoBarVerdict =
  | { eligible: true; surface: PromoBarSurface }
  | { eligible: false; reason: PromoBarIneligibleReason };

export function evaluatePromoBarEligibility(input: PromoBarEligibilityInput): PromoBarVerdict {
  const audience = audienceGate(input);
  if (audience) return { eligible: false, reason: audience };
  const surface = promoBarSurfaceFor(input.url);
  if (!surface) return { eligible: false, reason: 'route' };
  if (input.overlayOpen) return { eligible: false, reason: 'overlay' };
  if (input.presentedThisSession) return { eligible: false, reason: 'session' };
  if (isPromoBarSuppressedByDismissal(input.record, input.now)) {
    return { eligible: false, reason: 'dismissed' };
  }
  return { eligible: true, surface };
}

// ── Controller ───────────────────────────────────────────────────

/** The subset of a Svelte writable the controller needs. */
export interface DockStore {
  set(occupied: boolean): void;
}

export interface PromoBarControllerOptions {
  /** `bottomDockOccupied` (or a stand-in for tests). */
  dock: DockStore;
  storage: KeyValueStorage | null | undefined;
  session: KeyValueStorage | null | undefined;
}

export interface PromoBarUpdate {
  membershipEnabled: boolean;
  url: UrlParts;
  signedIn: boolean;
  membership: MembershipStatus | undefined;
  overlayOpen: boolean;
  now: number;
}

export interface PromoBarState {
  visible: boolean;
  /** Set whenever the bar is presented (visible or hidden behind an overlay). */
  surface: PromoBarSurface | null;
}

export interface PromoBarController {
  /** Re-plan from the current inputs. Cheap; call on every change. */
  update(input: PromoBarUpdate): PromoBarState;
  /** The X: persists the 30-day suppression and retires the bar. */
  dismiss(now: number): void;
  /**
   * The CTA. Records the action, retires the bar and returns where to go.
   * The visitor is heading to the membership page, which already counts as
   * presented for the session; the 30-day record keeps the bar quiet if
   * they come back without joining.
   */
  accept(now: number): string;
  /** Release the dock on component teardown. */
  destroy(): void;
  state(): PromoBarState;
}

export function createPromoBarController(opts: PromoBarControllerOptions): PromoBarController {
  // Presented in this mount and not yet retired. A reload starts inactive;
  // the session flag then keeps the bar away for the rest of the session.
  let active = false;
  let surface: PromoBarSurface | null = null;
  let visible = false;
  // Only ever release a dock claim this controller made, so a page that
  // owns the dock (the membership page's sticky CTA) is never stomped.
  let dockClaimed = false;

  function syncDock(next: boolean) {
    if (next === dockClaimed) return;
    dockClaimed = next;
    opts.dock.set(next);
  }

  function apply(nextVisible: boolean, nextSurface: PromoBarSurface | null): PromoBarState {
    visible = nextVisible;
    surface = nextSurface;
    syncDock(visible);
    return { visible, surface };
  }

  function retire(): PromoBarState {
    active = false;
    return apply(false, null);
  }

  function record(now: number, action: DiscoveryRecord['lastAction']) {
    const existing = readPromoBarRecord(opts.storage);
    writePromoBarRecord(opts.storage, { ...existing, lastDismissedAt: now, lastAction: action });
  }

  return {
    update(input) {
      if (isMembershipRoute(input.url.pathname)) {
        // Seen the real thing; nothing to remind them of this session.
        markPromoBarPresentedThisSession(opts.session);
        return retire();
      }

      if (active) {
        if (audienceGate(input)) return retire();
        const nextSurface = promoBarSurfaceFor(input.url);
        if (!nextSurface) return retire();
        // An overlay only covers the bar; it comes back when the overlay does.
        return apply(!input.overlayOpen, nextSurface);
      }

      const verdict = evaluatePromoBarEligibility({
        ...input,
        presentedThisSession: wasPromoBarPresentedThisSession(opts.session),
        record: readPromoBarRecord(opts.storage)
      });
      if (!verdict.eligible) return apply(false, null);

      active = true;
      markPromoBarPresentedThisSession(opts.session);
      return apply(true, verdict.surface);
    },
    dismiss(now) {
      record(now, 'close');
      retire();
    },
    accept(now) {
      record(now, 'explore');
      retire();
      return PROMO_BAR_CTA_HREF;
    },
    destroy() {
      retire();
    },
    state() {
      return { visible, surface };
    }
  };
}
