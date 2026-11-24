import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Logout must remove account-scoped data from the device, and must not
 * be derailed by a single failing store.
 */

vi.mock('$app/environment', () => ({ browser: true }));

const { groupCache, publishQueue, offlineStorage } = vi.hoisted(() => ({
  groupCache: { clearAll: vi.fn() },
  publishQueue: { clearQueue: vi.fn() },
  offlineStorage: { clearAll: vi.fn() }
}));

vi.mock('$lib/groupCacheStorage', () => ({ groupCache }));
vi.mock('$lib/publishQueue', () => ({ publishQueue }));
vi.mock('$lib/offlineStorage', () => ({ offlineStorage }));

import {
  clearAccountData,
  clearAccountDataForUserChange,
  clearAccountLocalStorage,
  clearStartSectionCookie,
  onAccountDataReset
} from './sessionCleanup';

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null
  };

  groupCache.clearAll.mockReset().mockResolvedValue(undefined);
  publishQueue.clearQueue.mockReset().mockResolvedValue(undefined);
  offlineStorage.clearAll.mockReset().mockResolvedValue(undefined);

  cookieWrites = [];
  vi.stubGlobal('document', {
    set cookie(v: string) {
      cookieWrites.push(v);
    },
    get cookie() {
      return '';
    }
  });
});

let cookieWrites: string[] = [];

/** True when a write expires the start-section cookie (Max-Age=0, site-wide). */
function expiresStartSectionCookie(write: string): boolean {
  return (
    write.startsWith('zapcooking_start_section=;') &&
    write.includes('Max-Age=0') &&
    write.includes('Path=/')
  );
}

function seedAccountData() {
  store.set('zapcooking_wallets', '[{"id":1}]');
  store.set('zapcooking_webln_wallet_name', 'Alby');
  store.set('zapcooking_pending_transactions', '[]');
  store.set('zapcooking_tx_metadata', '{}');
  store.set('zapcooking_cached_balance_1', '5000');
  store.set('zapcooking_cached_balance_2', '9000');
  store.set('spark_wallet_aaaa', 'ciphertext-a');
  store.set('spark_wallet_bbbb', 'ciphertext-b');
  store.set('spark_lightning_address', 'old@zap.cooking');
  // Must survive: the vault is removed by an explicit settings action.
  store.set('nostrcooking_vault_v1', 'vault-record');
  store.set('unrelated_key', 'keep-me');
}

describe('clearAccountLocalStorage', () => {
  it('removes wallet, balance, transaction and Spark keys', () => {
    seedAccountData();

    clearAccountLocalStorage();

    expect(store.has('zapcooking_wallets')).toBe(false);
    expect(store.has('zapcooking_webln_wallet_name')).toBe(false);
    expect(store.has('zapcooking_pending_transactions')).toBe(false);
    expect(store.has('zapcooking_tx_metadata')).toBe(false);
    expect(store.has('zapcooking_cached_balance_1')).toBe(false);
    expect(store.has('zapcooking_cached_balance_2')).toBe(false);
    expect(store.has('spark_wallet_aaaa')).toBe(false);
    expect(store.has('spark_wallet_bbbb')).toBe(false);
    expect(store.has('spark_lightning_address')).toBe(false);
  });

  it('leaves the passkey vault record and unrelated keys alone', () => {
    seedAccountData();

    clearAccountLocalStorage();

    expect(store.get('nostrcooking_vault_v1')).toBe('vault-record');
    expect(store.get('unrelated_key')).toBe('keep-me');
  });

  it('removes every prefixed key even with many present', () => {
    for (let i = 0; i < 10; i++) store.set(`zapcooking_cached_balance_${i}`, String(i));

    clearAccountLocalStorage();

    // Guards against index-shifting while iterating localStorage.
    expect([...store.keys()]).toEqual([]);
  });
});

describe('clearAccountData', () => {
  it('clears localStorage and all three databases', async () => {
    seedAccountData();

    await clearAccountData();

    expect(store.has('zapcooking_wallets')).toBe(false);
    expect(groupCache.clearAll).toHaveBeenCalledTimes(1);
    expect(publishQueue.clearQueue).toHaveBeenCalledTimes(1);
    expect(offlineStorage.clearAll).toHaveBeenCalledTimes(1);
  });

  it('clears the start-section cookie so / treats the browser as a visitor', async () => {
    await clearAccountData();

    expect(cookieWrites.some(expiresStartSectionCookie)).toBe(true);
  });

  it('still clears the rest when one database fails', async () => {
    seedAccountData();
    publishQueue.clearQueue.mockRejectedValue(new Error('db locked'));

    // Logout must never be blocked by a storage failure.
    await expect(clearAccountData()).resolves.toBeUndefined();

    expect(store.has('spark_wallet_aaaa')).toBe(false);
    expect(groupCache.clearAll).toHaveBeenCalledTimes(1);
    expect(offlineStorage.clearAll).toHaveBeenCalledTimes(1);
  });
});

describe('clearStartSectionCookie', () => {
  it('expires the cookie on the root path', () => {
    clearStartSectionCookie();

    expect(cookieWrites).toHaveLength(1);
    expect(expiresStartSectionCookie(cookieWrites[0])).toBe(true);
  });
});

describe('onAccountDataReset', () => {
  it('runs registered handlers when account data is wiped', () => {
    const reset = vi.fn();
    const unsubscribe = onAccountDataReset(reset);

    clearAccountLocalStorage();

    expect(reset).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('keeps going when a handler throws', () => {
    const first = vi.fn(() => {
      throw new Error('store stuck');
    });
    const second = vi.fn();
    onAccountDataReset(first);
    onAccountDataReset(second);

    expect(() => clearAccountLocalStorage()).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops calling a handler after unsubscribe', () => {
    const reset = vi.fn();
    const unsubscribe = onAccountDataReset(reset);
    unsubscribe();

    clearAccountLocalStorage();

    expect(reset).not.toHaveBeenCalled();
  });
});

describe('clearAccountDataForUserChange', () => {
  const OLD = 'a'.repeat(64);
  const NEW = 'b'.repeat(64);

  /** Let the fire-and-forget IndexedDB clears run. */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('wipes account data when a different pubkey authenticates', async () => {
    seedAccountData();

    expect(clearAccountDataForUserChange(NEW)).toBe(true);

    expect(store.has('zapcooking_wallets')).toBe(false);
    expect(store.has('spark_wallet_aaaa')).toBe(false);
    expect(store.has('spark_lightning_address')).toBe(false);
    expect(store.get('nostrcooking_lastUserPubkey')).toBe(NEW);
    // The wipe is the same one logout runs — databases included.
    await flush();
    expect(groupCache.clearAll).toHaveBeenCalledTimes(1);
    expect(publishQueue.clearQueue).toHaveBeenCalledTimes(1);
    expect(offlineStorage.clearAll).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the same pubkey re-authenticates', () => {
    seedAccountData();
    store.set('nostrcooking_lastUserPubkey', OLD);

    expect(clearAccountDataForUserChange(OLD)).toBe(false);

    expect(store.get('zapcooking_wallets')).toBe('[{"id":1}]');
    expect(groupCache.clearAll).not.toHaveBeenCalled();
  });

  it('adopts the stored session without wiping when no record exists', () => {
    // Upgrade path: every client that predates the record has account
    // data and a stored session but no last-user name. The first auth
    // after the update IS that same user — wiping here would destroy
    // their wallets on a routine page load.
    seedAccountData();
    store.set('nostrcooking_loggedInPublicKey', OLD);

    expect(clearAccountDataForUserChange(OLD)).toBe(false);

    expect(store.get('zapcooking_wallets')).toBe('[{"id":1}]');
    expect(store.get('spark_wallet_aaaa')).toBe('ciphertext-a');
    expect(store.get('nostrcooking_lastUserPubkey')).toBe(OLD);
  });

  it('wipes on the very first sign-in (no record, no stored session)', async () => {
    seedAccountData();

    expect(clearAccountDataForUserChange(NEW)).toBe(true);

    expect(store.has('zapcooking_wallets')).toBe(false);
    await flush();
    expect(groupCache.clearAll).toHaveBeenCalledTimes(1);
  });

  it('never fires without a pubkey', () => {
    seedAccountData();

    expect(clearAccountDataForUserChange('')).toBe(false);
    expect(store.has('zapcooking_wallets')).toBe(true);
  });

  it('the last-user record survives logout', async () => {
    store.set('nostrcooking_lastUserPubkey', OLD);
    seedAccountData();

    await clearAccountData();

    // Same-user re-login must not re-clear, and a different user signing
    // in next must still be detectable.
    expect(store.get('nostrcooking_lastUserPubkey')).toBe(OLD);
    expect(clearAccountDataForUserChange(OLD)).toBe(false);
    expect(clearAccountDataForUserChange(NEW)).toBe(true);
  });
});
