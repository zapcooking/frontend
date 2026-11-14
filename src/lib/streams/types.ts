/**
 * Live streaming types (NIP-53).
 *
 * The core library under `src/lib/streams` works on raw nostr-tools events,
 * not NDKEvent: the parsing, directory and zap-verification rules are pure
 * and testable without an NDK instance, and the UI layer bridges to NDKEvent
 * where it needs signing, publishing or the comment thread.
 *
 * @see https://nips.nostr.com/53
 */

/** Minimal shape of a relay event the library reads. Matches nostr-tools `Event`. */
export interface NostrEventLike {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/** Signature check injected from `nostr-tools/pure` (`verifyEvent`). */
export type EventVerifier = (event: NostrEventLike) => boolean;

/** A parsed kind:30311 live-event announcement (NIP-53). */
export interface StreamItem {
  /** `30311:<pubkey>:<d>` — the stream's stable address. */
  key: string;
  /** Event id of the announcement this item was parsed from. */
  id: string;
  /** created_at of the announcement (seconds). */
  updated: number;
  title: string;
  /** Live HLS (or other HTTPS) video address. */
  url: string | null;
  /** VOD address for ended streams. */
  recording: string | null;
  /** Announcement status: `live`, `planned`, `ended`, `relicted`… */
  status: string | null;
  /** Announcement image. */
  image: string | null;
  /** Smaller announcement image. */
  thumb: string | null;
  summary: string;
  /** Planned start (seconds), when tagged. */
  starts: number | null;
  /** End time (seconds) — only present once the end has actually passed. */
  ends: number | null;
  categories: string[];
  /** Status says live and the announcement is fresh enough to trust. */
  live: boolean;
  /** `current_participants`, when tagged. */
  viewers: number | null;
  /** Relays the announcement asks readers to use. */
  relays: string[];
  /** The `p` tag marked `host`, falling back to the announcement author. */
  host: string;
  /**
   * Where the stream comes from. Absent or `'nostr'`: a NIP-53 kind 30311
   * announcement with a media URL. `'zapcooking'`: a Go live session on Zap
   * Cooking's own server, played over WebRTC through /api/live/<id>/join.
   * It has no announcement and no URL (`url` is null, `key` is
   * `zc:<session id>`).
   */
  source?: 'nostr' | 'zapcooking';
  /** Go live session id (source `'zapcooking'` only). */
  sessionId?: string;
  /** Attached recipe address `<kind>:<pubkey>:<d>` (source `'zapcooking'` only). */
  recipeA?: string | null;
  /** Go live only: the "Live now" note's event id (comments and zaps hang off it). */
  noteId?: string | null;
}

/** Where the player currently renders. One surface owns the video at a time. */
export type PlayerSurface = 'page' | 'dock' | 'popout' | null;

/** Playback engine status surfaced to whichever surface is playing. */
export type StreamPlayStatus =
  | 'idle'
  | 'connecting'
  | 'buffering'
  | 'playing'
  | 'unavailable'
  /** The broadcast is over (Go live: the session ended). */
  | 'ended'
  /** Go live: the guest cap is reached for this session. */
  | 'full';
