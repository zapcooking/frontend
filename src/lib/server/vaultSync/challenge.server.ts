/**
 * Stateless HMAC-signed challenges for the vault-sync endpoints.
 *
 * Design (Gate 1, investigator's choice, ratified): challenges are
 * self-authenticating — base64url(nonce(32) || issuedAt(8, ms BE) ||
 * HMAC-SHA256(nonce || issuedAt)) under VAULT_SYNC_CHALLENGE_SECRET — so
 * issuance costs no KV read. Redemption verifies the MAC and the 2-minute
 * expiry, then writes a best-effort short-TTL tombstone for single-use.
 * KV's eventual consistency means single-use is not a hard guarantee
 * cross-PoP; that's acceptable because a replayed assertion can only
 * re-fetch the same ciphertext the captor already saw — it can never
 * produce PRF output.
 */

export const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const TOMBSTONE_TTL_S = 180;
const TOMBSTONE_PREFIX = 'challenge-used:';

type KVLike = {
  get(key: string, type?: 'text' | 'json'): Promise<string | unknown | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) =>
    c.charCodeAt(0)
  );
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/** Issue a challenge. `now` is injectable for tests only. */
export async function issueChallenge(
  secret: string,
  now = Date.now()
): Promise<{ challenge: string; expiresAt: number }> {
  const payload = new Uint8Array(40);
  crypto.getRandomValues(payload.subarray(0, 32));
  new DataView(payload.buffer).setBigUint64(32, BigInt(now), false);
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', await hmacKey(secret), payload as BufferSource)
  );
  const challenge = new Uint8Array(72);
  challenge.set(payload, 0);
  challenge.set(mac, 40);
  return { challenge: b64url(challenge), expiresAt: now + CHALLENGE_TTL_MS };
}

/**
 * Redeem a challenge: MAC valid, within TTL, not already redeemed.
 * Throws on any failure (callers map to the uniform 404).
 */
export async function redeemChallenge(
  kv: KVLike | undefined,
  secret: string,
  challenge: string,
  now = Date.now()
): Promise<void> {
  let bytes: Uint8Array;
  try {
    bytes = fromB64url(challenge);
  } catch {
    throw new Error('challenge not base64url');
  }
  if (bytes.length !== 72) throw new Error('challenge wrong length');

  const payload = bytes.subarray(0, 40);
  const mac = bytes.subarray(40);
  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    mac as BufferSource,
    payload as BufferSource
  );
  if (!valid) throw new Error('challenge MAC invalid');

  const issuedAt = Number(new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(32, false));
  if (now < issuedAt || now - issuedAt > CHALLENGE_TTL_MS) {
    throw new Error('challenge expired');
  }

  // Best-effort single-use tombstone (see header for why best-effort).
  if (kv) {
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', bytes as BufferSource)
    );
    const key =
      TOMBSTONE_PREFIX +
      Array.from(digest)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    if (await kv.get(key)) throw new Error('challenge already redeemed');
    await kv.put(key, '1', { expirationTtl: TOMBSTONE_TTL_S });
  }
}
