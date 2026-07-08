import { describe, it, expect, beforeEach, vi } from 'vitest';
import fixture from '../test/fixtures/vault-v1.json';

/**
 * passkeySync unit tests: mocked fetch + mocked authenticator, REAL crypto
 * against the frozen vault-v1 vectors — the blob served by the mocked
 * server is byte-compatible with what the vault-sync endpoints store.
 */

vi.mock('$app/environment', () => ({ browser: true }));

import {
  signInWithPasskey,
  uploadVault,
  deleteVaultBlob,
  fetchChallengeSafe,
  syncableKeyEntry,
  shouldOfferSyncSignIn,
  shouldOfferSignupEnrollment,
  isUploadPending,
  setUploadPending,
  SyncSignInError,
  SYNC_PENDING_KEY
} from './passkeySync';
import { VAULT_STORAGE_KEY, type VaultRecord, type AssertionWire } from './passkeyVault';
import { hexToBytes, bytesToB64, b64urlToBytes, bytesToB64url } from './passkeyVaultCrypto';

const CRED_ID = fixture.credentialIdB64url;

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

const WIRE: AssertionWire = {
  credentialId: CRED_ID,
  signature: 'c2ln',
  authenticatorData: 'YXV0aA',
  clientDataJSON: 'Y2Rq'
};

function assertionCredential(prfBytes: Uint8Array | null, credId = CRED_ID) {
  return {
    id: credId,
    rawId: b64urlToBytes(credId).buffer,
    type: 'public-key',
    response: {
      signature: new Uint8Array([1, 2, 3]).buffer,
      authenticatorData: new Uint8Array([4, 5, 6]).buffer,
      clientDataJSON: new Uint8Array([7, 8, 9]).buffer
    },
    getClientExtensionResults: () =>
      prfBytes ? { prf: { results: { first: prfBytes.slice().buffer } } } : {}
  };
}

let store: Map<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;
let credentials: { get: ReturnType<typeof vi.fn> };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Standard happy server: challenge then blob. */
function happyServer(blob: string) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/challenge')) {
      return jsonResponse(200, { challenge: 'c2VydmVyLWNoYWxsZW5nZQ', expiresAt: Date.now() + 120000 });
    }
    if (init?.method === 'POST') return jsonResponse(200, { blob });
    return jsonResponse(200, { ok: true });
  });
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
  credentials = { get: vi.fn() };
  vi.stubGlobal('navigator', { credentials });
});

describe('signInWithPasskey (new device)', () => {
  it('happy path: one ceremony, blob fetched, decrypted, key verified', async () => {
    happyServer(JSON.stringify(fixtureRecord()));
    credentials.get.mockResolvedValue(assertionCredential(hexToBytes(fixture.prfOutputHex)));

    const { privkeyHex, record } = await signInWithPasskey();

    expect(privkeyHex).toBe(fixture.nsecHex);
    expect(record.pubkey).toBe(fixture.pubkeyHex);
    // Exactly ONE ceremony, with server challenge AND prf.eval together,
    // discoverable (empty allowCredentials).
    expect(credentials.get).toHaveBeenCalledTimes(1);
    const getArgs = credentials.get.mock.calls[0][0].publicKey;
    expect(getArgs.allowCredentials).toEqual([]);
    expect(bytesToB64url(new Uint8Array(getArgs.challenge))).toBe('c2VydmVyLWNoYWxsZW5nZQ');
    expect(getArgs.extensions.prf.eval.first).toBeDefined();
    // Nothing persisted by this module — persistence is AuthManager's call.
    expect(store.get(VAULT_STORAGE_KEY)).toBeUndefined();
  });

  it('challenge fetch failure → SyncSignInError, no ceremony, nothing persisted', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { error: 'not_configured' }));
    await expect(signInWithPasskey()).rejects.toThrow(SyncSignInError);
    expect(credentials.get).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it('blob fetch 404 → SyncSignInError, nothing persisted', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/challenge')
        ? jsonResponse(200, { challenge: 'YQ', expiresAt: Date.now() + 120000 })
        : jsonResponse(404, { error: 'not_found' })
    );
    credentials.get.mockResolvedValue(assertionCredential(hexToBytes(fixture.prfOutputHex)));
    await expect(signInWithPasskey()).rejects.toThrow(/No synced sign-in/);
    expect(store.size).toBe(0);
  });

  it('missing PRF output (hybrid/QR shape) → fails closed before any fetch of the blob', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { challenge: 'YQ', expiresAt: Date.now() + 120000 })
    );
    credentials.get.mockResolvedValue(assertionCredential(null));
    await expect(signInWithPasskey()).rejects.toThrow(/key material/);
    // challenge fetch happened; blob fetch must NOT have.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('tampered blob (wrong ciphertext) → SyncSignInError, nothing persisted', async () => {
    const bad = fixtureRecord();
    bad.nsecCiphertext = bad.nsecCiphertext.slice(0, -8) + 'AAAAAAA=';
    happyServer(JSON.stringify(bad));
    credentials.get.mockResolvedValue(assertionCredential(hexToBytes(fixture.prfOutputHex)));
    await expect(signInWithPasskey()).rejects.toThrow(SyncSignInError);
    expect(store.size).toBe(0);
  });

  it('blob whose pubkey does not match the decrypted key → rejected', async () => {
    const swapped = fixtureRecord();
    swapped.pubkey = 'ab'.repeat(32);
    happyServer(JSON.stringify(swapped));
    credentials.get.mockResolvedValue(assertionCredential(hexToBytes(fixture.prfOutputHex)));
    await expect(signInWithPasskey()).rejects.toThrow(SyncSignInError);
  });

  it('blob lacking the asserting credential → rejected', async () => {
    happyServer(JSON.stringify(fixtureRecord()));
    credentials.get.mockResolvedValue(
      assertionCredential(hexToBytes(fixture.prfOutputHex), 'b3RoZXItY3JlZA')
    );
    await expect(signInWithPasskey()).rejects.toThrow(SyncSignInError);
  });
});

describe('uploadVault', () => {
  it('success clears the pending flag and sends blob+spki+assertion', async () => {
    setUploadPending(true);
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    const ok = await uploadVault(fixtureRecord(), WIRE);
    expect(ok).toBe(true);
    expect(isUploadPending()).toBe(false);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.spki).toBe('dGVzdC1zcGtp');
    expect(body.alg).toBe(-7);
    expect(JSON.parse(body.blob).pubkey).toBe(fixture.pubkeyHex);
    expect(body.assertion).toEqual(WIRE);
  });

  it('failure sets the pending flag (enrollment is never failed by upload)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, {}));
    expect(await uploadVault(fixtureRecord(), WIRE)).toBe(false);
    expect(isUploadPending()).toBe(true);
  });

  it('network throw sets the pending flag', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));
    expect(await uploadVault(fixtureRecord(), WIRE)).toBe(false);
    expect(isUploadPending()).toBe(true);
  });

  it('record without SPKI (pre-Phase-2) is not uploadable', async () => {
    expect(await uploadVault(fixtureRecord(false), WIRE)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('deleteVaultBlob — client-side idempotency (ruling pin)', () => {
  it('404 is treated as already-gone: resolves cleanly, no retry state, no error', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'not_found' }));

    await expect(deleteVaultBlob(WIRE)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1); // no retry loop
    expect(warnSpy).not.toHaveBeenCalled(); // not even a warning — it's success
    expect(store.get(SYNC_PENDING_KEY)).toBeUndefined(); // no retry state
    warnSpy.mockRestore();
  });

  it('non-404 failure logs and abandons (TTL is the backstop) — never throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValue(jsonResponse(500, {}));
    await expect(deleteVaultBlob(WIRE)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('targets sha256(credentialId) in the path', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    await deleteVaultBlob(WIRE);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toMatch(/\/api\/vault-sync\/[0-9a-f]{64}$/);
  });
});

describe('helpers', () => {
  it('fetchChallengeSafe never throws', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    expect(await fetchChallengeSafe()).toBeNull();
  });

  it('syncableKeyEntry requires spki with a supported alg', () => {
    expect(syncableKeyEntry(fixtureRecord())).toBeTruthy();
    expect(syncableKeyEntry(fixtureRecord(false))).toBeNull();
    expect(syncableKeyEntry(null)).toBeNull();
    const badAlg = fixtureRecord();
    (badAlg.keys[0] as any).alg = -8;
    expect(syncableKeyEntry(badAlg)).toBeNull();
  });

  it('shouldOfferSignupEnrollment: flag AND full support only (step absent, never disabled)', () => {
    expect(shouldOfferSignupEnrollment({ flagEnabled: true, support: 'full' })).toBe(true);
    expect(shouldOfferSignupEnrollment({ flagEnabled: false, support: 'full' })).toBe(false);
    expect(shouldOfferSignupEnrollment({ flagEnabled: true, support: 'no-prf' })).toBe(false);
    expect(shouldOfferSignupEnrollment({ flagEnabled: true, support: 'none' })).toBe(false);
  });

  it('shouldOfferSyncSignIn matrix', () => {
    const base = {
      flagEnabled: true,
      hasLocalRecord: false,
      supported: true,
      isAuthenticated: false
    };
    expect(shouldOfferSyncSignIn(base)).toBe(true);
    expect(shouldOfferSyncSignIn({ ...base, flagEnabled: false })).toBe(false);
    // Local record present → the unlock card owns the surface.
    expect(shouldOfferSyncSignIn({ ...base, hasLocalRecord: true })).toBe(false);
    expect(shouldOfferSyncSignIn({ ...base, supported: false })).toBe(false);
    expect(shouldOfferSyncSignIn({ ...base, isAuthenticated: true })).toBe(false);
  });
});
