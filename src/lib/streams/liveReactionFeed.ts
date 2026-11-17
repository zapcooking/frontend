/**
 * The receive side of live reactions, shared by the viewer's player
 * (StreamLikes) and the host page (HostReactions).
 *
 * Opens one relay subscription for a stream's targets (the note's `#e`
 * and the address's `#a`), and calls `onReaction` once per event that
 * may be shown. Left out, on both pages:
 *
 *  - pubkeys on the signed-in user's own mute list;
 *  - for a Go live session, pubkeys the host hid from their streams and
 *    pubkeys the admin hid everywhere (GET /api/live/<id>/hidden, the
 *    same list the chat applies), re-read every half minute.
 *
 * Reactions are ephemeral, so there is no history to load: the feed only
 * ever reports what arrives while it is open.
 */

import { get } from 'svelte/store';
import { NDKRelaySet, type NDKSubscription } from '@nostr-dev-kit/ndk';
import type NDK from '@nostr-dev-kit/ndk';
import { mutedPubkeys, muteListStore } from '$lib/muteListStore';
import { fetchHiddenAuthors } from '$lib/live/hiddenClient';
import { DISCOVERY_RELAYS } from './relays';
import {
  ReactionIntake,
  hasTargets,
  reactionFilters,
  type ReactionId,
  type ReactionTargets
} from './liveReactions';

const HIDDEN_REFRESH_MS = 30_000;

/**
 * Where reactions are read from: the stream's own relays plus the shared
 * discovery set. A Go live session lists no relays of its own, and likes
 * are always published to the discovery set, so that is where they meet.
 */
export function reactionRelays(itemRelays: readonly string[] = []): string[] {
  return [...new Set([...itemRelays, ...DISCOVERY_RELAYS])];
}

export interface ReactionFeedOptions {
  ndk: NDK;
  targets: ReactionTargets;
  /** The stream's own relays, when it names any. */
  relays?: readonly string[];
  /** Go live session id: turns on the hidden-list filter. */
  sessionId?: string | null;
  /** The viewer's own pubkey (their taps already floated). Omit on the host page. */
  self?: () => string | null | undefined;
  onReaction: (reaction: ReactionId) => void;
}

/** Start listening. Returns the function that stops it. */
export function openReactionFeed(opts: ReactionFeedOptions): () => void {
  if (typeof window === 'undefined' || !hasTargets(opts.targets)) return () => {};

  let stopped = false;
  let sub: NDKSubscription | null = null;
  let hidden = new Set<string>();
  // A Go live stream shows nothing until the hidden list has been asked
  // for once (answered or not), so a hidden pubkey cannot slip a reaction
  // in during the first moments.
  let hiddenSettled = !opts.sessionId;
  let hiddenTimer: ReturnType<typeof setInterval> | null = null;

  async function loadHidden() {
    if (!opts.sessionId) return;
    const found = await fetchHiddenAuthors(opts.sessionId);
    // Could not tell: keep what is applied.
    if (found) hidden = new Set(found.map((h) => h.pubkey));
    hiddenSettled = true;
  }

  if (opts.sessionId) {
    void loadHidden();
    hiddenTimer = setInterval(() => {
      if (!document.hidden) void loadHidden();
    }, HIDDEN_REFRESH_MS);
  }

  // The mute list is usually loaded already (it is cached); make sure.
  void muteListStore.load().catch(() => {});

  const intake = new ReactionIntake({
    targets: opts.targets,
    self: opts.self,
    isBlocked: (pubkey) => get(mutedPubkeys).has(pubkey) || hidden.has(pubkey)
  });

  try {
    const relaySet = NDKRelaySet.fromRelayUrls(reactionRelays(opts.relays), opts.ndk);
    sub = opts.ndk.subscribe(
      reactionFilters(opts.targets) as never,
      { closeOnEose: false, groupable: false },
      relaySet
    );
    sub.on('event', (event) => {
      if (stopped || !hiddenSettled) return;
      const reaction = intake.accept(event);
      if (reaction) opts.onReaction(reaction);
    });
  } catch {
    // A failed subscribe only loses other people's reactions.
  }

  return () => {
    stopped = true;
    if (hiddenTimer) clearInterval(hiddenTimer);
    sub?.stop();
    sub = null;
  };
}
