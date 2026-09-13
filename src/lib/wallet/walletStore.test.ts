import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get, type Writable } from 'svelte/store';

/**
 * NWC at-rest encryption in walletStore.
 *
 * kind-3 `data` values that are `nostr+walletconnect://…` connection
 * strings must be persisted as `{enc, method}` NIP-44 envelopes, never
 * plaintext. Everything else (webln/spark markers) stays plaintext.
 * Envelope entries that can't be decrypted yet (no signer) are held in
 * `pendingEncrypted` and must survive every storage write.
 */

vi.mock('$app/environment', () => ({ browser: true }));

const { fakeNdk, fakePubkey, encryption } = vi.hoisted(() => ({
  fakeNdk: { signer: null as unknown },
  fakePubkey: 'a'.repeat(64),
  encryption: {
    encrypt: vi.fn(),
    decrypt: vi.fn(),
    canCreateNostrBackup: vi.fn()
  }
}));

vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return {
    ndk: writable(fakeNdk),
    userPublickey: writable('')
  };
});

vi.mock('$lib/encryptionService', () => encryption);

const NWC_URL = 'nostr+walletconnect://64bexample?secret=sekrit&relay=wss%3A%2F%2Frelay.com';

type WalletStoreModule = typeof import('./walletStore');

let mod: WalletStoreModule;
let userPubkeyStore: Writable<string>;
let store: Map<string, string>;

function readStored(): any[] {
  const raw = store.get('zapcooking_wallets');
  return raw ? JSON.parse(raw) : [];
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();

  store = new Map();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear()
  };

  encryption.encrypt.mockReset();
  encryption.decrypt.mockReset();
  encryption.canCreateNostrBackup.mockReset();
  encryption.encrypt.mockResolvedValue({ ciphertext: 'ENVELOPE-CIPHERTEXT', method: 'nip44v2' });
  encryption.decrypt.mockResolvedValue(NWC_URL);
  encryption.canCreateNostrBackup.mockReturnValue(true);

  mod = await import('./walletStore');
  const nostr = await import('$lib/nostr');
  userPubkeyStore = nostr.userPublickey;
  fakeNdk.signer = null;
  userPubkeyStore.set('');
});

describe('at-rest encryption of NWC connection strings', () => {
  it('persists kind-3 NWC data as an envelope and leaves other kinds plaintext', async () => {
    // Legacy plaintext seed: one NWC wallet, one webln marker
    store.set(
      'zapcooking_wallets',
      JSON.stringify([
        { id: 1, kind: 3, name: 'Alby', active: true, data: NWC_URL },
        { id: 2, kind: 1, name: 'WebLN', active: false, data: 'webln' }
      ])
    );

    await vi.advanceTimersByTimeAsync(10); // module init load

    const stored = readStored();
    const nwc = stored.find((w) => w.id === 1);
    const webln = stored.find((w) => w.id === 2);
    expect(nwc.data).toEqual({ enc: 'ENVELOPE-CIPHERTEXT', method: 'nip44v2' });
    expect(nwc.data.enc).not.toContain(NWC_URL);
    expect(webln.data).toBe('webln');
    expect(get(mod.wallets).length).toBe(2);
  });

  it('keeps plaintext when the signer cannot encrypt (accepted fallback)', async () => {
    encryption.canCreateNostrBackup.mockReturnValue(false);
    store.set(
      'zapcooking_wallets',
      JSON.stringify([{ id: 1, kind: 3, name: 'Alby', active: true, data: NWC_URL }])
    );

    await vi.advanceTimersByTimeAsync(10);

    const stored = readStored();
    expect(stored[0].data).toBe(NWC_URL); // NIP-46 sessions can't wrap
    expect(encryption.encrypt).not.toHaveBeenCalled();
  });

  it('reuses the prior envelope instead of dropping to plaintext when re-encrypt fails', async () => {
    store.set(
      'zapcooking_wallets',
      JSON.stringify([
        {
          id: 1,
          kind: 3,
          name: 'Alby',
          active: true,
          data: { enc: 'PRIOR', method: 'nip44v2' }
        }
      ])
    );

    await vi.advanceTimersByTimeAsync(10); // load registers the envelope

    // Signer becomes available but refuses to encrypt; the wallet update
    // triggers a re-save.
    userPubkeyStore.set(fakePubkey);
    fakeNdk.signer = {};
    encryption.encrypt.mockRejectedValue(new Error('denied'));
    mod.updateWalletName(1, 'Alby 2');

    await vi.advanceTimersByTimeAsync(10);

    const stored = readStored();
    expect(stored[0].data).toEqual({ enc: 'PRIOR', method: 'nip44v2' });
  });
});

describe('deferred envelope decryption', () => {
  it('holds back envelope entries, decrypts them once a signer exists, preserves them until then', async () => {
    store.set(
      'zapcooking_wallets',
      JSON.stringify([
        { id: 1, kind: 3, name: 'Alby', active: true, data: { enc: 'CIPHER', method: 'nip44v2' } },
        { id: 2, kind: 1, name: 'WebLN', active: false, data: 'webln' }
      ])
    );

    await vi.advanceTimersByTimeAsync(10); // load: no signer yet

    // Only the plaintext wallet is in memory
    expect(get(mod.wallets).map((w) => w.id)).toEqual([2]);

    // Any write while undecrypted must keep the envelope in storage
    mod.updateWalletName(2, 'WebLN 2');
    await vi.advanceTimersByTimeAsync(10);
    expect(readStored().some((w) => w.id === 1 && w.data.enc === 'CIPHER')).toBe(true);

    // Signer arrives → interval decrypts and merges
    userPubkeyStore.set(fakePubkey);
    fakeNdk.signer = {};
    await vi.advanceTimersByTimeAsync(5100);

    expect(encryption.decrypt).toHaveBeenCalledWith(fakePubkey, 'CIPHER', 'nip44v2');
    const merged = get(mod.wallets).find((w) => w.id === 1);
    expect(merged?.data).toBe(NWC_URL);
    expect(get(mod.walletsDecrypted)).toBeGreaterThan(0);
  });

  it('keeps failed envelopes pending instead of dropping them', async () => {
    store.set(
      'zapcooking_wallets',
      JSON.stringify([
        { id: 1, kind: 3, name: 'Alby', active: true, data: { enc: 'CIPHER', method: 'nip44v2' } }
      ])
    );

    await vi.advanceTimersByTimeAsync(10);
    userPubkeyStore.set(fakePubkey);
    fakeNdk.signer = {};
    encryption.decrypt.mockRejectedValue(new Error('locked'));

    await vi.advanceTimersByTimeAsync(5100);

    expect(get(mod.wallets).length).toBe(0); // still not decrypted
    expect(readStored()[0].data.enc).toBe('CIPHER'); // still persisted
  });
});

describe('clearAllWallets', () => {
  it('drops still-encrypted entries from storage', async () => {
    store.set(
      'zapcooking_wallets',
      JSON.stringify([
        { id: 1, kind: 3, name: 'Alby', active: true, data: { enc: 'CIPHER', method: 'nip44v2' } }
      ])
    );

    await vi.advanceTimersByTimeAsync(10);
    mod.clearAllWallets();
    await vi.advanceTimersByTimeAsync(10);

    expect(readStored()).toEqual([]);
  });
});
