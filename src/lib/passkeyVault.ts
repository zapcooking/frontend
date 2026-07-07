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

/** rp.id: fixed on production (related-origins file already deployed), host-default elsewhere (dev). */
function rpIdForOrigin(): string | undefined {
  const host = typeof location !== 'undefined' ? location.hostname : '';
  return host === 'zap.cooking' || host.endsWith('.zap.cooking') ? 'zap.cooking' : undefined;
}

export interface VaultKeyEntry {
  credentialId: string; // base64url rawId
  wrappedDek: string; // base64
  dekIv: string; // base64
  addedAt: number;
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
  const bytes = first instanceof ArrayBuffer ? new Uint8Array(first) : new Uint8Array(first.buffer ?? first);
  return bytes.length === 32 ? bytes : null;
}

/**
 * Assert with the given credentials + PRF eval and return {credentialId, prfOutput}.
 * Shared by enrollment-verify and unlock.
 */
async function assertWithPrf(
  credentialIds: string[]
): Promise<{ credentialId: string; prfOutput: Uint8Array }> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: randomChallenge() as BufferSource,
      rpId: rpIdForOrigin(),
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
  return { credentialId: assertion.id, prfOutput };
}

/**
 * Full enrollment ceremony. Creates a passkey, then IMMEDIATELY does a get()
 * and verifies the PRF output round-trips a wrap/unwrap + nsec encrypt/decrypt
 * before anything is persisted — several providers only return PRF results on
 * get(), so create()-time signals are never trusted alone. On any failure the
 * vault storage is left untouched (an orphan passkey may remain in the user's
 * provider; we cannot delete authenticator-side credentials).
 */
export async function enrollPasskey(
  privkeyHex: string,
  pubkey: string,
  userLabel: string
): Promise<VaultRecord> {
  const normalizedKey = privkeyHex.toLowerCase();
  if (getPublicKey(hexToBytes(normalizedKey)) !== pubkey) {
    throw new PasskeyVaultError('private key does not match the session pubkey');
  }

  // Exclude credentials already in a record so providers refuse duplicates.
  const existing = getVaultRecord();
  const excludeCredentials = (existing?.keys ?? []).map((k) => ({
    type: 'public-key' as const,
    id: b64urlToBytes(k.credentialId) as BufferSource
  }));

  const created = (await navigator.credentials.create({
    publicKey: {
      challenge: randomChallenge() as BufferSource,
      rp: { id: rpIdForOrigin(), name: 'Zap Cooking' },
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

  // Verify-on-get: derive the KEK from a real assertion, never from create().
  const { credentialId, prfOutput } = await assertWithPrf([created.id]);

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
          addedAt: now
        }
      ]
    };
    saveVaultRecord(record);
    return record;
  } catch (e) {
    if (e instanceof PasskeyVaultError) throw e;
    throw new EnrollVerifyError(
      `Vault verification failed: ${e instanceof Error ? e.message : String(e)}`
    );
  } finally {
    zeroize(kek, dek, verifyDek, prfOutput);
  }
}

/**
 * Unlock ceremony: assert with any enrolled credential, unwrap the DEK, and
 * return the decrypted 64-hex private key (memory only — callers must never
 * persist it). Fails closed on any mismatch; never mutates storage.
 */
export async function unlockPasskey(record: VaultRecord): Promise<string> {
  const { credentialId, prfOutput } = await assertWithPrf(
    record.keys.map((k) => k.credentialId)
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
    return privkeyHex;
  } catch (e) {
    if (e instanceof PasskeyVaultError) throw e;
    throw new UnlockFailedError(
      `Could not decrypt the vault with this passkey: ${e instanceof Error ? e.message : String(e)}`
    );
  } finally {
    zeroize(kek, dek, prfOutput);
  }
}
