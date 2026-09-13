import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Login auto-restore: the last-used wallet is remembered per pubkey and
 * put back from the user's Nostr backups after logout wiped the device.
 * Restore only runs on an empty device with a record for the user, once
 * per session, and the NWC backup must fingerprint-match the remembered
 * connection (the relay slot is a single replaceable event).
 */

vi.mock('$app/environment', () => ({ browser: true }));

const mocks = vi.hoisted(() => ({
  fakePubkey: 'a'.repeat(64),
  walletsItems: [] as unknown[],
  hasPersistedWallets: vi.fn(() => false),
  connectWallet: vi.fn(),
  restoreNwcFromNostr: vi.fn(),
  listSparkBackups: vi.fn(),
  restoreSparkBackup: vi.fn()
}));

vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return {
    ndk: writable({}),
    ndkReady: Promise.resolve(),
    userPublickey: writable(mocks.fakePubkey)
  };
});

vi.mock('./walletStore', async () => {
  const { writable } = await import('svelte/store');
  const fingerprintWalletData = (data: string): string => {
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) {
      h ^= data.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  };
  return {
    wallets: writable(mocks.walletsItems),
    hasPersistedWallets: mocks.hasPersistedWallets,
    fingerprintWalletData
  };
});

vi.mock('./walletManager', () => ({ connectWallet: mocks.connectWallet }));
vi.mock('./nwcBackup', () => ({ restoreNwcFromNostr: mocks.restoreNwcFromNostr }));
vi.mock('$lib/spark', () => ({
  listSparkBackups: mocks.listSparkBackups,
  restoreSparkBackup: mocks.restoreSparkBackup,
  getSparkWalletId: (mnemonic: string) => `id(${mnemonic})`
}));

const NWC_URL = 'nostr+walletconnect://64bexample?secret=sekrit&relay=wss%3A%2F%2Frelay.com';

type AutoRestoreModule = typeof import('./autoRestore');

let mod: AutoRestoreModule;
let store: Map<string, string>;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('VITE_BREEZ_API_KEY', 'test-key');
  mocks.hasPersistedWallets.mockReturnValue(false);
  mocks.walletsItems.length = 0;

  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear()
  });

  mod = await import('./autoRestore');
});

describe('last-wallet record', () => {
  it('remembers and returns the active NWC wallet by fingerprint', () => {
    mod.rememberActiveWallet({ kind: 3, data: NWC_URL });

    const record = mod.getLastWalletRecord(mocks.fakePubkey);
    expect(record).not.toBeNull();
    expect(record!.kind).toBe(3);
    // The raw connection string must never land in the stored record.
    expect(store.get(`zapcooking_last_wallet_${mocks.fakePubkey}`)).not.toContain('secret');
  });

  it('remembers a Spark wallet by its wallet id verbatim', () => {
    mod.rememberActiveWallet({ kind: 4, data: 'abcd0123abcd0123' });

    const record = mod.getLastWalletRecord(mocks.fakePubkey);
    expect(record).not.toBeNull();
    expect(record!.kind).toBe(4);
    expect(record!.id).toBe('abcd0123abcd0123');
    expect(typeof record!.at).toBe('number');
  });

  it('ignores non-wallet kinds and missing data', () => {
    mod.rememberActiveWallet({ kind: 1, data: 'webln' });
    mod.rememberActiveWallet({ kind: 3, data: '' });
    expect(mod.getLastWalletRecord(mocks.fakePubkey)).toBeNull();
  });

  it('returns null for a corrupt record', () => {
    store.set(`zapcooking_last_wallet_${mocks.fakePubkey}`, '{not json');
    expect(mod.getLastWalletRecord(mocks.fakePubkey)).toBeNull();
  });
});

describe('autoRestoreWalletAtLogin', () => {
  it('does nothing without a record for the user', async () => {
    await expect(mod.autoRestoreWalletAtLogin(mocks.fakePubkey)).resolves.toBe(false);
    expect(mocks.restoreNwcFromNostr).not.toHaveBeenCalled();
    expect(mocks.listSparkBackups).not.toHaveBeenCalled();
  });

  it('skips when the device still has wallets in the store', async () => {
    mod.rememberActiveWallet({ kind: 3, data: NWC_URL });
    mocks.walletsItems.push({ id: 1 });
    await expect(mod.autoRestoreWalletAtLogin(mocks.fakePubkey)).resolves.toBe(false);
    expect(mocks.restoreNwcFromNostr).not.toHaveBeenCalled();
  });

  it('skips when wallets are persisted but not yet decrypted', async () => {
    mod.rememberActiveWallet({ kind: 3, data: NWC_URL });
    mocks.hasPersistedWallets.mockReturnValue(true);
    await expect(mod.autoRestoreWalletAtLogin(mocks.fakePubkey)).resolves.toBe(false);
    expect(mocks.restoreNwcFromNostr).not.toHaveBeenCalled();
  });

  it('restores the remembered NWC connection when the backup matches', async () => {
    mod.rememberActiveWallet({ kind: 3, data: NWC_URL });
    mocks.restoreNwcFromNostr.mockResolvedValue(NWC_URL);
    mocks.connectWallet.mockResolvedValue({ success: true });

    await expect(mod.autoRestoreWalletAtLogin(mocks.fakePubkey)).resolves.toBe(true);
    expect(mocks.connectWallet).toHaveBeenCalledWith(3, NWC_URL);
  });

  it('refuses an NWC backup that is a different connection', async () => {
    mod.rememberActiveWallet({ kind: 3, data: NWC_URL });
    mocks.restoreNwcFromNostr.mockResolvedValue(
      'nostr+walletconnect://otherkey?secret=other&relay=wss%3A%2F%2Frelay.com'
    );

    await expect(mod.autoRestoreWalletAtLogin(mocks.fakePubkey)).resolves.toBe(false);
    expect(mocks.connectWallet).not.toHaveBeenCalled();
  });

  it('restores the remembered Spark wallet from its per-wallet backup', async () => {
    mod.rememberActiveWallet({ kind: 4, data: 'abcd0123abcd0123' });
    mocks.listSparkBackups.mockResolvedValue([
      { walletId: 'ffffffffffffffff', createdAt: 20 },
      { walletId: 'abcd0123abcd0123', createdAt: 10 }
    ]);
    mocks.restoreSparkBackup.mockResolvedValue('test mnemonic');
    mocks.connectWallet.mockResolvedValue({ success: true });

    await expect(mod.autoRestoreWalletAtLogin(mocks.fakePubkey)).resolves.toBe(true);
    expect(mocks.restoreSparkBackup).toHaveBeenCalledTimes(1);
    const [calledPubkey, calledApiKey, calledBackup] = mocks.restoreSparkBackup.mock.calls[0];
    expect(calledPubkey).toBe(mocks.fakePubkey);
    expect(calledApiKey).toBe('test-key');
    expect(calledBackup.walletId).toBe('abcd0123abcd0123');
    expect(mocks.connectWallet).toHaveBeenCalledWith(4, 'id(test mnemonic)');
  });

  it('falls back to the newest Spark backup when the remembered one is gone', async () => {
    mod.rememberActiveWallet({ kind: 4, data: 'deleted00000000' });
    mocks.listSparkBackups.mockResolvedValue([{ walletId: 'ffffffffffffffff', createdAt: 20 }]);
    mocks.restoreSparkBackup.mockResolvedValue('test mnemonic');
    mocks.connectWallet.mockResolvedValue({ success: true });

    await expect(mod.autoRestoreWalletAtLogin(mocks.fakePubkey)).resolves.toBe(true);
    expect(mocks.restoreSparkBackup).toHaveBeenCalledTimes(1);
    const calledBackup = mocks.restoreSparkBackup.mock.calls[0][2];
    expect(calledBackup.walletId).toBe('ffffffffffffffff');
  });

  it('attempts only once per pubkey per session', async () => {
    mod.rememberActiveWallet({ kind: 3, data: NWC_URL });
    mocks.restoreNwcFromNostr.mockResolvedValue(NWC_URL);
    mocks.connectWallet.mockResolvedValue({ success: true });

    await mod.autoRestoreWalletAtLogin(mocks.fakePubkey);
    const calls = mocks.connectWallet.mock.calls.length;

    await expect(mod.autoRestoreWalletAtLogin(mocks.fakePubkey)).resolves.toBe(false);
    expect(mocks.connectWallet.mock.calls.length).toBe(calls);
  });

  it('reports failure when the restore throws (signer denied)', async () => {
    mod.rememberActiveWallet({ kind: 3, data: NWC_URL });
    mocks.restoreNwcFromNostr.mockRejectedValue(new Error('denied'));

    await expect(mod.autoRestoreWalletAtLogin(mocks.fakePubkey)).resolves.toBe(false);
  });
});
