/**
 * What a stream's chat and zaps hang off.
 *
 *  - A NIP-53 stream: its announcement address, `30311:<pubkey>:<d>`.
 *    Chat is kind 1311 and zaps carry an `a` tag.
 *  - A Go live session: its "Live now" note, a 64-hex event id. Chat is
 *    kind 1 replies to the note and zaps carry an `e` tag.
 *
 * The two shapes cannot be confused (an address always contains ':'), so
 * the tag follows from the string.
 *
 * A Go live session also has an address of its own, whether or not its
 * announcement was ever published: `goLiveAddress` builds it from the
 * host and the session id.
 */

const EVENT_ID = /^[a-f0-9]{64}$/;

/**
 * A Go live session's NIP-53 address, `30311:<host>:<session id>`: its
 * announcement is the host's own, with `d` = the session id. Built from
 * the session as our server reports it, never read from an announcement,
 * so it is the same with the "Live now" note off and when the
 * announcement did not reach a relay. Null when either part is unusable.
 */
export function goLiveAddress(
  hostPubkey: string | null | undefined,
  sessionId: string | null | undefined
): string | null {
  const host = (hostPubkey ?? '').toLowerCase();
  if (!EVENT_ID.test(host)) return null;
  const d = (sessionId ?? '').trim();
  if (!d || d.length > 200) return null;
  return `30311:${host}:${d}`;
}

export type TargetTag = 'a' | 'e';

export function isEventTarget(target: string | null | undefined): boolean {
  return EVENT_ID.test(target ?? '');
}

/** The tag a chat message or zap uses to point at `target`. */
export function targetTag(target: string): TargetTag {
  return isEventTarget(target) ? 'e' : 'a';
}

/** A relay filter fragment selecting events that point at `target`. */
export function targetFilter(target: string): { '#a': string[] } | { '#e': string[] } {
  return targetTag(target) === 'e' ? { '#e': [target] } : { '#a': [target] };
}
