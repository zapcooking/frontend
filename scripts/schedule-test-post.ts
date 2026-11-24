/**
 * Scheduled Posts — acceptance script.
 *
 * Usage (the base URL is required; there is no default):
 *
 *   npx tsx scripts/schedule-test-post.ts <base-url>
 *
 * What it does depends on the base URL.
 *
 * NOT https://zap.cooking (a preview or staging deployment) — API CHECK
 *   Proves the API contract in docs/schedule-contract.md: create with a
 *   `relays` value, 409 `already_scheduled` with `status` on a repeat
 *   POST, list with ?status=pending, `bad_relays`,
 *   `kind_not_allowed_for_relay_mode`, and cancel. Then it stops. A
 *   preview deployment writes to zapcooking-scheduler-preview, which the
 *   cron worker never sweeps (workers/cron/wrangler.toml binds the
 *   production database only), so a preview row can never reach `sent`.
 *   The one row it creates is scheduled a day out and cancelled before
 *   the script exits. Takes a few seconds.
 *
 * https://zap.cooking (production) — FULL PIPELINE
 *   Schedules a kind 1 from a throwaway key 180 s out in 'pantry' mode,
 *   polls until the sweep reports `sent`, reads the note back from
 *   wss://pantry.zap.cooking (authenticated as the throwaway key, filter
 *   authors:[self]), deletes it with a kind 5 from the same key, and
 *   confirms it is gone. Takes about 4 to 6 minutes.
 *
 * Nothing is ever sent to a public relay: the only relay_mode used for
 * an event that can be published is 'pantry'. The throwaway key lives in
 * memory only and is never written anywhere. If a step fails, the last
 * lines say which event id is involved and exactly what was left behind.
 *
 * Exit 0 = pass. Exit 1 = failure. Exit 2 = bad usage.
 */

import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, type Event } from 'nostr-tools';

export const PRODUCTION_ORIGIN = 'https://zap.cooking';
export const PANTRY_RELAY = 'wss://pantry.zap.cooking';

const PRODUCTION_LEAD_SECONDS = 180;
const POLL_INTERVAL_MS = 30_000;
const POLL_TIMEOUT_MS = 10 * 60_000;
const RELAY_STEP_TIMEOUT_MS = 10_000;
const GONE_CHECKS = 5;
const GONE_CHECK_INTERVAL_MS = 2_000;

const nowSec = () => Math.floor(Date.now() / 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (stage: string, msg: string) => console.log(`[${stage}] ${msg}`);

class StepError extends Error {}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new StepError(message);
}

// ── NIP-98 ──────────────────────────────────────────────────────────

/** Origin + path, no query, no fragment, no trailing slash (contract: `u` tag). */
function nip98Url(url: string): string {
  const u = new URL(url);
  const path = u.pathname.length > 1 && u.pathname.endsWith('/') ? u.pathname.slice(0, -1) : u.pathname;
  return `${u.origin}${path}`;
}

function nip98Header(sk: Uint8Array, url: string, method: string, body?: string): string {
  const tags: string[][] = [
    ['u', nip98Url(url)],
    ['method', method]
  ];
  if (body !== undefined) tags.push(['payload', createHash('sha256').update(body).digest('hex')]);
  const event = finalizeEvent({ kind: 27235, created_at: nowSec(), tags, content: '' }, sk);
  return `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}`;
}

interface ApiResult {
  status: number;
  data: any;
}

async function api(
  sk: Uint8Array,
  method: 'POST' | 'GET' | 'DELETE',
  url: string,
  body?: unknown
): Promise<ApiResult> {
  const bodyString = body === undefined ? undefined : JSON.stringify(body);
  const res = await fetch(url, {
    method,
    headers: {
      ...(bodyString !== undefined ? { 'Content-Type': 'application/json' } : {}),
      Authorization: nip98Header(sk, url, method, bodyString)
    },
    body: bodyString
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { unparsed: text.slice(0, 200) };
  }
  return { status: res.status, data };
}

const show = (r: ApiResult) => `${r.status} ${JSON.stringify(r.data)}`;

// ── API check (any deployment that is not production) ───────────────

async function runApiCheck(baseUrl: string): Promise<void> {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const scheduleUrl = `${baseUrl}/api/schedule`;
  const stamp = new Date().toISOString();
  // A day out: far from any sweep even if this deployment turned out to
  // share a swept database, and it is cancelled below either way.
  const publishAt = nowSec() + 86_400;
  const event = finalizeEvent(
    { kind: 1, created_at: publishAt, tags: [], content: `zap.cooking scheduler API check ${stamp}` },
    sk
  );
  log('setup', `throwaway pubkey ${pubkey}`);
  log('setup', `event ${event.id}, publish_at ${publishAt} (a day out; it will be cancelled)`);

  let created = false;
  let cancelled = false;
  try {
    // 1. Create, with a relays value that needs normalizing.
    const createBody = { event, relay_mode: 'all', relays: ['wss://Relay.Example.com/'] };
    const create = await api(sk, 'POST', scheduleUrl, createBody);
    check(create.status === 201, `create: expected 201, got ${show(create)}`);
    created = true;
    check(create.data.id === event.id, `create: id mismatch: ${show(create)}`);
    check(create.data.status === 'pending', `create: status is not pending: ${show(create)}`);
    check(
      JSON.stringify(create.data.relays) === JSON.stringify(['wss://relay.example.com']),
      `create: relays not stored normalized: ${show(create)}`
    );
    log('1/6 create', `201, relays stored as ${JSON.stringify(create.data.relays)}`);

    // 2. The same signed event again: 409 with the row's status.
    const repeat = await api(sk, 'POST', scheduleUrl, createBody);
    check(repeat.status === 409, `repeat POST: expected 409, got ${show(repeat)}`);
    check(
      repeat.data.error === 'already_scheduled' && repeat.data.status === 'pending',
      `repeat POST: expected already_scheduled with status pending, got ${show(repeat)}`
    );
    log('2/6 repeat', '409 already_scheduled, status pending');

    // 3. List with the status filter.
    const listed = await api(sk, 'GET', `${scheduleUrl}?status=pending`);
    check(listed.status === 200, `list: expected 200, got ${show(listed)}`);
    const items: any[] = listed.data?.items ?? [];
    const item = items.find((i) => i.id === event.id);
    check(item, 'list ?status=pending: the new row is missing');
    check(
      items.every((i) => i.status === 'pending'),
      'list ?status=pending: returned a row that is not pending'
    );
    check(
      JSON.stringify(item.relays) === JSON.stringify(['wss://relay.example.com']),
      `list: relays missing from the item: ${JSON.stringify(item.relays)}`
    );
    check(item.event?.id === event.id && item.event?.sig === event.sig, 'list: event not returned intact');
    log('3/6 list', `?status=pending returned the row (${items.length} pending), relays and event intact`);

    // 4. A relay the server must refuse. Nothing is stored.
    const badRelayEvent = finalizeEvent(
      { kind: 1, created_at: publishAt + 1, tags: [], content: `bad_relays probe ${stamp}` },
      sk
    );
    const badRelays = await api(sk, 'POST', scheduleUrl, {
      event: badRelayEvent,
      relay_mode: 'all',
      relays: ['wss://localhost']
    });
    check(
      badRelays.status === 400 && badRelays.data.error === 'bad_relays',
      `bad relays: expected 400 bad_relays, got ${show(badRelays)}`
    );
    log('4/6 bad_relays', '400 bad_relays for wss://localhost');

    // 5. A comment (kind 1111) cannot be scheduled to pantry. Nothing is stored.
    const commentEvent = finalizeEvent(
      { kind: 1111, created_at: publishAt + 2, tags: [], content: `pantry kind probe ${stamp}` },
      sk
    );
    const pantryKind = await api(sk, 'POST', scheduleUrl, { event: commentEvent, relay_mode: 'pantry' });
    check(
      pantryKind.status === 400 && pantryKind.data.error === 'kind_not_allowed_for_relay_mode',
      `pantry kind: expected 400 kind_not_allowed_for_relay_mode, got ${show(pantryKind)}`
    );
    log('5/6 pantry kind', '400 kind_not_allowed_for_relay_mode for kind 1111 with pantry');

    // 6. Cancel, and see that it took.
    const cancel = await api(sk, 'DELETE', `${scheduleUrl}/${event.id}`);
    check(
      cancel.status === 200 && cancel.data.status === 'cancelled',
      `cancel: expected 200 cancelled, got ${show(cancel)}`
    );
    cancelled = true;
    const after = await api(sk, 'GET', `${scheduleUrl}?status=pending`);
    check(after.status === 200, `list after cancel: expected 200, got ${show(after)}`);
    check(
      !(after.data.items as any[]).some((i) => i.id === event.id),
      'list after cancel: the row is still pending'
    );
    const again = await api(sk, 'DELETE', `${scheduleUrl}/${event.id}`);
    check(
      again.status === 409 && again.data.error === 'not_cancellable' && again.data.status === 'cancelled',
      `second cancel: expected 409 not_cancellable (cancelled), got ${show(again)}`
    );
    log('6/6 cancel', '200 cancelled; gone from ?status=pending; a second cancel is 409 not_cancellable');
  } catch (err) {
    if (created && !cancelled) {
      const cleanup = await api(sk, 'DELETE', `${scheduleUrl}/${event.id}`).catch(() => null);
      const ok = cleanup?.status === 200;
      console.error(`LEFT BEHIND: event ${event.id}`);
      console.error(
        ok
          ? '  The scheduled row was cancelled during cleanup. Nothing will be published.'
          : `  A PENDING row for this event remains on ${baseUrl}, due ${new Date(publishAt * 1000).toISOString()}, ` +
              `relay_mode all. Cleanup cancel answered ${cleanup ? show(cleanup) : 'nothing'}. ` +
              'The throwaway key is gone, so it cannot be cancelled through the API; ' +
              "cancel it in D1: UPDATE scheduled_events SET status='cancelled' WHERE id='<that id>'."
      );
    }
    throw err;
  }

  log('done', 'API CHECK PASSED: create, repeat (409), list, bad_relays, pantry kind gate, cancel.');
  log(
    'done',
    `Stopping here: ${new URL(baseUrl).host} is not production. The cron worker sweeps only the production ` +
      "database, so a row scheduled here can never reach 'sent'. Run against https://zap.cooking for the full pipeline."
  );
  log('done', 'Left behind: one cancelled row for a throwaway pubkey. Nothing was published.');
}

// ── pantry: authenticated read and delete over a raw WebSocket ──────

type Frame = unknown[];

/**
 * One connection to a relay that requires NIP-42 auth to read (pantry).
 * Exported so the read / delete / confirm-gone sequence can be exercised
 * against a local relay without touching production.
 */
export class RelaySession {
  private ws!: WebSocket;
  private frames: Frame[] = [];
  private waiters: (() => void)[] = [];
  private closed = false;

  constructor(
    private url: string,
    private sk: Uint8Array
  ) {}

  async open(): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener('message', (ev) => {
      try {
        const frame = JSON.parse(String(ev.data));
        if (Array.isArray(frame)) this.frames.push(frame);
      } catch {
        /* not JSON: ignore */
      }
      this.wake();
    });
    this.ws.addEventListener('close', () => {
      this.closed = true;
      this.wake();
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new StepError(`could not connect to ${this.url}`)), RELAY_STEP_TIMEOUT_MS);
      this.ws.addEventListener('open', () => (clearTimeout(timer), resolve()));
      this.ws.addEventListener('error', () => (clearTimeout(timer), reject(new StepError(`connection error (${this.url})`))));
    });
  }

  private wake() {
    for (const w of this.waiters.splice(0)) w();
  }

  /** Wait for (and consume) the first frame matching `match`, or null on timeout. */
  private async take(match: (f: Frame) => boolean, timeoutMs = RELAY_STEP_TIMEOUT_MS): Promise<Frame | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = this.frames.findIndex(match);
      if (i >= 0) return this.frames.splice(i, 1)[0];
      const left = deadline - Date.now();
      if (left <= 0 || this.closed) return null;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => (clearTimeout(timer), resolve()));
      });
    }
  }

  /** Answer the relay's NIP-42 challenge as the throwaway key. */
  async authenticate(): Promise<void> {
    const challenge = await this.take((f) => f[0] === 'AUTH' && typeof f[1] === 'string', 5_000);
    check(challenge, `${this.url} sent no AUTH challenge within 5 s`);
    const auth = finalizeEvent(
      {
        kind: 22242,
        created_at: nowSec(),
        tags: [
          ['relay', this.url],
          ['challenge', challenge[1] as string]
        ],
        content: ''
      },
      this.sk
    );
    this.ws.send(JSON.stringify(['AUTH', auth]));
    const ok = await this.take((f) => f[0] === 'OK' && f[1] === auth.id);
    check(ok, `${this.url} did not answer the AUTH event`);
    check(ok[2] === true, `${this.url} refused AUTH: ${String(ok[3] ?? '')}`);
  }

  /** Events matching `filter`, up to EOSE. Throws if the relay refuses the REQ. */
  async query(filter: Record<string, unknown>): Promise<Event[]> {
    const sub = `acc-${Math.random().toString(36).slice(2, 10)}`;
    this.ws.send(JSON.stringify(['REQ', sub, filter]));
    const events: Event[] = [];
    for (;;) {
      const frame = await this.take((f) => (f[0] === 'EVENT' || f[0] === 'EOSE' || f[0] === 'CLOSED') && f[1] === sub);
      check(frame, `${this.url} did not finish the query (no EOSE)`);
      if (frame[0] === 'EVENT') events.push(frame[2] as Event);
      else if (frame[0] === 'CLOSED') throw new StepError(`${this.url} refused the read: ${String(frame[2] ?? '')}`);
      else break;
    }
    this.ws.send(JSON.stringify(['CLOSE', sub]));
    return events;
  }

  /** Publish an event on this (authenticated) connection; resolves on OK true. */
  async publish(event: Event): Promise<void> {
    this.ws.send(JSON.stringify(['EVENT', event]));
    const ok = await this.take((f) => f[0] === 'OK' && f[1] === event.id);
    check(ok, `${this.url} did not answer the kind ${event.kind} event`);
    check(ok[2] === true, `${this.url} refused the kind ${event.kind} event: ${String(ok[3] ?? '')}`);
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* already closed */
    }
  }
}

/**
 * Read the note back as its author, delete it, and confirm it is gone.
 * Returns once the relay no longer serves the event. Exported for the
 * same reason as RelaySession.
 */
export async function readDeleteConfirm(
  relayUrl: string,
  sk: Uint8Array,
  event: Event,
  onStep: (stage: string, msg: string) => void = log
): Promise<void> {
  const pubkey = getPublicKey(sk);
  const filter = { ids: [event.id], authors: [pubkey] };
  const session = new RelaySession(relayUrl, sk);
  try {
    await session.open();
    await session.authenticate();
    const found = await session.query(filter);
    check(found.length > 0, `event ${event.id} is not on ${relayUrl} (authenticated read, authors:[self])`);
    check(
      found[0].id === event.id && found[0].sig === event.sig && found[0].content === event.content,
      `${relayUrl} returned a different event than the one scheduled`
    );
    onStep('4/6 read', `found on ${relayUrl} (authenticated as the throwaway key, authors:[self]), byte-identical`);

    const deletion = finalizeEvent(
      {
        kind: 5,
        created_at: nowSec(),
        tags: [
          ['e', event.id],
          ['k', String(event.kind)]
        ],
        content: 'scheduler acceptance test cleanup'
      },
      sk
    );
    await session.publish(deletion);
    onStep('5/6 delete', `kind 5 ${deletion.id} accepted by ${relayUrl}`);

    let remaining = 1;
    for (let i = 0; i < GONE_CHECKS && remaining > 0; i++) {
      if (i > 0) await sleep(GONE_CHECK_INTERVAL_MS);
      remaining = (await session.query(filter)).length;
    }
    check(remaining === 0, `${relayUrl} accepted the kind 5 but still serves event ${event.id}`);
    onStep('6/6 gone', `${relayUrl} no longer returns the note`);
  } finally {
    session.close();
  }
}

// ── full pipeline (production only) ─────────────────────────────────

async function runFullPipeline(baseUrl: string): Promise<void> {
  // The key stays in this variable until the delete is confirmed.
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const scheduleUrl = `${baseUrl}/api/schedule`;
  const publishAt = nowSec() + PRODUCTION_LEAD_SECONDS;
  const event = finalizeEvent(
    {
      kind: 1,
      created_at: publishAt,
      tags: [],
      content: `zap.cooking scheduled-posts acceptance test ${new Date().toISOString()} (will be deleted)`
    },
    sk
  );
  log('1/6 sign', `throwaway pubkey ${pubkey}`);
  log('1/6 sign', `event ${event.id}, publish_at ${publishAt} (${new Date(publishAt * 1000).toISOString()})`);

  /** What exists right now, for the failure report. */
  let state: 'nothing' | 'row-pending' | 'published' | 'deleted' = 'nothing';
  try {
    const create = await api(sk, 'POST', scheduleUrl, { event, relay_mode: 'pantry' });
    check(create.status === 201, `create: expected 201, got ${show(create)}`);
    state = 'row-pending';
    log('2/6 schedule', `201 relay_mode=pantry ${JSON.stringify(create.data)}`);

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let status = 'pending';
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const listed = await api(sk, 'GET', scheduleUrl);
      if (listed.status !== 200) {
        log('3/6 poll', `list answered ${show(listed)}; retrying`);
        continue;
      }
      const item = (listed.data.items as any[]).find((i) => i.id === event.id);
      check(item, 'the scheduled row disappeared from the list');
      status = item.status;
      log('3/6 poll', `status=${item.status} attempts=${item.attempts} last_error=${item.last_error ?? 'none'}`);
      // 'publishing' means a relay may already have it.
      if (status !== 'pending') state = 'published';
      if (status === 'sent') break;
      if (status === 'failed') {
        state = 'row-pending'; // terminal, and nothing accepted it
        throw new StepError(`the row failed terminally: ${item.last_error}`);
      }
    }
    check(status === 'sent', `timed out after ${POLL_TIMEOUT_MS / 60_000} min; the row is still '${status}'`);
    log('3/6 poll', 'row is sent: the sweep broadcast it');

    await readDeleteConfirm(PANTRY_RELAY, sk, event);
    state = 'deleted';
  } catch (err) {
    console.error(`LEFT BEHIND: event ${event.id}, throwaway pubkey ${pubkey}`);
    if (state === 'nothing') {
      console.error('  Nothing. The event was never accepted by the API.');
    } else if (state === 'row-pending') {
      const cleanup = await api(sk, 'DELETE', `${scheduleUrl}/${event.id}`).catch(() => null);
      if (cleanup?.status === 200) {
        console.error('  The scheduled row was cancelled during cleanup. Nothing was or will be published.');
      } else if (cleanup?.status === 409 && cleanup.data?.status === 'failed') {
        console.error("  A 'failed' row in the scheduler database. No relay accepted the note; nothing is on pantry.");
      } else {
        console.error(
          `  A scheduled row that could not be cancelled (cancel answered ${cleanup ? show(cleanup) : 'nothing'}). ` +
            `If it is still pending it will be published to ${PANTRY_RELAY} at ${new Date(publishAt * 1000).toISOString()}.`
        );
        printKeyForManualCleanup(sk);
      }
    } else {
      console.error(
        `  The note is (or may be) on ${PANTRY_RELAY}: kind 1, readable only by its author and members. ` +
          'It was NOT confirmed deleted. Nothing was sent to any other relay.'
      );
      console.error("  Also a 'sent' or 'publishing' row for it in the scheduler database.");
      printKeyForManualCleanup(sk);
    }
    throw err;
  }

  log('done', 'FULL PIPELINE PASSED: scheduled, swept, on pantry, read back, deleted, confirmed gone.');
  log(
    'done',
    "Left behind: one 'sent' row for the throwaway pubkey in the scheduler database (the API has no delete). " +
      'No note remains on any relay.'
  );
}

/**
 * Last resort, failure path only: the throwaway key is the only thing
 * that can delete the note or cancel the row, and it dies with this
 * process. It controls nothing but this one test note.
 */
function printKeyForManualCleanup(sk: Uint8Array) {
  console.error(
    `  To finish by hand, this throwaway key can delete the note (kind 5 to ${PANTRY_RELAY} after NIP-42 auth) ` +
      'or cancel the row (DELETE /api/schedule/<id>). It was never written to disk:'
  );
  console.error(`  ${nip19.nsecEncode(sk)}`);
}

// ── entry ───────────────────────────────────────────────────────────

function usage(problem: string): never {
  console.error(`${problem}\n`);
  console.error('Usage: npx tsx scripts/schedule-test-post.ts <base-url>');
  console.error('  <base-url> is required. A preview deployment runs the API check;');
  console.error(`  ${PRODUCTION_ORIGIN} runs the full pipeline (publishes one note to pantry, then deletes it).`);
  process.exit(2);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1) usage(args.length === 0 ? 'Missing base URL.' : 'Expected exactly one argument.');
  let base: URL;
  try {
    base = new URL(args[0]);
  } catch {
    usage(`Not a URL: ${args[0]}`);
  }
  if (base.protocol !== 'https:' && base.hostname !== 'localhost' && base.hostname !== '127.0.0.1') {
    usage(`The base URL must be https: ${args[0]}`);
  }
  if (base.pathname !== '/' || base.search || base.hash) usage(`Give the origin only, with no path: ${args[0]}`);
  if (base.hostname === 'www.zap.cooking') usage(`Use ${PRODUCTION_ORIGIN} for production.`);

  const baseUrl = base.origin;
  if (baseUrl === PRODUCTION_ORIGIN) {
    log('mode', `FULL PIPELINE against production (${baseUrl}); one note goes to ${PANTRY_RELAY} and is deleted`);
    await runFullPipeline(baseUrl);
  } else {
    log('mode', `API CHECK against ${baseUrl} (not production: nothing will be published)`);
    await runApiCheck(baseUrl);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`FAILED: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    });
}
