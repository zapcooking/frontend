/**
 * A returning member whose key is in a passkey vault on this device lands
 * signed out (the vault is locked until a passkey ceremony). Nothing opens
 * by itself: the header shows "Continue as {name}" and one tap unlocks.
 *
 * The root layout decides whether that applies (it owns the AuthManager
 * restore) and publishes the vault's pubkey here; the header and the
 * sign-in sheet read it.
 */
import { writable } from 'svelte/store';
import type { ProfileState } from '$lib/profileStore';

/** The locked vault's pubkey, or null when there is nothing to continue. */
export const lockedVaultPubkey = writable<string | null>(null);

export interface LockedVaultInput {
  isAuthenticated: boolean;
  vaultStatus: 'none' | 'locked' | 'unlocked' | undefined;
  /** A plaintext key is restoring instead (legacy nsec session). */
  hasPlaintextKey: boolean;
  /** A bunker session is reconnecting instead. */
  isNip46: boolean;
  /** passkeyVault.detectSupport(): an unsupported origin can't unlock. */
  support: 'full' | 'no-prf' | 'none';
}

/** Signed out with only a locked vault behind the cached pubkey. */
function isLockedVaultSession(input: Omit<LockedVaultInput, 'support'>): boolean {
  return (
    !input.isAuthenticated &&
    input.vaultStatus === 'locked' &&
    !input.hasPlaintextKey &&
    !input.isNip46
  );
}

export function shouldOfferContinue(input: LockedVaultInput): boolean {
  return isLockedVaultSession(input) && input.support !== 'none';
}

/**
 * A locked vault this browser can't unlock (e.g. a record left on a preview
 * origin, where the passkey's rp id doesn't apply). There is no chip, so
 * the cached pubkey must not make the header show the account menu: the
 * visitor needs Sign in / Join free.
 */
export function isStrandedLockedVault(input: LockedVaultInput): boolean {
  return isLockedVaultSession(input) && input.support === 'none';
}

/**
 * The member's own name from their kind 0, for "Continue as {name}".
 * Never an npub: null until a name is known, and the button then says
 * "Continue" next to the avatar.
 */
export function continueName(state: ProfileState | null | undefined): string | null {
  if (!state || state.status !== 'found') return null;
  const { display_name, name } = state.profile;
  const picked = (display_name || '').trim() || (name || '').trim();
  return picked || null;
}
