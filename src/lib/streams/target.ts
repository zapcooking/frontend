/**
 * What a stream's chat and zaps hang off.
 *
 *  - A NIP-53 stream: its announcement address, `30311:<pubkey>:<d>`.
 *    Chat is kind 1311 and zaps carry an `a` tag.
 *  - A Go live session: its own address, `30311:<host>:<session id>`
 *    (`goLiveAddress`), whether or not its announcement was published.
 *    Chat is kind 1311 on it. Zaps point at the "Live now" note (a
 *    64-hex event id, `e` tag) or at the address (`a` tag); both count
 *    (`goLiveZapTargets`).
 *
 * The two shapes cannot be confused (an address always contains ':'), so
 * the tag follows from the string.
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

/**
 * What a Go live session's zaps may point at: its address, and its "Live
 * now" note when it has one. A zap sent from here targets the note when
 * there is one (so it shows on the note in other apps) and the address
 * otherwise; other live apps zap the address. Totals count both. Empty
 * when the host or session id is unusable.
 */
export function goLiveZapTargets(
  hostPubkey: string | null | undefined,
  sessionId: string | null | undefined,
  noteId?: string | null
): string[] {
  const address = goLiveAddress(hostPubkey, sessionId);
  if (!address) return [];
  return noteId && EVENT_ID.test(noteId) ? [noteId, address] : [address];
}

/**
 * One relay filter fragment per target. Kept apart: a relay ANDs the tags
 * of one filter, so `#e` and `#a` together would match almost nothing.
 */
export function targetFilters(
  targets: readonly string[]
): ({ '#a': string[] } | { '#e': string[] })[] {
  return [...new Set(targets)].map((target) => targetFilter(target));
}

/** A relay filter fragment selecting events that point at `target`. */
export function targetFilter(target: string): { '#a': string[] } | { '#e': string[] } {
  return targetTag(target) === 'e' ? { '#e': [target] } : { '#a': [target] };
}
