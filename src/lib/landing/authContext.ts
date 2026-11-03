import type { AuthState } from '$lib/authManager';

/** The root layout owns the store; no account state is shared between SSR requests. */
export const LANDING_AUTH_CONTEXT = Symbol('landing-auth-state');

export type LandingAuthSnapshot = {
  state: Pick<AuthState, 'isAuthenticated' | 'publicKey' | 'isLoading'>;
  /** The first manager snapshot can precede a delayed browser-signer restore. */
  initial: boolean;
} | null;
