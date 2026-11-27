/**
 * Go live — admin metrics (/admin/live/metrics).
 *
 * Auth for every call: NIP-98 signed by a key in ADMIN_PUBKEYS, as for
 * /api/admin/live. Nothing else is accepted.
 *
 * GET /api/admin/live/metrics
 *   200: { now, this_month, last_month, monthly, streams, since, truncated,
 *          waiting, usd_per_1000_minutes }
 *     monthly     live_host_monthly rows for this month and last month
 *                 (UTC). Streams are counted once recorded (about 5 min
 *                 after they end).
 *     streams     every stream that went live in the 30 UTC days ending
 *                 today (the same days as the page's charts), newest
 *                 first, with its metrics (viewer_seconds NULL until
 *                 recorded, or when it could not be read). At most
 *                 STREAMS_LIMIT; `truncated` is true when there were more.
 *     since       the start of that window (unix seconds, 00:00 UTC)
 *     waiting     ended sessions not recorded yet, for any reason (inside
 *                 the 5-minute wait, queued, or retrying a lookup)
 *
 * POST /api/admin/live/metrics — body { action: 'record' }
 *   Runs the sweep's close-out step now (see $lib/live/metrics.server):
 *   records ended streams whose 5-minute wait is over, oldest first, until
 *   the queue is empty or RECORD_BUDGET_MS runs out. The cron sweep does
 *   the same every minute, but only against production; this is how a
 *   preview deployment records its streams. Not written to the action log
 *   (it moderates nothing).
 *   200: { recorded, gaveUp, retry, waiting }   (see CloseOutSummary)
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { ADMIN_PUBKEYS } from '$lib/adminAuth';
import { verifyNip98 } from '$lib/nip98.server';
import { readBodyCapped } from '$lib/live/body.server';
import { LIVE_COST_USD_PER_1000_MINUTES } from '$lib/live/config';
import {
  closeOutEndedSessions,
  countWaiting,
  fetchStreamZapSats,
  listMetricsStreams,
  listMonthly,
  monthKey
} from '$lib/live/metrics.server';
import { finishPresence, readPresenceTotals } from '$lib/live/presence.server';
import { nowSeconds, type LiveDb } from '$lib/live/sessions.server';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_BODY_BYTES = 256;
const RECORD_BUDGET_MS = 20_000;
const DAY = 86_400;
/** Most streams returned for the 30-day window. More sets `truncated`. */
const STREAMS_LIMIT = 5000;
const forbidden = () => json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });
const bad = () => json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });

export const GET: RequestHandler = async ({ request, platform }) => {
  const auth = await verifyNip98(request, { expectedPubkeys: ADMIN_PUBKEYS });
  if (!auth.ok) {
    console.warn(`[Live metrics] NIP-98 rejected (${auth.reason}) on GET`);
    return forbidden();
  }
  const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
  if (!db) return json({ error: 'not_configured' }, { status: 500, headers: NO_STORE });
  try {
    const now = nowSeconds();
    const thisMonth = monthKey(now);
    const lastMonth = monthKey(now, -1);
    // 00:00 UTC 29 days ago: the first of the charts' 30 daily buckets.
    const since = Math.floor(now / DAY) * DAY - 29 * DAY;
    const [monthly, rows, waiting] = await Promise.all([
      listMonthly(db, [lastMonth, thisMonth]),
      listMetricsStreams(db, since, STREAMS_LIMIT + 1),
      countWaiting(db)
    ]);
    const truncated = rows.length > STREAMS_LIMIT;
    const streams = truncated ? rows.slice(0, STREAMS_LIMIT) : rows;
    return json(
      {
        now,
        this_month: thisMonth,
        last_month: lastMonth,
        monthly,
        streams,
        since,
        truncated,
        waiting,
        usd_per_1000_minutes: LIVE_COST_USD_PER_1000_MINUTES
      },
      { headers: NO_STORE }
    );
  } catch (err) {
    console.error(`[Live metrics] read failed: ${(err as Error)?.name ?? 'error'}`);
    return json({ error: 'internal' }, { status: 500, headers: NO_STORE });
  }
};

export const POST: RequestHandler = async ({ request, platform }) => {
  const bodyBytes = await readBodyCapped(request, MAX_BODY_BYTES);
  if (bodyBytes === 'too_large') {
    return json({ error: 'too_large' }, { status: 413, headers: NO_STORE });
  }
  if (bodyBytes === 'unreadable') return bad();
  const auth = await verifyNip98(request, { expectedPubkeys: ADMIN_PUBKEYS, bodyBytes });
  if (!auth.ok) {
    console.warn(`[Live metrics] NIP-98 rejected (${auth.reason}) on POST`);
    return forbidden();
  }
  const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
  if (!db) return json({ error: 'not_configured' }, { status: 500, headers: NO_STORE });
  let action: unknown;
  try {
    action = (JSON.parse(new TextDecoder().decode(bodyBytes)) as { action?: unknown } | null)
      ?.action;
  } catch {
    return bad();
  }
  if (action !== 'record') return bad();
  const deadline = Date.now() + RECORD_BUDGET_MS;
  // Provider lookups shared by this run (one per host).
  const providers = new Map();
  const summary = await closeOutEndedSessions(
    db,
    {
      readTotals: (id) => readPresenceTotals(platform, id),
      finish: (id) => finishPresence(platform, id),
      zapSats: (targets, host) => fetchStreamZapSats(targets, host, { providers })
    },
    nowSeconds(),
    () => Date.now() > deadline
  );
  console.log(
    `[Live metrics] record recorded=${summary.recorded} gave_up=${summary.gaveUp} retry=${summary.retry} waiting=${summary.waiting}`
  );
  return json(summary, { headers: NO_STORE });
};
