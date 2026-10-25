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

// logout() clears account-scoped data (wallets, group/publish/offline
// databases). Those are covered by sessionCleanup.test.ts; stub them here
// so this suite stays a pure AuthManager unit test and doesn't pull
// IndexedDB modules into the mocked-NDK environment.
vi.mock('$lib/sessionCleanup', () => ({
  clearAccountData: vi.fn().mockResolvedValue(undefined),
  clearAccountLocalStorage: vi.fn()
}));

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
import { VAULT_STORAGE_KEY, isVaultUnconfirmed, type VaultRecord } from './passkeyVault';
import {
  hexToBytes,
  bytesToB64,
  deriveKek,
  generateDek,
  wrapDek,
  encryptNsec
} from './passkeyVaultCrypto';
import { getPublicKey } from 'nostr-tools';
import { PasskeyNotReadyError, PASSKEY_NOT_READY_MESSAGE } from './passkeySync';
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

// ── One-prompt setup ─────────────────────────────────────────────

// Simulated authenticator. createPrf: create() returns the PRF output (as
// iCloud Keychain, Google Password Manager and 1Password do). getPrf: what
// this provider's get() yields for the same salt — the create() value by
// default, other bytes for a bad provider, or the NotAllowedError Microsoft
// Password Manager raises.
function simulatedAuthenticator(opts: {
  createPrf: boolean;
  getPrf?: Uint8Array | 'NotAllowedError';
}) {
  const prf = hexToBytes(fixture.prfOutputHex);
  credentials.create.mockImplementation(async () => ({
    id: fixture.credentialIdB64url,
    rawId: new ArrayBuffer(0),
    type: 'public-key',
    response: {
      getPublicKey: () => new Uint8Array([48, 1]).buffer,
      getPublicKeyAlgorithm: () => -7
    },
    getClientExtensionResults: () =>
      opts.createPrf
        ? { prf: { enabled: true, results: { first: prf.slice().buffer } } }
        : { prf: { enabled: true } }
  }));
  credentials.get.mockImplementation(async () => {
    if (opts.getPrf === 'NotAllowedError') throw new DOMException('denied', 'NotAllowedError');
    const out = opts.getPrf ?? prf;
    return {
      id: fixture.credentialIdB64url,
      rawId: new ArrayBuffer(0),
      type: 'public-key',
      response: {
        signature: new Uint8Array([1]).buffer,
        authenticatorData: new Uint8Array([2]).buffer,
        clientDataJSON: new Uint8Array([3]).buffer
      },
      getClientExtensionResults: () => ({ prf: { results: { first: out.slice().buffer } } })
    };
  });
}

async function nsecSession() {
  const am = new AuthManager(ndk);
  await am.authenticateWithPrivateKey(fixture.nsecHex);
  return am;
}

/** A later visit restoring from storage, expected to start signed in. */
async function nextVisit() {
  const am = new AuthManager(makeNdk());
  await vi.waitFor(() => expect(am.getState().isAuthenticated).toBe(true));
  return am;
}

/** A later visit expected to start LOCKED (unconfirmed vault, chip shown). */
async function nextVisitLocked() {
  const am = new AuthManager(makeNdk());
  await flush();
  expect(am.getState().isAuthenticated).toBe(false);
  expect(am.getVaultStatus()).toBe('locked');
  return am;
}

describe('one-prompt enrollment (PRF at create)', () => {
  it('one ceremony: vault written, plaintext key and nsec session kept', async () => {
    simulatedAuthenticator({ createPrf: true });
    const am = await nsecSession();

    await expect(am.enrollVault()).resolves.toEqual({ confirmed: false });

    expect(credentials.create).toHaveBeenCalledTimes(1);
    expect(credentials.get).not.toHaveBeenCalled();
    expect(vaultInStore()).toBeDefined();
    expect(isVaultUnconfirmed()).toBe(true);
    expect(store.get(PK_KEY)).toBe(fixture.nsecHex);
    expect(am.getState().authMethod).toBe('privateKey');
    expect(am.getState().isAuthenticated).toBe(true);
  });

  it('falls back to create + get (today) when create() returns no PRF result', async () => {
    simulatedAuthenticator({ createPrf: false });
    const am = await nsecSession();

    await expect(am.enrollVault()).resolves.toEqual({ confirmed: true });

    expect(credentials.get).toHaveBeenCalledTimes(1);
    expect(store.get(PK_KEY)).toBeUndefined();
    expect(am.getState().authMethod).toBe('passkey');
    expect(isVaultUnconfirmed()).toBe(false);
  });

  it('next visit starts locked; the normal unlock confirms the vault and deletes the plaintext key', async () => {
    simulatedAuthenticator({ createPrf: true });
    await (await nsecSession()).enrollVault();

    const am = await nextVisitLocked();
    expect(store.get(PK_KEY)).toBe(fixture.nsecHex); // silent fallback, still here

    await am.unlockVault();

    expect(credentials.get).toHaveBeenCalledTimes(1);
    expect(am.getState().authMethod).toBe('passkey');
    expect(store.get(PK_KEY)).toBeUndefined();
    expect(isVaultUnconfirmed()).toBe(false);
    // From now on an ordinary passkey vault.
    await nextVisitLocked();
  });

  it('a cancelled unlock signs in from the plaintext key and keeps the vault', async () => {
    simulatedAuthenticator({ createPrf: true, getPrf: 'NotAllowedError' });
    await (await nsecSession()).enrollVault();
    const am = await nextVisitLocked();

    await expect(am.unlockVault()).resolves.toBeUndefined();

    expect(am.getState().isAuthenticated).toBe(true);
    expect(am.getState().authMethod).toBe('privateKey');
    expect(isVaultUnconfirmed()).toBe(true);
    expect(store.get(PK_KEY)).toBe(fixture.nsecHex);
    expect(am.takeVaultConfirmFailure()).toBe(false);
    await nextVisitLocked(); // the chip again next time
  });

  it('from the second NotAllowedError on: signed in, vault kept, keep-trying/remove choice offered', async () => {
    simulatedAuthenticator({ createPrf: true, getPrf: 'NotAllowedError' });
    await (await nsecSession()).enrollVault();
    const first = await nextVisitLocked();
    await first.unlockVault(); // visit 1: plain cancel
    expect(first.takeVaultCancelChoice()).toBe(false);

    const second = await nextVisitLocked();
    await second.unlockVault(); // visit 2: second cancel

    expect(second.getState().isAuthenticated).toBe(true);
    expect(second.getState().authMethod).toBe('privateKey');
    expect(vaultInStore()).toBeDefined(); // never removed automatically
    expect(isVaultUnconfirmed()).toBe(true);
    expect(second.takeVaultConfirmFailure()).toBe(false);
    expect(second.takeVaultCancelChoice()).toBe(true);
    expect(second.takeVaultCancelChoice()).toBe(false); // offered once per failure

    // "Keep trying" changes nothing: the next failure offers the choice again.
    const third = await nextVisitLocked();
    await third.unlockVault();
    expect(vaultInStore()).toBeDefined();
    expect(third.takeVaultCancelChoice()).toBe(true);

    // "Remove and save backup key".
    third.discardUnconfirmedVault();
    expect(vaultInStore()).toBeUndefined();
    expect(store.get(PK_KEY)).toBe(fixture.nsecHex);
    await nextVisit(); // plain nsec session from now on
  });

  it('bad PRF on the unlock: vault removed at once, signed in from the plaintext key', async () => {
    simulatedAuthenticator({ createPrf: true, getPrf: new Uint8Array(32).fill(7) });
    await (await nsecSession()).enrollVault();
    const am = await nextVisitLocked();

    await am.unlockVault();

    expect(vaultInStore()).toBeUndefined();
    expect(am.getState().isAuthenticated).toBe(true);
    expect(am.getState().authMethod).toBe('privateKey');
    expect(store.get(PK_KEY)).toBe(fixture.nsecHex);
    expect(am.takeVaultConfirmFailure()).toBe(true);
  });

  it('a failed marker write leaves no vault behind: no lockout on the next visit', async () => {
    // Provider whose get() can't reproduce its create() PRF.
    simulatedAuthenticator({ createPrf: true, getPrf: new Uint8Array(32).fill(7) });
    const am = await nsecSession();
    const setItem = (globalThis as any).localStorage.setItem;
    (globalThis as any).localStorage.setItem = (k: string, v: string) => {
      if (k === 'nostrcooking_vault_unconfirmed') {
        throw new DOMException('quota', 'QuotaExceededError');
      }
      setItem(k, v);
    };

    await expect(am.enrollVault()).rejects.toThrow();
    (globalThis as any).localStorage.setItem = setItem;
    expect(vaultInStore()).toBeUndefined();

    const next = await nextVisit();
    expect(next.getState().authMethod).toBe('privateKey');
    expect(store.get(PK_KEY)).toBe(fixture.nsecHex);
  });

  it('migrate never uses one prompt, even in an nsec session', async () => {
    simulatedAuthenticator({ createPrf: true });
    const am = await nsecSession();

    await expect(am.enrollVault({ migrate: true })).resolves.toEqual({ confirmed: true });

    expect(credentials.create.mock.calls[0][0].publicKey.extensions).toEqual({ prf: {} });
    expect(credentials.get).toHaveBeenCalledTimes(1);
  });

  it('the plaintext key is never deleted without a verified unlock (logout drops the vault instead)', async () => {
    simulatedAuthenticator({ createPrf: true });
    const am = await nsecSession();
    await am.enrollVault();

    await am.logout();

    expect(store.get(PK_KEY)).toBeUndefined();
    expect(vaultInStore()).toBeUndefined();
  });

  it('removing an unconfirmed vault needs no ceremony and keeps the plaintext key', async () => {
    simulatedAuthenticator({ createPrf: true });
    const am = await nsecSession();
    await am.enrollVault();

    await am.removeVault();

    expect(credentials.get).not.toHaveBeenCalled();
    expect(vaultInStore()).toBeUndefined();
    expect(store.get(PK_KEY)).toBe(fixture.nsecHex);
  });

  it('a passkey session (no plaintext key to fall back on) keeps create + get', async () => {
    simulatedAuthenticator({ createPrf: true });
    await (await nsecSession()).enrollVault();
    const am = await nextVisitLocked();
    await am.unlockVault(); // confirmed passkey session, plaintext gone
    credentials.create.mockClear();
    credentials.get.mockClear();

    await expect(am.enrollVault({ migrate: true })).resolves.toEqual({ confirmed: true });

    expect(credentials.create.mock.calls[0][0].publicKey.extensions).toEqual({ prf: {} });
    expect(credentials.get).toHaveBeenCalledTimes(1);
    expect(store.get(PK_KEY)).toBeUndefined();
  });

  it('sync: nothing is uploaded until the confirming unlock, which uploads', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      url.endsWith('/challenge')
        ? { ok: true, json: async () => ({ challenge: 'AAAA' }) }
        : { ok: true, json: async () => ({ ok: true }) }
    );
    vi.stubGlobal('fetch', fetchMock);
    const puts = () =>
      fetchMock.mock.calls.filter(
        (call: unknown[]) => (call[1] as RequestInit | undefined)?.method === 'PUT'
      );

    simulatedAuthenticator({ createPrf: true });
    await (await nsecSession()).enrollVault({ sync: true });
    expect(puts()).toHaveLength(0);

    const am = await nextVisitLocked();
    await am.unlockVault();
    expect(am.getState().authMethod).toBe('passkey');
    await vi.waitFor(() => expect(puts()).toHaveLength(1));
    vi.unstubAllGlobals();
  });
});

// ── No dead ends on the chip ─────────────────────────────────────

const SAVED_PRF = () => hexToBytes(fixture.prfOutputHex);
const OTHER_CRED = 'b3RoZXItY3JlZGVudGlhbA'; // b64url "other-credential"
const OTHER_PRF = () => new Uint8Array(32).fill(9);

// A server copy for `nsecHex`, wrapped for credential `credentialId` with `prf`.
async function serverRecord(nsecHex: string, credentialId: string, prf: Uint8Array) {
  const dek = generateDek();
  const { wrappedDek, iv } = await wrapDek(dek, deriveKek(prf.slice()));
  return {
    version: 1,
    pubkey: getPublicKey(hexToBytes(nsecHex)),
    nsecCiphertext: encryptNsec(nsecHex, dek),
    createdAt: 2,
    keys: [{ credentialId, wrappedDek: bytesToB64(wrappedDek), dekIv: bytesToB64(iv), addedAt: 2 }]
  };
}

// The OS picker: the user picks `credentialId`; the authenticator returns `prf`.
function pickFromOsList(credentialId: string, prf: Uint8Array) {
  credentials.get.mockImplementation(async () => ({
    id: credentialId,
    rawId: new ArrayBuffer(0),
    type: 'public-key',
    response: {
      signature: new Uint8Array([1]).buffer,
      authenticatorData: new Uint8Array([2]).buffer,
      clientDataJSON: new Uint8Array([3]).buffer
    },
    getClientExtensionResults: () => ({ prf: { results: { first: prf.slice().buffer } } })
  }));
}

// Sync service: challenges, and `blobs` served by credential (any hash).
function syncService(blob: object | null) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/challenge')) return { ok: true, json: async () => ({ challenge: 'AAAA' }) };
    if (blob) return { ok: true, json: async () => ({ blob: JSON.stringify(blob) }) };
    return { ok: false, status: 404, json: async () => ({ error: 'not_found' }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const lastGetArgs = () => credentials.get.mock.calls.at(-1)![0].publicKey;

describe('no dead ends on the chip', () => {
  it('after a cancel, the next unlock lists every passkey; picking the saved one unlocks locally', async () => {
    seedVault();
    const am = new AuthManager(ndk);
    credentials.get.mockRejectedValueOnce(new DOMException('cancelled', 'NotAllowedError'));
    await expect(am.unlockVault()).rejects.toThrow();
    expect(lastGetArgs().allowCredentials).toHaveLength(1);

    pickFromOsList(fixture.credentialIdB64url, SAVED_PRF());
    await am.unlockVault();

    expect(lastGetArgs().allowCredentials).toEqual([]); // discoverable: every passkey
    expect(am.getState().authMethod).toBe('passkey');
    expect(am.getState().publicKey).toBe(fixture.pubkeyHex);
    vi.unstubAllGlobals();
  });

  it('"Use a different passkey", same account: its server copy becomes the saved login', async () => {
    simulatedAuthenticator({ createPrf: true });
    await (await nsecSession()).enrollVault(); // unconfirmed local vault + plaintext
    const am = await nextVisitLocked();
    const synced = await serverRecord(fixture.nsecHex, OTHER_CRED, OTHER_PRF());
    syncService(synced);
    pickFromOsList(OTHER_CRED, OTHER_PRF());

    await am.signInWithAnyPasskey();

    expect(am.getState().authMethod).toBe('passkey');
    expect(JSON.parse(vaultInStore()!)).toEqual(synced);
    expect(isVaultUnconfirmed()).toBe(false);
    expect(store.get(PK_KEY)).toBeUndefined(); // the replaced vault's fallback goes with it
    vi.unstubAllGlobals();
  });

  it('a different account asks "Replace saved login?" first, then finishes without a second prompt', async () => {
    seedVault();
    const am = new AuthManager(ndk);
    const other = await serverRecord(OTHER_NSEC, OTHER_CRED, OTHER_PRF());
    syncService(other);
    pickFromOsList(OTHER_CRED, OTHER_PRF());

    const error = await am.signInWithAnyPasskey().catch((e) => e);

    expect(error).toBeInstanceOf(VaultConflictError);
    expect(error.resume).toBeTypeOf('function');
    expect(JSON.parse(vaultInStore()!)).toEqual(fixtureRecord()); // nothing replaced yet
    expect(am.getState().isAuthenticated).toBe(false);

    await error.resume(); // the user confirmed the dialog
    expect(credentials.get).toHaveBeenCalledTimes(1);
    expect(am.getState().publicKey).toBe(other.pubkey);
    expect(JSON.parse(vaultInStore()!)).toEqual(other);
    vi.unstubAllGlobals();
  });

  it('a picked passkey with no server copy and no local vault: "isn\'t ready on this device yet"', async () => {
    seedVault();
    const am = new AuthManager(ndk);
    syncService(null);
    pickFromOsList(OTHER_CRED, OTHER_PRF());

    const error = await am.signInWithAnyPasskey().catch((e) => e);
    expect(error).toBeInstanceOf(PasskeyNotReadyError);
    expect(error.message).toBe(PASSKEY_NOT_READY_MESSAGE);
    expect(JSON.parse(vaultInStore()!)).toEqual(fixtureRecord());
    expect(am.getState().isAuthenticated).toBe(false);
    vi.unstubAllGlobals();
  });

  it('the same message from the chip: the next tap after a cancel picks a passkey that has no copy', async () => {
    seedVault();
    const am = new AuthManager(ndk);
    syncService(null);
    credentials.get.mockRejectedValueOnce(new DOMException('cancelled', 'NotAllowedError'));
    await expect(am.unlockVault()).rejects.toThrow();

    pickFromOsList(OTHER_CRED, OTHER_PRF());
    await expect(am.unlockVault()).rejects.toBeInstanceOf(PasskeyNotReadyError);
    expect(JSON.parse(vaultInStore()!)).toEqual(fixtureRecord());
    vi.unstubAllGlobals();
  });

  it('Forget, unconfirmed vault: refused until the backup key is saved, then removes it and its plaintext key', async () => {
    simulatedAuthenticator({ createPrf: true });
    await (await nsecSession()).enrollVault();
    const am = await nextVisitLocked();
    expect(am.savedLoginHasServerCopy()).toBe(false); // never uploaded
    // The backup flow gets the key without a prompt (its plaintext fallback).
    expect(am.getSavedLoginPlaintextKey()).toBe(fixture.nsecHex);

    expect(() => am.forgetSavedLogin()).toThrow(/Save your backup key/);
    expect(vaultInStore()).toBeDefined();
    expect(store.get(PK_KEY)).toBe(fixture.nsecHex);

    am.forgetSavedLogin({ backupSaved: true }); // Download or verified Copy done

    expect(vaultInStore()).toBeUndefined();
    expect(store.get(PK_KEY)).toBeUndefined();
    expect(store.get(PUB_KEY)).toBeUndefined();
    const next = new AuthManager(makeNdk());
    await flush();
    expect(next.getState().isAuthenticated).toBe(false);
    expect(next.getVaultStatus()).toBe('none');
  });

  it('Forget, confirmed vault without a server copy: one unlock reads the backup key, then Forget is allowed', async () => {
    seedVault();
    store.set(PUB_KEY, fixture.pubkeyHex);
    const am = new AuthManager(ndk);
    await flush();
    expect(am.savedLoginHasServerCopy()).toBe(false);
    expect(am.getSavedLoginPlaintextKey()).toBeNull();
    expect(() => am.forgetSavedLogin()).toThrow(/Save your backup key/);

    credentials.get.mockResolvedValue(fakeAssertion(SAVED_PRF()));
    await expect(am.revealSavedLoginKey()).resolves.toBe(fixture.nsecHex);
    expect(credentials.get).toHaveBeenCalledTimes(1);
    expect(am.getState().isAuthenticated).toBe(false); // memory only, no session
    expect(store.get(PK_KEY)).toBeUndefined(); // nothing persisted

    am.forgetSavedLogin({ backupSaved: true });
    expect(vaultInStore()).toBeUndefined();
  });

  it('Forget, confirmed vault with a server copy: the confirmation alone is enough', async () => {
    store.set('nostrcooking_vault_sync_enabled', '1');
    const record = fixtureRecord();
    record.keys[0].spki = 'AAAA';
    record.keys[0].alg = -7;
    store.set(VAULT_STORAGE_KEY, JSON.stringify(record));
    const am = new AuthManager(ndk);
    await flush();
    expect(am.savedLoginHasServerCopy()).toBe(true);

    am.forgetSavedLogin();

    expect(credentials.get).not.toHaveBeenCalled();
    expect(vaultInStore()).toBeUndefined();
  });

  it('Forget is refused while signed in', async () => {
    seedVault();
    const am = new AuthManager(ndk);
    credentials.get.mockResolvedValue(fakeAssertion(SAVED_PRF()));
    await am.unlockVault();
    expect(() => am.forgetSavedLogin({ backupSaved: true })).toThrow(/Sign out first/);
    expect(vaultInStore()).toBeDefined();
  });
});

describe('sync chosen at setup (unconfirmed vault)', () => {
  it('the preference is stored and can change before confirmation; nothing uploads early', async () => {
    const fetchMock = syncService(null);
    simulatedAuthenticator({ createPrf: true });
    const am = await nsecSession();
    await am.enrollVault({ sync: false });
    expect(store.get('nostrcooking_vault_sync_enabled')).toBe('0');

    am.setUnconfirmedVaultSync(true);
    expect(store.get('nostrcooking_vault_sync_enabled')).toBe('1');
    expect(store.get('nostrcooking_vault_sync_pending')).toBe('1');

    am.setUnconfirmedVaultSync(false);
    expect(store.get('nostrcooking_vault_sync_pending')).toBeUndefined();
    const puts = fetchMock.mock.calls.filter(
      (call: unknown[]) => (call[1] as RequestInit | undefined)?.method === 'PUT'
    );
    expect(puts).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});
