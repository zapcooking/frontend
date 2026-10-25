import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getPublicKey } from 'nostr-tools';
import * as nip44 from 'nostr-tools/nip44';

/**
 * Legacy decrypt fallback (#897). Before #896, production builds encrypted
 * some NIP-07/NIP-46 users' data with a leftover stored nsec or (NIP-46)
 * the browser extension. Those sources may now be used to DECRYPT only;
 * the user's own data is then re-encrypted under the session key through
 * the normal guarded paths, and nothing new is ever encrypted with them.
 */

vi.mock('$app/environment', () => ({ browser: true }));

const { fakeNdk, fakeAuth, published, bunker } = vi.hoisted(() => ({
  fakeNdk: { signer: null as unknown, fetchEvents: null as unknown },
  fakeAuth: { method: null as string | null },
  published: [] as Array<{ kind: number; content: string; tags: string[][]; created_at: number }>,
  bunker: {
    encrypt: (..._args: unknown[]): Promise<string> => Promise.resolve('bunker-ct'),
    decrypt: (..._args: unknown[]): Promise<string> => Promise.reject(new Error('bunker: bad MAC'))
  }
}));

vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return { ndk: writable(fakeNdk), ndkReady: Promise.resolve() };
});

vi.mock('$lib/authManager', () => ({
  getAuthManager: () => ({ getState: () => ({ authMethod: fakeAuth.method }) })
}));

vi.mock('$lib/nip46Rpc', () => ({
  nip44EncryptViaNip46: vi.fn((...args: unknown[]) => bunker.encrypt(...args)),
  nip44DecryptViaNip46: vi.fn((...args: unknown[]) => bunker.decrypt(...args))
}));

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

import { encrypt, decrypt, decryptWithSource, clearDecryptCache } from './encryptionService';
import { nip44EncryptViaNip46 } from '$lib/nip46Rpc';
import { restoreNwcFromNostr } from './wallet/nwcBackup';
import { loadMnemonic, saveMnemonic } from './spark/storage';

const bytes = (hex: string) => Uint8Array.from(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
const convKey = (skHex: string, pubkey: string) =>
  nip44.v2.utils.getConversationKey(bytes(skHex), pubkey);
const canOpen = (ct: string, skHex: string, pubkey: string) => {
  try {
    nip44.v2.decrypt(ct, convKey(skHex, pubkey));
    return true;
  } catch {
    return false;
  }
};

const USER_SK = '44'.repeat(32); // the account (held by the extension / bunker)
const LEFTOVER_SK = '55'.repeat(32); // leftover stored nsec from an old session
const EXT_SK = '66'.repeat(32); // a NIP-46 user's unrelated extension key
const OTHER_SK = '77'.repeat(32); // a DM counterparty
const USER_PK = getPublicKey(bytes(USER_SK));
const OTHER_PK = getPublicKey(bytes(OTHER_SK));

const NWC = 'nostr+walletconnect://' + 'ef'.repeat(32) + '?relay=wss://r.example&secret=s';
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// A NIP-07 extension backed by a real key.
function extensionFor(skHex: string) {
  const decrypt = vi.fn(async (pk: string, ct: string) => nip44.v2.decrypt(ct, convKey(skHex, pk)));
  const encrypt = vi.fn(async (pk: string, pt: string) => nip44.v2.encrypt(pt, convKey(skHex, pk)));
  return { nip44: { encrypt, decrypt } };
}

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear()
  };
  (globalThis as any).window = {};
  fakeNdk.signer = {};
  fakeNdk.fetchEvents = null;
  fakeAuth.method = null;
  published.length = 0;
  bunker.encrypt = () => Promise.resolve('bunker-ct');
  bunker.decrypt = () => Promise.reject(new Error('bunker: bad MAC'));
  vi.mocked(nip44EncryptViaNip46).mockClear();
  clearDecryptCache();
});

describe('(a) wallet backup encrypted under a leftover stored nsec', () => {
  it('is readable, migrates to the real key, and then opens with the real key alone', async () => {
    fakeAuth.method = 'nip07';
    const ext = extensionFor(USER_SK);
    (globalThis as any).window = { nostr: ext };
    store.set('nostrcooking_privateKey', LEFTOVER_SK);

    const legacyEvent = {
      kind: 30078,
      content: nip44.v2.encrypt(NWC, convKey(LEFTOVER_SK, USER_PK)),
      tags: [
        ['d', 'zapcooking-nwc-backup'],
        ['encryption', 'nip44']
      ],
      created_at: 1
    };
    fakeNdk.fetchEvents = vi.fn(async () => new Set([legacyEvent]));

    await expect(restoreNwcFromNostr(USER_PK)).resolves.toBe(NWC);

    // Republished once, re-encrypted through the extension (the real key).
    expect(published).toHaveLength(1);
    const migrated = published[0];
    expect(migrated.tags).toContainEqual(['d', 'zapcooking-nwc-backup']);
    expect(canOpen(migrated.content, USER_SK, USER_PK)).toBe(true);
    expect(canOpen(migrated.content, LEFTOVER_SK, USER_PK)).toBe(false);

    // Later session, leftover key gone: the migrated backup opens with the
    // real key alone and nothing is republished.
    store.delete('nostrcooking_privateKey');
    clearDecryptCache();
    fakeNdk.fetchEvents = vi.fn(async () => new Set([{ ...migrated, created_at: 2 }]));
    await expect(restoreNwcFromNostr(USER_PK)).resolves.toBe(NWC);
    expect(published).toHaveLength(1);
  });
});

describe('(b) new encrypts never use a legacy source', () => {
  it('nip07: encrypts through the extension after a legacy decrypt', async () => {
    fakeAuth.method = 'nip07';
    const ext = extensionFor(USER_SK);
    (globalThis as any).window = { nostr: ext };
    store.set('nostrcooking_privateKey', LEFTOVER_SK);

    // The fallback is active: a legacy ciphertext decrypts.
    const legacyCt = nip44.v2.encrypt('old', convKey(LEFTOVER_SK, USER_PK));
    await expect(decrypt(USER_PK, legacyCt, 'nip44')).resolves.toBe('old');

    const { ciphertext } = await encrypt(USER_PK, 'new');
    expect(ext.nip44.encrypt).toHaveBeenCalledWith(USER_PK, 'new');
    expect(canOpen(ciphertext, USER_SK, USER_PK)).toBe(true);
    expect(canOpen(ciphertext, LEFTOVER_SK, USER_PK)).toBe(false);
  });

  it('nip46: encrypts through the bunker, and a bunker failure never falls back', async () => {
    fakeAuth.method = 'nip46';
    fakeNdk.signer = { remotePubkey: 'ab'.repeat(32) };
    const ext = extensionFor(EXT_SK);
    (globalThis as any).window = { nostr: ext };
    store.set('nostrcooking_privateKey', LEFTOVER_SK);

    await expect(encrypt(USER_PK, 'new')).resolves.toEqual({
      ciphertext: 'bunker-ct',
      method: 'nip44'
    });

    bunker.encrypt = () => Promise.reject(new Error('bunker offline'));
    await expect(encrypt(USER_PK, 'new')).rejects.toThrow(/remote signer/);
    expect(ext.nip44.encrypt).not.toHaveBeenCalled();
  });
});

describe('(c) NIP-46 session with an extension', () => {
  it('extension-encrypted saved wallet decrypts via the fallback and migrates to the bunker', async () => {
    fakeAuth.method = 'nip46';
    fakeNdk.signer = { remotePubkey: 'ab'.repeat(32) };
    const ext = extensionFor(EXT_SK);
    (globalThis as any).window = { nostr: ext };

    const recordKey = `spark_wallet_${USER_PK}`;
    store.set(
      recordKey,
      JSON.stringify({
        version: 2,
        ciphertext: nip44.v2.encrypt(MNEMONIC, convKey(EXT_SK, USER_PK))
      })
    );

    await expect(loadMnemonic(USER_PK)).resolves.toBe(MNEMONIC);
    expect(ext.nip44.decrypt).toHaveBeenCalledTimes(1);

    // Re-saved under the session key (bunker), not the extension.
    expect(vi.mocked(nip44EncryptViaNip46).mock.calls[0].slice(1)).toEqual([USER_PK, MNEMONIC]);
    expect(JSON.parse(store.get(recordKey)!)).toEqual({ version: 2, ciphertext: 'bunker-ct' });
    expect(ext.nip44.encrypt).not.toHaveBeenCalled();
  });

  it('keeps the legacy copy, and reads it if the bunker copy stops opening', async () => {
    fakeAuth.method = 'nip46';
    fakeNdk.signer = { remotePubkey: 'ab'.repeat(32) };
    const ext = extensionFor(EXT_SK);
    (globalThis as any).window = { nostr: ext };

    const recordKey = `spark_wallet_${USER_PK}`;
    const stashKey = `spark_wallet_legacy_${USER_PK}`;
    const legacyRecord = JSON.stringify({
      version: 2,
      ciphertext: nip44.v2.encrypt(MNEMONIC, convKey(EXT_SK, USER_PK))
    });
    store.set(recordKey, legacyRecord);
    await expect(loadMnemonic(USER_PK)).resolves.toBe(MNEMONIC);
    expect(store.get(stashKey)).toBe(legacyRecord);

    // Later session: the bunker can't open what it wrote (a session-key
    // bunker after reconnecting). The stash still opens via the extension.
    clearDecryptCache();
    bunker.decrypt = () => Promise.reject(new Error('bunker: bad MAC'));
    await expect(loadMnemonic(USER_PK)).resolves.toBe(MNEMONIC);
    expect(ext.nip44.decrypt).toHaveBeenCalledTimes(2); // once per session, on the stash

    // A different wallet saved later supersedes the stash.
    await saveMnemonic(USER_PK, 'zoo '.repeat(11) + 'wrong');
    expect(store.has(stashKey)).toBe(false);
  });

  it('only own-data decrypts may spend the extension prompt; plain decrypt() never does', async () => {
    fakeAuth.method = 'nip46';
    fakeNdk.signer = { remotePubkey: 'ab'.repeat(32) };
    const ext = extensionFor(EXT_SK);
    (globalThis as any).window = { nostr: ext };

    // A DM, the relay list, a mute list: display-only decrypt() calls.
    const dm = nip44.v2.encrypt('dm', convKey(EXT_SK, OTHER_PK));
    await expect(decrypt(OTHER_PK, dm, 'nip44')).rejects.toThrow();
    expect(ext.nip44.decrypt).not.toHaveBeenCalled();

    // The session's one prompt is still there for the user's own data.
    const wallet = nip44.v2.encrypt('wallet', convKey(EXT_SK, USER_PK));
    await expect(
      decryptWithSource(USER_PK, wallet, 'nip44', { legacy: 'prompt' })
    ).resolves.toEqual({ plaintext: 'wallet', source: 'legacy-extension' });
    expect(ext.nip44.decrypt).toHaveBeenCalledTimes(1);
  });

  it('asks the extension at most once per session', async () => {
    fakeAuth.method = 'nip46';
    fakeNdk.signer = { remotePubkey: 'ab'.repeat(32) };
    const ext = extensionFor(EXT_SK);
    (globalThis as any).window = { nostr: ext };

    const first = nip44.v2.encrypt('one', convKey(EXT_SK, USER_PK));
    const second = nip44.v2.encrypt('two', convKey(EXT_SK, USER_PK));
    const own = { legacy: 'prompt' } as const;
    await expect(decryptWithSource(USER_PK, first, 'nip44', own)).resolves.toMatchObject({
      plaintext: 'one'
    });
    await expect(decryptWithSource(USER_PK, second, 'nip44', own)).rejects.toThrow();
    expect(ext.nip44.decrypt).toHaveBeenCalledTimes(1);

    // A new session gets one more.
    clearDecryptCache();
    await expect(decryptWithSource(USER_PK, second, 'nip44', own)).resolves.toMatchObject({
      plaintext: 'two'
    });
    expect(ext.nip44.decrypt).toHaveBeenCalledTimes(2);
  });
});

describe('DMs with other people', () => {
  it('decrypt for display only: nothing is re-encrypted or published', async () => {
    fakeAuth.method = 'nip07';
    const ext = extensionFor(USER_SK);
    (globalThis as any).window = { nostr: ext };
    store.set('nostrcooking_privateKey', LEFTOVER_SK);

    const sentUnderLeftover = nip44.v2.encrypt('hi there', convKey(LEFTOVER_SK, OTHER_PK));
    await expect(decrypt(OTHER_PK, sentUnderLeftover, 'nip44')).resolves.toBe('hi there');
    expect(ext.nip44.encrypt).not.toHaveBeenCalled();
    expect(published).toHaveLength(0);
  });
});
