/**
 * Scheduled Posts — encryption-at-rest helpers.
 *
 * Signed events awaiting publish are stored in D1 as
 * AES-256-GCM ciphertext (base64) with a per-row random 12-byte IV.
 *
 * Honest threat model: this protects DB exports and backups from
 * casual exposure. It does NOT protect against the server operator —
 * the broadcast path necessarily holds SCHEDULE_ENC_KEY to decrypt
 * and publish. Don't oversell this property in user-facing copy.
 *
 * Pure module: the key arrives as a parameter (routes read
 * SCHEDULE_ENC_KEY from env; the cron worker reads its own secret),
 * so the identical code runs in Pages functions, the cron worker,
 * and vitest with no env plumbing. Uses only WebCrypto
 * (`crypto.subtle`), which behaves identically in all three.
 */

const IV_BYTES = 12;

/**
 * Import the 64-hex-char (32-byte) SCHEDULE_ENC_KEY into a CryptoKey.
 * Throws on malformed keys so a misconfigured secret fails loudly at
 * startup rather than producing undecryptable rows.
 */
export async function importScheduleKey(hexKey: string): Promise<CryptoKey> {
  if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
    throw new Error('SCHEDULE_ENC_KEY must be exactly 64 hex characters (32 bytes)');
  }
  const raw = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    raw[i] = parseInt(hexKey.slice(i * 2, i * 2 + 2), 16);
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt'
  ]);
}

/**
 * Encrypt a serialized signed event. Returns base64 ciphertext and
 * base64 IV, matching the `ciphertext` / `iv` columns of
 * `scheduled_events`. A fresh random IV is generated per call —
 * never reuse an IV under GCM.
 */
export async function encryptScheduledEvent(
  key: CryptoKey,
  plaintext: string
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv)
  };
}

/**
 * Decrypt a row back to the signed-event JSON string. GCM's auth tag
 * makes any tampering (ciphertext or IV) throw rather than return
 * garbage — callers should let that propagate and mark the row
 * failed, not retry.
 */
export async function decryptScheduledEvent(
  key: CryptoKey,
  ciphertext: string,
  iv: string
): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) },
    key,
    base64ToBytes(ciphertext)
  );
  return new TextDecoder().decode(decrypted);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
