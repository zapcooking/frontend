/**
 * Account-scoped data cleanup on logout.
 *
 * Logging out used to clear only the auth keys, leaving the previous
 * user's wallet list, cached balances, transaction history metadata,
 * Spark mnemonics, cached group messages, queued posts and offline
 * recipe cache on the device. On a shared or borrowed browser the next
 * person could read all of it.
 *
 * Deliberately NOT wired into AuthManager.clearStorage(): that runs on
 * session-RESTORE failures too (a bunker relay being briefly
 * unreachable, say), and wiping the publish queue there would destroy
 * the user's unsent posts over a transient error. This runs only on an
 * explicit, user-initiated logout.
 *
 * The passkey vault record is not touched — logout ends the session but
 * must leave the vault unlockable. Removing it is a separate,
 * unlock-gated settings action.
 */
import { browser } from '$app/environment';
import { START_SECTION_COOKIE } from '$lib/startSectionConstants';

/** Exact localStorage keys removed on logout. */
export const ACCOUNT_DATA_KEYS = [
  'zapcooking_wallets',
  'zapcooking_webln_wallet_name',
  'zapcooking_pending_transactions',
  'zapcooking_tx_metadata'
] as const;

/** Key prefixes removed on logout (per-wallet / per-pubkey suffixes). */
export const ACCOUNT_DATA_PREFIXES = ['zapcooking_cached_balance', 'spark_wallet_'] as const;

/** Remove every localStorage key that is exactly one of, or prefixed by, the lists above. */
export function clearAccountLocalStorage(): void {
  if (!browser) return;

  for (const key of ACCOUNT_DATA_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage disabled/full — keep going, one key must not block the rest.
    }
  }

  // Collect first: removing while iterating localStorage shifts indices.
  const prefixed: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && ACCOUNT_DATA_PREFIXES.some((p) => key.startsWith(p))) {
        prefixed.push(key);
      }
    }
  } catch {
    // Enumeration failed — the exact-key removals above still happened.
  }
  for (const key of prefixed) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}

/**
 * Drop the start-section cookie so `/` treats this browser as a visitor
 * again (landing page) instead of a member (start section). Only explicit
 * logout clears it: a locked passkey vault keeps the cookie, so a returning
 * member still lands in the app where they can unlock.
 */
export function clearStartSectionCookie(): void {
  if (!browser) return;
  try {
    document.cookie = `${START_SECTION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  } catch {
    // Cookies disabled — nothing was written to clear.
  }
}

/**
 * Clear all account-scoped data for a logout.
 *
 * Every step is independent and best-effort: an IndexedDB failure (locked
 * database, private mode, quota) must never prevent logout from
 * completing. Modules are imported dynamically to keep this off
 * AuthManager's static import graph.
 */
export async function clearAccountData(): Promise<void> {
  if (!browser) return;

  clearAccountLocalStorage();
  clearStartSectionCookie();

  // Cached group messages (zapcooking-groups).
  try {
    const { groupCache } = await import('$lib/groupCacheStorage');
    await groupCache.clearAll();
  } catch (e) {
    console.warn('[SessionCleanup] Failed to clear group cache:', e);
  }

  // Queued outgoing events (zapcooking-publish-queue). These are the
  // logged-out account's unsent posts — they cannot be published by a
  // different session, so they go with the account.
  try {
    const { publishQueue } = await import('$lib/publishQueue');
    await publishQueue.clearQueue();
  } catch (e) {
    console.warn('[SessionCleanup] Failed to clear publish queue:', e);
  }

  // Offline recipe/draft cache (zapcooking-offline).
  try {
    const { offlineStorage } = await import('$lib/offlineStorage');
    await offlineStorage.clearAll();
  } catch (e) {
    console.warn('[SessionCleanup] Failed to clear offline storage:', e);
  }
}
