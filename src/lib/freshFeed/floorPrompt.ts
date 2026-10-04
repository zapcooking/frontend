import type { LoginState } from './memberLogin';

/**
 * What the end of the free window shows. Every reader reaches it after 14
 * days of posts; what follows depends on who they are.
 */
export type FloorPrompt =
  | { kind: 'join'; signedIn: boolean } // not a member (or signed out): membership pitch
  | { kind: 'login' } // a member who declined: the manual button
  | { kind: 'pending' } // waiting for the signer
  | { kind: 'none' }; // a logged-in member: history continues, nothing to show

export function floorPrompt(o: {
  signedIn: boolean;
  member: boolean;
  login: LoginState;
}): FloorPrompt {
  if (!o.signedIn) return { kind: 'join', signedIn: false };
  if (o.login === 'not-member' || !o.member) return { kind: 'join', signedIn: true };
  if (o.login === 'pending') return { kind: 'pending' };
  if (o.login === 'declined') return { kind: 'login' };
  return { kind: 'none' };
}
