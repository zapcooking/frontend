/**
 * Go live — the held "ended" announcement, server side: store it while
 * the session is open, publish it once the session has ended.
 *
 * The event is signed by the host ahead of time (see endedEvent.ts). The
 * server checks it, keeps the newest one on the session row, and sends
 * it to relays when the session ends, whichever way that happens: the
 * End route tries once at once, and the sweep (once a minute) publishes
 * whatever is still waiting, with a few retries. Nothing here builds or
 * signs an event.
 *
 * Every query here names the 0011 columns itself, so nothing else breaks
 * while that migration is missing: these calls throw, and their callers
 * log and carry on.
 */
import { verifyEvent } from 'nostr-tools/pure';
import { publishToRelay, type WebSocketFactory, type WebSocketLike } from '$lib/rawPublish';
import { DISCOVERY_RELAYS, goLiveAnnouncementRelays } from '$lib/streams/relays';
import {
  endedEventProblem,
  isSignedEventShape,
  pickEvent,
  pickHostRelays,
  type EndedEventProblem,
  type SignedEvent
} from './endedEvent';
import { nowSeconds, type LiveDb } from './sessions.server';

/** Failed publish attempts before the sweep stops trying a session. */
export const ENDED_PUBLISH_MAX_TRIES = 5;
/** Sessions the sweep publishes for in one run. */
export const ENDED_PUBLISH_BATCH = 2;
/** Per relay. Short: the sweep has 20 s for everything it does. */
export const ENDED_PUBLISH_TIMEOUT_MS = 4000;

/** The relays every held event goes to: where the page publishes the live one, minus the host's own. */
export function endedFixedRelays(): string[] {
  return [...new Set([...DISCOVERY_RELAYS, ...goLiveAnnouncementRelays()])];
}

export type EventVerifier = (event: SignedEvent) => boolean;

export type StoreOutcome =
  | { ok: true; id: string }
  /** Not this session's ended announcement, or not signed by its host. */
  | { ok: false; reason: 'invalid'; problem: EndedEventProblem | 'signature' }
  /** The held one is as new or newer. */
  | { ok: false; reason: 'not_newer' }
  /** The session ended in the meantime. */
  | { ok: false; reason: 'ended' };

/**
 * Check a host's pre-signed ended announcement and keep it if it is
 * newer than the one held. `relays` is the host's own relay list, cut
 * down to the ones the server will use.
 */
export async function storeEndedEvent(
  db: LiveDb,
  session: { id: string; host_pubkey: string; created_at: number },
  event: unknown,
  relays: unknown,
  opts: { now?: number; verify?: EventVerifier } = {}
): Promise<StoreOutcome> {
  const problem = endedEventProblem(
    event,
    { id: session.id, hostPubkey: session.host_pubkey, createdAt: session.created_at },
    opts.now ?? nowSeconds()
  );
  if (problem) return { ok: false, reason: 'invalid', problem };
  const signed = pickEvent(event as SignedEvent);
  const verify = opts.verify ?? ((e: SignedEvent) => verifyEvent(e as never));
  if (!verify(signed)) return { ok: false, reason: 'invalid', problem: 'signature' };

  const hostRelays = pickHostRelays(relays, endedFixedRelays());
  const result = await db
    .prepare(
      `UPDATE live_sessions
          SET ended_event = ?2, ended_event_relays = ?3
        WHERE id = ?1 AND status != 'ended'
          AND (ended_event IS NULL OR json_extract(ended_event, '$.created_at') < ?4)`
    )
    .bind(session.id, JSON.stringify(signed), JSON.stringify(hostRelays), signed.created_at)
    .run();
  if ((result.meta?.changes ?? 0) === 1) return { ok: true, id: signed.id };
  const now = await db
    .prepare('SELECT status FROM live_sessions WHERE id = ?1')
    .bind(session.id)
    .first<{ status: string }>();
  return { ok: false, reason: !now || now.status === 'ended' ? 'ended' : 'not_newer' };
}

/**
 * Forget the held event of an open session: the host page has published
 * a newer live announcement without a twin, so relays would refuse the
 * held one anyway. True when something was dropped.
 */
export async function dropEndedEvent(db: LiveDb, id: string): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE live_sessions SET ended_event = NULL, ended_event_relays = NULL
        WHERE id = ?1 AND status != 'ended' AND ended_event IS NOT NULL`
    )
    .bind(id)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

function parseHeld(raw: string | null): SignedEvent | null {
  if (!raw) return null;
  try {
    const event = JSON.parse(raw);
    return isSignedEventShape(event) ? event : null;
  } catch {
    return null;
  }
}

/**
 * The held event of a session that HAS ended, for anyone: by then it is
 * meant to be public. Null while the session is open (handing it out
 * early would let anyone mark a running stream as ended), and when there
 * is none.
 */
export async function readEndedEvent(db: LiveDb, id: string): Promise<SignedEvent | null> {
  const row = await db
    .prepare("SELECT ended_event FROM live_sessions WHERE id = ?1 AND status = 'ended'")
    .bind(id)
    .first<{ ended_event: string | null }>();
  return parseHeld(row?.ended_event ?? null);
}

export interface EndedPublishDeps {
  /** Tests inject a scripted socket; production opens a real one. */
  wsFactory?: WebSocketFactory;
  timeoutMs?: number;
  /**
   * Publish ONLY to these, whatever the row and the fixed list say. For
   * local checks (LIVE_ENDED_RELAYS), so a test never writes to a public
   * relay. Unset in production.
   */
  relaysOverride?: string[] | null;
}

/** LIVE_ENDED_RELAYS, comma separated, or null when unset. */
export function parseRelaysOverride(value: string | undefined): string[] | null {
  if (!value) return null;
  const urls = value
    .split(',')
    .map((url) => url.trim())
    .filter((url) => /^wss?:\/\/\S+$/.test(url));
  return urls.length ? urls : null;
}

export type EndedPublishOutcome =
  /** Nothing to do: no held event, not ended, or already settled. */
  | { state: 'none' }
  | { state: 'published' | 'retry' | 'gave_up'; accepted: number; newer: number; failed: number };

/** A relay that refuses the event because it already has a newer one: the stream reads as ended there. */
const HAS_NEWER = /newer|replaced|duplicate|already have/i;

/**
 * Publish the held ended announcement of an ended session, if it is
 * still waiting. Settled as 'published' when at least one relay took it
 * or said it already has a newer one (the host page's own ended event);
 * otherwise counted as a failed try, and given up after the last one.
 * Safe to run twice at once: the event is the same and the row updates
 * are conditional.
 */
export async function publishHeldEnded(
  db: LiveDb,
  id: string,
  deps: EndedPublishDeps = {}
): Promise<EndedPublishOutcome> {
  const row = await db
    .prepare(
      `SELECT ended_event, ended_event_relays, ended_publish_tries FROM live_sessions
        WHERE id = ?1 AND status = 'ended' AND ended_event IS NOT NULL
          AND ended_publish_state IS NULL`
    )
    .bind(id)
    .first<{
      ended_event: string;
      ended_event_relays: string | null;
      ended_publish_tries: number;
    }>();
  if (!row) return { state: 'none' };

  const event = parseHeld(row.ended_event);
  let hostRelays: unknown = [];
  try {
    hostRelays = JSON.parse(row.ended_event_relays ?? '[]');
  } catch {
    hostRelays = [];
  }
  const fixed = endedFixedRelays();
  // The host's relays were checked when stored, and are checked again here.
  const relays = deps.relaysOverride ?? [...fixed, ...pickHostRelays(hostRelays, fixed)];

  let accepted = 0;
  let newer = 0;
  let failed = 0;
  let firstFailure = '';
  if (event) {
    const wsFactory =
      deps.wsFactory ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike);
    const timeoutMs = deps.timeoutMs ?? ENDED_PUBLISH_TIMEOUT_MS;
    const results = await Promise.allSettled(
      relays.map((url) => publishToRelay(url, event, timeoutMs, wsFactory))
    );
    for (const result of results) {
      if (result.status === 'fulfilled') {
        accepted++;
        continue;
      }
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      if (HAS_NEWER.test(reason)) newer++;
      else {
        failed++;
        firstFailure ||= reason;
      }
    }
  } else {
    firstFailure = 'held event unreadable';
  }

  let state: 'published' | 'retry' | 'gave_up';
  if (accepted + newer > 0) {
    state = 'published';
    await db
      .prepare(
        `UPDATE live_sessions SET ended_publish_state = 'published'
          WHERE id = ?1 AND ended_publish_state IS NULL`
      )
      .bind(id)
      .run();
  } else {
    const tries = row.ended_publish_tries + 1;
    state = !event || tries >= ENDED_PUBLISH_MAX_TRIES ? 'gave_up' : 'retry';
    await db
      .prepare(
        `UPDATE live_sessions
            SET ended_publish_tries = ended_publish_tries + 1, ended_publish_state = ?2
          WHERE id = ?1 AND ended_publish_state IS NULL`
      )
      .bind(id, state === 'gave_up' ? 'gave_up' : null)
      .run();
  }
  console.log(
    `[LiveEnded] session=${id} relays=${relays.length} accepted=${accepted} newer=${newer} failed=${failed} try=${row.ended_publish_tries + 1} state=${state}` +
      (firstFailure ? ` first_failure=${JSON.stringify(firstFailure.slice(0, 160))}` : '')
  );
  return { state, accepted, newer, failed };
}

export interface EndedSweepSummary {
  published: number;
  retry: number;
  gaveUp: number;
}

/** The sweep's step: publish for ended sessions whose held event is still waiting, fewest tries first. */
export async function publishPendingEnded(
  db: LiveDb,
  deps: EndedPublishDeps = {},
  outOfTime: () => boolean = () => false,
  limit = ENDED_PUBLISH_BATCH
): Promise<EndedSweepSummary> {
  const summary: EndedSweepSummary = { published: 0, retry: 0, gaveUp: 0 };
  const { results } = await db
    .prepare(
      `SELECT id FROM live_sessions
        WHERE status = 'ended' AND ended_event IS NOT NULL AND ended_publish_state IS NULL
        ORDER BY ended_publish_tries, ended_at LIMIT ?1`
    )
    .bind(limit)
    .all<{ id: string }>();
  for (const row of results ?? []) {
    if (outOfTime()) break;
    const outcome = await publishHeldEnded(db, row.id, deps);
    if (outcome.state === 'published') summary.published++;
    else if (outcome.state === 'retry') summary.retry++;
    else if (outcome.state === 'gave_up') summary.gaveUp++;
  }
  return summary;
}
