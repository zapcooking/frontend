import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { bottomDockOccupied, setBottomDockClaim } from './stores/bottomDock';
import {
  PROMO_BAR_STORAGE_KEY,
  PROMO_BAR_DOCK_OWNER,
  PROMO_BAR_SESSION_KEY,
  PROMO_BAR_SUPPRESSION_MS,
  PROMO_BAR_CTA_HREF,
  PROMO_BAR_COPY,
  promoBarSurfaceFor,
  isPromoBarRoute,
  isPromoBarSuppressedByDismissal,
  evaluatePromoBarEligibility,
  createPromoBarController,
  type PromoBarEligibilityInput,
  type PromoBarUpdate
} from './cookPlusPromoBar';
import {
  DISCOVERY_STORAGE_KEY,
  DISCOVERY_SESSION_KEY,
  type KeyValueStorage
} from './cookPlusDiscovery';
import { COOK_PLUS_CHECKOUT_PATH } from './cookPlusPricing';

class StorageStub implements KeyValueStorage {
  data = new Map<string, string>();
  throwOnGet = false;
  throwOnSet = false;
  getItem(key: string): string | null {
    if (this.throwOnGet) throw new Error('denied');
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    if (this.throwOnSet) throw new Error('quota');
    this.data.set(key, value);
  }
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 11, 12, 0, 0);

function url(pathname: string, search = ''): { pathname: string; search: string } {
  return { pathname, search };
}

const FEED = url('/community');
const RECIPE = url('/recipe/naddr1abc');

function eligible(overrides: Partial<PromoBarEligibilityInput> = {}): PromoBarEligibilityInput {
  return {
    membershipEnabled: true,
    url: FEED,
    signedIn: true,
    membership: { active: false, tier: 'unknown' },
    overlayOpen: false,
    presentedThisSession: false,
    record: {},
    now: NOW,
    ...overrides
  };
}

describe('route eligibility', () => {
  it('shows on the main feed and recipe detail only', () => {
    expect(promoBarSurfaceFor(FEED)).toBe('feed');
    expect(promoBarSurfaceFor(url('/community/'))).toBe('feed');
    expect(promoBarSurfaceFor(url('/community', '?tab=global'))).toBe('feed');
    expect(promoBarSurfaceFor(RECIPE)).toBe('recipe');
    expect(promoBarSurfaceFor(url('/recipe/naddr1abc/'))).toBe('recipe');
  });

  it("excludes the feed's Groups tab, which is a chat surface", () => {
    expect(promoBarSurfaceFor(url('/community', '?tab=members'))).toBeNull();
  });

  it('excludes every other route, including the ones the modal allows', () => {
    for (const path of [
      '/',
      '/explore',
      '/recipes',
      '/recipe',
      '/recipe/a/b',
      '/reads',
      '/user/npub1x',
      '/membership',
      '/membership/cook-plus-checkout',
      '/onboarding',
      '/login',
      '/create',
      '/feed-post',
      '/messages',
      '/groups/abc',
      '/wallet',
      '/cheffy',
      '/nourish',
      '/souschef',
      '/settings',
      '/admin',
      '/debug'
    ]) {
      expect(isPromoBarRoute(url(path)), path).toBe(false);
    }
  });

  it('carries contextual copy per surface', () => {
    expect(PROMO_BAR_COPY.feed).toEqual({
      title: 'Cook+',
      body: 'Sous Chef, Nourish & Cheffy',
      cta: 'Unlock Cook+'
    });
    expect(PROMO_BAR_COPY.recipe).toEqual({
      title: 'Cook+',
      body: 'Analyze this recipe, save it, or ask Cheffy',
      cta: 'Unlock Cook+'
    });
  });
});

describe('30-day dismissal suppression', () => {
  it('is not suppressed when never dismissed', () => {
    expect(isPromoBarSuppressedByDismissal({}, NOW)).toBe(false);
    // Showing (without dismissing) is not what starts the cooldown.
    expect(isPromoBarSuppressedByDismissal({ lastShownAt: NOW }, NOW)).toBe(false);
  });

  it('is suppressed for 30 days after dismissal and lifts exactly at 30 days', () => {
    expect(PROMO_BAR_SUPPRESSION_MS).toBe(30 * DAY);
    expect(isPromoBarSuppressedByDismissal({ lastDismissedAt: NOW }, NOW)).toBe(true);
    expect(isPromoBarSuppressedByDismissal({ lastDismissedAt: NOW - 29 * DAY }, NOW)).toBe(true);
    expect(isPromoBarSuppressedByDismissal({ lastDismissedAt: NOW - 30 * DAY }, NOW)).toBe(false);
  });

  it('is applied by the eligibility check', () => {
    expect(
      evaluatePromoBarEligibility(eligible({ record: { lastDismissedAt: NOW - 10 * DAY } }))
    ).toEqual({ eligible: false, reason: 'dismissed' });
    expect(
      evaluatePromoBarEligibility(eligible({ record: { lastDismissedAt: NOW - 31 * DAY } }))
    ).toEqual({ eligible: true, surface: 'feed' });
  });
});

describe('member suppression', () => {
  it('never shows to members of any tier', () => {
    for (const tier of ['cook_plus', 'pro_kitchen', 'founders', 'member', 'unknown'] as const) {
      expect(
        evaluatePromoBarEligibility(eligible({ membership: { active: true, tier } })),
        tier
      ).toEqual({ eligible: false, reason: 'member' });
    }
  });

  it('waits for the membership lookup to resolve', () => {
    expect(evaluatePromoBarEligibility(eligible({ membership: undefined }))).toEqual({
      eligible: false,
      reason: 'membership-unknown'
    });
    expect(
      evaluatePromoBarEligibility(
        eligible({ membership: { active: false, tier: 'unknown', unresolved: true } })
      )
    ).toEqual({ eligible: false, reason: 'membership-unknown' });
  });

  it('never shows to signed-out visitors or when membership is disabled', () => {
    expect(evaluatePromoBarEligibility(eligible({ signedIn: false }))).toEqual({
      eligible: false,
      reason: 'signed-out'
    });
    expect(evaluatePromoBarEligibility(eligible({ membershipEnabled: false }))).toEqual({
      eligible: false,
      reason: 'disabled'
    });
  });

  it('yields to an open overlay and to the session flag', () => {
    expect(evaluatePromoBarEligibility(eligible({ overlayOpen: true }))).toEqual({
      eligible: false,
      reason: 'overlay'
    });
    expect(evaluatePromoBarEligibility(eligible({ presentedThisSession: true }))).toEqual({
      eligible: false,
      reason: 'session'
    });
  });
});

describe('controller', () => {
  let storage: StorageStub;
  let session: StorageStub;
  const dock = { set: (occupied: boolean) => setBottomDockClaim(PROMO_BAR_DOCK_OWNER, occupied) };
  const MEMBERSHIP_OWNER = 'membership-sticky-cta';

  function make() {
    return createPromoBarController({ dock, storage, session });
  }

  function input(overrides: Partial<PromoBarUpdate> = {}): PromoBarUpdate {
    return {
      membershipEnabled: true,
      url: FEED,
      signedIn: true,
      membership: { active: false, tier: 'unknown' },
      overlayOpen: false,
      now: NOW,
      ...overrides
    };
  }

  beforeEach(() => {
    storage = new StorageStub();
    session = new StorageStub();
    setBottomDockClaim(PROMO_BAR_DOCK_OWNER, false);
    setBottomDockClaim(MEMBERSHIP_OWNER, false);
  });

  it('presents on the feed and switches copy on the way to a recipe', () => {
    const c = make();
    expect(c.update(input())).toEqual({ visible: true, surface: 'feed' });
    expect(c.update(input({ url: RECIPE }))).toEqual({ visible: true, surface: 'recipe' });
  });

  it('uses its own storage keys, never the discovery modal’s', () => {
    const c = make();
    c.update(input());
    expect(session.data.get(PROMO_BAR_SESSION_KEY)).toBe('1');
    expect(session.data.has(DISCOVERY_SESSION_KEY)).toBe(false);
    c.dismiss(NOW);
    expect(storage.data.has(PROMO_BAR_STORAGE_KEY)).toBe(true);
    expect(storage.data.has(DISCOVERY_STORAGE_KEY)).toBe(false);
  });

  describe('once per session', () => {
    it('does not present again after a reload once the session flag is set', () => {
      make().update(input());
      expect(session.data.get(PROMO_BAR_SESSION_KEY)).toBe('1');
      const reloaded = make();
      expect(reloaded.update(input())).toEqual({ visible: false, surface: null });
    });

    it('retires when the visitor leaves eligible routes and does not come back', () => {
      const c = make();
      c.update(input());
      expect(c.update(input({ url: url('/user/npub1x') }))).toEqual({
        visible: false,
        surface: null
      });
      expect(c.update(input())).toEqual({ visible: false, surface: null });
      expect(c.update(input({ url: RECIPE }))).toEqual({ visible: false, surface: null });
    });

    it('only hides behind an overlay, then returns when it closes', () => {
      const c = make();
      c.update(input());
      expect(c.update(input({ overlayOpen: true }))).toEqual({ visible: false, surface: 'feed' });
      expect(c.update(input({ overlayOpen: false }))).toEqual({ visible: true, surface: 'feed' });
    });

    it('does not present while an overlay is up, and presents once it closes', () => {
      const c = make();
      expect(c.update(input({ overlayOpen: true })).visible).toBe(false);
      expect(session.data.has(PROMO_BAR_SESSION_KEY)).toBe(false);
      expect(c.update(input()).visible).toBe(true);
    });

    it('retires when the audience gate closes while it is up', () => {
      const c = make();
      c.update(input());
      expect(c.update(input({ membership: { active: true, tier: 'cook_plus' } })).visible).toBe(
        false
      );
      expect(c.update(input()).visible).toBe(false);
    });

    it('still presents only once when session storage is blocked', () => {
      session.throwOnGet = true;
      session.throwOnSet = true;
      const c = make();
      expect(c.update(input()).visible).toBe(true);
      c.update(input({ url: url('/user/npub1x') }));
      expect(c.update(input()).visible).toBe(false);
      expect(c.update(input({ url: RECIPE })).visible).toBe(false);
    });

    it('remembers a membership-page visit in memory when session storage is blocked', () => {
      session.throwOnGet = true;
      session.throwOnSet = true;
      const c = make();
      c.update(input({ url: url('/membership') }));
      expect(c.update(input()).visible).toBe(false);
    });

    it('treats a membership-page visit as presented for the rest of the session', () => {
      const c = make();
      expect(c.update(input({ url: url('/membership') })).visible).toBe(false);
      expect(session.data.get(PROMO_BAR_SESSION_KEY)).toBe('1');
      expect(c.update(input()).visible).toBe(false);
    });
  });

  describe('dismissal', () => {
    it('persists a 30-day suppression and retires', () => {
      const c = make();
      c.update(input());
      c.dismiss(NOW);
      expect(c.state()).toEqual({ visible: false, surface: null });
      expect(JSON.parse(storage.data.get(PROMO_BAR_STORAGE_KEY) as string)).toEqual({
        lastDismissedAt: NOW,
        lastAction: 'close'
      });
      // A new session inside the window stays quiet; after it, the bar is back.
      session = new StorageStub();
      expect(make().update(input({ now: NOW + 29 * DAY })).visible).toBe(false);
      expect(make().update(input({ now: NOW + 30 * DAY })).visible).toBe(true);
    });
  });

  describe('CTA', () => {
    it('routes to /membership and never to checkout', () => {
      expect(PROMO_BAR_CTA_HREF).toBe('/membership');
      const c = make();
      c.update(input());
      const href = c.accept(NOW);
      expect(href).toBe('/membership');
      expect(href).not.toBe(COOK_PLUS_CHECKOUT_PATH);
      expect(c.state().visible).toBe(false);
      expect(JSON.parse(storage.data.get(PROMO_BAR_STORAGE_KEY) as string).lastAction).toBe(
        'explore'
      );
    });
  });

  describe('bottom dock', () => {
    it('occupies the dock while visible and releases it when hidden', () => {
      const c = make();
      expect(get(bottomDockOccupied)).toBe(false);
      c.update(input());
      expect(get(bottomDockOccupied)).toBe(true);
      c.update(input({ overlayOpen: true }));
      expect(get(bottomDockOccupied)).toBe(false);
      c.update(input());
      expect(get(bottomDockOccupied)).toBe(true);
      c.dismiss(NOW);
      expect(get(bottomDockOccupied)).toBe(false);
    });

    it('releases the dock when it retires on navigation and on destroy', () => {
      const c = make();
      c.update(input());
      c.update(input({ url: url('/explore') }));
      expect(get(bottomDockOccupied)).toBe(false);

      session = new StorageStub();
      const d = make();
      d.update(input());
      expect(get(bottomDockOccupied)).toBe(true);
      d.destroy();
      expect(get(bottomDockOccupied)).toBe(false);
    });

    it("cannot clear another owner's claim, and vice versa", () => {
      // The membership page's sticky CTA holds its own claim. Whatever the
      // bar does, that claim stands until the membership page releases it.
      setBottomDockClaim(MEMBERSHIP_OWNER, true);
      const c = make();
      expect(c.update(input({ url: url('/membership') })).visible).toBe(false);
      expect(get(bottomDockOccupied)).toBe(true);
      c.destroy();
      expect(get(bottomDockOccupied)).toBe(true);

      // Overlapping lifetimes during a navigation: the bar is up, the
      // membership page claims and then tears down; the bar's claim stands.
      session = new StorageStub();
      const d = make();
      d.update(input());
      setBottomDockClaim(MEMBERSHIP_OWNER, true);
      setBottomDockClaim(MEMBERSHIP_OWNER, false);
      expect(get(bottomDockOccupied)).toBe(true);
      d.destroy();
      expect(get(bottomDockOccupied)).toBe(false);
    });
  });
});
