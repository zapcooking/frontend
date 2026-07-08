/**
 * Passkey vault sync — Phase 2 client (cross-device sign-in).
 *
 * Talks to /api/vault-sync/: the Phase 1 vault record travels as an opaque
 * server-side blob so a provider-synced passkey can sign the user in on a
 * brand-new device. The server never decrypts; every request is gated by a
 * WebAuthn assertion over a server challenge (Phase 1 security ruling: a
 * provider-account compromise alone must not yield both the passkey and the
 * ciphertext without a live verified ceremony).
 *
 * Sync is BEST-EFFORT everywhere: the local vault is the product. Upload
 * failure never fails enrollment (dirty flag + retry piggybacked on the
 * next unlock's ceremony); DELETE failure is logged and left to the
 * server-side 370-day TTL; any sign-in failure falls through to normal
 * login with nothing persisted.
 */

import { browser } from '$app/environment';
import {
  RP_ID,
  isCeremonyCancelled,
  saveVaultRecord,
  type AssertionWire,
  type VaultRecord
} from '$lib/passkeyVault';
import {
  PRF_INPUT,
  b64urlToBytes,
  bytesToB64url,
  b64ToBytes,
  hexToBytes,
  deriveKek,
  unwrapDek,
  decryptNsec,
  zeroize
} from '$lib/passkeyVaultCrypto';
import { getPublicKey } from 'nostr-tools';

/**
 * Soft-launch gate (R3): while false, no sync UI renders and no sync
 * network calls are made anywhere — Phase 2 ships dark. Flip deliberately.
 */
export const PASSKEY_SYNC_ENABLED = true;

/**
 * Phase 3 gate: passkey enrollment offered inside account creation
 * ("Secure your account" step). Launch-coupled with PASSKEY_SYNC_ENABLED —
 * the launch PR flips BOTH together and updates the CI flag-guard in the
 * same change (R3 ruling). Guarded on main by .github/workflows/checks.yaml.
 */
export const PASSKEY_SIGNUP_ENABLED = false;

/** '1' = user opted in (R1 default-ON at enrollment); '0' = explicitly off.
 * ABSENT = off — pre-Phase-2 enrollments must never surprise-upload. */
export const SYNC_ENABLED_KEY = 'nostrcooking_vault_sync_enabled';
/** Set when an upload failed; retried on the next unlock ceremony. */
export const SYNC_PENDING_KEY = 'nostrcooking_vault_sync_pending';

export class PasskeySyncError extends Error {}
/** Sign-in failed before anything was persisted — caller falls through. */
export class SyncSignInError extends PasskeySyncError {}

export function isSyncEnabled(): boolean {
  return browser && localStorage.getItem(SYNC_ENABLED_KEY) === '1';
}

export function setSyncEnabled(on: boolean): void {
  if (browser) localStorage.setItem(SYNC_ENABLED_KEY, on ? '1' : '0');
}

export function isUploadPending(): boolean {
  return browser && localStorage.getItem(SYNC_PENDING_KEY) === '1';
}

export function setUploadPending(pending: boolean): void {
  if (!browser) return;
  if (pending) localStorage.setItem(SYNC_PENDING_KEY, '1');
  else localStorage.removeItem(SYNC_PENDING_KEY);
}

/** The record's syncable entry (has SPKI). Pre-Phase-2 records return null. */
export function syncableKeyEntry(record: VaultRecord | null) {
  if (!record) return null;
  return (
    record.keys.find((k) => typeof k.spki === 'string' && (k.alg === -7 || k.alg === -257)) ??
    null
  );
}

// ── HTTP ────────────────────────────────────────────────────────

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Fetch a server challenge. Throws on any failure. */
export async function fetchChallenge(): Promise<string> {
  const res = await fetch('/api/vault-sync/challenge', { method: 'POST' });
  if (!res.ok) throw new PasskeySyncError(`challenge fetch failed (${res.status})`);
  const body = await res.json();
  if (typeof body?.challenge !== 'string') throw new PasskeySyncError('bad challenge response');
  return body.challenge;
}

/** Like fetchChallenge but never throws — sync is best-effort. */
export async function fetchChallengeSafe(): Promise<string | null> {
  try {
    return await fetchChallenge();
  } catch {
    return null;
  }
}

/**
 * Upload the vault record. The assertion must be over a server challenge
 * from the SAME ceremony budget (enrollment verify-get or an unlock).
 * Returns true on success; false marks the upload pending for retry.
 */
export async function uploadVault(
  record: VaultRecord,
  assertion: AssertionWire
): Promise<boolean> {
  const entry = syncableKeyEntry(record);
  if (!entry) return false;
  try {
    const res = await fetch('/api/vault-sync', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        blob: JSON.stringify(record),
        spki: entry.spki,
        alg: entry.alg,
        assertion
      })
    });
    if (!res.ok) {
      setUploadPending(true);
      return false;
    }
    setUploadPending(false);
    return true;
  } catch {
    setUploadPending(true);
    return false;
  }
}

/**
 * Delete the server blob. Best-effort by ruling: a 404 is SUCCESS (the
 * uniform-404 design means "absent or unauthorized are indistinguishable";
 * for the owner's own delete that reads as already-gone — idempotency lives
 * here, client-side). Other failures are logged and abandoned: after
 * removal there is no credential left to assert with, so the server-side
 * 370-day TTL is the backstop. Never throws, never schedules retries.
 */
export async function deleteVaultBlob(assertion: AssertionWire): Promise<void> {
  try {
    const hash = await sha256Hex(b64urlToBytes(assertion.credentialId));
    const res = await fetch(`/api/vault-sync/${hash}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assertion })
    });
    if (!res.ok && res.status !== 404) {
      console.warn('[VaultSync] blob delete failed; server TTL is the backstop', res.status);
    }
  } catch (e) {
    console.warn('[VaultSync] blob delete failed; server TTL is the backstop', e);
  }
}

// ── New-device sign-in ──────────────────────────────────────────

export interface SyncSignInResult {
  /** Decrypted key — memory only; AuthManager builds the signer from it. */
  privkeyHex: string;
  /** The fetched record — AuthManager persists it AFTER the session is live. */
  record: VaultRecord;
}

function isValidRecordShape(r: any): r is VaultRecord {
  return (
    !!r &&
    r.version === 1 &&
    typeof r.pubkey === 'string' &&
    /^[0-9a-f]{64}$/.test(r.pubkey) &&
    typeof r.nsecCiphertext === 'string' &&
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

/**
 * The whole new-device flow, ONE ceremony: server challenge → discoverable
 * get() (empty allowCredentials — the user picks their passkey) with
 * challenge AND prf.eval in the same prompt → assertion-gated blob fetch →
 * local decrypt with the PRF-derived KEK → byte-verify the key against the
 * record pubkey. Throws SyncSignInError (or the cancellation DOMException)
 * with NOTHING persisted; only AuthManager persists, after the session is
 * established.
 */
export async function signInWithPasskey(): Promise<SyncSignInResult> {
  if (!browser) throw new SyncSignInError('browser required');

  const challenge = await fetchChallenge().catch(() => {
    throw new SyncSignInError('Could not reach the sign-in service');
  });

  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: b64urlToBytes(challenge) as BufferSource,
      rpId: RP_ID,
      allowCredentials: [],
      userVerification: 'required',
      extensions: { prf: { eval: { first: new TextEncoder().encode(PRF_INPUT) } } } as any
    }
  })) as PublicKeyCredential | null;
  if (!cred) throw new SyncSignInError('No credential returned');

  const res = cred.response as AuthenticatorAssertionResponse;
  const ext = (cred.getClientExtensionResults() as any)?.prf?.results?.first;
  let prfOutput: Uint8Array | null = null;
  if (ext instanceof ArrayBuffer) prfOutput = new Uint8Array(ext);
  else if (ArrayBuffer.isView(ext)) {
    prfOutput = new Uint8Array(ext.buffer, ext.byteOffset, ext.byteLength);
  }
  if (!prfOutput || prfOutput.length !== 32) {
    // Hybrid/QR cross-device assertions historically drop PRF — fail closed,
    // the overlay falls through to normal login.
    throw new SyncSignInError('This passkey flow did not provide the required key material');
  }

  const assertion: AssertionWire = {
    credentialId: cred.id,
    signature: bytesToB64url(new Uint8Array(res.signature)),
    authenticatorData: bytesToB64url(new Uint8Array(res.authenticatorData)),
    clientDataJSON: bytesToB64url(new Uint8Array(res.clientDataJSON))
  };

  let blob: string;
  try {
    const hash = await sha256Hex(b64urlToBytes(cred.id));
    const httpRes = await fetch(`/api/vault-sync/${hash}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assertion })
    });
    if (!httpRes.ok) throw new Error(String(httpRes.status));
    const body = await httpRes.json();
    if (typeof body?.blob !== 'string') throw new Error('no blob');
    blob = body.blob;
  } catch {
    zeroize(prfOutput);
    throw new SyncSignInError('No synced sign-in found for this passkey');
  }

  // Decrypt locally. A blob that does not decrypt cleanly to the record's
  // own pubkey is NEVER returned (and therefore never persisted).
  const kek = deriveKek(prfOutput);
  let dek: Uint8Array | null = null;
  try {
    const record = JSON.parse(blob);
    if (!isValidRecordShape(record)) throw new Error('bad record shape');
    const entry = record.keys.find((k) => k.credentialId === cred.id);
    if (!entry) throw new Error('credential not in record');
    dek = await unwrapDek(b64ToBytes(entry.wrappedDek), b64ToBytes(entry.dekIv), kek);
    const privkeyHex = decryptNsec(record.nsecCiphertext, dek);
    if (getPublicKey(hexToBytes(privkeyHex)) !== record.pubkey) {
      throw new Error('decrypted key does not match record pubkey');
    }
    return { privkeyHex, record };
  } catch (e) {
    throw new SyncSignInError(
      `Could not unlock the synced vault: ${e instanceof Error ? e.message : String(e)}`
    );
  } finally {
    zeroize(kek, dek, prfOutput);
  }
}

/**
 * Predicate for the signup "Secure your account" step (unit-tested).
 * 'full' only: signup must never render a step that the enrollment
 * ceremony would immediately fail — unsupported browsers get today's
 * signup byte-identical (R4: absent, not disabled).
 */
export function shouldOfferSignupEnrollment(ctx: {
  flagEnabled: boolean;
  support: 'full' | 'no-prf' | 'none';
}): boolean {
  return ctx.flagEnabled && ctx.support === 'full';
}

/** Predicate for the LoginOverlay button (unit-tested). */
export function shouldOfferSyncSignIn(ctx: {
  flagEnabled: boolean;
  hasLocalRecord: boolean;
  supported: boolean;
  isAuthenticated: boolean;
}): boolean {
  // A local record means the existing unlock card owns the surface — no
  // network involved; sync sign-in is strictly for record-less devices.
  return ctx.flagEnabled && ctx.supported && !ctx.hasLocalRecord && !ctx.isAuthenticated;
}

/** Persist a fetched record locally — the device becomes a Phase 1 device. */
export function adoptSyncedRecord(record: VaultRecord): void {
  saveVaultRecord(record);
  // The record arrived via sync, so sync is evidently what the user wants
  // on this account; subsequent uploads from this device keep it fresh.
  setSyncEnabled(true);
}

export { isCeremonyCancelled };
