/**
 * Scheduled Posts — web client for /api/schedule.
 *
 * The contract is docs/schedule-contract.md; this module is the web
 * client's reading of it and should change with it.
 *
 *   signForSchedule(event, publishAt)   sign with created_at = publish time
 *   scheduleEvent(signed, { relayMode, relays })
 *   listScheduled({ status })
 *   cancelScheduled(id)
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

import { verifyEvent, type Event as NostrEvent } from 'nostr-tools';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import { isPublicRelayUrl, ENDED_HOST_RELAYS_NEVER } from './live/endedEvent';
import {
  MAX_SCHEDULE_RELAYS,
  MAX_SCHEDULE_RELAY_URL_LENGTH,
  normalizeScheduleRelay
} from './scheduleRelays';

// ── types ───────────────────────────────────────────────────────────

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
  | 'not_configured'
  | 'internal'
  // client-side
  | 'not_signed_in'
  | 'sign_failed'
  | 'signer_changed_event'
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
  'not_configured',
  'internal'
];

export interface ScheduleFailure<C extends ScheduleErrorCode = ScheduleErrorCode> {
  ok: false;
  code: C;
  /**
   * The row's status, where the server reports one: `already_scheduled`
   * (the existing row is cancelled or failed) and `not_cancellable`.
   */
  status?: ScheduleStatus;
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
    >;

export type ListScheduledResult =
  | { ok: true; items: ScheduledItem[] }
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
    now: () => Math.floor(Date.now() / 1000)
  };
}

async function resolveDeps(overrides?: Partial<ScheduleClientDeps>): Promise<ScheduleClientDeps> {
  const complete =
    overrides &&
    (['fetch', 'origin', 'signAuthHeader', 'getWriteRelays', 'prepareSigner', 'now'] as const).every(
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
  'rate_limited'
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
        ...(withRelays.length > 0 ? { relays: withRelays } : {})
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
    return {
      ok: true,
      id: typeof data.id === 'string' ? data.id : signedEvent.id,
      publishAt: typeof data.publish_at === 'number' ? data.publish_at : signedEvent.created_at,
      relayMode: data.relay_mode === 'pantry' ? 'pantry' : 'all',
      relays: Array.isArray(data.relays) ? data.relays.filter((r): r is string => typeof r === 'string') : [],
      status: asStatus(data.status) ?? 'pending',
      alreadyScheduled: false
    };
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
        alreadyScheduled: true
      };
    }
    // Cancelled or failed (or a status we do not know): this exact
    // event will not go out. The caller must sign a new one to retry.
    return failure(code, SCHEDULE_CODES, rowStatus);
  }
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
 * (the server's order), at most 100. `status` narrows to one status.
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
    return { ok: true, items };
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
  already_scheduled: "This post was already scheduled and then cancelled or failed, so it won't be sent. Schedule it again to retry.",
  quota_exceeded: 'You have 50 posts scheduled, the most allowed. Cancel one, or wait for one to go out.',
  rate_limited: "You've scheduled a lot in the last hour. Try again later.",
  bad_status: "Couldn't load your scheduled posts. Please try again.",
  not_found: 'This scheduled post no longer exists.',
  not_cancellable: "This post can't be cancelled any more.",
  not_configured: 'Scheduling is unavailable right now.',
  internal: 'Something went wrong. Please try again.',
  not_signed_in: 'Sign in to schedule posts.',
  sign_failed: "Your signer didn't sign the post. Check your signer and try again.",
  signer_changed_event:
    "Your signer changed this post's time, so it can't be scheduled. Try a different signer, or post it now instead.",
  network: "Couldn't reach Zap Cooking. Check your connection and try again.",
  unknown: 'Something went wrong. Please try again.'
};

const NOT_CANCELLABLE_COPY: Partial<Record<ScheduleStatus, string>> = {
  publishing: "This post is being published right now and can't be cancelled.",
  sent: 'This post has already been published.',
  failed: "This post already failed and won't be sent."
};

/**
 * Plain wording for a failure, for showing to a person. Total over
 * ScheduleErrorCode, so a new code cannot ship without copy.
 */
export function scheduleErrorCopy(result: { code: ScheduleErrorCode; status?: ScheduleStatus }): string {
  if (result.code === 'not_cancellable' && result.status) {
    return NOT_CANCELLABLE_COPY[result.status] ?? COPY.not_cancellable;
  }
  return COPY[result.code];
}
