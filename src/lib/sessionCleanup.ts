/**
 * Account-scoped data cleanup on logout — and on a user change.
 *
 * Logging out used to clear only the auth keys, leaving the previous
 * user's wallet list, cached balances, transaction history metadata,
 * Spark mnemonics, cached group messages, queued posts and offline
 * recipe cache on the device. On a shared or borrowed browser the next
 * person could read all of it.
 *
 * The same leak exists without a logout: when a different Nostr account
 * authenticates on this browser (a NIP-07 extension whose active account
 * was switched, a second vault record unlocked, a different bunker),
 * every account-scoped key above still belongs to the PREVIOUS account.
 * clearAccountDataForUserChange() detects that via a last-user record
 * and runs the same wipe, so the new session starts with none of the
 * old account's wallets, balances or lightning address. In-memory
 * account state registers itself via onAccountDataReset, so the stores
 * reset with the storage they were loaded from.
 *
 * Deliberately NOT wired into AuthManager.clearStorage(): that also runs
 * on session-RESTORE failures (a bunker relay being briefly
 * unreachable, say), and wiping the publish queue there would destroy
 * the user's unsent posts over a transient error. This wipe runs only
 * on an explicit logout and from the user-change guard — which fires
 * only once a session has actually authenticated (isAuthenticated + a
 * pubkey); restore failures and locked-vault browsing never produce
 * that state.
 *
 * The passkey vault record is not touched — logout ends the session but
 * must leave the vault unlockable. Removing it is a separate,
 * unlock-gated settings action.
 */
import { browser } from '$app/environment';
import { START_SECTION_COOKIE } from '$lib/startSectionConstants';

/**
 * Exact localStorage keys removed when an account's data is wiped
 * (logout, NIP-46 disconnect, or a different account authenticating).
 */
export const ACCOUNT_DATA_KEYS = [
  'zapcooking_wallets',
  'zapcooking_webln_wallet_name',
  'zapcooking_pending_transactions',
  'zapcooking_tx_metadata',
  'spark_lightning_address'
] as const;

/** Key prefixes removed on logout (per-wallet / per-pubkey suffixes). */
export const ACCOUNT_DATA_PREFIXES = ['zapcooking_cached_balance', 'spark_wallet_'] as const;

/**
 * Storage key of the last account that authenticated on this device.
 * Deliberately survives logout: logout itself wipes the account's data,
 * so a same-user re-login has nothing left to clear, and the record
 * must still name that user when a different one signs in next.
 */
const LAST_USER_KEY = 'nostrcooking_lastUserPubkey';

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

  notifyAccountDataReset();
}

// ── In-memory account state ─────────────────────────────────────────
//
// Wiping storage without resetting the stores that loaded it leaves the
// previous account's wallets rendered on screen. Modules register their
// reset here, so every wipe path (logout, NIP-46 disconnect, user
// change) clears memory and storage together and no caller has to know
// which stores hold account state.

type AccountDataResetHandler = () => void;
const accountDataResetHandlers: AccountDataResetHandler[] = [];

/**
 * Register a reset for in-memory, account-scoped state. Called
 * synchronously whenever account data is wiped. Returns an unsubscriber.
 */
export function onAccountDataReset(handler: AccountDataResetHandler): () => void {
  accountDataResetHandlers.push(handler);
  return () => {
    const i = accountDataResetHandlers.indexOf(handler);
    if (i > -1) accountDataResetHandlers.splice(i, 1);
  };
}

function notifyAccountDataReset(): void {
  for (const handler of accountDataResetHandlers) {
    try {
      handler();
    } catch {
      // One broken handler must not block the rest of the wipe.
    }
  }
}

/**
 * Drop the start-section cookie so `/` treats this browser as a visitor
 * again (landing page) instead of a member (start section). Only explicit
 * logout and a user change clear it: a locked passkey vault keeps the
 * cookie, so a returning member still lands in the app where they can
 * unlock.
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
 * Cached group messages, queued outgoing events and the offline recipe
 * cache (IndexedDB). Modules are imported dynamically to keep this off
 * AuthManager's static import graph.
 */
async function clearAccountDatabases(): Promise<void> {
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

/**
 * Clear all account-scoped data for a logout.
 *
 * Every step is independent and best-effort: an IndexedDB failure (locked
 * database, private mode, quota) must never prevent logout from
 * completing.
 */
export async function clearAccountData(): Promise<void> {
  if (!browser) return;

  clearAccountLocalStorage();
  clearStartSectionCookie();

  await clearAccountDatabases();
}

function rememberLastUser(pubkey: string): void {
  try {
    localStorage.setItem(LAST_USER_KEY, pubkey);
  } catch {
    // Storage disabled/full — the next sign-in just re-clears.
  }
}

/**
 * Wipe account-scoped data when `pubkey` is not the last account that
 * authenticated on this device.
 *
 * Runs synchronously through the localStorage wipe and the registered
 * in-memory resets, so it can be called the moment a session
 * authenticates — before any listener renders the new pubkey. The
 * IndexedDB part is fire-and-forget for the same reason.
 *
 * Returns true when a wipe happened.
 */
export function clearAccountDataForUserChange(pubkey: string): boolean {
  if (!browser || !pubkey) return false;

  let lastUser: string | null = null;
  let storedSession: string | null = null;
  try {
    lastUser = localStorage.getItem(LAST_USER_KEY);
    storedSession = localStorage.getItem('nostrcooking_loggedInPublicKey');
  } catch {
    // Storage unreadable — a change cannot be detected, so nothing may
    // be wiped on a guess.
    return false;
  }

  if (lastUser === pubkey) return false;

  // Upgrade path: clients that predate the record have no last-user
  // name, but the authenticating pubkey IS the stored session's own.
  // Adopt it without wiping — otherwise every existing user would lose
  // their wallets on the first load after this ships.
  if (!lastUser && storedSession === pubkey) {
    rememberLastUser(pubkey);
    return false;
  }

  clearAccountLocalStorage();
  clearStartSectionCookie();
  rememberLastUser(pubkey);
  void clearAccountDatabases();
  return true;
}
