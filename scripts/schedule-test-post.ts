/**
 * Scheduled Posts — end-to-end acceptance script (spec §8).
 *
 * Signs a throwaway-key kind 1 with created_at = now + 180, schedules
 * it via POST /api/schedule with a real NIP-98 header, polls GET until
 * the row is 'sent', then confirms the event is fetchable by id on
 * wss://pantry.zap.cooking. This is the acceptance gate for the whole
 * backend (PRs A+B+C together).
 *
 * Prerequisites (must be live before this can pass):
 *   - PR B routes deployed with the SCHEDULER_DB binding
 *   - SCHEDULE_ENC_KEY secret set on the Pages project AND the cron
 *     worker (same value in both)
 *   - the cron worker deployed with the minutely trigger
 *
 * Usage:
 *   npx tsx scripts/schedule-test-post.ts
 *   SCHEDULE_TEST_BASE_URL=https://staging.zap.cooking npx tsx scripts/schedule-test-post.ts
 *
 * relay_mode is 'pantry' so the throwaway test post stays off the
 * public relays. Exit 0 = full pipeline verified; exit 1 = failure
 * (the failing stage is the last log line).
 */

import { finalizeEvent, generateSecretKey, getPublicKey, SimplePool } from 'nostr-tools';
import { normalizeUrl, sha256Hex } from '../src/lib/nip98';
import { standardRelays } from '../src/lib/consts';

const BASE_URL = process.env.SCHEDULE_TEST_BASE_URL ?? 'https://zap.cooking';
const PANTRY_RELAY = 'wss://pantry.zap.cooking';
// SCHEDULE_TEST_RELAY_MODE=all schedules against the public relay list
// instead of pantry — diagnostic mode for isolating pantry's write
// posture from the worker's publish machinery. Default stays 'pantry'
// so the routine acceptance run keeps test posts off public relays.
const RELAY_MODE = process.env.SCHEDULE_TEST_RELAY_MODE === 'all' ? 'all' : 'pantry';
const CONFIRM_RELAYS = RELAY_MODE === 'pantry' ? [PANTRY_RELAY] : [...standardRelays];
const PUBLISH_LEAD_SECONDS = 180;
const POLL_INTERVAL_MS = 30_000;
const POLL_TIMEOUT_MS = 10 * 60_000;
const RELAY_FETCH_TIMEOUT_MS = 15_000;

const nowSec = () => Math.floor(Date.now() / 1000);
const log = (stage: string, msg: string) => console.log(`[${stage}] ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const sk = generateSecretKey();
const pubkey = getPublicKey(sk);

async function nip98Header(url: string, method: string, bodyString?: string): Promise<string> {
  const tags: string[][] = [
    ['u', normalizeUrl(url)],
    ['method', method]
  ];
  if (bodyString !== undefined) {
    tags.push(['payload', await sha256Hex(new TextEncoder().encode(bodyString))]);
  }
  const event = finalizeEvent({ kind: 27235, created_at: nowSec(), tags, content: '' }, sk);
  return `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}`;
}

async function main(): Promise<void> {
  // ── 1/4: sign the future event ────────────────────────────────────
  const publishAt = nowSec() + PUBLISH_LEAD_SECONDS;
  const event = finalizeEvent(
    {
      kind: 1,
      created_at: publishAt,
      tags: [],
      content: `zap.cooking scheduled-posts integration test — ${new Date().toISOString()}`
    },
    sk
  );
  log('1/4 sign', `throwaway pubkey ${pubkey}`);
  log('1/4 sign', `event ${event.id}, publish_at ${publishAt} (${new Date(publishAt * 1000).toISOString()})`);

  // ── 2/4: schedule it ──────────────────────────────────────────────
  const scheduleUrl = `${BASE_URL}/api/schedule`;
  const body = JSON.stringify({ event, relay_mode: RELAY_MODE });
  const postRes = await fetch(scheduleUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: await nip98Header(scheduleUrl, 'POST', body)
    },
    body
  });
  const postData = (await postRes.json()) as Record<string, unknown>;
  if (postRes.status !== 201) {
    throw new Error(`POST /api/schedule returned ${postRes.status}: ${JSON.stringify(postData)}`);
  }
  log('2/4 schedule', `201 (relay_mode=${RELAY_MODE}) — ${JSON.stringify(postData)}`);

  // ── 3/4: poll until the sweep broadcasts it ───────────────────────
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let status = 'pending';
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const listRes = await fetch(scheduleUrl, {
      headers: { Authorization: await nip98Header(scheduleUrl, 'GET') }
    });
    if (listRes.status !== 200) {
      log('3/4 poll', `GET returned ${listRes.status} — retrying`);
      continue;
    }
    const { items } = (await listRes.json()) as { items: { id: string; status: string; attempts: number; last_error: string | null }[] };
    const item = items.find((i) => i.id === event.id);
    if (!item) throw new Error('scheduled row disappeared from the list endpoint');
    status = item.status;
    log('3/4 poll', `status=${item.status} attempts=${item.attempts} last_error=${item.last_error ?? 'none'}`);
    if (status === 'sent') break;
    if (status === 'failed') throw new Error(`row failed terminally: ${item.last_error}`);
  }
  if (status !== 'sent') {
    throw new Error(`timed out after ${POLL_TIMEOUT_MS / 60000} min — row still '${status}'`);
  }
  log('3/4 poll', 'row is sent — sweep broadcast it');

  // ── 4/4: confirm on the pantry relay ──────────────────────────────
  const pool = new SimplePool();
  try {
    const fetched = await Promise.race([
      pool.get(CONFIRM_RELAYS, { ids: [event.id] }),
      sleep(RELAY_FETCH_TIMEOUT_MS).then(() => null)
    ]);
    if (!fetched) throw new Error(`event ${event.id} not found on ${CONFIRM_RELAYS.join(', ')}`);
    if (fetched.content !== event.content) throw new Error('relay returned a different event body');
    log('4/4 relay', `event confirmed via ${CONFIRM_RELAYS.length} relay(s) (${RELAY_MODE} mode)`);
  } finally {
    pool.close(CONFIRM_RELAYS);
  }

  log('done', 'scheduled → swept → broadcast → fetchable. Full pipeline verified.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`FAILED: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
