/**
 * Is this a locked passkey session? A passkey vault with no plaintext key
 * and no remote-signer session: authManager deliberately stays
 * unauthenticated until the user unlocks, yet the stored pubkey
 * (nostrcooking_loggedInPublicKey) remains, so the pubkey alone doesn't mean
 * the reader can use signed-in features. Mirrors authManager's restore order
 * (NIP-46, then a stored private key, then the locked vault).
 */
interface StorageLike {
  getItem(k: string): string | null;
}

export function isLockedPasskeySession(storage: StorageLike | null, hasVault: boolean): boolean {
  if (!storage || !hasVault) return false;
  try {
    const nip46 =
      storage.getItem('nostrcooking_authMethod') === 'nip46' &&
      !!storage.getItem('nostrcooking_nip46');
    const privateKey = !!storage.getItem('nostrcooking_privateKey');
    return !nip46 && !privateKey;
  } catch {
    return false;
  }
}
