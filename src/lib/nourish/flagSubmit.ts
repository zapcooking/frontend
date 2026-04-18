/**
 * Nourish-score flag submission — client-side helper.
 *
 * Two paths:
 *   1. Logged-in (user has a Nostr signer) — publish a NIP-32 kind 1985
 *      labeling event to the pantry relay, signed by the user's own pubkey.
 *      Transparent, attributable, portable.
 *   2. Anon (no signer) — POST to /api/nourish/flag, rate-limited per-IP
 *      by the Cloudflare Worker (see flagRateLimit.server.ts).
 *
 * Both paths apply a dedup pre-check before opening any UI:
 *   - Logged-in: reactive query for prior kind 1985 events from this pubkey
 *     with matching l-tag + target tag.
 *   - Anon: localStorage stamp `nourish-flagged:<target>:<dim>:<dir>` < 24h.
 *
 * NIP-32 tag structure (logged-in):
 *   L = "cooking.zap.nourish-flag"
 *   l = "<too-high|too-low>:<dimension>"    ← colon per NIP-73 precedent
 *   target = ["a", "30023:<pk>:<d>", <relay>] + ["e", <nourishId>, <relay>]
 *            OR ["scan-hash", <contentHash>]
 *   score snapshot + model version for triage context.
 */

import { NDKEvent } from '@nostr-dev-kit/ndk';
import { get, type Readable } from 'svelte/store';
import { ndk, userPublickey } from '$lib/nostr';
import { addClientTagToEvent } from '$lib/nip89';

export const NOURISH_FLAG_NAMESPACE = 'cooking.zap.nourish-flag';
export const NOURISH_FLAG_KIND = 1985;
export const PANTRY_RELAY = 'wss://pantry.zap.cooking';

export type NourishDimension = 'gut' | 'protein' | 'realFood' | 'overall';
export type FlagDirection = 'too-high' | 'too-low';

export type FlagTarget =
  | {
      kind: 'recipe';
      /** NIP-01 addressable tag value: "<kind>:<pubkey>:<d>" */
      aTag: string;
      /** The kind 30078 Nourish event's id. */
      nourishEventId: string;
    }
  | {
      kind: 'scan';
      /** Content hash of the scan input (from /lib/nourish/cache). */
      contentHash: string;
    };

export interface FlagSubmission {
  target: FlagTarget;
  dimension: NourishDimension;
  direction: FlagDirection;
  /** Score at flag time (0..10). Stored as a snapshot for admin triage. */
  score: number;
  /** Nourish model/prompt version from $lib/nourish/types. */
  nourishVer: string;
  /** Optional free-text reason. Trimmed + truncated client-side to 500 chars. */
  reason?: string;
}

export type FlagResult =
  | { ok: true; source: 'nostr' | 'anon' }
  | { ok: true; source: 'nostr' | 'anon'; duplicate: true }
  | { ok: false; error: 'rate_limited'; retryAfter: number }
  | { ok: false; error: 'no_signer' }
  | { ok: false; error: 'network' }
  | { ok: false; error: 'publish_failed' };

const MAX_REASON_LEN = 500;

// --------------------------- Target serialization ---------------------------

/**
 * Serialize a FlagTarget into the string form used by the anon Worker
 * endpoint and by localStorage keys. Matches the server's `target` validation.
 */
export function serializeTarget(target: FlagTarget): string {
  if (target.kind === 'recipe') return `a:${target.aTag}`;
  return `scan:${target.contentHash}`;
}

// ---------------------------- Anon dedup (localStorage) ---------------------

function anonStampKey(target: FlagTarget, dim: NourishDimension, dir: FlagDirection): string {
  return `nourish-flagged:${serializeTarget(target)}:${dim}:${dir}`;
}

/** Returns true if the anon user has flagged this target/dim/dir in the last 24h. */
export function hasAnonFlagStamp(
  target: FlagTarget,
  dimension: NourishDimension,
  direction: FlagDirection
): boolean {
  if (typeof localStorage === 'undefined') return false;
  const raw = localStorage.getItem(anonStampKey(target, dimension, direction));
  if (!raw) return false;
  const ts = parseInt(raw, 10);
  if (!isFinite(ts)) return false;
  return Date.now() - ts < 24 * 60 * 60 * 1000;
}

function setAnonFlagStamp(
  target: FlagTarget,
  dimension: NourishDimension,
  direction: FlagDirection
): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(anonStampKey(target, dimension, direction), Date.now().toString());
  } catch {
    // QuotaExceeded or privacy mode — non-fatal.
  }
}

// ---------------------------- Signed dedup (Nostr) --------------------------

/**
 * Query the pantry relay for any kind 1985 flag event from `pubkey`
 * matching this target + dimension + direction. Returns true if found.
 * Fails open (returns false) on network error — worst case a user
 * resubmits once; the relay will store both, admin view will dedup
 * visually by pubkey.
 */
export async function hasPriorSignedFlag(
  pubkey: string,
  target: FlagTarget,
  dimension: NourishDimension,
  direction: FlagDirection
): Promise<boolean> {
  const ndkInstance = get(ndk);
  if (!ndkInstance) return false;

  const labelValue = `${direction}:${dimension}`;
  const filter: Record<string, unknown> = {
    kinds: [NOURISH_FLAG_KIND],
    authors: [pubkey],
    '#L': [NOURISH_FLAG_NAMESPACE],
    '#l': [labelValue]
  };
  if (target.kind === 'recipe') {
    (filter as Record<string, string[]>)['#e'] = [target.nourishEventId];
  } else {
    (filter as Record<string, string[]>)['#scan-hash'] = [target.contentHash];
  }

  try {
    const results = await Promise.race([
      ndkInstance.fetchEvents(filter as never),
      new Promise<Set<NDKEvent>>((resolve) => setTimeout(() => resolve(new Set()), 3000))
    ]);
    return results.size > 0;
  } catch {
    return false;
  }
}

// ---------------------------- Public submit API -----------------------------

/**
 * Submit a flag. Auto-routes to Nostr (if signer present) or the anon
 * Worker endpoint. Pre-checks dedup and returns `{ok, duplicate: true}`
 * without attempting the write in that case.
 *
 * Errors surface as `{ok: false, error}` — callers map to a toast via
 * Task 6 Stage 5's Toast primitive.
 */
export async function submitFlag(submission: FlagSubmission): Promise<FlagResult> {
  const loggedInPubkey = get(userPublickey as Readable<string | null>);
  const ndkInstance = get(ndk);
  const hasSigner = !!ndkInstance?.signer;

  if (loggedInPubkey && hasSigner) {
    return submitSignedFlag(loggedInPubkey, submission);
  }
  return submitAnonFlag(submission);
}

async function submitSignedFlag(
  pubkey: string,
  submission: FlagSubmission
): Promise<FlagResult> {
  const { target, dimension, direction, score, nourishVer, reason } = submission;

  const priorExists = await hasPriorSignedFlag(pubkey, target, dimension, direction);
  if (priorExists) {
    return { ok: true, source: 'nostr', duplicate: true };
  }

  const ndkInstance = get(ndk);
  if (!ndkInstance) return { ok: false, error: 'no_signer' };

  const ev = new NDKEvent(ndkInstance);
  ev.kind = NOURISH_FLAG_KIND;
  ev.content = (reason ?? '').trim().slice(0, MAX_REASON_LEN);
  ev.created_at = Math.floor(Date.now() / 1000);

  const labelValue = `${direction}:${dimension}`;
  ev.tags = [
    ['L', NOURISH_FLAG_NAMESPACE],
    ['l', labelValue, NOURISH_FLAG_NAMESPACE],
    ['score', score.toFixed(2)],
    ['nourish-ver', nourishVer]
  ];

  if (target.kind === 'recipe') {
    ev.tags.push(['a', target.aTag, PANTRY_RELAY]);
    ev.tags.push(['e', target.nourishEventId, PANTRY_RELAY]);
  } else {
    ev.tags.push(['scan-hash', target.contentHash]);
  }

  addClientTagToEvent(ev);

  try {
    await ev.sign();
    await ev.publish();
    return { ok: true, source: 'nostr' };
  } catch (err) {
    console.error('[nourish-flag] publish failed:', err);
    return { ok: false, error: 'publish_failed' };
  }
}

async function submitAnonFlag(submission: FlagSubmission): Promise<FlagResult> {
  const { target, dimension, direction, score, nourishVer, reason } = submission;

  if (hasAnonFlagStamp(target, dimension, direction)) {
    return { ok: true, source: 'anon', duplicate: true };
  }

  let response: Response;
  try {
    response = await fetch('/api/nourish/flag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: serializeTarget(target),
        dimension,
        direction,
        score,
        nourishVer,
        reason: (reason ?? '').trim().slice(0, MAX_REASON_LEN)
      })
    });
  } catch (err) {
    console.error('[nourish-flag] network failure:', err);
    return { ok: false, error: 'network' };
  }

  if (response.status === 429) {
    const body = (await response.json().catch(() => ({}))) as {
      retryAfter?: number;
    };
    return {
      ok: false,
      error: 'rate_limited',
      retryAfter: typeof body.retryAfter === 'number' ? body.retryAfter : 60
    };
  }

  if (!response.ok) {
    console.error('[nourish-flag] server error:', response.status);
    return { ok: false, error: 'network' };
  }

  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    duplicate?: boolean;
  };

  // Stamp localStorage BEFORE returning so subsequent pre-checks hit.
  // (Even for duplicates — the server confirmed the flag exists, so our
  // local stamp should match.)
  setAnonFlagStamp(target, dimension, direction);

  if (body.duplicate) {
    return { ok: true, source: 'anon', duplicate: true };
  }
  return { ok: true, source: 'anon' };
}
