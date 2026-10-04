import { writable } from 'svelte/store';

/**
 * Who sees the Fresh beta feed (a /feed tab reading only wss://feed.zap.cooking).
 *
 * A tri-state, device-local preference:
 *   - unset: the default for the signed-in key — on for FRESH_DEFAULT_ON_PUBKEYS,
 *     off for everyone else;
 *   - 'on' / 'off': the member's own choice from Settings ("Try the new feed
 *     (beta)"), which always wins.
 * Signed out, the tab is hidden whatever is stored.
 *
 * Same localStorage pattern as `foodFilterSettings.ts` (guarded `typeof
 * localStorage`, no `$app` import, so it stays importable under vitest).
 * Nothing here is synced or sent anywhere.
 */

/**
 * Keys that see Fresh by default. Deliberately separate from `isAdmin`
 * ($lib/adminAuth), which holds only one of them: the other is the feed
 * relay's own operator key, and widening isAdmin would also open /admin.
 */
export const FRESH_DEFAULT_ON_PUBKEYS: ReadonlySet<string> = new Set([
  // npub1xxdd8eusvdxmaph3fkuu9x2mymhrcc3ghe2l38zv0l4f4nqp659qskkt7a (Zap Cooking org)
  '319ad3e790634dbe86f14db9c2995b26ee3c6228be55f89c4c7fea9acc01d50a',
  // npub15u3cqhx6vuj3rywg0ph5mfv009lxja6cyvqn2jagaydukq6zmjwqex05rq (Seth)
  'a723805cda67251191c8786f4da58f797e6977582301354ba8e91bcb0342dc9c'
]);

export type FreshPreference = 'on' | 'off' | null;

const STORAGE_KEY = 'zapcooking_fresh_feed';

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/** The stored choice; anything but the two values we write reads as unset. */
export function readStoredFreshPreference(): FreshPreference {
  if (!hasLocalStorage()) return null;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'on' || v === 'off') return v;
  } catch (error) {
    console.error('Failed to load Fresh feed setting from localStorage:', error);
  }
  return null;
}

/** Is Fresh shown to this key (hex; '' or null = signed out) with this preference? */
export function isFreshVisible(pubkey: string | null | undefined, pref: FreshPreference): boolean {
  if (!pubkey) return false;
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  return FRESH_DEFAULT_ON_PUBKEYS.has(pubkey.toLowerCase());
}

function createFreshPreferenceStore() {
  const { subscribe, set } = writable<FreshPreference>(readStoredFreshPreference());
  return {
    subscribe,
    /** Record the member's choice (the Settings switch). */
    setEnabled: (enabled: boolean) => {
      const v: FreshPreference = enabled ? 'on' : 'off';
      set(v);
      if (!hasLocalStorage()) return;
      try {
        localStorage.setItem(STORAGE_KEY, v);
      } catch (error) {
        console.error('Failed to save Fresh feed setting to localStorage:', error);
      }
    }
  };
}

export const freshPreference = createFreshPreferenceStore();

export const FRESH_STORAGE_KEY = STORAGE_KEY;
