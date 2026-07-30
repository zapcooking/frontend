/**
 * Mute-list types and the pure checks that read them.
 *
 * Split out of `mutableIntegration.ts` (which re-exports everything here, so
 * existing imports are unchanged) because that module pulls in `$lib/nostr`
 * and therefore `$app/environment`, which is not resolvable under vitest.
 * These checks decide what a member does and does not see, so they are the
 * part that needs tests.
 */

// Type definitions (from mutable)
export interface MutedPubkey {
  type: 'pubkey';
  value: string; // hex pubkey
  reason?: string;
  eventRef?: string;
  private?: boolean;
}

export interface MutedWord {
  type: 'word';
  value: string;
  reason?: string;
  private?: boolean;
}

export interface MutedTag {
  type: 'tag';
  value: string;
  reason?: string;
  private?: boolean;
}

export interface MutedThread {
  type: 'thread';
  value: string; // event id
  reason?: string;
  private?: boolean;
}

export interface MuteList {
  pubkeys: MutedPubkey[];
  words: MutedWord[];
  tags: MutedTag[];
  threads: MutedThread[];
}

/**
 * Check if a pubkey is in the mute list
 */
export function isPubkeyMuted(muteList: MuteList, pubkey: string): boolean {
  return muteList.pubkeys.some((item) => item.value === pubkey);
}

/**
 * Check if content contains muted words
 */
export function containsMutedWord(muteList: MuteList, content: string): boolean {
  if (!content) return false;
  const lowerContent = content.toLowerCase();
  return muteList.words.some((item) => lowerContent.includes(item.value.toLowerCase()));
}

/**
 * Check if event has muted tags
 */
export function hasMutedTag(muteList: MuteList, eventTags: string[][]): boolean {
  const eventHashtags = eventTags
    .filter((tag) => tag[0] === 't')
    .map((tag) => tag[1]?.toLowerCase());

  return muteList.tags.some((item) => eventHashtags.includes(item.value.toLowerCase()));
}

/**
 * Check if thread is muted
 */
export function isThreadMuted(muteList: MuteList, eventId: string): boolean {
  return muteList.threads.some((item) => item.value === eventId);
}

/** The parts of an event the mute checks read. */
export interface MutableEventLike {
  id?: string;
  pubkey?: string;
  content?: string;
  tags?: string[][];
}

/**
 * Does the mute list hide this event?
 *
 * Composes the four checks above (pubkey, word, tag, thread) into the single
 * question a feed actually asks, so callers can enforce mutes without also
 * pulling in whatever topic filter they happen to run. A null or absent mute
 * list mutes nothing.
 */
export function isEventMutedBy(
  muteList: MuteList | null | undefined,
  event: MutableEventLike
): boolean {
  if (!muteList) return false;

  if (event.pubkey && isPubkeyMuted(muteList, event.pubkey)) return true;
  if (containsMutedWord(muteList, event.content ?? '')) return true;
  if (hasMutedTag(muteList, event.tags ?? [])) return true;
  if (event.id && isThreadMuted(muteList, event.id)) return true;

  return false;
}
