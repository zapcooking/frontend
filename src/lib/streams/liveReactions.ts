/**
 * Live reactions (kind 21111): the hearts that float up over a stream.
 *
 * A reaction is a relay-ephemeral event — relays broadcast it to whoever
 * is subscribed and never store it — whose content names the reaction.
 * It points at the stream with up to two tags:
 *
 *  - `["e", <Live now note id>]`, when the stream has a note;
 *  - `["a", "30311:<host>:<d>"]`, the stream's NIP-53 address. For a Go
 *    live session `<d>` is the session id, so a stream with the note
 *    switched off still has something to hang reactions on.
 *
 * Senders write both; readers subscribe to both and count each event
 * once. This file is the pure half (targets, tags, filters, the intake
 * that decides what is shown, the publish pacing); `liveReactionFeed.ts`
 * wires it to relays, the mute list and the hidden list.
 */

import type { StreamItem } from './types';

/** Relay-ephemeral kind: broadcast live, never stored (NIP-16 range). */
export const LIKE_KIND = 21111;

export type ReactionId = 'purple' | 'fire' | 'hug' | 'hundred' | 'plant' | 'shaka';

export interface ReactionSpec {
  label: string;
  emoji: string;
}

export const REACTIONS: Record<ReactionId, ReactionSpec> = {
  purple: { label: 'Purple heart', emoji: '💜' },
  fire: { label: 'Fire', emoji: '🔥' },
  hug: { label: 'Hug', emoji: '🫂' },
  hundred: { label: '100', emoji: '💯' },
  plant: { label: 'Grow Nostr', emoji: '🌱' },
  shaka: { label: 'Shaka', emoji: '🤙' }
};

export const DEFAULT_REACTION: ReactionId = 'purple';

export function isReactionId(value: unknown): value is ReactionId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(REACTIONS, value);
}

/**
 * The reaction an event's content names. Anything unknown is the default
 * heart, so foreign content can never put an arbitrary glyph on screen.
 */
export function reactionOf(content: string | null | undefined): ReactionId {
  const id = (content ?? '').trim();
  return isReactionId(id) ? id : DEFAULT_REACTION;
}

// ── Targets ──────────────────────────────────────────────────────────

const HEX64 = /^[0-9a-f]{64}$/;
const STREAM_ADDRESS = /^30311:[0-9a-f]{64}:.+$/;

/** What a stream's reactions point at. Either may be missing; both null means none. */
export interface ReactionTargets {
  /** The "Live now" note id. */
  e: string | null;
  /** The stream's address, `30311:<host>:<d>`. */
  a: string | null;
}

export const NO_TARGETS: ReactionTargets = Object.freeze({ e: null, a: null });

/** A Go live session's NIP-53 address: its announcement is the host's, with `d` = session id. */
export function goLiveAddress(
  hostPubkey: string | null | undefined,
  sessionId: string | null | undefined
): string | null {
  const host = (hostPubkey ?? '').toLowerCase();
  if (!HEX64.test(host)) return null;
  const d = (sessionId ?? '').trim();
  if (!d || d.length > 200) return null;
  return `30311:${host}:${d}`;
}

/**
 * The targets for a stream as the player knows it.
 *
 *  - A NIP-53 stream: its own address (the item's key).
 *  - A Go live session: the address built from host + session id, plus
 *    the note id when the note exists.
 */
export function reactionTargets(
  item: Pick<StreamItem, 'key' | 'host' | 'sessionId' | 'noteId'> | null | undefined
): ReactionTargets {
  if (!item) return NO_TARGETS;
  const e = item.noteId && HEX64.test(item.noteId) ? item.noteId : null;
  const a = STREAM_ADDRESS.test(item.key) ? item.key : goLiveAddress(item.host, item.sessionId);
  return { e, a };
}

export function hasTargets(targets: ReactionTargets): boolean {
  return !!(targets.e || targets.a);
}

/** A stable key for "did the target change", for resubscribing. */
export function targetsKey(targets: ReactionTargets): string {
  return `${targets.e ?? ''}|${targets.a ?? ''}`;
}

/** The tags a reaction carries: every target the stream has. */
export function reactionTags(targets: ReactionTargets): string[][] {
  const tags: string[][] = [];
  if (targets.e) tags.push(['e', targets.e]);
  if (targets.a) tags.push(['a', targets.a]);
  return tags;
}

export type ReactionFilter =
  | { kinds: number[]; '#e': string[] }
  | { kinds: number[]; '#a': string[] };

/**
 * One filter per target. Relays OR the filters of a subscription, so a
 * reaction tagged with either the note or the address arrives.
 */
export function reactionFilters(targets: ReactionTargets): ReactionFilter[] {
  const filters: ReactionFilter[] = [];
  if (targets.e) filters.push({ kinds: [LIKE_KIND], '#e': [targets.e] });
  if (targets.a) filters.push({ kinds: [LIKE_KIND], '#a': [targets.a] });
  return filters;
}

/** Does the event really point at one of our targets? (A relay can send anything.) */
export function pointsAt(tags: readonly (readonly string[])[], targets: ReactionTargets): boolean {
  for (const tag of tags) {
    if (tag[0] === 'e' && targets.e && tag[1] === targets.e) return true;
    if (tag[0] === 'a' && targets.a && tag[1] === targets.a) return true;
  }
  return false;
}

// ── Intake: which arriving events become a floating reaction ─────────

export interface ReactionEventLike {
  id?: string;
  pubkey: string;
  kind?: number;
  content?: string;
  tags: readonly (readonly string[])[];
}

export interface IntakeOptions {
  targets: ReactionTargets;
  /**
   * The viewer's own pubkey, read at arrival time: their reactions
   * already floated when they tapped. The host page passes nothing — a
   * host has no like button, so nothing of theirs has been shown yet.
   */
  self?: () => string | null | undefined;
  /** Muted, hidden by the host, or hidden everywhere: never shown. */
  isBlocked?: (pubkey: string) => boolean;
  /** How many event ids to remember for deduping. */
  remember?: number;
}

/**
 * Turns arriving events into reaction ids, once each. The same event
 * matches both filters and comes from several relays; only its first
 * arrival counts.
 */
export class ReactionIntake {
  private readonly seen = new Set<string>();
  private readonly remember: number;

  constructor(private readonly opts: IntakeOptions) {
    this.remember = Math.max(1, opts.remember ?? 2000);
  }

  /** The reaction to show, or null when the event is not shown. */
  accept(event: ReactionEventLike): ReactionId | null {
    if (event.kind !== undefined && event.kind !== LIKE_KIND) return null;
    if (!event.id || !HEX64.test(event.pubkey ?? '')) return null;
    if (!pointsAt(event.tags ?? [], this.opts.targets)) return null;
    if (this.seen.has(event.id)) return null;
    this.seen.add(event.id);
    if (this.seen.size > this.remember) {
      // Sets iterate in insertion order: drop the oldest.
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    const self = this.opts.self?.();
    if (self && event.pubkey === self) return null;
    if (this.opts.isBlocked?.(event.pubkey)) return null;
    return reactionOf(event.content);
  }
}

/** The union of the lists that keep someone's reactions off the screen. */
export function blockedBy(
  ...lists: (Iterable<string> | null | undefined)[]
): (pubkey: string) => boolean {
  const sets = lists.filter((l): l is Iterable<string> => !!l).map((l) => new Set(l));
  return (pubkey) => sets.some((s) => s.has(pubkey));
}

// ── Publish pacing ───────────────────────────────────────────────────

/**
 * A hold sends at most one reaction per this long. One second, because
 * `created_at` counts whole seconds: two likes signed in the same second
 * with the same reaction and tags are the same event (same id), which
 * relays and readers drop as a duplicate. At the earlier 400 ms, more
 * than half of the signatures a hold asked for bought nothing.
 */
export const PUBLISH_MIN_GAP_MS = 1000;
/** A signature that took longer than this had a person (or a slow bunker) in the loop. */
export const SLOW_SIGN_MS = 1500;
/** After a slow signature: wait this long before asking again. */
export const SLOW_SIGN_GAP_MS = 5000;
/** After a refused or failed signature: stop asking for this long. */
export const FAILED_SIGN_GAP_MS = 30_000;
/** A request the signer never answered is given up on after this long. */
export const SIGN_ABANDON_MS = 60_000;

/**
 * Decides when the like button may ask the signer for another signature.
 *
 * Holding the button spawns a heart every 90 ms; only some of them are
 * published. Two rules keep that from flooding a remote signer:
 *
 *  1. One request at a time. A NIP-46 bunker or Amber answers when it
 *     answers (possibly after a person taps Approve); until then no
 *     second request is sent, so prompts cannot pile up.
 *  2. The gap grows with the signer. Fast signers (a local key, an
 *     extension or bunker that auto-approves) get one request per
 *     PUBLISH_MIN_GAP_MS. A slow answer waits SLOW_SIGN_GAP_MS; a refusal
 *     or error waits FAILED_SIGN_GAP_MS.
 *
 * Hearts on the liker's own screen never wait on any of this.
 */
export class LikePacer {
  private startedAt: number | null = null;
  private nextAt = 0;

  /** May a signature be requested now? */
  canStart(now: number): boolean {
    if (this.startedAt !== null) {
      if (now - this.startedAt < SIGN_ABANDON_MS) return false;
      // Never answered: treat it as failed and let a later tap try again.
      this.startedAt = null;
      this.nextAt = Math.max(this.nextAt, now);
    }
    return now >= this.nextAt;
  }

  /** A request went to the signer. Returns the token `finish` needs. */
  start(now: number): number {
    this.startedAt = now;
    this.nextAt = now + PUBLISH_MIN_GAP_MS;
    return now;
  }

  /** The signer answered (`signed`) or refused/failed (`!signed`). */
  finish(token: number, now: number, signed: boolean) {
    // An abandoned request answering late must not clear a newer one.
    if (this.startedAt !== token) return;
    this.startedAt = null;
    if (!signed) {
      this.nextAt = now + FAILED_SIGN_GAP_MS;
    } else if (now - token > SLOW_SIGN_MS) {
      this.nextAt = now + SLOW_SIGN_GAP_MS;
    }
  }
}
