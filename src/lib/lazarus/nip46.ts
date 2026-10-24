/**
 * NIP-46 remote signers receive every request NIP-44 encrypted, and NIP-44
 * caps plaintext at 65,535 bytes. A request that carries a large event or
 * ciphertext (a big follow list, or a mute list with hundreds of private
 * items) can't be sent at all. Those can only be signed or decrypted by a
 * signer that doesn't go through NIP-46, such as a NIP-07 extension or a
 * local key.
 *
 * Vendored from the spec’s reference implementation (dmnyc/jumble-spark, branch feat/lazarus-data-recovery, src/lib/nip46.ts).
 */
export const NIP46_MAX_REQUEST_BYTES = 65535;

/** Size of a NIP-46 request before encryption, allowing for a 64-character request id. */
export function getNip46RequestBytes(method: string, params: string[]): number {
  return new TextEncoder().encode(JSON.stringify({ id: '0'.repeat(64), method, params })).length;
}

export function fitsNip46Request(method: string, params: string[]): boolean {
  return getNip46RequestBytes(method, params) <= NIP46_MAX_REQUEST_BYTES;
}
