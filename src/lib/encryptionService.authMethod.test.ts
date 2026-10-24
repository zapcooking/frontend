import { describe, it, expect, beforeEach, vi } from 'vitest';
import fixture from '../test/fixtures/vault-v1.json';
import { getPublicKey, generateSecretKey } from 'nostr-tools';
import * as nip44 from 'nostr-tools/nip44';

/**
 * encryptionService routes on authManager's authMethod, never on the
 * signer's class name. Production minification mangles constructor names
 * (NDKPrivateKeySigner ships as "e"), which made canCreateNostrBackup()
 * reject passkey sessions with the NIP-46 message and made the NIP-46
 * encrypt/decrypt branches unreachable. Every signer below is named "e".
 */

vi.mock('$app/environment', () => ({ browser: true }));

const { fakeNdk, fakeAuth, published, nip46Rpc } = vi.hoisted(() => ({
  fakeNdk: { signer: null as unknown, fetchEvents: null as unknown },
  fakeAuth: { method: null as string | null, present: true },
  published: [] as Array<{ kind: number; content: string; tags: string[][]; created_at: number }>,
  nip46Rpc: {
    nip44EncryptViaNip46: (..._args: unknown[]): Promise<string> => Promise.resolve('nip46-ct'),
    nip44DecryptViaNip46: (..._args: unknown[]): Promise<string> => Promise.resolve('nip46-pt')
  }
}));

vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return { ndk: writable(fakeNdk), ndkReady: Promise.resolve() };
});

vi.mock('$lib/authManager', () => ({
  getAuthManager: () =>
    fakeAuth.present ? { getState: () => ({ authMethod: fakeAuth.method }) } : null
}));

vi.mock('$lib/nip46Rpc', () => ({
  nip44EncryptViaNip46: vi.fn((...args: unknown[]) => nip46Rpc.nip44EncryptViaNip46(...args)),
  nip44DecryptViaNip46: vi.fn((...args: unknown[]) => nip46Rpc.nip44DecryptViaNip46(...args))
}));

// backupNwcToNostr builds its event with NDKEvent; capture it instead of
// signing/publishing so restore can read it back.
vi.mock('@nostr-dev-kit/ndk', async () => {
  const actual = (await vi.importActual(
    '@nostr-dev-kit/ndk'
  )) as typeof import('@nostr-dev-kit/ndk');
  class FakeEvent {
    kind = 0;
    content = '';
    tags: string[][] = [];
    created_at = Math.floor(Date.now() / 1000);
    async sign() {}
    async publish() {
      published.push({
        kind: this.kind,
        content: this.content,
        tags: this.tags,
        created_at: this.created_at
      });
    }
    rawEvent() {
      return { kind: this.kind, content: this.content, tags: this.tags };
    }
  }
  return { ...actual, NDKEvent: FakeEvent };
});

import {
  canCreateNostrBackup,
  getNostrBackupBlocker,
  describeNostrBackupBlocker,
  hasEncryptionSupport,
  encrypt,
  decrypt,
  clearDecryptCache
} from './encryptionService';
import { nip44EncryptViaNip46, nip44DecryptViaNip46 } from '$lib/nip46Rpc';
import { backupNwcToNostr, restoreNwcFromNostr } from './wallet/nwcBackup';
import { hexToBytes } from './passkeyVaultCrypto';

// Mangled class names, as a minified production build emits them.
function mangledLocalSigner(privateKey: string): unknown {
  const e = class e {
    constructor(public privateKey: string) {}
  };
  return new e(privateKey);
}
function mangledRemoteSigner(): unknown {
  // NDKNip46Signer shape: no privateKey getter.
  const e = class e {
    remotePubkey = 'ab'.repeat(32);
    async encrypt() {
      return 'nip04-ct';
    }
    async decrypt() {
      return 'nip04-pt';
    }
  };
  return new e();
}

const STALE_KEY = Array.from(generateSecretKey())
  .map((b) => b.toString(16).padStart(2, '0'))
  .join('');

// A real curve point: an invalid recipient makes local encryption throw and
// fall through to window.nostr, which would hide a stale-key bug.
const RECIPIENT = getPublicKey(generateSecretKey());

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear()
  };
  (globalThis as any).window = {}; // no window.nostr
  fakeNdk.signer = null;
  fakeNdk.fetchEvents = null;
  fakeAuth.method = null;
  fakeAuth.present = true;
  published.length = 0;
  clearDecryptCache();
  vi.mocked(nip44EncryptViaNip46).mockClear();
  vi.mocked(nip44DecryptViaNip46).mockClear();
});

describe('canCreateNostrBackup by auth method', () => {
  it('privateKey: allowed with a mangled-name signer holding the key', () => {
    fakeAuth.method = 'privateKey';
    fakeNdk.signer = mangledLocalSigner(fixture.nsecHex);
    expect(getNostrBackupBlocker()).toBeNull();
    expect(canCreateNostrBackup()).toBe(true);
  });

  it('privateKey: allowed from the stored key when the signer has none', () => {
    fakeAuth.method = 'privateKey';
    fakeNdk.signer = {};
    store.set('nostrcooking_privateKey', fixture.nsecHex);
    expect(canCreateNostrBackup()).toBe(true);
  });

  it('passkey: allowed with a mangled-name signer and empty localStorage', () => {
    fakeAuth.method = 'passkey';
    fakeNdk.signer = mangledLocalSigner(fixture.nsecHex);
    expect(store.size).toBe(0);
    expect(getNostrBackupBlocker()).toBeNull();
    expect(canCreateNostrBackup()).toBe(true);
  });

  it('passkey: a stale stored key does not stand in for a missing in-memory key', () => {
    fakeAuth.method = 'passkey';
    fakeNdk.signer = {};
    store.set('nostrcooking_privateKey', STALE_KEY);
    expect(getNostrBackupBlocker()).toBe('no-local-key');
  });

  it('nip07: allowed when the extension can encrypt', () => {
    fakeAuth.method = 'nip07';
    fakeNdk.signer = {};
    (globalThis as any).window = { nostr: { nip44: { encrypt: vi.fn() } } };
    expect(canCreateNostrBackup()).toBe(true);
  });

  it('nip07: blocked with an accurate reason when the extension cannot encrypt', () => {
    fakeAuth.method = 'nip07';
    fakeNdk.signer = {};
    expect(getNostrBackupBlocker()).toBe('no-extension-encryption');
  });

  it('nip46: blocked even with a stale stored key and window.nostr present', () => {
    fakeAuth.method = 'nip46';
    fakeNdk.signer = mangledRemoteSigner();
    store.set('nostrcooking_privateKey', STALE_KEY);
    (globalThis as any).window = { nostr: { nip44: { encrypt: vi.fn() } } };
    expect(getNostrBackupBlocker()).toBe('nip46');
    expect(canCreateNostrBackup()).toBe(false);
  });

  it('signed out or no auth manager: blocked', () => {
    fakeNdk.signer = mangledLocalSigner(fixture.nsecHex);
    expect(getNostrBackupBlocker()).toBe('signed-out');
    fakeAuth.present = false;
    expect(getNostrBackupBlocker()).toBe('signed-out');
  });
});

describe('describeNostrBackupBlocker', () => {
  const alt = 'Save your recovery phrase manually';

  it('mentions NIP-46 only for nip46', () => {
    expect(describeNostrBackupBlocker('nip46', alt)).toContain('remote signer (NIP-46)');
    for (const b of ['no-local-key', 'no-extension-encryption', 'signed-out'] as const) {
      const msg = describeNostrBackupBlocker(b, alt);
      expect(msg).not.toMatch(/NIP-46|remote signer/);
      expect(msg).toContain('save your recovery phrase manually');
    }
  });

  it('backupNwcToNostr surfaces the accurate reason, not the NIP-46 one', async () => {
    // Auth method not known yet, but the signer can encrypt, so the
    // encryption-support check passes and the backup gate decides.
    fakeNdk.signer = { encrypt: vi.fn() };
    const attempt = backupNwcToNostr('ab'.repeat(32), 'nostr+walletconnect://x');
    await expect(attempt).rejects.toThrow(/^Sign in to enable Nostr-relay backup/);
    await expect(attempt).rejects.not.toThrow(/NIP-46/);
  });

  it('backupNwcToNostr keeps the NIP-46 message for nip46 sessions', async () => {
    fakeAuth.method = 'nip46';
    fakeNdk.signer = mangledRemoteSigner();
    await expect(backupNwcToNostr('ab'.repeat(32), 'nostr+walletconnect://x')).rejects.toThrow(
      'Nostr-relay backup is unavailable when using a remote signer (NIP-46). Save your NWC connection string manually'
    );
  });
});

describe('encrypt/decrypt routing with mangled class names', () => {
  it('nip46: encrypt and decrypt go through the remote signer, never a stale key', async () => {
    fakeAuth.method = 'nip46';
    fakeNdk.signer = mangledRemoteSigner();
    store.set('nostrcooking_privateKey', STALE_KEY);

    expect(hasEncryptionSupport()).toBe(true);
    await expect(encrypt(RECIPIENT, 'hi')).resolves.toEqual({
      ciphertext: 'nip46-ct',
      method: 'nip44'
    });
    expect(nip44EncryptViaNip46).toHaveBeenCalledTimes(1);

    await expect(decrypt(RECIPIENT, 'some-ct', 'nip44')).resolves.toBe('nip46-pt');
    expect(nip44DecryptViaNip46).toHaveBeenCalledTimes(1);
  });

  it('nip07: encrypt uses the extension, not a stale stored key', async () => {
    fakeAuth.method = 'nip07';
    fakeNdk.signer = {};
    store.set('nostrcooking_privateKey', STALE_KEY);
    const extEncrypt = vi.fn(async () => 'ext-ct');
    (globalThis as any).window = { nostr: { nip44: { encrypt: extEncrypt } } };

    await expect(encrypt(RECIPIENT, 'hi')).resolves.toEqual({
      ciphertext: 'ext-ct',
      method: 'nip44'
    });
    expect(extEncrypt).toHaveBeenCalledWith(RECIPIENT, 'hi');
  });

  it('privateKey: encrypts locally with a mangled-name signer', async () => {
    fakeAuth.method = 'privateKey';
    fakeNdk.signer = mangledLocalSigner(fixture.nsecHex);
    const selfPubkey = getPublicKey(hexToBytes(fixture.nsecHex));
    const { ciphertext, method } = await encrypt(selfPubkey, 'nsec says hi');
    expect(method).toBe('nip44');
    await expect(decrypt(selfPubkey, ciphertext, 'nip44')).resolves.toBe('nsec says hi');
  });
});

describe('passkey session wallet backup', () => {
  it('encrypts the backup to the user’s own pubkey and restore decrypts it', async () => {
    fakeAuth.method = 'passkey';
    fakeNdk.signer = mangledLocalSigner(fixture.nsecHex);
    const selfPubkey = getPublicKey(hexToBytes(fixture.nsecHex));
    const nwc = 'nostr+walletconnect://' + 'ef'.repeat(32) + '?relay=wss://r.example&secret=s';

    await backupNwcToNostr(selfPubkey, nwc);
    expect(published).toHaveLength(1);
    const event = published[0];
    expect(event.tags).toContainEqual(['encryption', 'nip44']);
    expect(event.content).not.toContain(nwc);
    // Nothing touched localStorage — the key stays memory-only.
    expect(store.size).toBe(0);

    // Independently of the service: the ciphertext opens with the
    // self-conversation key (user sk + user pk), i.e. it was encrypted to
    // the user's own pubkey.
    const selfConversationKey = nip44.v2.utils.getConversationKey(
      hexToBytes(fixture.nsecHex),
      selfPubkey
    );
    expect(nip44.v2.decrypt(event.content, selfConversationKey)).toBe(nwc);

    // And the app's restore path reads it back.
    clearDecryptCache();
    fakeNdk.fetchEvents = vi.fn(async () => new Set([event]));
    await expect(restoreNwcFromNostr(selfPubkey)).resolves.toBe(nwc);
  });
});
