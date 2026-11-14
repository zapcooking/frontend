/**
 * What someone pasted into the private-key sign-in field, and the NIP-49
 * decrypt step for ncryptsec keys — the password-encrypted export format the
 * mobile apps offer. nsec and hex keys pass straight through to
 * AuthManager.authenticateWithPrivateKey; ncryptsec must be decrypted here
 * first, because only this layer knows the password.
 */
import * as nip49 from 'nostr-tools/nip49';

export type PrivateKeyInputKind = 'ncryptsec' | 'nsec' | 'hex' | 'invalid';

export function classifyPrivateKeyInput(input: string): PrivateKeyInputKind {
  const value = input.trim();
  if (!value) return 'invalid';
  if (value.startsWith('ncryptsec1')) return 'ncryptsec';
  if (value.startsWith('nsec1')) return 'nsec';
  if (/^[0-9a-fA-F]{64}$/.test(value)) return 'hex';
  return 'invalid';
}

/**
 * Decrypt a pasted ncryptsec key to the private-key hex
 * AuthManager.authenticateWithPrivateKey expects. Throws on a wrong
 * password or malformed key — callers translate that into UI copy.
 */
export function decryptNcryptsec(ncryptsec: string, password: string): string {
  const secret = nip49.decrypt(ncryptsec.trim(), password);
  return Array.from(secret)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
