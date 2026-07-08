/**
 * Minimal WebAuthn assertion verification for the vault-sync endpoints.
 *
 * Deliberately dependency-free (Gate 1 ruling): we never parse attestation
 * objects — clients register with the SPKI DER from
 * AuthenticatorAttestationResponse.getPublicKey(), so verification reduces
 * to fixed-offset authenticatorData parsing, clientDataJSON checks, and a
 * WebCrypto signature verify. Supports the two algorithms Phase 1 requests
 * at create(): ES256 (-7) and RS256 (-257).
 *
 * Security posture notes:
 * - rpIdHash is pinned to sha256('zap.cooking') — same constant the client
 *   enforces (passkeyVault.ts RP_ID).
 * - UV (user verification) flag is REQUIRED; Phase 1 ceremonies always set
 *   userVerification: 'required'.
 * - signCount: stored last-seen only, NEVER enforced to increment — synced
 *   passkeys (GPM, iCloud Keychain) report 0 or regress by design, so an
 *   increment check would lock out exactly the credentials this feature
 *   exists for (per ruling, Gate 2 addition 4).
 */

export const RP_ID = 'zap.cooking';

/** Origins allowed to produce assertions (mirrors the client origin gate). */
export function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:') return false;
    return url.hostname === RP_ID || url.hostname.endsWith(`.${RP_ID}`);
  } catch {
    return false;
  }
}

export interface ParsedAuthenticatorData {
  rpIdHash: Uint8Array;
  userPresent: boolean;
  userVerified: boolean;
  signCount: number;
}

export function parseAuthenticatorData(data: Uint8Array): ParsedAuthenticatorData {
  if (data.length < 37) throw new Error('authenticatorData too short');
  const flags = data[32];
  return {
    rpIdHash: data.slice(0, 32),
    userPresent: (flags & 0x01) !== 0,
    userVerified: (flags & 0x04) !== 0,
    signCount: (data[33] << 24) | (data[34] << 16) | (data[35] << 8) | data[36]
  };
}

/**
 * Convert an ASN.1/DER-encoded ECDSA signature (what authenticators emit)
 * to the raw r||s form WebCrypto verifies. Each integer is left-padded or
 * trimmed to 32 bytes (P-256).
 */
export function derToRawEcdsa(der: Uint8Array): Uint8Array {
  let offset = 0;
  if (der[offset++] !== 0x30) throw new Error('invalid DER: no sequence');
  let seqLen = der[offset++];
  if (seqLen & 0x80) {
    const lenBytes = seqLen & 0x7f;
    if (lenBytes < 1 || lenBytes > 2) throw new Error('invalid DER: bad length');
    seqLen = 0;
    for (let i = 0; i < lenBytes; i++) seqLen = (seqLen << 8) | der[offset++];
  }
  if (offset + seqLen !== der.length) throw new Error('invalid DER: length mismatch');

  const readInt = (): Uint8Array => {
    if (der[offset++] !== 0x02) throw new Error('invalid DER: no integer');
    let len = der[offset++];
    if (len & 0x80) throw new Error('invalid DER: overlong integer');
    let bytes = der.slice(offset, offset + len);
    offset += len;
    // Strip leading zero sign bytes, then left-pad to 32.
    while (bytes.length > 32 && bytes[0] === 0x00) bytes = bytes.slice(1);
    if (bytes.length > 32) throw new Error('invalid DER: integer too long');
    const out = new Uint8Array(32);
    out.set(bytes, 32 - bytes.length);
    return out;
  };

  const r = readInt();
  const s = readInt();
  if (offset !== der.length) throw new Error('invalid DER: trailing bytes');
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));
}

let rpIdHashCache: Uint8Array | null = null;
async function expectedRpIdHash(): Promise<Uint8Array> {
  if (!rpIdHashCache) rpIdHashCache = await sha256(new TextEncoder().encode(RP_ID));
  return rpIdHashCache;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

export function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) =>
    c.charCodeAt(0)
  );
}

export function bytesToB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface AssertionInput {
  /** Raw signature bytes from the assertion (DER for ES256). */
  signature: Uint8Array;
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
}

export interface VerifiedAssertion {
  /** Last-seen counter for storage. Never used for enforcement (see header). */
  signCount: number;
}

/**
 * Verify a WebAuthn assertion. Throws on ANY failure — callers map every
 * throw to the uniform 404 (no oracle). Returns the observed signCount.
 *
 * @param expectedChallenge exact challenge string the client was issued
 *   (base64url) — compared against clientDataJSON.challenge.
 */
export async function verifyAssertion(
  input: AssertionInput,
  spkiDer: Uint8Array,
  coseAlg: number,
  expectedChallenge: string
): Promise<VerifiedAssertion> {
  // 1. clientDataJSON: type, challenge, origin.
  let clientData: { type?: string; challenge?: string; origin?: string };
  try {
    clientData = JSON.parse(new TextDecoder().decode(input.clientDataJSON));
  } catch {
    throw new Error('clientDataJSON not JSON');
  }
  if (clientData.type !== 'webauthn.get') throw new Error('wrong clientData type');
  if (
    typeof clientData.challenge !== 'string' ||
    clientData.challenge !== expectedChallenge
  ) {
    throw new Error('challenge mismatch');
  }
  if (typeof clientData.origin !== 'string' || !isAllowedOrigin(clientData.origin)) {
    throw new Error('origin not allowed');
  }

  // 2. authenticatorData: rpIdHash + UV.
  const authData = parseAuthenticatorData(input.authenticatorData);
  if (!constantTimeEqual(authData.rpIdHash, await expectedRpIdHash())) {
    throw new Error('rpIdHash mismatch');
  }
  if (!authData.userPresent) throw new Error('UP flag not set');
  if (!authData.userVerified) throw new Error('UV flag not set');

  // 3. Signature over authenticatorData || sha256(clientDataJSON).
  const signedData = new Uint8Array(input.authenticatorData.length + 32);
  signedData.set(input.authenticatorData, 0);
  signedData.set(await sha256(input.clientDataJSON), input.authenticatorData.length);

  let ok: boolean;
  if (coseAlg === -7) {
    const key = await crypto.subtle.importKey(
      'spki',
      spkiDer as BufferSource,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      derToRawEcdsa(input.signature) as BufferSource,
      signedData as BufferSource
    );
  } else if (coseAlg === -257) {
    const key = await crypto.subtle.importKey(
      'spki',
      spkiDer as BufferSource,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      input.signature as BufferSource,
      signedData as BufferSource
    );
  } else {
    throw new Error(`unsupported algorithm ${coseAlg}`);
  }
  if (!ok) throw new Error('signature verification failed');

  return { signCount: authData.signCount };
}
