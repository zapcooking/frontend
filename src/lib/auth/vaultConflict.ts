/**
 * "Replace saved login?" — signing in (nsec, Google restore) or creating an
 * account on a browser whose passkey vault belongs to ANOTHER account needs
 * an explicit confirmation: it deletes the wrapped key for that account on
 * this device (see VaultConflictError in authManager). Sign-in and signup
 * both raise it; VaultConflictDialog renders it once for the overlay.
 */
import { writable, get } from 'svelte/store';

export interface VaultConflictState {
  open: boolean;
  message: string;
  busy: boolean;
  retry: (() => Promise<void>) | null;
}

const closed: VaultConflictState = { open: false, message: '', busy: false, retry: null };

export const vaultConflict = writable<VaultConflictState>(closed);

/** Ask for confirmation; `retry` runs the replacing sign-in if confirmed. */
export function raiseVaultConflict(message: string, retry: () => Promise<void>): void {
  vaultConflict.set({ open: true, message, busy: false, retry });
}

export async function confirmVaultConflict(): Promise<void> {
  const { retry } = get(vaultConflict);
  if (!retry) return;
  vaultConflict.update((s) => ({ ...s, busy: true }));
  try {
    await retry();
    vaultConflict.set(closed);
  } catch (error) {
    vaultConflict.update((s) => ({
      ...s,
      busy: false,
      message: (error as Error)?.message || 'Sign-in failed. Please try again.'
    }));
  }
}

export function cancelVaultConflict(): void {
  vaultConflict.set(closed);
}

/** Signup copy: plain "saved login", no vault jargon. */
export const SIGNUP_VAULT_CONFLICT_MESSAGE =
  'This browser has a saved login for another account. Creating a new profile will ' +
  "remove that saved login — make sure the other account's key is backed up first.";
