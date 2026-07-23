/**
 * Scheduled Posts API — shared server-side pieces for the
 * /api/schedule routes (and, later, the Phase 2 cron sweep).
 *
 * Spec: scheduler-phase1-spec.md §4 (auth), §5 (endpoints).
 */

import { json } from '@sveltejs/kit';
import { POLL_ENDS_AT_TAG, ZAP_POLL_CLOSED_AT_TAG } from './polls';
import type { Nip98FailureReason } from './nip98.server';

/** Event kinds that may be scheduled (spec §5.1). */
export const SCHEDULABLE_KINDS = [1, 1068, 6969, 30023, 35000];

/** publish_at window: strictly more than 2 minutes, less than 90 days out. */
export const MIN_LEAD_SECONDS = 120;
export const MAX_LEAD_SECONDS = 90 * 86400;

/** Serialized signed event size cap (bytes). */
export const MAX_EVENT_BYTES = 64 * 1024;

/** A scheduled poll must stay open ≥ 60 s after it publishes. */
export const POLL_CLOSE_MARGIN_SECONDS = 60;

/** Max pending rows per pubkey. */
export const MAX_PENDING_PER_PUBKEY = 25;

/** Max creates per pubkey per rolling hour (counted by row created_at). */
export const MAX_CREATES_PER_HOUR = 10;

/** List endpoint row cap. */
export const LIST_LIMIT = 100;

export const RELAY_MODES = ['all', 'pantry'] as const;
export type RelayMode = (typeof RELAY_MODES)[number];

/** Row shape of the scheduled_events D1 table. */
export interface ScheduledEventRow {
  id: string;
  pubkey: string;
  kind: number;
  publish_at: number;
  relay_mode: RelayMode;
  ciphertext: string;
  iv: string;
  status: 'pending' | 'publishing' | 'sent' | 'failed' | 'cancelled';
  attempts: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  sent_at: number | null;
}

/**
 * Collapse the verifier's granular failure reason into a broad
 * category for the client-facing 401 body. The granular reason goes
 * to console.warn only — surfacing it would let a caller probe which
 * specific check failed (oracle behavior the spec forbids). Keep
 * these category strings disjoint from every Nip98FailureReason
 * value; the test suite asserts the granular strings never appear in
 * a response.
 */
export function nip98FailureCategory(reason: Nip98FailureReason): string {
  switch (reason) {
    case 'missing-header':
    case 'malformed-header':
      return 'header';
    case 'wrong-kind':
    case 'invalid-signature':
    case 'stale-timestamp':
    case 'pubkey-mismatch':
      return 'event';
    case 'url-mismatch':
    case 'method-mismatch':
    case 'payload-mismatch':
    case 'missing-payload-tag':
      return 'binding';
  }
}

/**
 * The one 401 body every /api/schedule route returns on auth failure.
 * Built here so all three endpoints stay byte-consistent and none can
 * accidentally leak the granular reason.
 */
export function authFailedResponse(reason: Nip98FailureReason): Response {
  return json({ error: 'auth_failed', detail: nip98FailureCategory(reason) }, { status: 401 });
}

/**
 * Poll-close timestamp of a schedulable event, or null when the event
 * isn't a poll or carries no (parseable) close tag. Tag names come
 * from src/lib/polls.ts — the same constants the poll builders use —
 * so the two can't drift apart.
 */
export function pollCloseTimestamp(event: { kind: number; tags: string[][] }): number | null {
  const tagName =
    event.kind === 1068 ? POLL_ENDS_AT_TAG : event.kind === 6969 ? ZAP_POLL_CLOSED_AT_TAG : null;
  if (!tagName) return null;
  const raw = event.tags.find((t) => t[0] === tagName)?.[1];
  if (!raw) return null;
  const ts = parseInt(raw, 10);
  return Number.isNaN(ts) ? null : ts;
}
