/**
 * Vault-sync blob validation. The blob is the client's vault-v1 record
 * VERBATIM (src/test/fixtures/vault-v1.json is the frozen contract); the
 * server checks shape and size but NEVER decrypts and NEVER logs contents
 * (R2 ruling — enforced by test).
 *
 * The shape rules duplicate the client's isValidRecord (passkeyVault.ts)
 * rather than importing it: that module is browser-only ($app/environment,
 * platform detection). Future cleanup: extract shared record types.
 */

export const MAX_BLOB_BYTES = 4096;

export interface BlobValidationResult {
  pubkey: string;
}

/**
 * Validate a vault blob string. Returns the record pubkey on success,
 * throws on any violation. `assertingCredentialId` must appear in keys[]
 * — an assertion from credential X may only write a blob that credential
 * X can unlock.
 */
export function validateBlob(
  blob: string,
  assertingCredentialId: string
): BlobValidationResult {
  if (new TextEncoder().encode(blob).length > MAX_BLOB_BYTES) {
    throw new Error('blob too large');
  }
  let record: any;
  try {
    record = JSON.parse(blob);
  } catch {
    throw new Error('blob not JSON');
  }
  if (!record || record.version !== 1) throw new Error('blob version unsupported');
  if (typeof record.pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(record.pubkey)) {
    throw new Error('blob pubkey invalid');
  }
  if (typeof record.nsecCiphertext !== 'string' || record.nsecCiphertext.length === 0) {
    throw new Error('blob nsecCiphertext invalid');
  }
  if (!Array.isArray(record.keys) || record.keys.length === 0) {
    throw new Error('blob keys invalid');
  }
  for (const k of record.keys) {
    if (
      !k ||
      typeof k.credentialId !== 'string' ||
      typeof k.wrappedDek !== 'string' ||
      typeof k.dekIv !== 'string'
    ) {
      throw new Error('blob key entry invalid');
    }
  }
  if (!record.keys.some((k: any) => k.credentialId === assertingCredentialId)) {
    throw new Error('asserting credential not in blob keys');
  }
  return { pubkey: record.pubkey };
}

/** Stored KV value shape for a vault-sync entry. */
export interface VaultSyncEntry {
  version: 1;
  blob: string;
  /** SPKI DER from create()'s getPublicKey(), base64url. */
  credentialPublicKey: string;
  /** COSE algorithm from getPublicKeyAlgorithm(): -7 (ES256) or -257 (RS256). */
  alg: number;
  /** Last observed counter. Stored, never enforced (synced passkeys report 0). */
  signCount: number;
  updatedAt: number;
  /**
   * Stored from a registration-authorized first upload (one-prompt signup):
   * no assertion has verified against credentialPublicKey yet. The first
   * verified assertion clears it; until then an assertion-backed upload may
   * replace the entry, and it expires after UNCONFIRMED_TTL_S.
   */
  unconfirmed?: true;
}

/** 12 months + grace (R4 ruling); refreshed on upload and successful fetch. */
export const ENTRY_TTL_S = 370 * 24 * 60 * 60;

/**
 * An unconfirmed entry's lifetime. Short: if the passkey never produces a
 * working assertion (a provider whose get() can't reproduce its PRF), the
 * client drops its local vault but can't sign a DELETE — the entry just
 * expires. A confirming assertion rewrites it with ENTRY_TTL_S.
 */
export const UNCONFIRMED_TTL_S = 30 * 24 * 60 * 60;
