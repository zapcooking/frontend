/**
 * The nspam judge — Sidecar's judgeStrangers method, applied as hiding.
 *
 * THE FOLLOW LIST KNOWS YOUR CIRCLE AND NOTHING ABOUT A STRANGER; nspam knows nothing about
 * your circle and something about the stranger, from how their replies read. An author whose
 * newest scorable replies (a bundle of up to ten, newest first — that is how the model reads
 * them) score >= SPAM_THRESHOLD goes into the verdict set, and everything of theirs — replies
 * and notifications — is hidden while they are in it. Anyone in your follow list is never
 * hidden, whatever they score: a model's false positive must not be able to silence a friend.
 *
 * FAIL OPEN. With no model loaded nothing is judged and nothing is hidden; a reply that is not
 * scorable (not a kind-1 reply, or not mostly Latin — see nspam.ts scorable) leaves its author
 * unscored; and until the follow list has been read, no one is a stranger yet. A failed model
 * fetch only costs the feature, never a reply.
 */

import { derived, get, writable } from 'svelte/store';
import { browser } from '$app/environment';
import { userPublickey } from '$lib/nostr';
import { load, score, scorable, type NspamModel, type ScorableNote } from './nspam';
import {
  followListSize,
  followPubkeysReady,
  getFollowedPubkeys,
  loadFollowListProfiles
} from '$lib/followListCache';

/** A note with the fields the judge keys and scores on. NDKEvent satisfies this. */
export interface JudgeableEvent extends ScorableNote {
  id?: string;
  kind?: number;
  pubkey?: string;
}

/**
 * Calibrated score at or above which an author is treated as a known spammer. Sidecar marks
 * rows with NSPAM_LABEL = 0.9; the calibration is nearly a step, so almost every score is 0
 * or 1 and the line is far from anything in between.
 */
export const SPAM_THRESHOLD = 0.9;

// Per author, the newest scorable replies seen (newest first, at most the model's ten) and the
// identity of the bundle last scored, so an arrival that changes nothing re-scores nothing.
const bundles = new Map<string, JudgeableEvent[]>();
const scoredAs = new Map<string, string>();
const verdicts = new Map<string, number>();

// Authors outlive any one thread or notification batch, but not indefinitely: past this many
// authors the oldest bundles are dropped (Map keeps insertion order), the model re-reads them
// if the author shows up again.
const MAX_AUTHORS = 500;

/** Pubkeys whose reply bundle scored >= SPAM_THRESHOLD. */
export const nspamSpammers = writable<ReadonlySet<string>>(new Set());

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Verdicts with the follow list subtracted: the set of authors to hide. Fail-open while the
 * follow list is unread — until it lands, no one is a stranger yet (and a reply you chose to
 * follow must never be hidden because it arrived before the list did). `followListSize` is a
 * dependency so a re-read that changes the set re-runs this, not just the first read.
 */
export const nspamHiddenAuthors = derived(
  [nspamSpammers, followPubkeysReady, followListSize],
  ([$spammers, $followsReady]) => {
    if ($spammers.size === 0) return EMPTY;
    if (!$followsReady) return EMPTY;
    const followed = getFollowedPubkeys();
    const hidden = new Set<string>();
    for (const pk of $spammers) if (!followed.has(pk)) hidden.add(pk);
    return hidden;
  }
);

let model: NspamModel | null = null;
let modelLoading: Promise<void> | null = null;
let followsKicked = false;

/**
 * Load the model and the follow list in the background. Safe to call anywhere, any number of
 * times: one fetch each, and a failed model fetch leaves the judge inert (nothing hidden).
 */
export function warmNspam(): void {
  if (!browser) return;
  if (!followsKicked) {
    followsKicked = true;
    loadFollowListProfiles().catch(() => {});
  }
  if (model || modelLoading) return;
  modelLoading = (async () => {
    try {
      const res = await fetch('/models/nspam.bin');
      if (!res.ok) throw new Error('nspam model: ' + res.status);
      model = load(await res.arrayBuffer());
      // Bundles remembered before the model landed are scored now, not forgotten.
      for (const pk of [...bundles.keys()]) scoreAuthor(pk);
    } catch {
      // No model: the lists read as they always did.
    } finally {
      modelLoading = null;
    }
  })();
}

/**
 * Remember the scorable kind-1 replies among `events` per author and re-score each touched
 * author's bundle, updating the verdict set. Batches may arrive in any order: the bundle is
 * sorted newest-first before scoring, as Sidecar sorts before its model reads it. Events that
 * are not scorable (reactions, zaps, mentions without an e tag, non-Latin text) are ignored —
 * they say nothing the model was trained to read.
 */
export function judgeReplies(events: JudgeableEvent[]): void {
  if (!browser || !events.length) return;
  const own = get(userPublickey);
  const touched = new Set<string>();
  for (const ev of events) {
    const pk = ev?.pubkey;
    // Your own replies are never judged: the model reads strangers, and a bundle
    // it misread must not be able to hide your replies from your own threads.
    if (!pk || pk === own || !scorable(ev)) continue;
    let bundle = bundles.get(pk);
    if (!bundle) {
      if (bundles.size >= MAX_AUTHORS) {
        const oldest = bundles.keys().next().value;
        if (oldest !== undefined) {
          bundles.delete(oldest);
          scoredAs.delete(oldest);
        }
      }
      bundle = [];
      bundles.set(pk, bundle);
    }
    if (ev.id && bundle.some((n) => n.id === ev.id)) continue;
    bundle.unshift(ev);
    if (bundle.length > 10) bundle.length = 10;
    touched.add(pk);
  }
  if (!touched.size) return;
  warmNspam();
  if (!model) return; // bundles are remembered; scores land when the model does
  for (const pk of touched) scoreAuthor(pk);
}

function scoreAuthor(pk: string): void {
  if (!model) return;
  const bundle = bundles.get(pk);
  if (!bundle?.length) return;
  const key = bundle.map((n) => n.id || '').join(',');
  if (scoredAs.get(pk) === key) return;
  scoredAs.set(pk, key);
  const newestFirst = [...bundle].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  const r = score(model, newestFirst);
  if (!r) return;
  verdicts.set(pk, r.score);
  publish();
}

function publish(): void {
  const s = new Set<string>();
  for (const [pk, v] of verdicts) if (v >= SPAM_THRESHOLD) s.add(pk);
  nspamSpammers.set(s);
}

/** The author's verdict, or undefined when never scored (fail-open direction). */
export function spamVerdict(pubkey: string): number | undefined {
  return verdicts.get(pubkey);
}
