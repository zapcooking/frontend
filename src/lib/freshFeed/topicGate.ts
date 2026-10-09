/**
 * The gate on the full views behind Fresh's preview cards (a topic feed,
 * "on this day", the time machine), decided by the app's own membership
 * answer when the reader opens one:
 *
 * - `open`: a member (the view logs in to the feed relay on the way if it
 *   has to — a local key already did silently on load; a prompting signer
 *   is asked once, at this click), or a signed-in reader whose membership
 *   isn't known yet (the view waits for the answer; it never pitches on an
 *   unresolved lookup);
 * - `pitch`: not a member, or signed out: the membership pitch, and
 *   nothing is asked of the relay.
 *
 * The in-feed cards themselves are never gated: everyone sees the same
 * previews.
 */
export type Gate = 'open' | 'pitch';

export function topicGate(o: {
  signedIn: boolean;
  member: boolean;
  /** The membership lookup has answered (an unresolved lookup is unknown, not "no"). */
  membershipKnown: boolean;
}): Gate {
  if (!o.signedIn) return 'pitch';
  if (!o.membershipKnown) return 'open';
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
