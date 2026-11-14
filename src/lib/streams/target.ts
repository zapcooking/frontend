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
 */

const EVENT_ID = /^[a-f0-9]{64}$/;

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
