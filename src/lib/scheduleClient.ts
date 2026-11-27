/**
 * Scheduled Posts — web client for /api/schedule.
 *
 * The contract is docs/schedule-contract.md; this module is the web
 * client's reading of it and should change with it.
 *
 *   signForSchedule(event, publishAt)   sign with created_at = publish time
 *   scheduleEvent(signed, { relayMode, relays, replaces })
 *   listScheduled({ status })
 *   cancelScheduled(id)
 *   planMove(event, newPublishAt)       what moving a post would change
 *   moveScheduled(item, newPublishAt)   move it: re-sign verbatim, swap atomically
 *
 * Every function resolves to a typed result and never throws. A
 * failure is `{ ok: false, code }` with one code per error in the
 * contract plus a few that only a client can produce (not signed in,
 * network, the signer changed the event). UI code switches on `code`
 * and takes its wording from scheduleErrorCopy(); no server string is
 * ever shown to a person.
 *
 * No UI and no stores here. The app-wide pieces it needs (the NDK
 * signer, fetch, the relay list cache) arrive through `deps`, resolved
 * lazily from the app by default and replaced wholesale in tests.
 */

import { getEventHash, verifyEvent, type Event as NostrEvent } from 'nostr-tools';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import { isPublicRelayUrl, ENDED_HOST_RELAYS_NEVER } from './live/endedEvent';
import { POLL_ENDS_AT_TAG, ZAP_POLL_CLOSED_AT_TAG } from './polls';
import { pickedTimeProblem } from './composerSchedule';
import {
  MAX_SCHEDULE_RELAYS,
  MAX_SCHEDULE_RELAY_URL_LENGTH,
  normalizeScheduleRelay
} from './scheduleRelays';

// ── types ───────────────────────────────────────────────────────────

/** Contract: at most this many posts pending per account. */
export const MAX_PENDING_SCHEDULED = 50;

export type ScheduleRelayMode = 'all' | 'pantry';
export type ScheduleStatus = 'pending' | 'publishing' | 'sent' | 'failed' | 'cancelled';
export const SCHEDULE_STATUSES: readonly ScheduleStatus[] = [
  'pending',
  'publishing',
  'sent',
  'failed',
  'cancelled'
];

/** One row of GET /api/schedule. */
export interface ScheduledItem {
  id: string;
  /** Unix seconds; equals event.created_at. */
  publishAt: number;
  relayMode: ScheduleRelayMode;
  relays: string[];
  status: ScheduleStatus;
  attempts: number;
  /** Diagnostic text from the sweep or a relay. Detail only; never the headline. */
  lastError: string | null;
  sentAt: number | null;
  event: NostrEvent;
}

/**
 * Every way a call can fail. The first block is the server's error
 * codes, verbatim from the contract; the second is client-side.
 */
export type ScheduleErrorCode =
  | 'auth_failed'
  | 'bad_request'
  | 'bad_relay_mode'
  | 'bad_relays'
  | 'bad_signature'
  | 'pubkey_mismatch'
  | 'bad_kind'
  | 'kind_not_allowed_for_relay_mode'
  | 'bad_publish_time'
  | 'too_large'
  | 'poll_closes_before_publish'
  | 'already_scheduled'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'bad_status'
  | 'not_found'
  | 'not_cancellable'
  | 'not_replaceable'
  | 'not_configured'
  | 'internal'
  // client-side
  | 'not_signed_in'
  | 'sign_failed'
  | 'signer_changed_event'
  | 'expires_before_publish'
  | 'move_changed_post'
  | 'network'
  | 'unknown';

const SERVER_CODES: readonly ScheduleErrorCode[] = [
  'auth_failed',
  'bad_request',
  'bad_relay_mode',
  'bad_relays',
  'bad_signature',
  'pubkey_mismatch',
  'bad_kind',
  'kind_not_allowed_for_relay_mode',
  'bad_publish_time',
  'too_large',
  'poll_closes_before_publish',
  'already_scheduled',
  'quota_exceeded',
  'rate_limited',
  'bad_status',
  'not_found',
  'not_cancellable',
  'not_replaceable',
  'not_configured',
  'internal'
];

export interface ScheduleFailure<C extends ScheduleErrorCode = ScheduleErrorCode> {
  ok: false;
  code: C;
  /**
   * The row's status, where the server reports one: `already_scheduled`
   * (the existing row is cancelled or failed), `not_cancellable` and
   * `not_replaceable`.
   */
  status?: ScheduleStatus;
  /** On `rate_limited`: 'moves' when it was the replace limit, not the create limit. */
  limit?: 'moves';
}

type CommonFailure = 'auth_failed' | 'not_configured' | 'internal' | 'not_signed_in' | 'network' | 'unknown';

export type SignForScheduleResult =
  | { ok: true; event: NostrEvent }
  | ScheduleFailure<'not_signed_in' | 'sign_failed' | 'signer_changed_event' | 'bad_publish_time'>;

export type ScheduleEventResult =
  | {
      ok: true;
      id: string;
      publishAt: number;
      relayMode: ScheduleRelayMode;
      /** As stored by the server (normalized). */
      relays: string[];
      status: ScheduleStatus;
      /** True when an earlier attempt had already stored this exact event. */
      alreadyScheduled: boolean;
      /**
       * Only for a call with `replaces`: 'replaced' when the old post is
       * no longer scheduled, 'original_still_scheduled' in the rare case
       * where the new post was stored but the old one could not be
       * cancelled (the caller must tell the person). Absent otherwise.
       */
      replacement?: 'replaced' | 'original_still_scheduled';
    }
  | ScheduleFailure<
      | CommonFailure
      | 'bad_request'
      | 'bad_relay_mode'
      | 'bad_relays'
      | 'bad_signature'
      | 'pubkey_mismatch'
      | 'bad_kind'
      | 'kind_not_allowed_for_relay_mode'
      | 'bad_publish_time'
      | 'too_large'
      | 'poll_closes_before_publish'
      | 'already_scheduled'
      | 'quota_exceeded'
      | 'rate_limited'
      | 'not_found'
      | 'not_replaceable'
    >;

export type ListScheduledResult =
  | {
      ok: true;
      items: ScheduledItem[];
      /** True when the account has more matching rows than the server returns (its 100-row cap). */
      truncated: boolean;
    }
  | ScheduleFailure<CommonFailure | 'bad_status'>;

export type CancelScheduledResult =
  | { ok: true; id: string; /** True when it was already cancelled before this call. */ alreadyCancelled: boolean }
  | ScheduleFailure<CommonFailure | 'not_found' | 'not_cancellable'>;

// ── dependencies ────────────────────────────────────────────────────

export interface ScheduleClientDeps {
  fetch: typeof fetch;
  /** Origin the API is called on (and signed for), e.g. https://zap.cooking. */
  origin: () => string;
  /**
   * Build a NIP-98 Authorization header for one request. Must reject
   * when there is no signer or the signer refuses.
   */
  signAuthHeader: (opts: { method: string; url: string; bodyString?: string }) => Promise<string>;
  /** The author's NIP-65 write relays, [] when unknown. */
  getWriteRelays: (pubkey: string) => Promise<string[]>;
  /** Wake a remote (NIP-46) signer before asking it to sign. */
  prepareSigner: () => Promise<void>;
  /**
   * The session signer, asked for a signature and nothing else: the
   * caller has already built and hashed the event, and gets back the
   * `sig` for exactly that. Null when signed out. (NDKEvent.sign() is
   * not this: it rewrites tags and content before signing.)
   */
  rawSigner: () => Promise<{ pubkey: string; sign: (event: NostrEvent) => Promise<string> } | null>;
  now: () => number;
}

async function defaultDeps(): Promise<ScheduleClientDeps> {
  const [{ get }, nostr, { signNip98AuthHeader }, { getOwnWriteRelays }] = await Promise.all([
    import('svelte/store'),
    import('./nostr'),
    import('./nip98'),
    import('./nip65Routing')
  ]);
  return {
    fetch: (input, init) => fetch(input, init),
    origin: () => window.location.origin,
    signAuthHeader: (opts) => signNip98AuthHeader(get(nostr.ndk), opts),
    getWriteRelays: getOwnWriteRelays,
    prepareSigner: async () => {
      const { getAuthManager } = await import('./authManager');
      await getAuthManager()?.ensureNip46SignerReady();
    },
    rawSigner: async () => {
      const signer = get(nostr.ndk)?.signer;
      if (!signer) return null;
      const user = await signer.user();
      return { pubkey: user.pubkey, sign: (event) => signer.sign(event) };
    },
    now: () => Math.floor(Date.now() / 1000)
  };
}

async function resolveDeps(overrides?: Partial<ScheduleClientDeps>): Promise<ScheduleClientDeps> {
  const complete =
    overrides &&
    (['fetch', 'origin', 'signAuthHeader', 'getWriteRelays', 'prepareSigner', 'rawSigner', 'now'] as const).every(
      (k) => overrides[k] !== undefined
    );
  // A complete override never touches the app modules (tests).
  if (complete) return overrides as ScheduleClientDeps;
  return { ...(await defaultDeps()), ...overrides };
}

// ── relays ──────────────────────────────────────────────────────────

/**
 * Relays not worth one of the four places: the two the sweep always
 * publishes to anyway (SCHEDULER_FLOOR_RELAYS in workers/cron/sweep.ts;
 * if that list changes this only costs a wasted place, never a missed
 * relay), and relays that never store a note.
 */
const RELAYS_NOT_WORTH_SENDING: readonly string[] = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  ...ENDED_HOST_RELAYS_NEVER
];

/**
 * Turn a relay list (the author's NIP-65 write relays, in their order)
 * into a `relays` value the server will accept: only URLs that pass
 * the server's own check, normalized, without duplicates or relays not
 * worth sending, at most MAX_SCHEDULE_RELAYS. The server rejects the
 * whole request for one bad entry, so filtering here is not optional.
 */
export function pickScheduleRelays(urls: readonly unknown[]): string[] {
  const skip = new Set(RELAYS_NOT_WORTH_SENDING.map((u) => normalizeScheduleRelay(u)));
  const out: string[] = [];
  for (const url of urls) {
    if (out.length >= MAX_SCHEDULE_RELAYS) break;
    if (typeof url !== 'string' || url.length >= MAX_SCHEDULE_RELAY_URL_LENGTH) continue;
    if (!isPublicRelayUrl(url)) continue;
    const normalized = normalizeScheduleRelay(url);
    if (skip.has(normalized) || out.includes(normalized)) continue;
    out.push(normalized);
  }
  return out;
}

// ── signing ─────────────────────────────────────────────────────────

/** Contract: strictly more than 120 s and strictly less than 90 days out. */
const SERVER_MIN_LEAD_SECONDS = 120;
const SERVER_MAX_LEAD_SECONDS = 90 * 86400;

/**
 * Sign `event` so that it publishes at `publishAt` (unix seconds): set
 * created_at to that time, sign once with the session signer, and hand
 * back the plain signed event for scheduleEvent().
 *
 * THE INPUT IS NEVER MODIFIED. A copy is signed; `event` keeps whatever
 * created_at, id and sig it had (normally none), on success and on
 * every failure. That matters when the person gives up on scheduling
 * and publishes now instead: the same draft event must not go out
 * carrying a future time left behind by a failed attempt here.
 *
 * The result is checked before it is returned: created_at must still
 * be `publishAt` and the id and signature must verify. A signer that
 * re-dates what it signs (some extensions and remote signers stamp the
 * current time) fails that check and comes back as
 * `signer_changed_event`: posting it would schedule something other
 * than what the person chose, or nothing at all.
 *
 * Do not run proof-of-work on an event headed here, before or after:
 * the miner re-stamps created_at (src/lib/pow.ts) and any change after
 * signing breaks the signature.
 */
export async function signForSchedule(
  event: NDKEvent,
  publishAt: number,
  depsOverride?: Partial<ScheduleClientDeps>
): Promise<SignForScheduleResult> {
  const pre = depsOverride?.now ? depsOverride.now() : Math.floor(Date.now() / 1000);
  if (
    !Number.isInteger(publishAt) ||
    publishAt <= pre + SERVER_MIN_LEAD_SECONDS ||
    publishAt >= pre + SERVER_MAX_LEAD_SECONDS
  ) {
    return { ok: false, code: 'bad_publish_time' };
  }
  if (!event.ndk?.signer) return { ok: false, code: 'not_signed_in' };

  let raw: NostrEvent;
  try {
    const deps = await resolveDeps(depsOverride);
    await deps.prepareSigner();
    // A fresh event with copies of the tag arrays: signing fills in
    // pubkey, id and sig and may add tags, all on the copy. Nothing is
    // carried over from an earlier signature of the original.
    const copy = new NDKEvent(event.ndk);
    copy.kind = event.kind;
    copy.content = event.content;
    copy.tags = event.tags.map((tag) => [...tag]);
    copy.created_at = publishAt;
    await copy.sign();
    raw = copy.rawEvent() as NostrEvent;
  } catch (err) {
    console.warn('[Schedule] signing failed:', err);
    return { ok: false, code: 'sign_failed' };
  }

  let verified = false;
  try {
    verified = verifyEvent({ ...raw });
  } catch {
    verified = false;
  }
  if (raw.created_at !== publishAt || !verified) {
    console.warn('[Schedule] the signer returned an event that does not match what was asked for');
    return { ok: false, code: 'signer_changed_event' };
  }
  return { ok: true, event: raw };
}

// ── moving a scheduled post ─────────────────────────────────────────

/** Tags whose value is a time that belongs with the publish time. */
const POLL_CLOSE_TAG_BY_KIND: Record<number, string> = {
  1068: POLL_ENDS_AT_TAG,
  6969: ZAP_POLL_CLOSED_AT_TAG
};

function tagSeconds(tag: readonly string[]): number | null {
  if (!/^\d+$/.test(tag[1] ?? '')) return null;
  const n = parseInt(tag[1], 10);
  return Number.isSafeInteger(n) ? n : null;
}

export interface MovePlan {
  ok: true;
  /** Where the post is now, and where it would go (unix seconds). */
  from: number;
  to: number;
  /** The tags the moved event will carry: the original's, with only the time tags below changed. */
  tags: string[][];
  /** A poll's closing time, before and after. It keeps its length: it moves by as much as the post does. */
  pollClose: { from: number; to: number } | null;
  /** True when a `published_at` tag that equalled the old publish time moves with it. */
  publishedAtMoves: boolean;
}

export type MovePlanResult =
  | MovePlan
  | ScheduleFailure<'bad_publish_time' | 'expires_before_publish' | 'poll_closes_before_publish'>;

/**
 * What moving `original` to `newPublishAt` would do, without signing or
 * sending anything. The move dialog shows this and asks before any
 * signature is requested.
 *
 * A move changes the TIME and nothing else. Kind, content and every tag
 * are the original's own, as they were signed, with three exceptions
 * that are themselves times:
 *
 *   - a poll's closing time (`endsAt` on kind 1068, `closed_at` on 6969)
 *     moves by the same amount as the post, so the poll runs as long as
 *     it was set to;
 *   - `published_at` moves with the post only where it was the old
 *     publish time; a different value is the author's own date and stays;
 *   - an `expiration` tag (NIP-40) is never changed. If the post would
 *     already have expired at the new time, the move is refused.
 *
 * The time must be one the picker would offer: at least 5 minutes from
 * now and inside 90 days.
 */
export function planMove(original: NostrEvent, newPublishAt: number, nowSeconds: number): MovePlanResult {
  if (!Number.isInteger(newPublishAt) || pickedTimeProblem(newPublishAt, nowSeconds)) {
    return { ok: false, code: 'bad_publish_time' };
  }
  const from = original.created_at;
  const delta = newPublishAt - from;
  const pollCloseTag = POLL_CLOSE_TAG_BY_KIND[original.kind];
  let pollClose: MovePlan['pollClose'] = null;
  let publishedAtMoves = false;

  const tags: string[][] = [];
  for (const tag of original.tags) {
    const copy = [...tag];
    const seconds = tagSeconds(tag);
    if (seconds !== null) {
      if (tag[0] === 'expiration' && seconds <= newPublishAt) {
        return { ok: false, code: 'expires_before_publish' };
      }
      if (pollCloseTag && tag[0] === pollCloseTag) {
        copy[1] = String(seconds + delta);
        pollClose ??= { from: seconds, to: seconds + delta };
      } else if (tag[0] === 'published_at' && seconds === from) {
        copy[1] = String(newPublishAt);
        publishedAtMoves = true;
      }
    }
    tags.push(copy);
  }
  // The server's own rule, checked here so it is never the first to say so.
  if (pollClose && pollClose.to <= newPublishAt + 60) {
    return { ok: false, code: 'poll_closes_before_publish' };
  }
  return { ok: true, from, to: newPublishAt, tags, pollClose, publishedAtMoves };
}

/**
 * Is `moved` the original post at a new time and nothing else? Checked
 * on the SIGNED event, independently of how it was built: same author,
 * kind and content, the same tags in the same order, and where a tag
 * differs it is one of the time tags, changed only in its value, to
 * exactly what the rules in planMove allow.
 */
export function isSamePostMoved(original: NostrEvent, moved: NostrEvent): boolean {
  if (moved.pubkey !== original.pubkey || moved.kind !== original.kind || moved.content !== original.content) {
    return false;
  }
  if (!Array.isArray(moved.tags) || moved.tags.length !== original.tags.length) return false;
  const delta = moved.created_at - original.created_at;
  const pollCloseTag = POLL_CLOSE_TAG_BY_KIND[original.kind];
  for (let i = 0; i < original.tags.length; i++) {
    const a = original.tags[i];
    const b = moved.tags[i];
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let j = 0; j < a.length; j++) {
      if (a[j] === b[j]) continue;
      if (j !== 1) return false;
      const was = tagSeconds(a);
      if (was === null) return false;
      const isPollClose = !!pollCloseTag && a[0] === pollCloseTag && b[1] === String(was + delta);
      const isPublishedAt = a[0] === 'published_at' && was === original.created_at && b[1] === String(moved.created_at);
      if (!isPollClose && !isPublishedAt) return false;
    }
  }
  return true;
}

export type SignMoveResult =
  | { ok: true; event: NostrEvent; plan: MovePlan }
  | ScheduleFailure<
      | 'not_signed_in'
      | 'sign_failed'
      | 'signer_changed_event'
      | 'pubkey_mismatch'
      | 'bad_publish_time'
      | 'expires_before_publish'
      | 'poll_closes_before_publish'
      | 'move_changed_post'
    >;

/**
 * Sign `original` again for a new publish time, changing nothing else.
 *
 * NOT through NDKEvent.sign(), which signForSchedule uses for a post
 * fresh from the composer: that call re-derives tags from the content
 * (it adds `t`, `p` and `e` tags, and rewrites `@npub…` to `nostr:npub…`
 * in the text), which is right for a new post and wrong for one that
 * was already signed as its author wanted it, possibly by another app.
 * Here the event is built and hashed locally and the signer is asked
 * for the signature alone.
 *
 * Nothing is returned unless the signed event verifies, carries the new
 * time, and is the same post (isSamePostMoved).
 */
export async function signMove(
  original: NostrEvent,
  newPublishAt: number,
  depsOverride?: Partial<ScheduleClientDeps>
): Promise<SignMoveResult> {
  const deps = await resolveDeps(depsOverride);
  const plan = planMove(original, newPublishAt, deps.now());
  if (!plan.ok) return plan;

  let moved: NostrEvent;
  try {
    await deps.prepareSigner();
    const signer = await deps.rawSigner();
    if (!signer) return { ok: false, code: 'not_signed_in' };
    // A different account is signed in than the one that scheduled this.
    if (signer.pubkey !== original.pubkey) return { ok: false, code: 'pubkey_mismatch' };
    const unsigned = {
      kind: original.kind,
      content: original.content,
      tags: plan.tags.map((tag) => [...tag]),
      created_at: newPublishAt,
      pubkey: original.pubkey
    };
    const id = getEventHash(unsigned);
    const sig = await signer.sign({ ...unsigned, id, sig: '' });
    // Our own copy, with the signer's signature: whatever the signer did
    // to the object it was handed, this is what was asked to be signed.
    moved = { ...unsigned, id, sig };
  } catch (err) {
    console.warn('[Schedule] signing the move failed:', err);
    return { ok: false, code: 'sign_failed' };
  }

  let verified = false;
  try {
    verified = verifyEvent({ ...moved });
  } catch {
    verified = false;
  }
  // A signer that re-dated or otherwise changed what it signed returns a
  // signature for some other event; it does not verify against ours.
  if (!verified || moved.created_at !== newPublishAt) {
    console.warn('[Schedule] the signer returned a signature for a different event than the move');
    return { ok: false, code: 'signer_changed_event' };
  }
  if (!isSamePostMoved(original, moved)) return { ok: false, code: 'move_changed_post' };
  return { ok: true, event: moved, plan };
}

export type MoveScheduledResult =
  | {
      ok: true;
      /** The row as it now stands, built from the answer: the caller updates its view without a refetch. */
      item: ScheduledItem;
      /** The id of the row it replaced. */
      replacedId: string;
      /** See ScheduleEventResult.replacement. */
      replacement: 'replaced' | 'original_still_scheduled';
    }
  | Exclude<SignMoveResult, { ok: true }>
  | Exclude<ScheduleEventResult, { ok: true }>;

/**
 * Move a pending scheduled post to a new time: sign it again verbatim
 * (signMove) and swap it for the old row in one step (`replaces`), with
 * the relay mode and relays the old row had. On any failure the post is
 * where it was.
 *
 * Two signatures: the post, then the request. Call it only after the
 * person has confirmed the move (show them planMove's result first).
 */
export async function moveScheduled(
  item: ScheduledItem,
  newPublishAt: number,
  depsOverride?: Partial<ScheduleClientDeps>
): Promise<MoveScheduledResult> {
  const deps = await resolveDeps(depsOverride);
  const signed = await signMove(item.event, newPublishAt, deps);
  if (!signed.ok) return signed;
  const stored = await scheduleEvent(
    signed.event,
    // The old row's own relays, [] included: a move never re-derives them.
    { relayMode: item.relayMode, relays: item.relays, replaces: item.id },
    deps
  );
  if (!stored.ok) return stored;
  return {
    ok: true,
    replacedId: item.id,
    replacement: stored.replacement ?? 'replaced',
    item: {
      id: stored.id,
      publishAt: stored.publishAt,
      relayMode: stored.relayMode,
      relays: stored.relays,
      status: stored.status,
      attempts: 0,
      lastError: null,
      sentAt: null,
      event: signed.event
    }
  };
}

// ── transport ───────────────────────────────────────────────────────

type Sent =
  | { kind: 'response'; status: number; data: Record<string, unknown> }
  | { kind: 'failure'; failure: ScheduleFailure<'not_signed_in' | 'network'> };

/**
 * One authenticated request. The auth event signs the bare URL (the
 * query string is not part of the NIP-98 `u` match). On 401 the request
 * is sent once more with a freshly signed header, as the contract asks:
 * the usual cause is a header that aged past 60 s behind a signer prompt.
 */
async function send(
  deps: ScheduleClientDeps,
  method: 'POST' | 'GET' | 'DELETE',
  path: string,
  query = '',
  bodyString?: string
): Promise<Sent> {
  const url = `${deps.origin()}${path}`;
  for (let attempt = 0; ; attempt++) {
    let authorization: string;
    try {
      authorization = await deps.signAuthHeader({ method, url, bodyString });
    } catch (err) {
      console.warn('[Schedule] NIP-98 signing unavailable:', err);
      return { kind: 'failure', failure: { ok: false, code: 'not_signed_in' } };
    }
    let res: Response;
    try {
      res = await deps.fetch(`${url}${query}`, {
        method,
        headers: {
          Authorization: authorization,
          ...(bodyString !== undefined ? { 'Content-Type': 'application/json' } : {})
        },
        body: bodyString
      });
    } catch (err) {
      console.warn('[Schedule] request failed:', err);
      return { kind: 'failure', failure: { ok: false, code: 'network' } };
    }
    if (res.status === 401 && attempt === 0) continue;
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return {
      kind: 'response',
      status: res.status,
      data: data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {}
    };
  }
}

/** The server's `error` as one of our codes; anything unrecognized is `unknown`. */
function serverCode(data: Record<string, unknown>): ScheduleErrorCode {
  const error = data.error;
  return typeof error === 'string' && (SERVER_CODES as readonly string[]).includes(error)
    ? (error as ScheduleErrorCode)
    : 'unknown';
}

function asStatus(value: unknown): ScheduleStatus | undefined {
  return SCHEDULE_STATUSES.includes(value as ScheduleStatus) ? (value as ScheduleStatus) : undefined;
}

/** Narrow a server code to the ones a given endpoint documents; the rest become `unknown`. */
function failure<C extends ScheduleErrorCode>(
  code: ScheduleErrorCode,
  allowed: readonly C[],
  status?: ScheduleStatus
): ScheduleFailure<C | 'unknown'> {
  const narrowed = (allowed as readonly ScheduleErrorCode[]).includes(code) ? (code as C) : 'unknown';
  return status ? { ok: false, code: narrowed, status } : { ok: false, code: narrowed };
}

const COMMON: readonly CommonFailure[] = [
  'auth_failed',
  'not_configured',
  'internal',
  'not_signed_in',
  'network',
  'unknown'
];

// ── scheduleEvent ───────────────────────────────────────────────────

export interface ScheduleEventOptions {
  relayMode: ScheduleRelayMode;
  /**
   * Relays to broadcast to as well as the scheduler's own, 'all' mode
   * only. Leave undefined to use the author's NIP-65 write relays when
   * they are known; pass [] to send none. Whatever is given is filtered
   * through pickScheduleRelays first.
   */
  relays?: readonly string[];
  /**
   * The id of the caller's pending post that this event takes the place
   * of (a reschedule or an edit). The server stores the new event and
   * cancels the old one in one step, or does neither: `not_replaceable`
   * (the old one is already going out, sent, failed or cancelled; see
   * `status`) or `not_found`. Nothing is stored on those.
   */
  replaces?: string;
}

const SCHEDULE_CODES = [
  ...COMMON,
  'bad_request',
  'bad_relay_mode',
  'bad_relays',
  'bad_signature',
  'pubkey_mismatch',
  'bad_kind',
  'kind_not_allowed_for_relay_mode',
  'bad_publish_time',
  'too_large',
  'poll_closes_before_publish',
  'already_scheduled',
  'quota_exceeded',
  'rate_limited',
  'not_found',
  'not_replaceable'
] as const;

/**
 * Schedule a signed event (from signForSchedule). Safe to call again
 * with the same event after a `network` or `internal` failure: the
 * server answers 409 for an event it already has, and that comes back
 * here as success with `alreadyScheduled: true`.
 */
export async function scheduleEvent(
  signedEvent: NostrEvent,
  options: ScheduleEventOptions,
  depsOverride?: Partial<ScheduleClientDeps>
): Promise<ScheduleEventResult> {
  const deps = await resolveDeps(depsOverride);

  let relays: string[] = [];
  if (options.relayMode === 'all') {
    let source: readonly unknown[] = options.relays ?? [];
    if (options.relays === undefined) {
      try {
        source = await deps.getWriteRelays(signedEvent.pubkey);
      } catch {
        source = []; // unknown is fine: the scheduler's own relays still get it
      }
    }
    relays = pickScheduleRelays(source);
  }

  const post = (withRelays: string[]) =>
    send(
      deps,
      'POST',
      '/api/schedule',
      '',
      JSON.stringify({
        event: signedEvent,
        relay_mode: options.relayMode,
        ...(withRelays.length > 0 ? { relays: withRelays } : {}),
        ...(options.replaces ? { replaces: options.replaces } : {})
      })
    );

  let sent = await post(relays);
  // Contract: on bad_relays, retry once without them so the post still
  // goes to the scheduler's own relays. Our filter should make this
  // unreachable; if the server's rules ever tighten, it is not fatal.
  if (sent.kind === 'response' && serverCode(sent.data) === 'bad_relays' && relays.length > 0) {
    console.warn('[Schedule] server refused the relay list; retrying without it');
    sent = await post([]);
  }
  if (sent.kind === 'failure') return sent.failure;

  const { status, data } = sent;
  if (status === 201) {
    const created = {
      ok: true as const,
      id: typeof data.id === 'string' ? data.id : signedEvent.id,
      publishAt: typeof data.publish_at === 'number' ? data.publish_at : signedEvent.created_at,
      relayMode: (data.relay_mode === 'pantry' ? 'pantry' : 'all') as ScheduleRelayMode,
      relays: Array.isArray(data.relays) ? data.relays.filter((r): r is string => typeof r === 'string') : [],
      status: asStatus(data.status) ?? 'pending',
      alreadyScheduled: false
    };
    if (!options.replaces) return created;
    if (data.replaced === options.replaces) return { ...created, replacement: 'replaced' };

    // Contract: a 201 without `replaced` means the server did not act on
    // `replaces`, so BOTH posts are scheduled. Cancel the old one now.
    console.warn('[Schedule] the server ignored `replaces`; cancelling the original by hand');
    const cancelOld = await cancelScheduled(options.replaces, deps);
    if (cancelOld.ok || cancelOld.code === 'not_found') return { ...created, replacement: 'replaced' };
    if (cancelOld.code === 'not_cancellable' && (cancelOld.status === 'publishing' || cancelOld.status === 'sent')) {
      // The original is going out or has gone out: the new one must not
      // follow it. Take it back, and report what the atomic path would have.
      const undo = await cancelScheduled(created.id, deps);
      if (undo.ok) return { ok: false, code: 'not_replaceable', status: cancelOld.status };
    }
    return { ...created, replacement: 'original_still_scheduled' };
  }

  const code = serverCode(data);
  if (code === 'already_scheduled') {
    const rowStatus = asStatus(data.status);
    // An earlier attempt landed: that is the outcome the caller wanted.
    if (rowStatus === 'pending' || rowStatus === 'publishing' || rowStatus === 'sent') {
      return {
        ok: true,
        id: signedEvent.id,
        publishAt: signedEvent.created_at,
        relayMode: options.relayMode,
        relays,
        status: rowStatus,
        alreadyScheduled: true,
        // `replaced` on this answer says the swap happened (an earlier
        // attempt of this same request). Without it, this exact post was
        // already scheduled some other way and the one it was meant to
        // replace may well still be: the caller must say so.
        ...(options.replaces
          ? {
              replacement:
                data.replaced === options.replaces ? ('replaced' as const) : ('original_still_scheduled' as const)
            }
          : {})
      };
    }
    // Failed (or a status we do not know, or `cancelled` from a server
    // that does not yet revive cancelled rows): this exact event will
    // not go out. The caller must sign a new one to retry.
    return failure(code, SCHEDULE_CODES, rowStatus);
  }
  if (!options.replaces) {
    // These two are answers to `replaces` only; on a plain create they
    // are not something the contract says can happen.
    if (code === 'not_found' || code === 'not_replaceable') return { ok: false, code: 'unknown' };
    return failure(code, SCHEDULE_CODES);
  }
  if (code === 'not_replaceable') return failure(code, SCHEDULE_CODES, asStatus(data.status));
  if (code === 'rate_limited' && data.limit === 'moves') return { ok: false, code, limit: 'moves' };
  return failure(code, SCHEDULE_CODES);
}

// ── listScheduled ───────────────────────────────────────────────────

function parseItem(raw: unknown): ScheduledItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const status = asStatus(r.status);
  const event = r.event as NostrEvent | undefined;
  if (
    typeof r.id !== 'string' ||
    typeof r.publish_at !== 'number' ||
    !status ||
    !event ||
    typeof event !== 'object' ||
    typeof event.id !== 'string' ||
    typeof event.kind !== 'number' ||
    typeof event.content !== 'string' ||
    !Array.isArray(event.tags)
  ) {
    return null;
  }
  return {
    id: r.id,
    publishAt: r.publish_at,
    relayMode: r.relay_mode === 'pantry' ? 'pantry' : 'all',
    relays: Array.isArray(r.relays) ? r.relays.filter((x): x is string => typeof x === 'string') : [],
    status,
    attempts: typeof r.attempts === 'number' ? r.attempts : 0,
    lastError: typeof r.last_error === 'string' ? r.last_error : null,
    sentAt: typeof r.sent_at === 'number' ? r.sent_at : null,
    event
  };
}

/**
 * The signed-in account's scheduled events, newest publish time first
 * (the server's order), at most 100. `status` narrows to one status;
 * without it, every status except cancelled. `truncated` says the cap
 * cut the result (the oldest publish times are the ones dropped).
 * Rows this client cannot read are skipped rather than failing the list.
 */
export async function listScheduled(
  options: { status?: ScheduleStatus } = {},
  depsOverride?: Partial<ScheduleClientDeps>
): Promise<ListScheduledResult> {
  const deps = await resolveDeps(depsOverride);
  const query = options.status ? `?status=${encodeURIComponent(options.status)}` : '';
  const sent = await send(deps, 'GET', '/api/schedule', query);
  if (sent.kind === 'failure') return sent.failure;
  if (sent.status === 200 && Array.isArray(sent.data.items)) {
    const items = sent.data.items.map(parseItem).filter((i): i is ScheduledItem => i !== null);
    return { ok: true, items, truncated: sent.data.truncated === true };
  }
  return failure(serverCode(sent.data), [...COMMON, 'bad_status'] as const);
}

// ── cancelScheduled ─────────────────────────────────────────────────

/**
 * Cancel a pending scheduled event. `not_cancellable` carries the
 * row's status (publishing, sent or failed) so the UI can say what
 * actually happened. A row that was already cancelled counts as done.
 */
export async function cancelScheduled(
  id: string,
  depsOverride?: Partial<ScheduleClientDeps>
): Promise<CancelScheduledResult> {
  // The id becomes a path segment; anything but an event id is not a row.
  if (!/^[0-9a-f]{64}$/.test(id)) return { ok: false, code: 'not_found' };
  const deps = await resolveDeps(depsOverride);
  const sent = await send(deps, 'DELETE', `/api/schedule/${id}`);
  if (sent.kind === 'failure') return sent.failure;
  if (sent.status === 200 && sent.data.status === 'cancelled') {
    return { ok: true, id, alreadyCancelled: false };
  }
  const code = serverCode(sent.data);
  if (code === 'not_cancellable') {
    const rowStatus = asStatus(sent.data.status);
    if (rowStatus === 'cancelled') return { ok: true, id, alreadyCancelled: true };
    return failure(code, [...COMMON, 'not_found', 'not_cancellable'] as const, rowStatus);
  }
  return failure(code, [...COMMON, 'not_found', 'not_cancellable'] as const);
}

// ── copy ────────────────────────────────────────────────────────────

const COPY: Record<ScheduleErrorCode, string> = {
  auth_failed: "Couldn't verify your account. Check your device's date and time, then try again.",
  bad_request: "Couldn't schedule this post. Please try again.",
  bad_relay_mode: "Couldn't schedule this post. Please try again.",
  bad_relays: "Couldn't schedule this post to your relays. Please try again.",
  bad_signature: "Your signer returned a post we couldn't verify. Please try again.",
  pubkey_mismatch: 'This post was signed by a different account. Sign in again and retry.',
  bad_kind: "This kind of post can't be scheduled.",
  kind_not_allowed_for_relay_mode: "This kind of post can't be scheduled to the members' relay.",
  bad_publish_time: 'Pick a time at least 5 minutes from now and within 90 days.',
  too_large: 'This post is too long to schedule.',
  poll_closes_before_publish: "This poll would close before it's posted. Move the closing time later.",
  already_scheduled:
    "This exact post was scheduled for that time before and didn't go out, so it can't be scheduled for it again. Pick a different time, even by a minute.",
  quota_exceeded: 'You have 50 posts scheduled, the most allowed. Cancel one, or wait for one to go out.',
  rate_limited: "You've scheduled a lot in the last hour. Try again later.",
  bad_status: "Couldn't load your scheduled posts. Please try again.",
  not_found: 'This scheduled post no longer exists.',
  not_cancellable: "This post can't be cancelled any more.",
  not_replaceable: "This post can't be changed any more.",
  not_configured: 'Scheduling is unavailable right now.',
  internal: 'Something went wrong. Please try again.',
  not_signed_in: 'Sign in to schedule posts.',
  sign_failed: "Your signer didn't sign the post. Check your signer and try again.",
  signer_changed_event:
    "Your signer changed this post's time, so it can't be scheduled. Try a different signer, or post it now instead.",
  expires_before_publish:
    "This post is set to expire before that time, so it can't be moved there. Pick an earlier time, or edit the post.",
  move_changed_post:
    "This post couldn't be moved without changing it, so nothing was done. Use Edit to change it in the composer.",
  network: "Couldn't reach Zap Cooking. Check your connection and try again.",
  unknown: 'Something went wrong. Please try again.'
};

const NOT_CANCELLABLE_COPY: Partial<Record<ScheduleStatus, string>> = {
  publishing: "This post is being published right now and can't be cancelled.",
  sent: 'This post has already been published.',
  failed: "This post already failed and won't be sent."
};

const NOT_REPLACEABLE_COPY: Partial<Record<ScheduleStatus, string>> = {
  publishing: "This post is being published right now and can't be changed.",
  sent: 'This post has already been published.',
  cancelled: 'This post was cancelled.',
  failed: "This post already failed and won't be sent."
};

/**
 * Plain wording for a failure, for showing to a person. Total over
 * ScheduleErrorCode, so a new code cannot ship without copy.
 */
export function scheduleErrorCopy(result: {
  code: ScheduleErrorCode;
  status?: ScheduleStatus;
  limit?: 'moves';
}): string {
  if (result.code === 'not_cancellable' && result.status) {
    return NOT_CANCELLABLE_COPY[result.status] ?? COPY.not_cancellable;
  }
  if (result.code === 'not_replaceable' && result.status) {
    return NOT_REPLACEABLE_COPY[result.status] ?? COPY.not_replaceable;
  }
  if (result.code === 'rate_limited' && result.limit === 'moves') {
    return "You've moved a lot of posts in the last hour. Try again later.";
  }
  return COPY[result.code];
}
