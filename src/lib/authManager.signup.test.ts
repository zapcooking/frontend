import { describe, it, expect, beforeEach, vi } from 'vitest';
import fixture from '../test/fixtures/vault-v1.json';

/**
 * Phase 3 passkey-first signup: enrollAtSignup composes enrollPasskey →
 * authenticateWithPrivateKey (same-pubkey ADOPTION) → uploadVault. Flags
 * forced ON via partial module mock (everything else real); authenticator
 * and fetch mocked; crypto real against the frozen vault-v1 vectors.
 *
 * The headline pin (§2 ruling): the plaintext private key is NEVER written
 * to localStorage at any instant during the happy path — asserted with a
 * setItem SPY over the whole flow, not just absence at the end. That pin is
 * for the two-prompt path (no PRF at create). One-prompt signup (PR B)
 * deliberately keeps the plaintext key until the first verified unlock.
 */

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('./passkeySync', async (importOriginal: () => Promise<unknown>) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, PASSKEY_SYNC_ENABLED: true, PASSKEY_SIGNUP_ENABLED: true };
});

vi.mock('@nostr-dev-kit/ndk', async () => {
  const { getPublicKey } = await import('nostr-tools');
  const toBytes = (hex: string) =>
    Uint8Array.from(hex.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)));
  class NDKPrivateKeySigner {
    privateKey: string;
    constructor(pk: string) {
      this.privateKey = pk;
    }
    async user() {
      const pubkey = getPublicKey(toBytes(this.privateKey));
      return { pubkey, hexpubkey: pubkey };
    }
  }
  class NDKNip46Signer {}
  class NDKNip07Signer {}
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
import { SYNC_ENABLED_KEY, SYNC_PENDING_KEY, SYNC_SERVER_UNCONFIRMED_KEY } from './passkeySync';
import { isVaultUnconfirmed } from './passkeyVault';
import { afterPasskey } from './auth/signupFlow';
import { hexToBytes, bytesToB64 } from './passkeyVaultCrypto';

const NSEC = fixture.nsecHex;
const PUBKEY = fixture.pubkeyHex;
const CRED_ID = fixture.credentialIdB64url;
const PK_KEY = 'nostrcooking_privateKey';
const FOREIGN_PUBKEY = 'ab'.repeat(32);

function fakeCredential(ext: { prfResult?: Uint8Array; prfEnabled?: boolean } = {}) {
  const raw = Uint8Array.from(atob(CRED_ID.replace(/-/g, '+').replace(/_/g, '/') + '=='), (c) =>
    c.charCodeAt(0)
  );
  return {
    id: CRED_ID,
    rawId: raw.buffer,
    type: 'public-key',
    response: {
      signature: new Uint8Array([1]).buffer,
      authenticatorData: new Uint8Array([2]).buffer,
      clientDataJSON: new Uint8Array([3]).buffer,
      getAuthenticatorData: () => new Uint8Array([4]).buffer,
      getPublicKey: () => new Uint8Array([9, 9]).buffer,
      getPublicKeyAlgorithm: () => -7
    },
    getClientExtensionResults: () => {
      if (ext.prfResult) return { prf: { results: { first: ext.prfResult.slice().buffer } } };
      if (ext.prfEnabled !== undefined) return { prf: { enabled: ext.prfEnabled } };
      return {};
    }
  };
}

function foreignRecord(): VaultRecord {
  return {
    version: 1,
    pubkey: FOREIGN_PUBKEY,
    nsecCiphertext: fixture.expectedNsecCiphertextB64,
    createdAt: 1,
    keys: [
      {
        credentialId: 'Zm9yZWlnbi1jcmVk',
        wrappedDek: fixture.expectedWrappedDekB64,
        dekIv: bytesToB64(hexToBytes(fixture.dekIvHex)),
        addedAt: 1
      }
    ]
  };
}

let store: Map<string, string>;
let setItemKeys: string[];
let fetchMock: ReturnType<typeof vi.fn>;
let credentials: { create: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
let ndk: { signer: any; activeUser: any };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const flush = () => new Promise((r) => setTimeout(r, 10));

function happyAuthenticator() {
  credentials.create.mockResolvedValue(fakeCredential({ prfEnabled: true }));
  credentials.get.mockResolvedValue(
    fakeCredential({ prfResult: hexToBytes(fixture.prfOutputHex) })
  );
}

function acceptingServer() {
  fetchMock.mockImplementation(async (url: string) =>
    String(url).endsWith('/challenge')
      ? json(200, { challenge: 'c2VydmVyLWNoYWxsZW5nZQ', expiresAt: Date.now() + 120000 })
      : json(200, { ok: true })
  );
}

beforeEach(() => {
  store = new Map();
  setItemKeys = [];
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      setItemKeys.push(k); // the spy: records EVERY write, not just final state
      store.set(k, String(v));
    },
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear()
  };
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  credentials = { create: vi.fn(), get: vi.fn() };
  vi.stubGlobal('navigator', { credentials });
  vi.stubGlobal('window', {
    isSecureContext: true,
    PublicKeyCredential: function PublicKeyCredential() {}
  });
  ndk = { signer: null, activeUser: null };
});

describe('enrollAtSignup — happy path', () => {
  it('never writes the plaintext key at ANY instant (setItem spy), session passkey, blob uploaded', async () => {
    acceptingServer();
    happyAuthenticator();
    const am = new AuthManager(ndk);

    await am.enrollAtSignup(NSEC, PUBKEY, { sync: true });
    await flush();

    // The §2 pin: no write of nostrcooking_privateKey EVER happened.
    expect(setItemKeys).not.toContain(PK_KEY);

    const state = am.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.authMethod).toBe('passkey'); // adoption branch, not privateKey
    expect(state.publicKey).toBe(PUBKEY);
    expect(ndk.signer?.privateKey).toBe(NSEC);
    expect(JSON.parse(store.get(VAULT_STORAGE_KEY)!).pubkey).toBe(PUBKEY);
    expect(store.get(SYNC_ENABLED_KEY)).toBe('1');

    // Two-prompt budget; TOFU PUT rode the verify-get assertion.
    expect(credentials.create).toHaveBeenCalledTimes(1);
    expect(credentials.get).toHaveBeenCalledTimes(1);
    const puts = fetchMock.mock.calls.filter(([, init]: any) => init?.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(JSON.parse(puts[0][1].body).assertion.credentialId).toBe(CRED_ID);
  });

  it('a later re-auth with the same key (useGeneratedKeys shape) stays plaintext-free', async () => {
    acceptingServer();
    happyAuthenticator();
    const am = new AuthManager(ndk);
    await am.enrollAtSignup(NSEC, PUBKEY, { sync: true });

    // useGeneratedKeys calls authenticateWithPrivateKey again at activation.
    await am.authenticateWithPrivateKey(NSEC);

    expect(setItemKeys).not.toContain(PK_KEY);
    expect(am.getState().authMethod).toBe('passkey');
  });

  it('sync unchecked → zero network calls, sync recorded off', async () => {
    happyAuthenticator();
    const am = new AuthManager(ndk);
    await am.enrollAtSignup(NSEC, PUBKEY, { sync: false });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.get(SYNC_ENABLED_KEY)).toBe('0');
    expect(setItemKeys).not.toContain(PK_KEY);
    expect(am.getState().authMethod).toBe('passkey');
  });
});

describe('enrollAtSignup — failure is non-destructive', () => {
  it('PRF failure → nothing persisted, not authenticated; plaintext path still works after', async () => {
    acceptingServer();
    credentials.create.mockResolvedValue(fakeCredential({ prfEnabled: true }));
    credentials.get.mockResolvedValue(fakeCredential({})); // no PRF on verify-get
    const am = new AuthManager(ndk);

    await expect(am.enrollAtSignup(NSEC, PUBKEY, { sync: true })).rejects.toThrow();

    expect(am.getState().isAuthenticated).toBe(false);
    expect(store.get(VAULT_STORAGE_KEY)).toBeUndefined();
    expect(store.get(PK_KEY)).toBeUndefined();

    // The skip path (today's signup) still activates the account.
    await am.authenticateWithPrivateKey(NSEC);
    expect(am.getState().isAuthenticated).toBe(true);
    expect(am.getState().authMethod).toBe('privateKey');
    expect(store.get(PK_KEY)).toBe(NSEC);
  });

  it('user cancel on create → nothing persisted, no error state beyond the rejection', async () => {
    credentials.create.mockRejectedValue(new DOMException('cancelled', 'NotAllowedError'));
    const am = new AuthManager(ndk);
    await expect(am.enrollAtSignup(NSEC, PUBKEY, { sync: false })).rejects.toThrow();
    expect(store.size).toBe(0);
    expect(am.getState().isAuthenticated).toBe(false);
  });
});

describe('enrollAtSignup — foreign-vault guard (defense-in-depth)', () => {
  it('refuses with VaultConflictError before any ceremony; record intact', async () => {
    store.set(VAULT_STORAGE_KEY, JSON.stringify(foreignRecord()));
    const am = new AuthManager(ndk);

    await expect(am.enrollAtSignup(NSEC, PUBKEY, { sync: true })).rejects.toThrow(
      VaultConflictError
    );

    expect(credentials.create).not.toHaveBeenCalled();
    expect(credentials.get).not.toHaveBeenCalled();
    expect(JSON.parse(store.get(VAULT_STORAGE_KEY)!).pubkey).toBe(FOREIGN_PUBKEY);
  });

  it('after the UI replace flow deletes the record, enrollment proceeds', async () => {
    store.set(VAULT_STORAGE_KEY, JSON.stringify(foreignRecord()));
    acceptingServer();
    happyAuthenticator();
    const am = new AuthManager(ndk);

    // What the conflict dialog's confirm does (local-only, no network).
    store.delete(VAULT_STORAGE_KEY);
    const callsBefore = fetchMock.mock.calls.length;

    await am.enrollAtSignup(NSEC, PUBKEY, { sync: false });
    expect(am.getState().authMethod).toBe('passkey');
    expect(fetchMock.mock.calls.length).toBe(callsBefore); // replace made no network call
  });
});

// ── One-prompt signup (PR B) ──────────────────────────────────────

const PRF = () => hexToBytes(fixture.prfOutputHex);
const SERVER_CHALLENGE = 'c2VydmVyLWNoYWxsZW5nZQ';

/** create() returns the PRF output (iCloud Keychain / GPM / 1Password shape). */
function onePromptAuthenticator(getPrf: Uint8Array | 'NotAllowedError' = PRF()) {
  credentials.create.mockResolvedValue(fakeCredential({ prfResult: PRF() }));
  credentials.get.mockImplementation(async () => {
    if (getPrf === 'NotAllowedError') throw new DOMException('denied', 'NotAllowedError');
    return fakeCredential({ prfResult: getPrf });
  });
}

const puts = () => fetchMock.mock.calls.filter(([, init]: any) => init?.method === 'PUT');
const posts = () =>
  fetchMock.mock.calls.filter(
    ([url, init]: any) => init?.method === 'POST' && !String(url).endsWith('/challenge')
  );

/** Signup screen 2 as SignupFlow runs it: enroll, then sign in at finish. */
async function signUp(am: AuthManager, sync: boolean) {
  const { uploaded } = await am.enrollAtSignup(NSEC, PUBKEY, {
    sync,
    signIn: false,
    awaitUpload: sync
  });
  await am.authenticateWithPrivateKey(NSEC); // finish()
  return uploaded;
}

/** A later visit restoring from storage: starts locked. */
async function nextVisit() {
  const am = new AuthManager({ signer: null, activeUser: null });
  await flush();
  expect(am.getState().isAuthenticated).toBe(false);
  expect(am.getVaultStatus()).toBe('locked');
  return am;
}

describe('one-prompt signup (PRF at create)', () => {
  it('one ceremony; vault unconfirmed; plaintext kept; first upload authorized by the registration', async () => {
    acceptingServer();
    onePromptAuthenticator();
    const am = new AuthManager(ndk);

    const uploaded = await signUp(am, true);

    expect(credentials.create).toHaveBeenCalledTimes(1);
    expect(credentials.get).not.toHaveBeenCalled();
    // The create() signed over the server challenge.
    const challenge = new Uint8Array(credentials.create.mock.calls[0][0].publicKey.challenge);
    expect(btoa(String.fromCharCode(...challenge)).replace(/=+$/, '')).toBe(
      'c2VydmVyLWNoYWxsZW5nZQ'
    );
    expect(isVaultUnconfirmed()).toBe(true);
    expect(store.get(PK_KEY)).toBe(NSEC); // kept until the first verified unlock
    expect(am.getState().authMethod).toBe('privateKey');

    expect(uploaded).toBe(true);
    expect(puts()).toHaveLength(1);
    const body = JSON.parse(puts()[0][1].body);
    expect(body.assertion).toBeUndefined();
    expect(body.registration).toEqual({
      credentialId: CRED_ID,
      clientDataJSON: 'Aw', // [3]
      authenticatorData: 'BA' // [4]
    });
    expect(store.get(SYNC_SERVER_UNCONFIRMED_KEY)).toBe('1');
    expect(afterPasskey(true, uploaded)).toEqual({ kind: 'done' }); // passkey-only: no backup step
  });

  it('next visit: the chip unlock confirms the vault AND the server copy (refresh assertion)', async () => {
    acceptingServer();
    onePromptAuthenticator();
    await signUp(new AuthManager(ndk), true);
    fetchMock.mockClear();
    acceptingServer();

    const am = await nextVisit();
    await am.unlockVault();
    await flush();

    expect(am.getState().authMethod).toBe('passkey');
    expect(store.get(PK_KEY)).toBeUndefined();
    expect(isVaultUnconfirmed()).toBe(false);
    expect(posts()).toHaveLength(1); // the refresh: its assertion confirms the entry
    expect(JSON.parse(posts()[0][1].body).assertion.credentialId).toBe(CRED_ID);
    expect(store.get(SYNC_SERVER_UNCONFIRMED_KEY)).toBeUndefined();
  });

  it('upload not stored: the backup key is still required; the next unlock uploads with its assertion', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/challenge')
        ? json(200, { challenge: SERVER_CHALLENGE, expiresAt: Date.now() + 120000 })
        : json(503, { error: 'not_configured' })
    );
    onePromptAuthenticator();
    const uploaded = await signUp(new AuthManager(ndk), true);

    expect(credentials.get).not.toHaveBeenCalled(); // the one-prompt path
    expect(uploaded).toBe(false);
    expect(afterPasskey(true, uploaded)).toEqual({ kind: 'backup', reason: 'upload-failed' });
    expect(store.get(SYNC_PENDING_KEY)).toBe('1');
    expect(store.get(SYNC_SERVER_UNCONFIRMED_KEY)).toBeUndefined();

    fetchMock.mockClear();
    acceptingServer();
    const am = await nextVisit();
    await am.unlockVault();
    await vi.waitFor(() => expect(puts()).toHaveLength(1));
    const body = JSON.parse(puts()[0][1].body);
    expect(body.assertion.credentialId).toBe(CRED_ID);
    expect(body.registration).toBeUndefined();
  });

  it('sync off: one ceremony, no network, unconfirmed with the plaintext key kept', async () => {
    onePromptAuthenticator();
    const am = new AuthManager(ndk);
    await signUp(am, false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(credentials.get).not.toHaveBeenCalled();
    expect(isVaultUnconfirmed()).toBe(true);
    expect(store.get(PK_KEY)).toBe(NSEC);
  });

  it('a cancel on the next visit signs in from the plaintext key and keeps the vault', async () => {
    acceptingServer();
    onePromptAuthenticator('NotAllowedError');
    await signUp(new AuthManager(ndk), true);
    const am = await nextVisit();

    await am.unlockVault();

    expect(am.getState().isAuthenticated).toBe(true);
    expect(am.getState().authMethod).toBe('privateKey');
    expect(isVaultUnconfirmed()).toBe(true);
    expect(store.get(PK_KEY)).toBe(NSEC);
  });

  it('a non-cancel failure removes the vault, keeps the user signed in, asks for the backup key', async () => {
    acceptingServer();
    onePromptAuthenticator(new Uint8Array(32).fill(7)); // get() PRF ≠ create() PRF
    await signUp(new AuthManager(ndk), true);
    const am = await nextVisit();

    await am.unlockVault();

    expect(store.get(VAULT_STORAGE_KEY)).toBeUndefined();
    expect(am.getState().isAuthenticated).toBe(true);
    expect(store.get(PK_KEY)).toBe(NSEC);
    expect(am.takeVaultConfirmFailure()).toBe(true);
    // The server copy stays unconfirmed until it expires; nothing local refers to it.
    expect(store.get(SYNC_SERVER_UNCONFIRMED_KEY)).toBeUndefined();
  });

  it('no PRF at create: create + get as before (plaintext never written)', async () => {
    acceptingServer();
    happyAuthenticator();
    const am = new AuthManager(ndk);
    await signUp(am, true);
    expect(credentials.get).toHaveBeenCalledTimes(1);
    expect(setItemKeys).not.toContain(PK_KEY);
    expect(am.getState().authMethod).toBe('passkey');
    expect(JSON.parse(puts()[0][1].body).assertion.credentialId).toBe(CRED_ID);
  });
});
