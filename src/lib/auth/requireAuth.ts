/**
 * Sign-in at the point of action.
 *
 * A signed-out tap on save / like / reply / post / follow / zap calls
 * `requireAuth({ kind, reason })` instead of bouncing to /login. The login
 * overlay opens IN PLACE over the current page with the reason as its
 * tagline ("Sign in to save this recipe"), and the promise settles when the
 * overlay closes: `true` when a session now exists, `false` when the visitor
 * dismissed it. The page never unmounts, so resuming is just the caller
 * carrying on after the `await` — no serialized replay, no navigation.
 *
 *   if (!(await requireAuth({ kind: 'save', reason: 'Sign in to save this recipe' }))) return;
 *   // ...the save, now as the signed-in member
 *
 * Callers must make the resumed action idempotent ("ensure saved", "ensure
 * following"), never a toggle: the account that signs in may already have
 * saved or followed the target on another device, and a blind toggle would
 * undo it.
 *
 * "Signed in" is the AuthManager's settled state, never `$userPublickey`:
 * that store is seeded from localStorage before auth settles, so a locked
 * passkey session carries a pubkey with no signer behind it.
 *
 * Known limit: a full page reload while the overlay is open (rare — e.g. a
 * mobile browser evicting the tab during a signer-app round trip) drops the
 * pending request; the visitor lands signed in and taps again.
 */
import { writable, type Readable } from 'svelte/store';
import { loginOverlayOpen } from '$lib/stores/loginOverlay';
import { getAuthManager, type AuthState } from '$lib/authManager';

export type AuthIntentKind = 'save' | 'react' | 'reply' | 'post' | 'follow' | 'zap';

export interface AuthIntent {
  kind: AuthIntentKind;
  /** Shown as the overlay tagline while this request is pending. */
  reason: string;
}

const signedInStore = writable(false);

/** Reactive "a session exists" for templates (e.g. the zap sheet's two paths). */
export const signedIn: Readable<boolean> = { subscribe: signedInStore.subscribe };

/** The pending request's reason, rendered by LoginOverlay; null otherwise. */
export const loginReason = writable<string | null>(null);

function isSession(state: Pick<AuthState, 'isAuthenticated' | 'publicKey'> | undefined): boolean {
  return !!(state?.isAuthenticated && state.publicKey);
}

/** Called by the root layout with every AuthManager state (and the initial one). */
export function syncSignedIn(state: Pick<AuthState, 'isAuthenticated' | 'publicKey'>): void {
  signedInStore.set(isSession(state));
}

/** Read the manager directly: the store may lag a listener behind at sign-in. */
function signedInNow(): boolean {
  return isSession(getAuthManager()?.getState());
}

let pending: { intent: AuthIntent; resolve: (ok: boolean) => void } | null = null;
let watching = false;

function watchOverlay(): void {
  if (watching) return;
  watching = true;
  loginOverlayOpen.subscribe((open) => {
    if (open || !pending) return;
    const { resolve } = pending;
    pending = null;
    loginReason.set(null);
    resolve(signedInNow());
  });
}

/**
 * Whether a session exists right now. A toggle reads this BEFORE awaiting
 * requireAuth(): false means the action is resuming after a fresh sign-in
 * and must run in its idempotent "ensure" form.
 */
export function isSignedIn(): boolean {
  return signedInNow();
}

/** True while a requireAuth() call waits on the overlay (signup must not navigate away). */
export function hasPendingAuthRequest(): boolean {
  return pending !== null;
}

export function requireAuth(intent: AuthIntent): Promise<boolean> {
  if (signedInNow()) return Promise.resolve(true);
  watchOverlay();
  // The newest tap wins: an earlier request that never completed is
  // abandoned rather than resumed alongside it.
  if (pending) pending.resolve(false);
  return new Promise<boolean>((resolve) => {
    pending = { intent, resolve };
    loginReason.set(intent.reason);
    loginOverlayOpen.set(true);
  });
}

/** Test seam: forget any pending request. */
export function __resetRequireAuthForTests(): void {
  pending = null;
  loginReason.set(null);
  signedInStore.set(false);
  loginOverlayOpen.set(false);
}
