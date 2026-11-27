import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

/**
 * Cold-reload reproduction: the Nostr extension (e.g. Sidecar) switched
 * accounts while the app was closed. The page reloads, walletStore's
 * deferred init loads the one GLOBAL wallet key — still holding the
 * previous account's wallets — and only then does session restore
 * authenticate the NEW pubkey, firing the account wipe.
 *
 * The wipe must reset the in-memory store in the same beat, or the panel
 * keeps rendering the previous account's wallet: a lightning address that
 * is no longer theirs and a balance that can never sync, because the
 * Spark mnemonic and NWC envelopes are encrypted per pubkey. These tests
 * run the real ordering — load first, wipe second — against the real
 * sessionCleanup; on the old code the store keeps the previous
 * account's wallets.
 */

vi.mock('$app/environment', () => ({ browser: true }));

const { fakeNdk, userPubkey } = vi.hoisted(() => ({
  fakeNdk: { signer: null as unknown },
  userPubkey: { value: '' }
}));

vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return {
    ndk: writable(fakeNdk),
    ndkReady: Promise.resolve(),
    userPublickey: writable(userPubkey.value)
  };
});

// A decrypt that stays in flight until a test releases it, so the wipe
// can land while an envelope decrypt is mid-flight.
const { decryptDeferred } = vi.hoisted(() => {
  let resolve!: (v: { plaintext: string; source: string }) => void;
  const promise = new Promise<{ plaintext: string; source: string }>((r) => (resolve = r));
  return { decryptDeferred: { promise, resolve } };
});

vi.mock('$lib/encryptionService', () => ({
  decryptWithSource: vi.fn(() => decryptDeferred.promise),
  encrypt: vi.fn(async () => ({ ciphertext: 'ciphertext', method: 'nip44' })),
  canCreateNostrBackup: vi.fn(() => false),
  getNostrBackupBlocker: vi.fn(() => null),
  noteLegacyMigration: vi.fn()
}));

// The wipe's IndexedDB step: stubbed like sessionCleanup.test.ts so this
// suite stays a wallet-store unit test (their timers would outlive it).
const { groupCache, publishQueue, offlineStorage } = vi.hoisted(() => ({
  groupCache: { clearAll: vi.fn() },
  publishQueue: { clearQueue: vi.fn() },
  offlineStorage: { clearAll: vi.fn() }
}));
vi.mock('$lib/groupCacheStorage', () => ({ groupCache }));
vi.mock('$lib/publishQueue', () => ({ publishQueue }));
vi.mock('$lib/offlineStorage', () => ({ offlineStorage }));

const OLD = 'a'.repeat(64);
const NEW = 'b'.repeat(64);
const NWC_URL =
  'nostr+walletconnect://' + 'ef'.repeat(32) + '?relay=wss://r.example&secret=s';

let store: Map<string, string>;

beforeEach(() => {
  vi.resetModules();
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
  (globalThis as any).window = {};
  fakeNdk.signer = null;
  userPubkey.value = '';
});

afterEach(() => {
  vi.useRealTimers();
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

/** The device state a reload sees after the extension switched accounts. */
function seedSwitchedAccount() {
  // Stale: written by the PREVIOUS account's session, restored on load.
  userPubkey.value = OLD;
  store.set('nostrcooking_loggedInPublicKey', OLD);
  store.set('zapcooking_wallets', JSON.stringify([
    { id: 1, kind: 4, name: 'Self-custodial', active: true, data: 'spark' },
    { id: 2, kind: 3, name: 'NWC', active: false, data: { enc: 'envelope', method: 'nip44' } }
  ]));
  store.set('zapcooking_cached_balance_1', '21000');
  store.set('spark_lightning_address', 'old@zap.cooking');
}

describe('wallet state on a user change', () => {
  it('drops the previous account\'s wallets when the new pubkey authenticates', async () => {
    seedSwitchedAccount();

    const storeMod = await import('./walletStore');
    const cleanup = await import('$lib/sessionCleanup');

    // The deferred load runs before session restore can complete: the
    // previous account's wallet is on screen with its cached balance.
    await tick();
    expect(get(storeMod.wallets)).toHaveLength(1);
    expect(get(storeMod.walletBalance)).toBe(21000);
    expect(get(storeMod.walletSetupCheckPending)).toBe(true);

    // The new pubkey authenticates — the call AuthManager.updateState makes.
    expect(cleanup.clearAccountDataForUserChange(NEW)).toBe(true);

    expect(get(storeMod.wallets)).toEqual([]);
    expect(get(storeMod.walletBalance)).toBeNull();
    expect(get(storeMod.walletSetupCheckPending)).toBe(false);
    // Storage itself is wiped, so the next load cannot resurrect them.
    expect(storeMod.hasPersistedWallets()).toBe(false);
    expect(store.has('spark_lightning_address')).toBe(false);
    expect(store.get('nostrcooking_lastUserPubkey')).toBe(NEW);
  });

  it('keeps the stored session\'s own wallets when no record exists yet', async () => {
    seedSwitchedAccount();
    // Client predates the last-user record: the reload restores the SAME
    // account it has on file. Nothing may be wiped.
    store.delete('spark_lightning_address');

    const storeMod = await import('./walletStore');
    const cleanup = await import('$lib/sessionCleanup');

    await tick();
    expect(get(storeMod.wallets)).toHaveLength(1);

    expect(cleanup.clearAccountDataForUserChange(OLD)).toBe(false);

    expect(get(storeMod.wallets)).toHaveLength(1);
    expect(storeMod.hasPersistedWallets()).toBe(true);
    expect(store.get('nostrcooking_lastUserPubkey')).toBe(OLD);
  });

  it('an in-flight envelope decrypt cannot resurrect the wiped wallets', async () => {
    vi.useFakeTimers();
    seedSwitchedAccount();
    // A signer and pubkey make the decrypt poll fire for the envelopes.
    fakeNdk.signer = { ready: true };

    const storeMod = await import('./walletStore');
    const cleanup = await import('$lib/sessionCleanup');

    vi.advanceTimersByTime(0); // deferred load holds the envelope back
    vi.advanceTimersByTime(5000); // decrypt poll picks it up, decrypt hangs

    // The account switch lands while the decrypt is in flight.
    expect(cleanup.clearAccountDataForUserChange(NEW)).toBe(true);
    expect(get(storeMod.wallets)).toEqual([]);

    // The OLD account's envelope finally decrypts — too late.
    decryptDeferred.resolve({ plaintext: NWC_URL, source: 'nip44' });
    await vi.advanceTimersByTimeAsync(0);

    expect(get(storeMod.wallets)).toEqual([]);
    expect(storeMod.hasPersistedWallets()).toBe(false);
  });
});
