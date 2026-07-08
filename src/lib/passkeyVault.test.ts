import { describe, it, expect, beforeEach, vi } from 'vitest';
import fixture from '../test/fixtures/vault-v1.json';

/**
 * WebAuthn ceremony tests with a mocked navigator.credentials. The crypto
 * underneath runs REAL (passkeyVaultCrypto) — only the authenticator is
 * faked, so these tests prove the enroll→verify→persist and unlock→decrypt
 * plumbing end to end against the fixture vectors.
 */

vi.mock('$app/environment', () => ({ browser: true }));

import {
  enrollPasskey,
  unlockPasskey,
  getVaultRecord,
  saveVaultRecord,
  deleteVaultRecord,
  detectSupport,
  shouldOfferEnrollment,
  isCeremonyCancelled,
  PrfUnsupportedError,
  UnlockFailedError,
  VAULT_STORAGE_KEY,
  type VaultRecord
} from './passkeyVault';
import { hexToBytes, bytesToB64, b64urlToBytes } from './passkeyVaultCrypto';
import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';

const PRF_BYTES = () => hexToBytes(fixture.prfOutputHex);
const NEW_CRED_ID = 'bmV3LWNyZWQtaWQtMDE'; // b64url of "new-cred-id-01"

function fakeCredential(
  idB64url: string,
  ext: {
    prfResult?: Uint8Array;
    prfEnabled?: boolean;
    prfAsOffsetView?: boolean;
    spki?: Uint8Array;
  } = {}
) {
  const raw = b64urlToBytes(idB64url);
  return {
    id: idB64url,
    rawId: raw.buffer,
    type: 'public-key',
    response: {
      // Assertion-shaped fields (harmlessly present on create-shaped mocks).
      signature: new Uint8Array([1]).buffer,
      authenticatorData: new Uint8Array([2]).buffer,
      clientDataJSON: new Uint8Array([3]).buffer,
      // Attestation-shaped accessors, used when this mocks a create() result.
      getPublicKey: () => (ext.spki ? ext.spki.buffer : null),
      getPublicKeyAlgorithm: () => -7
    },
    getClientExtensionResults: () => {
      if (ext.prfResult) {
        if (ext.prfAsOffsetView) {
          // Some authenticator bridges hand back a TypedArray VIEW at a
          // nonzero offset inside a larger buffer instead of a bare
          // ArrayBuffer. getPrfResult must honor byteOffset/byteLength.
          const padded = new Uint8Array(8 + ext.prfResult.length + 8);
          padded.set(ext.prfResult, 8);
          return {
            prf: { results: { first: new Uint8Array(padded.buffer, 8, ext.prfResult.length) } }
          };
        }
        // Return a copy: production zeroizes the PRF buffer after use, and
        // reusing one Uint8Array across mocked ceremonies would leak that.
        return { prf: { results: { first: ext.prfResult.slice().buffer } } };
      }
      if (ext.prfEnabled !== undefined) return { prf: { enabled: ext.prfEnabled } };
      return {};
    }
  };
}

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

let store: Map<string, string>;
let credentials: { create: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };

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
  // The feature is origin-gated (C ruling): rp.id is always 'zap.cooking'
  // and detectSupport() is 'none' anywhere else, so tests must declare an
  // on-domain origin. Off-domain cases are covered explicitly below.
  vi.stubGlobal('location', { hostname: 'zap.cooking' });
});

describe('vault record storage', () => {
  it('round-trips a valid record', () => {
    saveVaultRecord(fixtureRecord());
    expect(getVaultRecord()).toEqual(fixtureRecord());
    deleteVaultRecord();
    expect(getVaultRecord()).toBeNull();
  });

  it('rejects malformed records instead of throwing', () => {
    store.set(VAULT_STORAGE_KEY, 'not-json');
    expect(getVaultRecord()).toBeNull();
    store.set(VAULT_STORAGE_KEY, JSON.stringify({ version: 2, pubkey: fixture.pubkeyHex }));
    expect(getVaultRecord()).toBeNull();
    store.set(VAULT_STORAGE_KEY, JSON.stringify({ ...fixtureRecord(), keys: [] }));
    expect(getVaultRecord()).toBeNull();
  });
});

describe('enrollPasskey', () => {
  it('happy path: create → verify-on-get → record persisted, then unlockable', async () => {
    credentials.create.mockResolvedValue(fakeCredential(NEW_CRED_ID, { prfEnabled: true }));
    credentials.get.mockResolvedValue(fakeCredential(NEW_CRED_ID, { prfResult: PRF_BYTES() }));

    const { record, assertion } = await enrollPasskey(fixture.nsecHex, fixture.pubkeyHex, 'Test');
    expect(assertion?.credentialId).toBe(NEW_CRED_ID); // verify-get assertion captured

    expect(record.pubkey).toBe(fixture.pubkeyHex);
    expect(record.keys).toHaveLength(1);
    expect(record.keys[0].credentialId).toBe(NEW_CRED_ID);
    expect(getVaultRecord()).toEqual(record);
    // Credentials bind to the fixed production rp id, never the origin.
    const createArgs = credentials.create.mock.calls[0][0].publicKey;
    expect(createArgs.rp.id).toBe('zap.cooking');
    // The verify-get must have pinned allowCredentials to the new credential.
    const getArgs = credentials.get.mock.calls[0][0].publicKey;
    expect(getArgs.rpId).toBe('zap.cooking');
    expect(getArgs.allowCredentials).toHaveLength(1);
    expect(getArgs.userVerification).toBe('required');

    // The persisted record decrypts with the same PRF output.
    credentials.get.mockResolvedValue(
      fakeCredential(NEW_CRED_ID, { prfResult: PRF_BYTES() })
    );
    await expect(unlockPasskey(record)).resolves.toMatchObject({ privkeyHex: fixture.nsecHex });
  });

  it('aborts without persisting when create() reports prf.enabled === false', async () => {
    credentials.create.mockResolvedValue(fakeCredential(NEW_CRED_ID, { prfEnabled: false }));
    await expect(enrollPasskey(fixture.nsecHex, fixture.pubkeyHex, 'Test')).rejects.toThrow(
      PrfUnsupportedError
    );
    expect(credentials.get).not.toHaveBeenCalled();
    expect(getVaultRecord()).toBeNull();
  });

  it('aborts without persisting when get() returns no PRF result (create alone is never trusted)', async () => {
    credentials.create.mockResolvedValue(fakeCredential(NEW_CRED_ID, { prfEnabled: true }));
    credentials.get.mockResolvedValue(fakeCredential(NEW_CRED_ID, {}));
    await expect(enrollPasskey(fixture.nsecHex, fixture.pubkeyHex, 'Test')).rejects.toThrow(
      PrfUnsupportedError
    );
    expect(getVaultRecord()).toBeNull();
  });

  it('bubbles user cancellation without persisting', async () => {
    credentials.create.mockRejectedValue(new DOMException('cancelled', 'NotAllowedError'));
    let caught: unknown;
    await enrollPasskey(fixture.nsecHex, fixture.pubkeyHex, 'Test').catch((e) => (caught = e));
    expect(isCeremonyCancelled(caught)).toBe(true);
    expect(getVaultRecord()).toBeNull();
  });

  it('tags orphanPasskeyLikely ONLY on failures after create() completed', async () => {
    // Before create: no credential exists, no orphan possible.
    let pre: unknown;
    await enrollPasskey('11'.repeat(32), fixture.pubkeyHex, 'Test').catch((e) => (pre = e));
    expect((pre as PrfUnsupportedError).orphanPasskeyLikely).toBeFalsy();

    // After create, PRF missing on verify-get: a provider-side credential
    // may exist — the UI's "safe to delete" note keys off this flag.
    credentials.create.mockResolvedValue(fakeCredential(NEW_CRED_ID, { prfEnabled: true }));
    credentials.get.mockResolvedValue(fakeCredential(NEW_CRED_ID, {}));
    let post: unknown;
    await enrollPasskey(fixture.nsecHex, fixture.pubkeyHex, 'Test').catch((e) => (post = e));
    expect(post).toBeInstanceOf(PrfUnsupportedError);
    expect((post as PrfUnsupportedError).orphanPasskeyLikely).toBe(true);

    // create() itself reporting prf disabled: credential was created.
    credentials.create.mockResolvedValue(fakeCredential(NEW_CRED_ID, { prfEnabled: false }));
    let created: unknown;
    await enrollPasskey(fixture.nsecHex, fixture.pubkeyHex, 'Test').catch((e) => (created = e));
    expect((created as PrfUnsupportedError).orphanPasskeyLikely).toBe(true);
  });

  it('captures SPKI/alg into the key entry when the provider exposes getPublicKey', async () => {
    const spkiBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    credentials.create.mockResolvedValue(
      fakeCredential(NEW_CRED_ID, { prfEnabled: true, spki: spkiBytes })
    );
    credentials.get.mockResolvedValue(fakeCredential(NEW_CRED_ID, { prfResult: PRF_BYTES() }));
    const { record } = await enrollPasskey(fixture.nsecHex, fixture.pubkeyHex, 'Test');
    expect(record.keys[0].spki).toBe('3q2-7w'); // b64url(deadbeef)
    expect(record.keys[0].alg).toBe(-7);
    // Enrollment without getPublicKey still succeeds — fields just absent.
    credentials.create.mockResolvedValue(fakeCredential(NEW_CRED_ID, { prfEnabled: true }));
    credentials.get.mockResolvedValue(fakeCredential(NEW_CRED_ID, { prfResult: PRF_BYTES() }));
    const { record: plain } = await enrollPasskey(fixture.nsecHex, fixture.pubkeyHex, 'Test');
    expect(plain.keys[0].spki).toBeUndefined();
  });

  it('signs the verify-get over a server challenge when provided (two-prompt budget)', async () => {
    credentials.create.mockResolvedValue(fakeCredential(NEW_CRED_ID, { prfEnabled: true }));
    credentials.get.mockResolvedValue(fakeCredential(NEW_CRED_ID, { prfResult: PRF_BYTES() }));
    const serverChallenge = 'c2VydmVyLWNoYWxsZW5nZQ';
    const { assertion } = await enrollPasskey(fixture.nsecHex, fixture.pubkeyHex, 'Test', {
      serverChallenge
    });
    // Exactly one create + one get: the TOFU PUT assertion comes from the
    // SAME verify-get prompt, never a third ceremony.
    expect(credentials.create).toHaveBeenCalledTimes(1);
    expect(credentials.get).toHaveBeenCalledTimes(1);
    const getArgs = credentials.get.mock.calls[0][0].publicKey;
    expect(new Uint8Array(getArgs.challenge)).toEqual(b64urlToBytes(serverChallenge));
    expect(assertion?.credentialId).toBe(NEW_CRED_ID);
  });

  it('migration opt-out of excludeCredentials (excludeExisting: false)', async () => {
    saveVaultRecord(fixtureRecord());
    credentials.create.mockResolvedValue(fakeCredential(NEW_CRED_ID, { prfEnabled: true }));
    credentials.get.mockResolvedValue(fakeCredential(NEW_CRED_ID, { prfResult: PRF_BYTES() }));
    await enrollPasskey(fixture.nsecHex, fixture.pubkeyHex, 'Test', { excludeExisting: false });
    const createArgs = credentials.create.mock.calls[0][0].publicKey;
    expect(createArgs.excludeCredentials).toEqual([]);
  });

  it('rejects a private key that does not match the pubkey', async () => {
    await expect(enrollPasskey('11'.repeat(32), fixture.pubkeyHex, 'Test')).rejects.toThrow(
      /does not match/
    );
    expect(credentials.create).not.toHaveBeenCalled();
  });

  it('passes existing credentials as excludeCredentials on create()', async () => {
    saveVaultRecord(fixtureRecord());
    credentials.create.mockResolvedValue(fakeCredential(NEW_CRED_ID, { prfEnabled: true }));
    credentials.get.mockResolvedValue(fakeCredential(NEW_CRED_ID, { prfResult: PRF_BYTES() }));
    await enrollPasskey(fixture.nsecHex, fixture.pubkeyHex, 'Test');
    const createArgs = credentials.create.mock.calls[0][0].publicKey;
    expect(createArgs.excludeCredentials).toHaveLength(1);
    expect(new Uint8Array(createArgs.excludeCredentials[0].id)).toEqual(
      b64urlToBytes(fixture.credentialIdB64url)
    );
  });
});

describe('unlockPasskey', () => {
  it('decrypts the fixture record with the fixture PRF output', async () => {
    credentials.get.mockResolvedValue(
      fakeCredential(fixture.credentialIdB64url, { prfResult: PRF_BYTES() })
    );
    await expect(unlockPasskey(fixtureRecord())).resolves.toMatchObject({
      privkeyHex: fixture.nsecHex
    });
    const getArgs = credentials.get.mock.calls[0][0].publicKey;
    expect(new Uint8Array(getArgs.allowCredentials[0].id)).toEqual(
      b64urlToBytes(fixture.credentialIdB64url)
    );
  });

  it('fails closed with a wrong PRF output and leaves the record intact', async () => {
    const wrong = PRF_BYTES();
    wrong[0] ^= 0xff;
    saveVaultRecord(fixtureRecord());
    credentials.get.mockResolvedValue(
      fakeCredential(fixture.credentialIdB64url, { prfResult: wrong })
    );
    await expect(unlockPasskey(fixtureRecord())).rejects.toThrow(UnlockFailedError);
    expect(getVaultRecord()).toEqual(fixtureRecord());
  });

  it('fails closed when the assertion uses a credential not in the record', async () => {
    credentials.get.mockResolvedValue(fakeCredential(NEW_CRED_ID, { prfResult: PRF_BYTES() }));
    await expect(unlockPasskey(fixtureRecord())).rejects.toThrow(UnlockFailedError);
  });

  it('fails closed when the decrypted key does not match the record pubkey', async () => {
    const tampered = { ...fixtureRecord(), pubkey: 'ab'.repeat(32) };
    credentials.get.mockResolvedValue(
      fakeCredential(fixture.credentialIdB64url, { prfResult: PRF_BYTES() })
    );
    await expect(unlockPasskey(tampered)).rejects.toThrow(UnlockFailedError);
  });

  it('bubbles user cancellation as a cancellation', async () => {
    credentials.get.mockRejectedValue(new DOMException('cancelled', 'NotAllowedError'));
    let caught: unknown;
    await unlockPasskey(fixtureRecord()).catch((e) => (caught = e));
    expect(isCeremonyCancelled(caught)).toBe(true);
  });

  it('accepts a PRF result delivered as a TypedArray view at a nonzero offset', async () => {
    credentials.get.mockResolvedValue(
      fakeCredential(fixture.credentialIdB64url, { prfResult: PRF_BYTES(), prfAsOffsetView: true })
    );
    await expect(unlockPasskey(fixtureRecord())).resolves.toMatchObject({
      privkeyHex: fixture.nsecHex
    });
  });
});

describe('detectSupport', () => {
  function stubCapabilities(caps: (() => Promise<unknown>) | undefined) {
    const pkc: any = function PublicKeyCredential() {};
    if (caps) pkc.getClientCapabilities = caps;
    vi.stubGlobal('window', { isSecureContext: true, PublicKeyCredential: pkc });
  }

  it("returns 'none' when PublicKeyCredential is absent", async () => {
    vi.stubGlobal('window', { isSecureContext: true });
    expect(await detectSupport()).toBe('none');
  });

  it("returns 'none' outside a secure context", async () => {
    vi.stubGlobal('window', {
      isSecureContext: false,
      PublicKeyCredential: function PublicKeyCredential() {}
    });
    expect(await detectSupport()).toBe('none');
  });

  it("returns 'full' when getClientCapabilities reports extension:prf true", async () => {
    stubCapabilities(async () => ({ 'extension:prf': true }));
    expect(await detectSupport()).toBe('full');
  });

  it("returns 'no-prf' when getClientCapabilities reports extension:prf false", async () => {
    stubCapabilities(async () => ({ 'extension:prf': false }));
    expect(await detectSupport()).toBe('no-prf');
  });

  it("returns provisional 'full' when the extension:prf key is ABSENT (Safari shape)", async () => {
    // Verbatim getClientCapabilities() result observed on Safari/macOS:
    // Safari omits extension keys entirely. Per the WebAuthn spec an absent
    // capability means "unknown", not "unsupported" — the feature must be
    // shown and the enrollment ceremony stays the authoritative check.
    stubCapabilities(async () => ({
      conditionalCreate: true,
      conditionalGet: true,
      hybridTransport: true,
      passkeyPlatformAuthenticator: true,
      relatedOrigins: true,
      userVerifyingPlatformAuthenticator: true
    }));
    expect(await detectSupport()).toBe('full');
  });

  it("returns provisional 'full' when getClientCapabilities is missing (pre-17.4 browsers)", async () => {
    stubCapabilities(undefined);
    expect(await detectSupport()).toBe('full');
  });

  it("returns provisional 'full' when getClientCapabilities throws", async () => {
    stubCapabilities(async () => {
      throw new Error('boom');
    });
    expect(await detectSupport()).toBe('full');
  });

  it("returns provisional 'full' when getClientCapabilities resolves to a non-object", async () => {
    stubCapabilities(async () => undefined);
    expect(await detectSupport()).toBe('full');
  });

  it("returns 'none' on unsupported origins regardless of WebAuthn availability (C ruling)", async () => {
    for (const hostname of [
      'feat-passkey-nsec-vault.frontend-hvd.pages.dev',
      'localhost',
      'zap.cooking.evil.example' // suffix must not match via substring tricks
    ]) {
      vi.stubGlobal('location', { hostname });
      stubCapabilities(async () => ({ 'extension:prf': true }));
      expect(await detectSupport()).toBe('none');
    }
  });

  it("staging.zap.cooking is a supported origin (the pre-prod test surface)", async () => {
    vi.stubGlobal('location', { hostname: 'staging.zap.cooking' });
    stubCapabilities(async () => ({ 'extension:prf': true }));
    expect(await detectSupport()).toBe('full');
  });
});

describe('shouldOfferEnrollment', () => {
  const base = {
    authMethod: 'privateKey' as string | null,
    isAuthenticated: true,
    hasPlaintextKey: true,
    hasVault: false,
    support: 'full' as const,
    dismissed: false
  };

  it('offers only for authenticated plaintext-key sessions with full support', () => {
    expect(shouldOfferEnrollment(base)).toBe(true);
  });

  const negativeCases: Array<[string, Parameters<typeof shouldOfferEnrollment>[0]]> = [
    ['not authenticated', { ...base, isAuthenticated: false }],
    ['nip07 session', { ...base, authMethod: 'nip07' }],
    ['nip46 session', { ...base, authMethod: 'nip46' }],
    ['already enrolled', { ...base, hasVault: true }],
    ['no plaintext key', { ...base, hasPlaintextKey: false }],
    ['no PRF support', { ...base, support: 'no-prf' }],
    ['no WebAuthn', { ...base, support: 'none' }],
    ['dismissed', { ...base, dismissed: true }]
  ];
  for (const [label, ctx] of negativeCases) {
    it(`does not offer when ${label}`, () => {
      expect(shouldOfferEnrollment(ctx)).toBe(false);
    });
  }
});

describe('NDK contract (real NDK, no mock)', () => {
  it('NDKPrivateKeySigner.privateKey returns the hex key encryptionService expects', () => {
    const signer = new NDKPrivateKeySigner(fixture.nsecHex);
    expect(signer.privateKey).toBe(fixture.nsecHex);
    expect(signer.privateKey).toMatch(/^[0-9a-f]{64}$/);
  });
});
