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

import { clearAccountData, clearAccountLocalStorage } from './sessionCleanup';

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
});

function seedAccountData() {
  store.set('zapcooking_wallets', '[{"id":1}]');
  store.set('zapcooking_webln_wallet_name', 'Alby');
  store.set('zapcooking_pending_transactions', '[]');
  store.set('zapcooking_tx_metadata', '{}');
  store.set('zapcooking_cached_balance_1', '5000');
  store.set('zapcooking_cached_balance_2', '9000');
  store.set('spark_wallet_aaaa', 'ciphertext-a');
  store.set('spark_wallet_bbbb', 'ciphertext-b');
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
