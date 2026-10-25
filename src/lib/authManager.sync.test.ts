import { describe, it, expect, beforeEach, vi } from 'vitest';
import fixture from '../test/fixtures/vault-v1.json';

/**
 * AuthManager ↔ vault-sync integration with PASSKEY_SYNC_ENABLED forced ON
 * (partial module mock — everything else in passkeySync runs real). Mocked
 * fetch + mocked authenticator; crypto real against the frozen vectors.
 */

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('./passkeySync', async (importOriginal: () => Promise<unknown>) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, PASSKEY_SYNC_ENABLED: true };
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
import {
  SYNC_ENABLED_KEY,
  SYNC_PENDING_KEY,
  SYNC_REFRESHED_AT_KEY,
  SYNC_REFRESH_INTERVAL_MS
} from './passkeySync';
import { hexToBytes, bytesToB64 } from './passkeyVaultCrypto';

const CRED_ID = fixture.credentialIdB64url;
const PK_KEY = 'nostrcooking_privateKey';
const OTHER_NSEC = '22'.repeat(32);

function fixtureRecord(withSpki = true): VaultRecord {
  return {
    version: 1,
    pubkey: fixture.pubkeyHex,
    nsecCiphertext: fixture.expectedNsecCiphertextB64,
    createdAt: 1,
    keys: [
      {
        credentialId: CRED_ID,
        wrappedDek: fixture.expectedWrappedDekB64,
        dekIv: bytesToB64(hexToBytes(fixture.dekIvHex)),
        addedAt: 1,
        ...(withSpki ? { spki: 'dGVzdC1zcGtp', alg: -7 } : {})
      }
    ]
  };
}

function fakeCredential(
  credId: string,
  ext: { prfResult?: Uint8Array; prfEnabled?: boolean; spki?: boolean } = {}
) {
  const raw = Uint8Array.from(atob(credId.replace(/-/g, '+').replace(/_/g, '/') + '=='), (c) =>
    c.charCodeAt(0)
  );
  return {
    id: credId,
    rawId: raw.buffer,
    type: 'public-key',
    response: {
      signature: new Uint8Array([1]).buffer,
      authenticatorData: new Uint8Array([2]).buffer,
      clientDataJSON: new Uint8Array([3]).buffer,
      getPublicKey: () => (ext.spki === false ? null : new Uint8Array([9, 9]).buffer),
      getPublicKeyAlgorithm: () => -7
    },
    getClientExtensionResults: () => {
      if (ext.prfResult) return { prf: { results: { first: ext.prfResult.slice().buffer } } };
      if (ext.prfEnabled !== undefined) return { prf: { enabled: ext.prfEnabled } };
      return {};
    }
  };
}

let store: Map<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;
let credentials: { create: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
let ndk: { signer: any; activeUser: any };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });
const flush = () => new Promise((r) => setTimeout(r, 10));
const seedVault = (withSpki = true) =>
  store.set(VAULT_STORAGE_KEY, JSON.stringify(fixtureRecord(withSpki)));

/** Server that accepts everything; records calls by method+path. */
function acceptingServer() {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/challenge')) {
      return json(200, { challenge: 'c2VydmVyLWNoYWxsZW5nZQ', expiresAt: Date.now() + 120000 });
    }
    return json(200, { ok: true, blob: JSON.stringify(fixtureRecord()) });
  });
}

function callsTo(method: string): Array<[string, RequestInit | undefined]> {
  return fetchMock.mock.calls.filter(([, init]: any) => (init?.method ?? 'GET') === method);
}

beforeEach(() => {
  store = new Map();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
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

describe('enrollment with sync', () => {
  async function loggedInManager() {
    const am = new AuthManager(ndk);
    await am.authenticateWithPrivateKey(fixture.nsecHex);
    return am;
  }

  it('sync ON: two prompts total, TOFU PUT sent with the verify-get assertion', async () => {
    acceptingServer();
    const am = await loggedInManager();
    credentials.create.mockResolvedValue(fakeCredential(CRED_ID, { prfEnabled: true }));
    credentials.get.mockResolvedValue(
      fakeCredential(CRED_ID, { prfResult: hexToBytes(fixture.prfOutputHex) })
    );

    await am.enrollVault({ sync: true });
    await flush();

    // Two-prompt budget (Gate 2 addition 2): exactly one create, one get.
    expect(credentials.create).toHaveBeenCalledTimes(1);
    expect(credentials.get).toHaveBeenCalledTimes(1);

    const puts = callsTo('PUT');
    expect(puts).toHaveLength(1);
    const body = JSON.parse(puts[0][1]!.body as string);
    expect(body.spki).toBeDefined();
    expect(body.assertion.credentialId).toBe(CRED_ID);
    expect(store.get(SYNC_ENABLED_KEY)).toBe('1');
    expect(store.get(SYNC_PENDING_KEY)).toBeUndefined();
    expect(store.get(PK_KEY)).toBeUndefined(); // plaintext still deleted
  });

  it('sync OFF: no network calls at all, toggle recorded off', async () => {
    const am = await loggedInManager();
    fetchMock.mockClear();
    credentials.create.mockResolvedValue(fakeCredential(CRED_ID, { prfEnabled: true }));
    credentials.get.mockResolvedValue(
      fakeCredential(CRED_ID, { prfResult: hexToBytes(fixture.prfOutputHex) })
    );
    await am.enrollVault({ sync: false });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.get(SYNC_ENABLED_KEY)).toBe('0');
  });

  it('upload failure never fails enrollment; pending flag set', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/challenge')
        ? json(200, { challenge: 'YQ', expiresAt: Date.now() + 120000 })
        : json(500, {})
    );
    const am = await loggedInManager();
    credentials.create.mockResolvedValue(fakeCredential(CRED_ID, { prfEnabled: true }));
    credentials.get.mockResolvedValue(
      fakeCredential(CRED_ID, { prfResult: hexToBytes(fixture.prfOutputHex) })
    );

    await am.enrollVault({ sync: true });
    await flush();

    expect(am.getState().authMethod).toBe('passkey'); // enrollment succeeded
    expect(store.get(VAULT_STORAGE_KEY)).toBeDefined();
    expect(store.get(PK_KEY)).toBeUndefined();
    expect(store.get(SYNC_PENDING_KEY)).toBe('1');
  });

  it('challenge fetch failure degrades to pending, enrollment succeeds with a local challenge', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    const am = await loggedInManager();
    fetchMock.mockClear();
    fetchMock.mockRejectedValue(new TypeError('offline'));
    credentials.create.mockResolvedValue(fakeCredential(CRED_ID, { prfEnabled: true }));
    credentials.get.mockResolvedValue(
      fakeCredential(CRED_ID, { prfResult: hexToBytes(fixture.prfOutputHex) })
    );
    await am.enrollVault({ sync: true });
    expect(am.getState().authMethod).toBe('passkey');
    expect(store.get(SYNC_PENDING_KEY)).toBe('1');
  });
});

describe('signup enrollment options (signIn / awaitUpload)', () => {
  function passkeyCeremony() {
    credentials.create.mockResolvedValue(fakeCredential(CRED_ID, { prfEnabled: true }));
    credentials.get.mockResolvedValue(
      fakeCredential(CRED_ID, { prfResult: hexToBytes(fixture.prfOutputHex) })
    );
  }

  it('signIn:false enrolls (record saved) without signing in', async () => {
    acceptingServer();
    passkeyCeremony();
    const am = new AuthManager(ndk);
    const result = await am.enrollAtSignup(fixture.nsecHex, fixture.pubkeyHex, {
      sync: false,
      signIn: false
    });
    expect(result).toEqual({ uploaded: null, confirmed: true });
    expect(store.get(VAULT_STORAGE_KEY)).toBeDefined();
    expect(am.getState().isAuthenticated).toBe(false);
    expect(store.get(PK_KEY)).toBeUndefined();
  });

  it('awaitUpload reports a landed upload and clears nothing pending', async () => {
    acceptingServer();
    passkeyCeremony();
    const am = new AuthManager(ndk);
    const result = await am.enrollAtSignup(fixture.nsecHex, fixture.pubkeyHex, {
      sync: true,
      signIn: false,
      awaitUpload: true
    });
    expect(result).toEqual({ uploaded: true, confirmed: true });
    expect(callsTo('PUT')).toHaveLength(1);
    expect(store.get(SYNC_PENDING_KEY)).toBeUndefined();
  });

  it('awaitUpload reports a failed upload (pending kept for the next unlock)', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/challenge')
        ? json(200, { challenge: 'YQ', expiresAt: Date.now() + 120000 })
        : json(500, {})
    );
    passkeyCeremony();
    const am = new AuthManager(ndk);
    const result = await am.enrollAtSignup(fixture.nsecHex, fixture.pubkeyHex, {
      sync: true,
      signIn: false,
      awaitUpload: true
    });
    expect(result).toEqual({ uploaded: false, confirmed: true });
    expect(store.get(SYNC_PENDING_KEY)).toBe('1');
  });

  it('awaitUpload with no server challenge (offline) reports not uploaded', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    passkeyCeremony();
    const am = new AuthManager(ndk);
    const result = await am.enrollAtSignup(fixture.nsecHex, fixture.pubkeyHex, {
      sync: true,
      signIn: false,
      awaitUpload: true
    });
    expect(result).toEqual({ uploaded: false, confirmed: true });
  });
});

describe('vault-sync request deadlines', () => {
  // A fetch that never answers on its own — only the abort signal ends it.
  function hangingUnlessAborted(match: (url: string, init?: RequestInit) => boolean) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (!match(String(url), init)) {
        return Promise.resolve(
          String(url).endsWith('/challenge')
            ? json(200, { challenge: 'YQ', expiresAt: Date.now() + 120000 })
            : json(200, { ok: true })
        );
      }
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'TimeoutError')));
      });
    });
  }
  // AbortSignal.timeout → a signal the test fires, so no real 5–10 s wait.
  function controllableDeadlines() {
    const controllers: AbortController[] = [];
    const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const c = new AbortController();
      controllers.push(c);
      return c.signal;
    });
    return { fireAll: () => controllers.forEach((c) => c.abort()), spy };
  }

  it('a stalled challenge fetch does not hold the unlock: it goes ahead locally', async () => {
    seedVault();
    store.set(SYNC_ENABLED_KEY, '1'); // refresh due (never stamped)
    hangingUnlessAborted((url) => url.endsWith('/challenge'));
    const d = controllableDeadlines();
    const am = new AuthManager(ndk);
    credentials.get.mockResolvedValue(
      fakeCredential(CRED_ID, { prfResult: hexToBytes(fixture.prfOutputHex) })
    );
    const p = am.unlockVault();
    await flush();
    expect(credentials.get).not.toHaveBeenCalled(); // still waiting on the challenge
    d.fireAll();
    await p;
    expect(am.getState().isAuthenticated).toBe(true);
    expect(credentials.get).toHaveBeenCalledTimes(1);
    d.spy.mockRestore();
  });

  it('a stalled signup upload reports not uploaded and stays pending', async () => {
    hangingUnlessAborted((_url, init) => init?.method === 'PUT');
    const d = controllableDeadlines();
    credentials.create.mockResolvedValue(fakeCredential(CRED_ID, { prfEnabled: true }));
    credentials.get.mockResolvedValue(
      fakeCredential(CRED_ID, { prfResult: hexToBytes(fixture.prfOutputHex) })
    );
    const am = new AuthManager(ndk);
    const p = am.enrollAtSignup(fixture.nsecHex, fixture.pubkeyHex, {
      sync: true,
      signIn: false,
      awaitUpload: true
    });
    for (let i = 0; i < 20 && callsTo('PUT').length === 0; i++) await flush();
    expect(callsTo('PUT')).toHaveLength(1);
    d.fireAll();
    expect(await p).toEqual({ uploaded: false, confirmed: true });
    expect(store.get(SYNC_PENDING_KEY)).toBe('1');
    d.spy.mockRestore();
  });
});

describe('pending-upload retry on unlock', () => {
  it('retries the upload with the unlock ceremony assertion (single prompt)', async () => {
    seedVault();
    store.set(SYNC_ENABLED_KEY, '1');
    store.set(SYNC_PENDING_KEY, '1');
    acceptingServer();
    const am = new AuthManager(ndk);
    credentials.get.mockResolvedValue(
      fakeCredential(CRED_ID, { prfResult: hexToBytes(fixture.prfOutputHex) })
    );

    await am.unlockVault();
    await flush();

    expect(credentials.get).toHaveBeenCalledTimes(1); // one ceremony, dual use
    expect(callsTo('PUT')).toHaveLength(1);
    expect(store.get(SYNC_PENDING_KEY)).toBeUndefined();
  });

  it('sync on, nothing pending → the same ceremony refreshes the entry TTL (no PUT)', async () => {
    seedVault();
    store.set(SYNC_ENABLED_KEY, '1');
    acceptingServer();
    const am = new AuthManager(ndk);
    credentials.get.mockResolvedValue(
      fakeCredential(CRED_ID, { prfResult: hexToBytes(fixture.prfOutputHex) })
    );
    await am.unlockVault();
    await flush();

    expect(credentials.get).toHaveBeenCalledTimes(1); // still one prompt
    const posts = callsTo('POST').filter(([url]) => !String(url).endsWith('/challenge'));
    expect(posts).toHaveLength(1);
    expect(String(posts[0][0])).toMatch(/^\/api\/vault-sync\/[0-9a-f]{64}$/);
    expect(JSON.parse(posts[0][1]!.body as string).assertion.credentialId).toBe(CRED_ID);
    expect(callsTo('PUT')).toHaveLength(0);
  });

  it('refresh is throttled to once a day per device: a second unlock the same day makes no call', async () => {
    seedVault();
    store.set(SYNC_ENABLED_KEY, '1');
    acceptingServer();
    const am = new AuthManager(ndk);
    credentials.get.mockResolvedValue(
      fakeCredential(CRED_ID, { prfResult: hexToBytes(fixture.prfOutputHex) })
    );
    await am.unlockVault();
    await flush();
    const stamped = Number(store.get(SYNC_REFRESHED_AT_KEY));
    expect(stamped).toBeGreaterThan(0);
    fetchMock.mockClear();

    await am.unlockVault();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();

    // A day later it's due again.
    store.set(SYNC_REFRESHED_AT_KEY, String(stamped - SYNC_REFRESH_INTERVAL_MS));
    await am.unlockVault();
    await flush();
    expect(callsTo('POST').filter(([url]) => !String(url).endsWith('/challenge'))).toHaveLength(1);
  });

  it('a pending upload still retries the same day (throttle applies to refreshes only)', async () => {
    seedVault();
    store.set(SYNC_ENABLED_KEY, '1');
    store.set(SYNC_REFRESHED_AT_KEY, String(Date.now()));
    store.set(SYNC_PENDING_KEY, '1');
    acceptingServer();
    const am = new AuthManager(ndk);
    credentials.get.mockResolvedValue(
      fakeCredential(CRED_ID, { prfResult: hexToBytes(fixture.prfOutputHex) })
    );
    await am.unlockVault();
    await flush();
    expect(callsTo('PUT')).toHaveLength(1);
  });

  it('sync on but the entry is gone (404) → the same assertion re-uploads it', async () => {
    seedVault();
    store.set(SYNC_ENABLED_KEY, '1');
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/challenge')) return json(200, { challenge: 'YQ', expiresAt: Date.now() + 120000 });
      if (init?.method === 'POST') return json(404, { error: 'not_found' });
      return json(200, { ok: true });
    });
    const am = new AuthManager(ndk);
    credentials.get.mockResolvedValue(
      fakeCredential(CRED_ID, { prfResult: hexToBytes(fixture.prfOutputHex) })
    );
    await am.unlockVault();
    await flush();
    expect(callsTo('PUT')).toHaveLength(1);
    expect(store.get(SYNC_PENDING_KEY)).toBeUndefined();
  });

  it('sync off → unlock makes zero network calls', async () => {
    seedVault();
    store.set(SYNC_ENABLED_KEY, '0');
    const am = new AuthManager(ndk);
    credentials.get.mockResolvedValue(
      fakeCredential(CRED_ID, { prfResult: hexToBytes(fixture.prfOutputHex) })
    );
    await am.unlockVault();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('challenge fetch failure → unlock still succeeds offline, flag survives', async () => {
    seedVault();
    store.set(SYNC_ENABLED_KEY, '1');
    store.set(SYNC_PENDING_KEY, '1');
    fetchMock.mockRejectedValue(new TypeError('offline'));
    const am = new AuthManager(ndk);
    credentials.get.mockResolvedValue(
      fakeCredential(CRED_ID, { prfResult: hexToBytes(fixture.prfOutputHex) })
    );
    await am.unlockVault();
    expect(am.getState().isAuthenticated).toBe(true);
    expect(store.get(SYNC_PENDING_KEY)).toBe('1');
  });
});

describe('removal issues DELETE with the reused ceremony', () => {
  async function unlockedManager() {
    seedVault();
    store.set(SYNC_ENABLED_KEY, '1');
    acceptingServer();
    const am = new AuthManager(ndk);
    credentials.get.mockResolvedValue(
      fakeCredential(CRED_ID, { prfResult: hexToBytes(fixture.prfOutputHex) })
    );
    await am.unlockVault();
    fetchMock.mockClear();
    acceptingServer();
    credentials.get.mockClear();
    return am;
  }

  it('one ceremony serves both the downgrade and the DELETE', async () => {
    const am = await unlockedManager();
    await am.removeVault();
    await flush();

    expect(credentials.get).toHaveBeenCalledTimes(1);
    const deletes = callsTo('DELETE');
    expect(deletes).toHaveLength(1);
    expect(String(deletes[0][0])).toMatch(/\/api\/vault-sync\/[0-9a-f]{64}$/);
    expect(store.get(PK_KEY)).toBe(fixture.nsecHex);
    expect(store.get(VAULT_STORAGE_KEY)).toBeUndefined();
    expect(store.get(SYNC_ENABLED_KEY)).toBe('0');
  });

  it('DELETE returning 404 is already-gone: removal completes with no error state (ruling pin)', async () => {
    const am = await unlockedManager();
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/challenge')
        ? json(200, { challenge: 'YQ', expiresAt: Date.now() + 120000 })
        : json(404, { error: 'not_found' })
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(am.removeVault()).resolves.toBeUndefined();
    await flush();

    expect(am.getState().authMethod).toBe('privateKey'); // downgrade done
    expect(warnSpy).not.toHaveBeenCalled(); // 404 = success, not even a warning
    expect(callsTo('DELETE')).toHaveLength(1); // no retry loop
    expect(store.get(SYNC_PENDING_KEY)).toBeUndefined(); // no retry state
    warnSpy.mockRestore();
  });
});

describe('sync toggle (R1 kill-switch)', () => {
  async function unlockedManager() {
    seedVault();
    acceptingServer();
    const am = new AuthManager(ndk);
    credentials.get.mockResolvedValue(
      fakeCredential(CRED_ID, { prfResult: hexToBytes(fixture.prfOutputHex) })
    );
    await am.unlockVault();
    fetchMock.mockClear();
    acceptingServer();
    credentials.get.mockClear();
    return am;
  }

  it('toggle ON: one ceremony, TOFU PUT, flag set', async () => {
    const am = await unlockedManager();
    store.set(SYNC_ENABLED_KEY, '0');
    await am.setVaultSync(true);
    expect(credentials.get).toHaveBeenCalledTimes(1);
    expect(callsTo('PUT')).toHaveLength(1);
    expect(store.get(SYNC_ENABLED_KEY)).toBe('1');
  });

  it('toggle OFF: one ceremony, DELETE, flag cleared', async () => {
    const am = await unlockedManager();
    store.set(SYNC_ENABLED_KEY, '1');
    await am.setVaultSync(false);
    expect(credentials.get).toHaveBeenCalledTimes(1);
    expect(callsTo('DELETE')).toHaveLength(1);
    expect(store.get(SYNC_ENABLED_KEY)).toBe('0');
  });

  it('toggle ON with a failed upload stays OFF and reports', async () => {
    const am = await unlockedManager();
    store.set(SYNC_ENABLED_KEY, '0');
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/challenge')
        ? json(200, { challenge: 'YQ', expiresAt: Date.now() + 120000 })
        : json(500, {})
    );
    await expect(am.setVaultSync(true)).rejects.toThrow(/remains off/);
    expect(store.get(SYNC_ENABLED_KEY)).toBe('0');
    expect(store.get(SYNC_PENDING_KEY)).toBeUndefined(); // failed opt-in ≠ pending
  });

  it('pre-Phase-2 record (no SPKI) → refuses with re-enrollment guidance, no ceremony', async () => {
    seedVault(false);
    acceptingServer();
    const am = new AuthManager(ndk);
    credentials.get.mockResolvedValue(
      fakeCredential(CRED_ID, { prfResult: hexToBytes(fixture.prfOutputHex) })
    );
    await am.unlockVault();
    credentials.get.mockClear();
    await expect(am.setVaultSync(true)).rejects.toThrow(/Re-create/);
    expect(credentials.get).not.toHaveBeenCalled();
  });
});

describe('new-device sign-in (signInWithPasskeySync)', () => {
  it('establishes the session AND writes the record (device becomes Phase 1)', async () => {
    acceptingServer();
    const am = new AuthManager(ndk);
    credentials.get.mockResolvedValue(
      fakeCredential(CRED_ID, { prfResult: hexToBytes(fixture.prfOutputHex) })
    );

    await am.signInWithPasskeySync();

    const state = am.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.authMethod).toBe('passkey');
    expect(state.publicKey).toBe(fixture.pubkeyHex);
    expect(ndk.signer?.privateKey).toBe(fixture.nsecHex);
    expect(store.get(PK_KEY)).toBeUndefined(); // never plaintext
    expect(JSON.parse(store.get(VAULT_STORAGE_KEY)!).pubkey).toBe(fixture.pubkeyHex);
    expect(store.get(SYNC_ENABLED_KEY)).toBe('1');
  });

  it('failed decrypt persists nothing and leaves the user logged out', async () => {
    const bad = fixtureRecord();
    bad.nsecCiphertext = bad.nsecCiphertext.slice(0, -8) + 'AAAAAAA=';
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/challenge')
        ? json(200, { challenge: 'YQ', expiresAt: Date.now() + 120000 })
        : json(200, { blob: JSON.stringify(bad) })
    );
    const am = new AuthManager(ndk);
    credentials.get.mockResolvedValue(
      fakeCredential(CRED_ID, { prfResult: hexToBytes(fixture.prfOutputHex) })
    );

    await expect(am.signInWithPasskeySync()).rejects.toThrow();
    expect(am.getState().isAuthenticated).toBe(false);
    expect(store.get(VAULT_STORAGE_KEY)).toBeUndefined();
    expect(ndk.signer).toBeNull();
  });
});

describe('conflict-replace makes NO network call (R4 regression)', () => {
  it('replacing a synced vault with a different account touches only local storage', async () => {
    seedVault();
    store.set(SYNC_ENABLED_KEY, '1');
    const am = new AuthManager(ndk);

    await expect(am.authenticateWithPrivateKey(OTHER_NSEC)).rejects.toThrow(VaultConflictError);
    await am.authenticateWithPrivateKey(OTHER_NSEC, { replaceVault: true });
    await flush();

    expect(am.getState().isAuthenticated).toBe(true);
    expect(store.get(VAULT_STORAGE_KEY)).toBeUndefined(); // local record gone
    expect(fetchMock).not.toHaveBeenCalled(); // server blob untouched — R4
    expect(credentials.get).not.toHaveBeenCalled(); // and no ceremony either
  });
});
