/**
 * Passkey-wrapped nsec vault (Phase 1: local-only, web-only).
 *
 * WebAuthn PRF ceremonies + the localStorage vault record. Crypto lives in
 * passkeyVaultCrypto.ts; AuthManager owns all session state and is the ONLY
 * module allowed to touch `nostrcooking_privateKey` — this module never
 * reads or writes the plaintext key, so the "delete plaintext only on
 * verified enrollment success" invariant is enforceable in one place.
 *
 * Platform: the feature is web-only. Capacitor WebViews (iOS WKWebView has
 * no WebAuthn at all; Android WebView has no usable PRF) are excluded
 * explicitly via isNative() in addition to API feature detection.
 */

import { browser } from '$app/environment';
import { isNative } from '$lib/platform';
import {
  PRF_INPUT,
  b64urlToBytes,
  bytesToB64,
  bytesToB64url,
  b64ToBytes,
  hexToBytes,
  deriveKek,
  wrapDek,
  unwrapDek,
  encryptNsec,
  decryptNsec,
  generateDek,
  zeroize
} from '$lib/passkeyVaultCrypto';
import { getPublicKey } from 'nostr-tools';

export const VAULT_STORAGE_KEY = 'nostrcooking_vault_v1';
export const VAULT_PROMPT_DISMISSED_KEY = 'nostrcooking_vault_prompt_dismissed';

/**
 * All credentials bind to the production rp id — never the current origin.
 * A hostname-derived rp.id (the previous behavior) let preview/pages.dev
 * builds mint working passkeys bound to throwaway origins; per the C ruling
 * the feature is instead cleanly ABSENT off zap.cooking/*.zap.cooking (see
 * isSupportedOrigin), and staging.zap.cooking is the pre-prod test surface.
 */
export const RP_ID = 'zap.cooking';

function isSupportedOrigin(): boolean {
  const host = typeof location !== 'undefined' ? location.hostname : '';
  return host === RP_ID || host.endsWith(`.${RP_ID}`);
}

export interface VaultKeyEntry {
  credentialId: string; // base64url rawId
  wrappedDek: string; // base64
  dekIv: string; // base64
  addedAt: number;
  /**
   * Credential public key (SPKI DER, base64url) + COSE alg, captured from
   * create()'s getPublicKey() at enrollment. OPTIONAL extension over the
   * frozen v1 shape (Phase 1 records lack it; validation never requires
   * it): public material only, needed for the vault-sync TOFU upload and
   * for re-enabling sync after toggle-off. Records missing it can only
   * gain sync via guided re-enrollment.
   */
  spki?: string;
  alg?: number;
}

export interface VaultRecord {
  version: 1;
  pubkey: string; // hex
  nsecCiphertext: string; // NIP-44 v2 payload (base64)
  createdAt: number;
  keys: VaultKeyEntry[];
}

export class PasskeyVaultError extends Error {}
/** Authenticator/provider has no usable PRF — enrollment must not proceed. */
export class PrfUnsupportedError extends PasskeyVaultError {}
/** Post-enroll round-trip verification failed — nothing was persisted. */
export class EnrollVerifyError extends PasskeyVaultError {}
/** Unlock ceremony completed but decryption failed (wrong credential/PRF). */
export class UnlockFailedError extends PasskeyVaultError {}

/** True when the user dismissed/cancelled the WebAuthn prompt. */
export function isCeremonyCancelled(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError');
}

// ── Vault record storage ────────────────────────────────────────

function isValidRecord(r: any): r is VaultRecord {
  return (
    !!r &&
    r.version === 1 &&
    typeof r.pubkey === 'string' &&
    /^[0-9a-f]{64}$/.test(r.pubkey) &&
    typeof r.nsecCiphertext === 'string' &&
    r.nsecCiphertext.length > 0 &&
    Array.isArray(r.keys) &&
    r.keys.length > 0 &&
    r.keys.every(
      (k: any) =>
        k &&
        typeof k.credentialId === 'string' &&
        typeof k.wrappedDek === 'string' &&
        typeof k.dekIv === 'string'
    )
  );
}

export function getVaultRecord(): VaultRecord | null {
  if (!browser) return null;
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveVaultRecord(record: VaultRecord): void {
  // Throw rather than silently return outside the browser: a silent no-op
  // here would let an enrollment "succeed" without a persisted record, and
  // AuthManager deletes the plaintext key right after.
  if (!browser) throw new Error('saveVaultRecord requires a browser environment');
  localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(record));
}

export function deleteVaultRecord(): void {
  if (!browser) return;
  localStorage.removeItem(VAULT_STORAGE_KEY);
}

// ── Feature detection ───────────────────────────────────────────

export type VaultSupport = 'full' | 'no-prf' | 'none';

/**
 * 'none'   — no WebAuthn surface at all (native app, insecure context, old browser)
 * 'no-prf' — WebAuthn present but the platform reports no PRF support
 * 'full'   — PRF believed available. Still provisional: only the enrollment
 *            ceremony's verify-on-get proves it for the actual provider.
 */
export async function detectSupport(): Promise<VaultSupport> {
  if (!browser || isNative()) return 'none';
  if (!isSupportedOrigin()) return 'none';
  if (!window.isSecureContext) return 'none';
  const pkc = (window as any).PublicKeyCredential;
  if (!pkc || !navigator.credentials?.create) return 'none';
  try {
    if (typeof pkc.getClientCapabilities === 'function') {
      const caps = await pkc.getClientCapabilities();
      const prf = caps?.['extension:prf'];
      if (prf === false) return 'no-prf';
      // true → full; ABSENT → provisional 'full'. Safari omits extension
      // keys from getClientCapabilities entirely, and per the WebAuthn spec
      // an absent capability means "unknown", not "unsupported" — only an
      // explicit false may hide the feature. The enrollment ceremony
      // (prf.enabled on create + PRF output verified on get) remains the
      // authoritative check either way.
      return 'full';
    }
  } catch {
    /* capability probe failed — fall through to provisional */
  }
  return 'full';
}

/** Pure predicate for the migration prompt (unit-tested). */
export function shouldOfferEnrollment(ctx: {
  authMethod: string | null;
  isAuthenticated: boolean;
  hasPlaintextKey: boolean;
  hasVault: boolean;
  support: VaultSupport;
  dismissed: boolean;
}): boolean {
  return (
    ctx.isAuthenticated &&
    ctx.authMethod === 'privateKey' &&
    ctx.hasPlaintextKey &&
    !ctx.hasVault &&
    ctx.support === 'full' &&
    !ctx.dismissed
  );
}

// ── Ceremonies ──────────────────────────────────────────────────

function randomChallenge(): Uint8Array {
  // No server verifies these ceremonies; the challenge only prevents replay
  // inside the WebAuthn API itself.
  return crypto.getRandomValues(new Uint8Array(32));
}

function prfExtensionEval(): { prf: { eval: { first: Uint8Array } } } {
  return { prf: { eval: { first: new TextEncoder().encode(PRF_INPUT) } } };
}

function getPrfResult(cred: PublicKeyCredential): Uint8Array | null {
  const ext = (cred.getClientExtensionResults() as any)?.prf;
  const first = ext?.results?.first;
  if (!first) return null;
  // Spec says ArrayBuffer, but tolerate TypedArray/DataView results from
  // authenticator bridges — honoring byteOffset/byteLength, since a view
  // into a larger buffer must not be read whole (it would fail the 32-byte
  // check on a valid PRF output). Deliberately kept as a VIEW, not a copy:
  // callers zeroize the returned bytes, and scrubbing in place also clears
  // the extension-result buffer itself.
  let bytes: Uint8Array;
  if (first instanceof ArrayBuffer) {
    bytes = new Uint8Array(first);
  } else if (ArrayBuffer.isView(first)) {
    bytes = new Uint8Array(first.buffer, first.byteOffset, first.byteLength);
  } else {
    return null;
  }
  return bytes.length === 32 ? bytes : null;
}

/**
 * Wire form of a WebAuthn assertion (all base64url), matching what the
 * vault-sync endpoints verify. Only meaningful server-side when the
 * ceremony used a SERVER-issued challenge; assertions over local random
 * challenges are returned too but are not redeemable.
 */
export interface AssertionWire {
  credentialId: string;
  signature: string;
  authenticatorData: string;
  clientDataJSON: string;
}

export interface CeremonyOptions {
  /**
   * Server-issued challenge (base64url, from POST /api/vault-sync/challenge).
   * When set, the ceremony signs over it so the SAME prompt's assertion can
   * authenticate a vault-sync request — this is how enrollment stays at two
   * prompts (verify-get doubles as the TOFU PUT assertion) and how removal
   * reuses its single unlock ceremony for DELETE.
   */
  serverChallenge?: string;
}

function wireAssertion(cred: PublicKeyCredential): AssertionWire | null {
  const res = cred.response as AuthenticatorAssertionResponse | undefined;
  if (!res?.signature || !res?.authenticatorData || !res?.clientDataJSON) return null;
  return {
    credentialId: cred.id,
    signature: bytesToB64url(new Uint8Array(res.signature)),
    authenticatorData: bytesToB64url(new Uint8Array(res.authenticatorData)),
    clientDataJSON: bytesToB64url(new Uint8Array(res.clientDataJSON))
  };
}

/**
 * Assert with the given credentials + PRF eval. Shared by enrollment-verify
 * and unlock. Returns the assertion wire form alongside the PRF output.
 */
async function assertWithPrf(
  credentialIds: string[],
  opts?: CeremonyOptions
): Promise<{ credentialId: string; prfOutput: Uint8Array; assertion: AssertionWire | null }> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: (opts?.serverChallenge
        ? b64urlToBytes(opts.serverChallenge)
        : randomChallenge()) as BufferSource,
      rpId: RP_ID,
      allowCredentials: credentialIds.map((id) => ({
        type: 'public-key' as const,
        id: b64urlToBytes(id) as BufferSource
      })),
      userVerification: 'required',
      extensions: prfExtensionEval() as any
    }
  })) as PublicKeyCredential | null;
  if (!assertion) throw new UnlockFailedError('Passkey assertion returned no credential');
  const prfOutput = getPrfResult(assertion);
  if (!prfOutput) {
    throw new PrfUnsupportedError('Passkey provider did not return a PRF result on get()');
  }
  return { credentialId: assertion.id, prfOutput, assertion: wireAssertion(assertion) };
}

/**
 * Full enrollment ceremony. Creates a passkey, then IMMEDIATELY does a get()
 * and verifies the PRF output round-trips a wrap/unwrap + nsec encrypt/decrypt
 * before anything is persisted — several providers only return PRF results on
 * get(), so create()-time signals are never trusted alone. On any failure the
 * vault storage is left untouched (an orphan passkey may remain in the user's
 * provider; we cannot delete authenticator-side credentials).
 */
export interface EnrollResult {
  record: VaultRecord;
  /**
   * The verify-get assertion. When opts.serverChallenge was provided this is
   * redeemable as the vault-sync TOFU PUT assertion (two-prompt budget).
   */
  assertion: AssertionWire | null;
}

export interface EnrollOptions extends CeremonyOptions {
  /**
   * Set false for guided re-enrollment (migration of pre-Phase-2 records):
   * the point is to mint a NEW credential while the old one still exists on
   * the provider, and excludeCredentials would make the provider refuse.
   */
  excludeExisting?: boolean;
}

export async function enrollPasskey(
  privkeyHex: string,
  pubkey: string,
  userLabel: string,
  opts?: EnrollOptions
): Promise<EnrollResult> {
  const normalizedKey = privkeyHex.toLowerCase();
  if (getPublicKey(hexToBytes(normalizedKey)) !== pubkey) {
    throw new PasskeyVaultError('private key does not match the session pubkey');
  }

  // Exclude credentials already in a record so providers refuse duplicates.
  const existing = getVaultRecord();
  const excludeCredentials =
    opts?.excludeExisting === false
      ? []
      : (existing?.keys ?? []).map((k) => ({
          type: 'public-key' as const,
          id: b64urlToBytes(k.credentialId) as BufferSource
        }));

  const created = (await navigator.credentials.create({
    publicKey: {
      challenge: randomChallenge() as BufferSource,
      rp: { id: RP_ID, name: 'Zap Cooking' },
      user: {
        id: hexToBytes(pubkey) as BufferSource,
        name: userLabel,
        displayName: userLabel
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 } // RS256
      ],
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required'
      },
      excludeCredentials,
      extensions: { prf: {} } as any
    }
  })) as PublicKeyCredential | null;
  if (!created) throw new PasskeyVaultError('Passkey creation returned no credential');

  const createExt = (created.getClientExtensionResults() as any)?.prf;
  if (createExt && createExt.enabled === false) {
    throw new PrfUnsupportedError('Passkey provider reported PRF unsupported on create()');
  }

  // Capture the credential public key for vault-sync (SPKI DER — no CBOR
  // attestation parsing anywhere). Public material; absence just means sync
  // is unavailable for this entry.
  let spki: string | undefined;
  let alg: number | undefined;
  try {
    const attRes = created.response as AuthenticatorAttestationResponse;
    const spkiDer = attRes.getPublicKey?.();
    const algNum = attRes.getPublicKeyAlgorithm?.();
    if (spkiDer && (algNum === -7 || algNum === -257)) {
      spki = bytesToB64url(new Uint8Array(spkiDer));
      alg = algNum;
    }
  } catch {
    /* provider without getPublicKey — sync unavailable, vault still fine */
  }

  // Verify-on-get: derive the KEK from a real assertion, never from create().
  // With opts.serverChallenge this same prompt also produces the TOFU PUT
  // assertion — enrollment must never grow a third ceremony.
  const { credentialId, prfOutput, assertion } = await assertWithPrf([created.id], opts);

  const kek = deriveKek(prfOutput);
  const dek = generateDek();
  let verifyDek: Uint8Array | null = null;
  try {
    const { wrappedDek, iv } = await wrapDek(dek, kek);
    const nsecCiphertext = encryptNsec(normalizedKey, dek);

    // Round-trip with independently unwrapped material before persisting.
    verifyDek = await unwrapDek(wrappedDek, iv, kek);
    if (decryptNsec(nsecCiphertext, verifyDek) !== normalizedKey) {
      throw new EnrollVerifyError('Vault round-trip verification failed');
    }

    const now = Date.now();
    const record: VaultRecord = {
      version: 1,
      pubkey,
      nsecCiphertext,
      createdAt: now,
      keys: [
        {
          credentialId,
          wrappedDek: bytesToB64(wrappedDek),
          dekIv: bytesToB64(iv),
          addedAt: now,
          ...(spki && alg !== undefined ? { spki, alg } : {})
        }
      ]
    };
    saveVaultRecord(record);
    return { record, assertion };
  } catch (e) {
    if (e instanceof PasskeyVaultError) throw e;
    throw new EnrollVerifyError(
      `Vault verification failed: ${e instanceof Error ? e.message : String(e)}`
    );
  } finally {
    zeroize(kek, dek, verifyDek, prfOutput);
  }
}

export interface UnlockResult {
  /** Decrypted 64-hex private key — memory only, callers must never persist it. */
  privkeyHex: string;
  credentialId: string;
  /** Redeemable server-side only when opts.serverChallenge was provided. */
  assertion: AssertionWire | null;
}

/**
 * Unlock ceremony: assert with any enrolled credential, unwrap the DEK, and
 * return the decrypted private key. Fails closed on any mismatch; never
 * mutates storage. With opts.serverChallenge the same single prompt also
 * yields a vault-sync-redeemable assertion (used by removal's DELETE and
 * the pending-upload retry — no second prompt, ever).
 */
export async function unlockPasskey(
  record: VaultRecord,
  opts?: CeremonyOptions
): Promise<UnlockResult> {
  const { credentialId, prfOutput, assertion } = await assertWithPrf(
    record.keys.map((k) => k.credentialId),
    opts
  );
  const entry = record.keys.find((k) => k.credentialId === credentialId);
  if (!entry) {
    zeroize(prfOutput);
    throw new UnlockFailedError('Assertion used a credential not present in the vault');
  }

  const kek = deriveKek(prfOutput);
  let dek: Uint8Array | null = null;
  try {
    dek = await unwrapDek(b64ToBytes(entry.wrappedDek), b64ToBytes(entry.dekIv), kek);
    const privkeyHex = decryptNsec(record.nsecCiphertext, dek);
    if (getPublicKey(hexToBytes(privkeyHex)) !== record.pubkey) {
      throw new UnlockFailedError('Decrypted key does not match the vault pubkey');
    }
    return { privkeyHex, credentialId, assertion };
  } catch (e) {
    if (e instanceof PasskeyVaultError) throw e;
    throw new UnlockFailedError(
      `Could not decrypt the vault with this passkey: ${e instanceof Error ? e.message : String(e)}`
    );
  } finally {
    zeroize(kek, dek, prfOutput);
  }
}
