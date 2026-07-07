import { describe, it, expect, beforeEach, vi } from 'vitest';
import fixture from '../test/fixtures/vault-v1.json';

/**
 * AuthManager ↔ passkey-vault integration. NDK is mocked (like
 * authManager.nip46.test.ts) but with pubkeys derived for real so the
 * vault's pubkey-equality logic is exercised honestly; the WebAuthn
 * authenticator is mocked; the vault crypto runs unmocked against the
 * fixture vectors.
 */

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('@nostr-dev-kit/ndk', async () => {
  const { getPublicKey } = await import('nostr-tools');
  const toBytes = (hex: string) =>
    Uint8Array.from(hex.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)));

  class NDKPrivateKeySigner {
    privateKey: string;
    constructor(pk: string) {
      this.privateKey = pk;
    }
    static generate() {
      return new NDKPrivateKeySigner('11'.repeat(32));
    }
    async user() {
      const pubkey = getPublicKey(toBytes(this.privateKey));
      return { pubkey, hexpubkey: pubkey };
    }
  }
  class NDKNip46Signer {}
  class NDKNip07Signer {
    async user(): Promise<never> {
      throw new Error('no NIP-07 extension in tests');
    }
  }
  class NDKRelaySet {
    static fromRelayUrls() {
      return {};
    }
  }
  return {
    NDKPrivateKeySigner,
    NDKNip46Signer,
    NDKNip07Signer,
    NDKRelaySet,
    NDKSubscriptionCacheUsage: { ONLY_RELAY: 'ONLY_RELAY' }
  };
});

import { AuthManager, VaultConflictError } from './authManager';
import { VAULT_STORAGE_KEY, type VaultRecord } from './passkeyVault';
import { hexToBytes, bytesToB64 } from './passkeyVaultCrypto';
import { resolveSecuritySections } from './securitySections';

const PK_KEY = 'nostrcooking_privateKey';
const PUB_KEY = 'nostrcooking_loggedInPublicKey';
const OTHER_NSEC = '22'.repeat(32); // valid scalar, different account

function fixtureRecord(): VaultRecord {
  return {
    version: 1,
    pubkey: fixture.pubkeyHex,
    nsecCiphertext: fixture.expectedNsecCiphertextB64,
    createdAt: 1,
    keys: [
      {
        credentialId: fixture.credentialIdB64url,
        wrappedDek: fixture.expectedWrappedDekB64,
        dekIv: bytesToB64(hexToBytes(fixture.dekIvHex)),
        addedAt: 1
      }
    ]
  };
}

function fakeAssertion(prfBytes: Uint8Array) {
  return {
    id: fixture.credentialIdB64url,
    rawId: new ArrayBuffer(0),
    type: 'public-key',
    getClientExtensionResults: () => ({ prf: { results: { first: prfBytes.slice().buffer } } })
  };
}

function makeNdk() {
  return { signer: null as any, activeUser: null as any };
}

let store: Map<string, string>;
let credentials: { create: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
let ndk: ReturnType<typeof makeNdk>;

const seedVault = () => store.set(VAULT_STORAGE_KEY, JSON.stringify(fixtureRecord()));
const vaultInStore = () => store.get(VAULT_STORAGE_KEY);
const flush = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  store = new Map();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear()
  };
  credentials = { create: vi.fn(), get: vi.fn() };
  vi.stubGlobal('navigator', { credentials });
  vi.stubGlobal('window', {
    isSecureContext: true,
    PublicKeyCredential: function PublicKeyCredential() {}
  });
  ndk = makeNdk();
});

describe('re-login with an existing vault (the re-login hole)', () => {
  it('same pubkey: adopts the vault, never persists plaintext', async () => {
    seedVault();
    const am = new AuthManager(ndk);
    await am.authenticateWithPrivateKey(fixture.nsecHex);

    const state = am.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.authMethod).toBe('passkey');
    expect(state.publicKey).toBe(fixture.pubkeyHex);
    expect(store.get(PK_KEY)).toBeUndefined();
    expect(vaultInStore()).toBeDefined();
    expect(am.getVaultStatus()).toBe('unlocked');
  });

  it('same pubkey via nsec1 bech32 input also adopts', async () => {
    seedVault();
    const { nip19 } = await import('nostr-tools');
    const nsec = nip19.nsecEncode(hexToBytes(fixture.nsecHex));
    const am = new AuthManager(ndk);
    await am.authenticateWithPrivateKey(nsec);
    expect(am.getState().authMethod).toBe('passkey');
    expect(store.get(PK_KEY)).toBeUndefined();
  });

  it('different pubkey: throws VaultConflictError and mutates nothing', async () => {
    seedVault();
    const am = new AuthManager(ndk);
    await expect(am.authenticateWithPrivateKey(OTHER_NSEC)).rejects.toThrow(VaultConflictError);

    expect(am.getState().isAuthenticated).toBe(false);
    expect(ndk.signer).toBeNull();
    expect(store.get(PK_KEY)).toBeUndefined();
    expect(JSON.parse(vaultInStore()!)).toEqual(fixtureRecord());
  });

  it('different pubkey with replaceVault: deletes the record, proceeds legacy', async () => {
    seedVault();
    const am = new AuthManager(ndk);
    await am.authenticateWithPrivateKey(OTHER_NSEC, { replaceVault: true });

    expect(am.getState().isAuthenticated).toBe(true);
    expect(am.getState().authMethod).toBe('privateKey');
    expect(store.get(PK_KEY)).toBe(OTHER_NSEC);
    expect(vaultInStore()).toBeUndefined();
  });

  it('no vault: legacy behavior unchanged (plaintext persisted)', async () => {
    const am = new AuthManager(ndk);
    await am.authenticateWithPrivateKey(fixture.nsecHex);
    expect(am.getState().authMethod).toBe('privateKey');
    expect(store.get(PK_KEY)).toBe(fixture.nsecHex);
  });
});

describe('escape hatch: cancelled unlock is never destructive', () => {
  it('cancel unlock → paste nsec → session live, vault re-adopted, not orphaned', async () => {
    seedVault();
    const am = new AuthManager(ndk);

    credentials.get.mockRejectedValue(new DOMException('user cancelled', 'NotAllowedError'));
    await expect(am.unlockVault()).rejects.toThrow();

    // Cancel left everything intact and surfaced no error banner.
    expect(am.getState().isAuthenticated).toBe(false);
    expect(am.getState().error).toBeNull();
    expect(JSON.parse(vaultInStore()!)).toEqual(fixtureRecord());

    // Escape hatch: paste the nsec — full session, vault still enrolled.
    await am.authenticateWithPrivateKey(fixture.nsecHex);
    expect(am.getState().isAuthenticated).toBe(true);
    expect(am.getState().authMethod).toBe('passkey');
    expect(store.get(PK_KEY)).toBeUndefined();
    expect(JSON.parse(vaultInStore()!)).toEqual(fixtureRecord());
  });

  it('a failed (non-cancel) unlock surfaces an error but keeps the record', async () => {
    seedVault();
    const am = new AuthManager(ndk);
    const wrong = hexToBytes(fixture.prfOutputHex);
    wrong[0] ^= 0xff;
    credentials.get.mockResolvedValue(fakeAssertion(wrong));

    await expect(am.unlockVault()).rejects.toThrow();
    expect(am.getState().isAuthenticated).toBe(false);
    expect(am.getState().error).toBeTruthy();
    expect(JSON.parse(vaultInStore()!)).toEqual(fixtureRecord());
  });
});

describe('unlockVault', () => {
  it('starts a memory-only session from the vault', async () => {
    seedVault();
    const am = new AuthManager(ndk);
    credentials.get.mockResolvedValue(fakeAssertion(hexToBytes(fixture.prfOutputHex)));

    await am.unlockVault();

    const state = am.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.authMethod).toBe('passkey');
    expect(state.publicKey).toBe(fixture.pubkeyHex);
    expect(ndk.signer?.privateKey).toBe(fixture.nsecHex);
    expect(store.get(PK_KEY)).toBeUndefined();
    expect(store.get(PUB_KEY)).toBe(fixture.pubkeyHex);
    expect(am.getSessionPrivateKeyHex()).toBe(fixture.nsecHex);
  });

  it('settings reveal in an unlocked passkey session shows the enrolled nsec, never a NIP-07 section', async () => {
    seedVault();
    const am = new AuthManager(ndk);
    credentials.get.mockResolvedValue(fakeAssertion(hexToBytes(fixture.prfOutputHex)));
    await am.unlockVault();

    // Exactly the inputs Settings → Security derives after unlock.
    const sk = am.getSessionPrivateKeyHex();
    const section = resolveSecuritySections({
      sk,
      storedAuthMethod: store.get('nostrcooking_authMethod') ?? null,
      sessionMethod: am.getState().authMethod
    });
    expect(section).toBe('privateKey');
    expect(sk).toBe(fixture.nsecHex); // revealed value === enrolled nsec
    expect(store.get(PK_KEY)).toBeUndefined(); // and it never came from storage
  });
});

describe('session restore (initializeFromStorage)', () => {
  it('locked vault: stays unauthenticated and wipes nothing', async () => {
    seedVault();
    store.set(PUB_KEY, fixture.pubkeyHex);
    const am = new AuthManager(ndk);
    await flush();

    expect(am.getState().isAuthenticated).toBe(false);
    expect(am.getVaultStatus()).toBe('locked');
    // Crucially the NIP-07 restore path (which clearStorage()s on failure)
    // was never attempted: both keys survive.
    expect(store.get(PUB_KEY)).toBe(fixture.pubkeyHex);
    expect(vaultInStore()).toBeDefined();
  });

  it('interrupted enrollment (plaintext + same-pubkey record): completes the deletion', async () => {
    seedVault();
    store.set(PK_KEY, fixture.nsecHex);
    store.set(PUB_KEY, fixture.pubkeyHex);
    const am = new AuthManager(ndk);
    await vi.waitFor(() => expect(am.getState().isAuthenticated).toBe(true));

    expect(am.getState().authMethod).toBe('passkey');
    expect(store.get(PK_KEY)).toBeUndefined();
    expect(vaultInStore()).toBeDefined();
  });

  it('plaintext restore without a vault stays legacy', async () => {
    store.set(PK_KEY, fixture.nsecHex);
    store.set(PUB_KEY, fixture.pubkeyHex);
    const am = new AuthManager(ndk);
    await vi.waitFor(() => expect(am.getState().isAuthenticated).toBe(true));
    expect(am.getState().authMethod).toBe('privateKey');
    expect(store.get(PK_KEY)).toBe(fixture.nsecHex);
  });
});

describe('logout', () => {
  it('clears session state but keeps the vault record', async () => {
    seedVault();
    const am = new AuthManager(ndk);
    credentials.get.mockResolvedValue(fakeAssertion(hexToBytes(fixture.prfOutputHex)));
    await am.unlockVault();

    await am.logout();

    expect(am.getState().isAuthenticated).toBe(false);
    expect(ndk.signer).toBeNull();
    expect(store.get(PUB_KEY)).toBeUndefined();
    expect(store.get(PK_KEY)).toBeUndefined();
    expect(JSON.parse(vaultInStore()!)).toEqual(fixtureRecord());
    expect(am.getVaultStatus()).toBe('locked');
  });
});

describe('enrollVault', () => {
  it('happy path: record written, plaintext deleted only after verification', async () => {
    const am = new AuthManager(ndk);
    await am.authenticateWithPrivateKey(fixture.nsecHex);
    expect(store.get(PK_KEY)).toBe(fixture.nsecHex);

    credentials.create.mockResolvedValue({
      id: fixture.credentialIdB64url,
      rawId: new ArrayBuffer(0),
      type: 'public-key',
      getClientExtensionResults: () => ({ prf: { enabled: true } })
    });
    credentials.get.mockResolvedValue(fakeAssertion(hexToBytes(fixture.prfOutputHex)));

    await am.enrollVault();

    expect(store.get(PK_KEY)).toBeUndefined();
    expect(am.getState().authMethod).toBe('passkey');
    const record = JSON.parse(vaultInStore()!);
    expect(record.pubkey).toBe(fixture.pubkeyHex);
    expect(am.getVaultStatus()).toBe('unlocked');
  });

  it('PRF verification failure aborts with no data loss', async () => {
    const am = new AuthManager(ndk);
    await am.authenticateWithPrivateKey(fixture.nsecHex);

    credentials.create.mockResolvedValue({
      id: fixture.credentialIdB64url,
      rawId: new ArrayBuffer(0),
      type: 'public-key',
      getClientExtensionResults: () => ({})
    });
    credentials.get.mockResolvedValue({
      id: fixture.credentialIdB64url,
      rawId: new ArrayBuffer(0),
      type: 'public-key',
      getClientExtensionResults: () => ({}) // no PRF on get either
    });

    await expect(am.enrollVault()).rejects.toThrow();
    // Plaintext untouched, no record, session still live as privateKey.
    expect(store.get(PK_KEY)).toBe(fixture.nsecHex);
    expect(vaultInStore()).toBeUndefined();
    expect(am.getState().authMethod).toBe('privateKey');
    expect(am.getState().isAuthenticated).toBe(true);
  });

  it('refuses to enroll for non-nsec sessions', async () => {
    const am = new AuthManager(ndk);
    await expect(am.enrollVault()).rejects.toThrow(/requires an active/);
  });
});

describe('removeVault (downgrade)', () => {
  it('requires a fresh unlock, restores plaintext, then deletes the record', async () => {
    seedVault();
    const am = new AuthManager(ndk);
    credentials.get.mockResolvedValue(fakeAssertion(hexToBytes(fixture.prfOutputHex)));
    await am.unlockVault();
    credentials.get.mockClear();
    credentials.get.mockResolvedValue(fakeAssertion(hexToBytes(fixture.prfOutputHex)));

    await am.removeVault();

    expect(credentials.get).toHaveBeenCalledTimes(1); // fresh ceremony
    expect(store.get(PK_KEY)).toBe(fixture.nsecHex);
    expect(vaultInStore()).toBeUndefined();
    expect(am.getState().authMethod).toBe('privateKey');
    expect(am.getState().isAuthenticated).toBe(true);
    expect(am.getVaultStatus()).toBe('none');
  });

  it('a cancelled removal ceremony changes nothing', async () => {
    seedVault();
    const am = new AuthManager(ndk);
    credentials.get.mockResolvedValue(fakeAssertion(hexToBytes(fixture.prfOutputHex)));
    await am.unlockVault(); // matching session — the guard is not what's under test here
    credentials.get.mockRejectedValue(new DOMException('cancelled', 'NotAllowedError'));

    await expect(am.removeVault()).rejects.toThrow();
    expect(store.get(PK_KEY)).toBeUndefined();
    expect(JSON.parse(vaultInStore()!)).toEqual(fixtureRecord());
    expect(am.getState().authMethod).toBe('passkey'); // session unchanged
  });

  it('refuses when the session belongs to a different account — no ceremony, nothing written (B ruling)', async () => {
    // Shape of the staging repro: live session for account B, vault record
    // for account A sitting in the same browser.
    const am = new AuthManager(ndk);
    await am.authenticateWithPrivateKey(OTHER_NSEC);
    seedVault(); // fixture-pubkey record appears "later" (multi-account browser)
    const sessionPubkeyBefore = am.getState().publicKey;

    await expect(am.removeVault()).rejects.toThrow(/different account/);

    expect(credentials.get).not.toHaveBeenCalled(); // refused BEFORE any passkey prompt
    expect(JSON.parse(vaultInStore()!)).toEqual(fixtureRecord()); // record intact
    expect(store.get(PK_KEY)).toBe(OTHER_NSEC); // B's own legacy key untouched
    expect(am.getState().publicKey).toBe(sessionPubkeyBefore); // no identity switch
    expect(am.getState().authMethod).toBe('privateKey');
  });

  it('refuses when not authenticated at all', async () => {
    seedVault();
    const am = new AuthManager(ndk);
    await expect(am.removeVault()).rejects.toThrow(/different account/);
    expect(credentials.get).not.toHaveBeenCalled();
    expect(JSON.parse(vaultInStore()!)).toEqual(fixtureRecord());
  });
});

describe('getSessionPrivateKeyHex', () => {
  it('reads the in-memory signer for passkey sessions (nothing in storage)', async () => {
    seedVault();
    const am = new AuthManager(ndk);
    credentials.get.mockResolvedValue(fakeAssertion(hexToBytes(fixture.prfOutputHex)));
    await am.unlockVault();
    expect(store.get(PK_KEY)).toBeUndefined();
    expect(am.getSessionPrivateKeyHex()).toBe(fixture.nsecHex);
  });

  it('falls back to localStorage for legacy sessions', async () => {
    const am = new AuthManager(ndk);
    await am.authenticateWithPrivateKey(fixture.nsecHex);
    ndk.signer = null; // even with the signer gone, legacy storage still answers
    expect(am.getSessionPrivateKeyHex()).toBe(fixture.nsecHex);
  });

  it('returns null when there is no nsec session', () => {
    const am = new AuthManager(ndk);
    expect(am.getSessionPrivateKeyHex()).toBeNull();
  });
});
