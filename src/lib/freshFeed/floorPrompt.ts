import type { LoginState } from './memberLogin';

/**
 * What the end of the free window shows. Every reader reaches it after 14
 * days of posts; what follows depends on who they are.
 */
export type FloorPrompt =
  | { kind: 'join'; signedIn: boolean } // not a member (or signed out): membership pitch
  | { kind: 'login' } // a member who declined: the manual button
  | { kind: 'relay-denied' } // a member the relay refused just now: retry, never the pitch
  | { kind: 'pending' } // waiting for the signer
  | { kind: 'none' }; // a logged-in member: history continues, nothing to show

export function floorPrompt(o: {
  signedIn: boolean;
  member: boolean;
  login: LoginState;
}): FloorPrompt {
  if (!o.signedIn) return { kind: 'join', signedIn: false };
  // The app's own membership answer decides the pitch. A relay denial for a
  // member is a transient disagreement (the relay checks membership through
  // the same API, cached for a minute): offer a retry, never "Become a member".
  if (!o.member) return { kind: 'join', signedIn: true };
  if (o.login === 'relay-denied') return { kind: 'relay-denied' };
  if (o.login === 'pending') return { kind: 'pending' };
  if (o.login === 'declined') return { kind: 'login' };
  return { kind: 'none' };
}
