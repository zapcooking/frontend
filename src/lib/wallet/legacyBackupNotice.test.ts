import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { getPublicKey } from 'nostr-tools';
import * as nip44 from 'nostr-tools/nip44';

/**
 * One-time "save your recovery phrase" notice (#897): queued only when the
 * legacy decrypt fallback opened a Spark backup in a NIP-46 session (which
 * can't republish it), and shown once per wallet. Real encryptionService.
 */

vi.mock('$app/environment', () => ({ browser: true }));

const { fakeAuth } = vi.hoisted(() => ({ fakeAuth: { method: null as string | null } }));

vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return { ndk: writable({ signer: { remotePubkey: 'ab'.repeat(32) } }) };
});
vi.mock('$lib/authManager', () => ({
  getAuthManager: () => ({ getState: () => ({ authMethod: fakeAuth.method }) })
}));
vi.mock('$lib/nip46Rpc', () => ({
  nip44EncryptViaNip46: vi.fn(async () => 'bunker-ct'),
  nip44DecryptViaNip46: vi.fn(async () => {
    throw new Error('bunker: bad MAC');
  })
}));

const bytes = (hex: string) => Uint8Array.from(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
const convKey = (skHex: string, pubkey: string) =>
  nip44.v2.utils.getConversationKey(bytes(skHex), pubkey);

const USER_PK = getPublicKey(bytes('44'.repeat(32)));
const EXT_SK = '66'.repeat(32);
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const WALLET = 'wallet-1';

type Mod = typeof import('./legacyBackupNotice');
type Enc = typeof import('$lib/encryptionService');
let mod: Mod;
let enc: Enc;
let store: Map<string, string>;

beforeEach(async () => {
  store = new Map();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear()
  };
  (globalThis as any).window = {
    nostr: {
      nip44: {
        decrypt: async (pk: string, ct: string) => nip44.v2.decrypt(ct, convKey(EXT_SK, pk))
      }
    }
  };
  fakeAuth.method = 'nip46';
  vi.resetModules();
  mod = await import('./legacyBackupNotice');
  enc = await import('$lib/encryptionService');
});

describe('legacy backup notice', () => {
  it('queues the notice when the fallback opens a NIP-46 Spark backup, and shows it once', async () => {
    // Backup encrypted by the user's extension before #896.
    const content = nip44.v2.encrypt(MNEMONIC, convKey(EXT_SK, USER_PK));
    const { plaintext, source } = await enc.decryptWithSource(USER_PK, content, 'nip44');
    expect(plaintext).toBe(MNEMONIC);
    expect(source).toBe('legacy-extension');

    const republish = vi.fn(async () => {});
    await mod.settleLegacySparkBackup(WALLET, source, republish);
    expect(republish).not.toHaveBeenCalled(); // NIP-46 can't create backups
    expect(get(mod.legacyBackupNoticePending)).toEqual([WALLET]);

    const wallets = [
      { kind: 3, data: 'nostr+walletconnect://x' },
      { kind: 4, data: WALLET }
    ];
    expect(mod.claimLegacyBackupNotice(get(mod.legacyBackupNoticePending), wallets)).toBe(WALLET);
    expect(mod.claimLegacyBackupNotice(get(mod.legacyBackupNoticePending), wallets)).toBeNull();

    // Opening the same backup again later never re-queues it.
    await mod.settleLegacySparkBackup(WALLET, source, republish);
    expect(get(mod.legacyBackupNoticePending)).toEqual([]);
  });

  it('survives a reload until shown (login auto-restore with the panel closed)', async () => {
    await mod.settleLegacySparkBackup(WALLET, 'legacy-stored-key', async () => {});
    vi.resetModules();
    const reloaded = await import('./legacyBackupNotice');
    expect(get(reloaded.legacyBackupNoticePending)).toEqual([WALLET]);
    expect(reloaded.claimLegacyBackupNotice([WALLET], [{ kind: 4, data: WALLET }])).toBe(WALLET);
  });

  it('waits until that Spark wallet is actually in the wallet list', async () => {
    await mod.settleLegacySparkBackup(WALLET, 'legacy-extension', async () => {});
    expect(mod.claimLegacyBackupNotice([WALLET], [{ kind: 4, data: 'other' }])).toBeNull();
    expect(get(mod.legacyBackupNoticePending)).toEqual([WALLET]);
  });

  it('is not queued for a backup that opened with the session key', async () => {
    const republish = vi.fn(async () => {});
    await mod.settleLegacySparkBackup(WALLET, 'session', republish);
    expect(republish).not.toHaveBeenCalled();
    expect(get(mod.legacyBackupNoticePending)).toEqual([]);
  });

  it('is not queued when the session can migrate the backup (NIP-07): it republishes instead', async () => {
    fakeAuth.method = 'nip07';
    const republish = vi.fn(async () => {});
    await mod.settleLegacySparkBackup(WALLET, 'legacy-stored-key', republish);
    expect(republish).toHaveBeenCalledTimes(1);
    expect(get(mod.legacyBackupNoticePending)).toEqual([]);
  });
});
