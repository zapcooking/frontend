import { describe, it, expect, beforeEach } from 'vitest';
import {
  DISCOVERY_STORAGE_KEY,
  DISCOVERY_SESSION_KEY,
  DISCOVERY_VIEWS_KEY,
  DISCOVERY_SUPPRESSION_MS,
  DISCOVERY_MIN_ELIGIBLE_VIEWS,
  DISCOVERY_DWELL_MS,
  MEMBERSHIP_PATH,
  isDiscoveryRoute,
  isMembershipRoute,
  readDiscoveryRecord,
  writeDiscoveryRecord,
  isSuppressedByCooldown,
  wasShownThisSession,
  markShownThisSession,
  evaluateDiscoveryEligibility,
  createEngagementTracker,
  type EligibilityInput,
  type KeyValueStorage
} from './cookPlusDiscovery';

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
const NOW = Date.UTC(2026, 8, 10, 12, 0, 0);

function eligible(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    membershipEnabled: true,
    pathname: '/explore',
    signedIn: true,
    membership: { active: false, tier: 'unknown' },
    overlayOpen: false,
    shownThisSession: false,
    record: {},
    now: NOW,
    ...overrides
  };
}

describe('isDiscoveryRoute', () => {
  it('allows ordinary browsing routes', () => {
    for (const path of ['/', '/explore', '/recipe/abc', '/reads', '/user/npub1x', '/recipes']) {
      expect(isDiscoveryRoute(path), path).toBe(true);
    }
  });

  it('excludes onboarding and auth', () => {
    expect(isDiscoveryRoute('/login')).toBe(false);
    expect(isDiscoveryRoute('/login/')).toBe(false);
    expect(isDiscoveryRoute('/onboarding')).toBe(false);
  });

  it('excludes creating and publishing workflows', () => {
    for (const path of [
      '/create',
      '/create/gated',
      '/drafts',
      '/fork/abc',
      '/feed-post',
      '/my-store/new'
    ]) {
      expect(isDiscoveryRoute(path), path).toBe(false);
    }
  });

  it('excludes the membership funnel itself', () => {
    expect(isDiscoveryRoute('/membership')).toBe(false);
    expect(isDiscoveryRoute('/membership/cook-plus-checkout')).toBe(false);
    expect(isDiscoveryRoute('/membership/cook-plus-success')).toBe(false);
  });

  it('excludes Cook+ tool pages, which carry contextual prompts', () => {
    expect(isDiscoveryRoute('/souschef')).toBe(false);
    expect(isDiscoveryRoute('/nourish')).toBe(false);
    expect(isDiscoveryRoute('/nourish/explore')).toBe(false);
    expect(isDiscoveryRoute('/cheffy')).toBe(false);
  });

  it('excludes chrome-less, money and admin surfaces', () => {
    for (const path of [
      '/messages',
      '/groups/abc',
      '/cheffys-table',
      '/wallet',
      '/delete-account',
      '/admin/x',
      '/settings'
    ]) {
      expect(isDiscoveryRoute(path), path).toBe(false);
    }
  });

  it('matches whole path segments, not string prefixes', () => {
    expect(isDiscoveryRoute('/created-by-me')).toBe(true);
    expect(isDiscoveryRoute('/my-store')).toBe(true);
    expect(isDiscoveryRoute('/my-store/newsletter')).toBe(true);
  });
});

describe('isMembershipRoute', () => {
  it('matches the membership page and its children only', () => {
    expect(MEMBERSHIP_PATH).toBe('/membership');
    expect(isMembershipRoute('/membership')).toBe(true);
    expect(isMembershipRoute('/membership/cook-plus-checkout?period=annual')).toBe(true);
    expect(isMembershipRoute('/memberships')).toBe(false);
    expect(isMembershipRoute('/explore')).toBe(false);
  });
});

describe('persisted record', () => {
  let storage: StorageStub;
  beforeEach(() => {
    storage = new StorageStub();
  });

  it('round-trips a record', () => {
    expect(writeDiscoveryRecord(storage, { lastShownAt: NOW, lastAction: 'later' })).toBe(true);
    expect(storage.data.get(DISCOVERY_STORAGE_KEY)).toContain('"lastShownAt"');
    expect(readDiscoveryRecord(storage)).toEqual({ lastShownAt: NOW, lastAction: 'later' });
  });

  it('reads an empty record when nothing is stored', () => {
    expect(readDiscoveryRecord(storage)).toEqual({});
    expect(readDiscoveryRecord(null)).toEqual({});
  });

  it('ignores corrupt or foreign values', () => {
    storage.data.set(DISCOVERY_STORAGE_KEY, 'not json');
    expect(readDiscoveryRecord(storage)).toEqual({});
    storage.data.set(
      DISCOVERY_STORAGE_KEY,
      JSON.stringify({ lastShownAt: 'yesterday', lastAction: 'buy', extra: 1 })
    );
    expect(readDiscoveryRecord(storage)).toEqual({});
  });

  it('tolerates blocked storage', () => {
    storage.throwOnGet = true;
    expect(readDiscoveryRecord(storage)).toEqual({});
    storage.throwOnGet = false;
    storage.throwOnSet = true;
    expect(writeDiscoveryRecord(storage, { lastShownAt: NOW })).toBe(false);
    expect(writeDiscoveryRecord(null, { lastShownAt: NOW })).toBe(false);
  });
});

describe('30-day cooldown', () => {
  it('is not suppressed when never shown', () => {
    expect(isSuppressedByCooldown({}, NOW)).toBe(false);
  });

  it('is suppressed for 30 days after being shown', () => {
    expect(isSuppressedByCooldown({ lastShownAt: NOW }, NOW)).toBe(true);
    expect(isSuppressedByCooldown({ lastShownAt: NOW - 29 * DAY }, NOW)).toBe(true);
    expect(isSuppressedByCooldown({ lastShownAt: NOW - DISCOVERY_SUPPRESSION_MS + 1 }, NOW)).toBe(
      true
    );
  });

  it('lifts exactly at 30 days', () => {
    expect(DISCOVERY_SUPPRESSION_MS).toBe(30 * DAY);
    expect(isSuppressedByCooldown({ lastShownAt: NOW - DISCOVERY_SUPPRESSION_MS }, NOW)).toBe(
      false
    );
    expect(isSuppressedByCooldown({ lastShownAt: NOW - 45 * DAY }, NOW)).toBe(false);
  });

  it('keys the cooldown on the last showing, not the last dismissal', () => {
    expect(isSuppressedByCooldown({ lastDismissedAt: NOW }, NOW)).toBe(false);
  });

  it('treats a future timestamp as suppressed rather than nagging', () => {
    expect(isSuppressedByCooldown({ lastShownAt: NOW + DAY }, NOW)).toBe(true);
  });
});

describe('session suppression', () => {
  it('records and reads the session flag', () => {
    const session = new StorageStub();
    expect(wasShownThisSession(session)).toBe(false);
    markShownThisSession(session);
    expect(session.data.get(DISCOVERY_SESSION_KEY)).toBe('1');
    expect(wasShownThisSession(session)).toBe(true);
  });

  it('survives blocked session storage', () => {
    const session = new StorageStub();
    session.throwOnSet = true;
    expect(() => markShownThisSession(session)).not.toThrow();
    session.throwOnGet = true;
    expect(wasShownThisSession(session)).toBe(false);
    expect(wasShownThisSession(null)).toBe(false);
  });
});

describe('evaluateDiscoveryEligibility', () => {
  it('is eligible for a signed-in, resolved non-member on a browsing route', () => {
    expect(evaluateDiscoveryEligibility(eligible())).toEqual({ eligible: true });
  });

  it('is off when membership is disabled for the deployment', () => {
    expect(evaluateDiscoveryEligibility(eligible({ membershipEnabled: false }))).toEqual({
      eligible: false,
      reason: 'disabled'
    });
  });

  it('never shows to signed-out visitors', () => {
    expect(evaluateDiscoveryEligibility(eligible({ signedIn: false }))).toEqual({
      eligible: false,
      reason: 'signed-out'
    });
  });

  it('waits for the membership lookup to resolve', () => {
    expect(evaluateDiscoveryEligibility(eligible({ membership: undefined }))).toEqual({
      eligible: false,
      reason: 'membership-unknown'
    });
  });

  it("treats the store's failed-lookup placeholder as unknown, not inactive", () => {
    // membershipStatus writes { active: false, unresolved: true } when the
    // request itself failed; that visitor may well be a member.
    expect(
      evaluateDiscoveryEligibility(
        eligible({ membership: { active: false, tier: 'unknown', unresolved: true } })
      )
    ).toEqual({ eligible: false, reason: 'membership-unknown' });
  });

  it('never shows to members of any tier', () => {
    for (const tier of ['cook_plus', 'pro_kitchen', 'founders', 'member', 'unknown'] as const) {
      expect(
        evaluateDiscoveryEligibility(eligible({ membership: { active: true, tier } })),
        tier
      ).toEqual({ eligible: false, reason: 'member' });
    }
  });

  it('respects excluded routes', () => {
    expect(evaluateDiscoveryEligibility(eligible({ pathname: '/onboarding' }))).toEqual({
      eligible: false,
      reason: 'route'
    });
    expect(evaluateDiscoveryEligibility(eligible({ pathname: '/create' }))).toEqual({
      eligible: false,
      reason: 'route'
    });
  });

  it('yields to any other open overlay', () => {
    expect(evaluateDiscoveryEligibility(eligible({ overlayOpen: true }))).toEqual({
      eligible: false,
      reason: 'overlay'
    });
  });

  it('shows at most once per session', () => {
    expect(evaluateDiscoveryEligibility(eligible({ shownThisSession: true }))).toEqual({
      eligible: false,
      reason: 'session'
    });
  });

  it('shows at most once every 30 days', () => {
    expect(
      evaluateDiscoveryEligibility(eligible({ record: { lastShownAt: NOW - 10 * DAY } }))
    ).toEqual({ eligible: false, reason: 'cooldown' });
    expect(
      evaluateDiscoveryEligibility(eligible({ record: { lastShownAt: NOW - 31 * DAY } }))
    ).toEqual({ eligible: true });
  });

  it('checks the member gate before the route gate', () => {
    // A member on an excluded route reports "member" — the reason a
    // support engineer needs when a member asks why they never see it.
    expect(
      evaluateDiscoveryEligibility(
        eligible({ pathname: '/create', membership: { active: true, tier: 'cook_plus' } })
      )
    ).toEqual({ eligible: false, reason: 'member' });
  });
});

describe('engagement tracker', () => {
  it('needs an interaction before anything counts', () => {
    const t = createEngagementTracker();
    t.noteNavigation('/explore', NOW);
    t.noteNavigation('/recipe/a', NOW + 1000);
    t.noteNavigation('/recipe/b', NOW + 2000);
    expect(t.eligibleViews()).toBe(3);
    expect(t.isEngaged(NOW + 3000)).toBe(false);
    t.noteInteraction();
    expect(t.isEngaged(NOW + 3000)).toBe(true);
  });

  it('triggers on the second eligible page view', () => {
    const t = createEngagementTracker();
    t.noteInteraction();
    t.noteNavigation('/explore', NOW);
    expect(t.isEngaged(NOW + 1000)).toBe(false);
    t.noteNavigation('/recipe/a', NOW + 1000);
    expect(DISCOVERY_MIN_ELIGIBLE_VIEWS).toBe(2);
    expect(t.isEngaged(NOW + 1000)).toBe(true);
  });

  it('does not count excluded routes or repeated same-path calls', () => {
    const t = createEngagementTracker();
    t.noteInteraction();
    t.noteNavigation('/explore', NOW);
    t.noteNavigation('/explore', NOW + 10);
    t.noteNavigation('/create', NOW + 20);
    t.noteNavigation('/login', NOW + 30);
    expect(t.eligibleViews()).toBe(1);
    expect(t.isEngaged(NOW + 40)).toBe(false);
  });

  it('triggers after a minute of dwell on one eligible page', () => {
    const t = createEngagementTracker();
    t.noteInteraction();
    t.noteNavigation('/recipe/a', NOW);
    expect(t.dwellDeadline()).toBe(NOW + DISCOVERY_DWELL_MS);
    expect(t.isEngaged(NOW + DISCOVERY_DWELL_MS - 1)).toBe(false);
    expect(t.isEngaged(NOW + DISCOVERY_DWELL_MS)).toBe(true);
  });

  it('resets dwell when the visitor moves to an excluded route', () => {
    const t = createEngagementTracker();
    t.noteInteraction();
    t.noteNavigation('/recipe/a', NOW);
    t.noteNavigation('/create', NOW + 5000);
    expect(t.dwellDeadline()).toBeNull();
    expect(t.isEngaged(NOW + DISCOVERY_DWELL_MS + 5000)).toBe(false);
  });

  it('carries the eligible-view count across full page loads via session storage', () => {
    const session = new StorageStub();
    const first = createEngagementTracker(session);
    first.noteNavigation('/explore', NOW);
    expect(session.data.get(DISCOVERY_VIEWS_KEY)).toBe('1');

    // A full reload creates a fresh tracker in the same tab.
    const second = createEngagementTracker(session);
    expect(second.eligibleViews()).toBe(1);
    second.noteInteraction();
    expect(second.isEngaged(NOW)).toBe(false);
    second.noteNavigation('/reads', NOW + 1000);
    expect(second.eligibleViews()).toBe(2);
    expect(second.isEngaged(NOW + 1000)).toBe(true);
    // Interaction is per-load: the stored count alone never opens anything.
    const third = createEngagementTracker(session);
    expect(third.isEngaged(NOW + 2000)).toBe(false);
  });

  it('ignores a corrupt or blocked session count', () => {
    const session = new StorageStub();
    session.data.set(DISCOVERY_VIEWS_KEY, 'lots');
    expect(createEngagementTracker(session).eligibleViews()).toBe(0);
    session.throwOnGet = true;
    session.throwOnSet = true;
    const t = createEngagementTracker(session);
    expect(() => t.noteNavigation('/explore', NOW)).not.toThrow();
    expect(t.eligibleViews()).toBe(1);
  });

  it('starts over after reset', () => {
    const t = createEngagementTracker();
    t.noteInteraction();
    t.noteNavigation('/explore', NOW);
    t.noteNavigation('/recipe/a', NOW);
    expect(t.isEngaged(NOW)).toBe(true);
    t.reset();
    expect(t.eligibleViews()).toBe(0);
    expect(t.hasInteracted()).toBe(false);
    expect(t.isEngaged(NOW)).toBe(false);
  });
});
