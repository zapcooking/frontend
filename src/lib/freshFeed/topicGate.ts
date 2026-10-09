/**
 * The gate on the full views behind Fresh's preview cards (a topic feed,
 * "on this day", the time machine), decided when the reader opens one, by
 * the app's signer state and its own membership answer:
 *
 * - `open`: a member (the view logs in to the feed relay on the way if it
 *   has to — a local key already did silently on load; a prompting signer
 *   is asked once, at this click), or a signed-in reader whose membership
 *   lookup failed (the view opens and offers its retry: a failed lookup is
 *   never "not a member");
 * - `wait`: the signer is still being restored, or the membership lookup
 *   is still in flight: the view opens loading and is decided when they
 *   answer. Never a pitch on an unanswered lookup, and never a relay login
 *   before the app's own membership answer (the login is refused on the
 *   spot without it, and the view would stall on that refusal);
 * - `pitch`: not a member, or signed out: the membership pitch, and
 *   nothing is asked of the relay. A locked passkey vault is signed out
 *   here: its pubkey stays in storage, but there is no signer, so a login
 *   attempt would fail and read as a decline. The pitch offers sign-in,
 *   which is where the vault unlocks.
 *
 * The in-feed cards themselves are never gated: everyone sees the same
 * previews.
 */
export type Gate = 'open' | 'pitch' | 'wait';

/** The app's signer: still being restored, there, or absent (signed out, or a locked vault). */
export type AuthGateState = 'pending' | 'in' | 'out';

/** The app's membership lookup for the pubkey: in flight, answered, or failed. */
export type MembershipGateState = 'pending' | 'answered' | 'unresolved';

/**
 * How long a view waits on an unanswered restore or lookup. After this it
 * opens as if the lookup had failed (the view's retry), never as a pitch.
 */
export const GATE_WAIT_MS = 15_000;

export function topicGate(o: {
  auth: AuthGateState;
  member: boolean;
  membership: MembershipGateState;
}): Gate {
  if (o.auth === 'out') return 'pitch';
  if (o.auth === 'pending' || o.membership === 'pending') return 'wait';
  if (o.membership === 'unresolved') return 'open';
  return o.member ? 'open' : 'pitch';
}

/**
 * Did the signer prompt at this click end in a decline? The feed login's
 * state before the request and after: a login that was already declined
 * before the click never prompted (the view shows its manual button
 * instead); one that turned declined during it was declined just now, and
 * the feed goes back to the preview.
 */
export function declinedNow(before: string, after: string): boolean {
  return before !== 'declined' && after === 'declined';
}
