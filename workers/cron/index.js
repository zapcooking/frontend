/**
 * zap-cooking-cron — two triggers, routed on event.cron:
 *
 *   "0 9 * * *"  daily membership-expiry check (pre-existing behavior)
 *                plus the account-deletion digest to the admin account
 *   "* * * * *"  scheduled-posts sweep/broadcast (spec §6)
 *                plus the Go live sweep (ends abandoned and over-long
 *                live sessions; see src/lib/live/sweep.server.ts)
 *
 * Anything that isn't the minutely cron falls through to the daily
 * jobs, preserving the original worker's behavior for the daily
 * trigger and for manual `wrangler triggers` invocations.
 */

import { sweepDueEvents } from './sweep';
import { publishEventRaw } from './publisher';
import { runDeletionDigest } from './deletionDigest';
import { ADMIN_PUBKEY } from '../../src/lib/adminAuth';

export const MINUTELY_CRON = '* * * * *';
export const DAILY_CRON = '0 9 * * *';

async function checkExpiringMemberships(env) {
  const response = await fetch('https://zap.cooking/api/cron/check-expiring-memberships', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.CRON_SECRET}`
    }
  });

  const result = await response.json();
  console.log('Cron job result:', result);
}

async function deletionDigest(env) {
  if (!env.SCHEDULER_DB) {
    console.error('[Deletion Digest] SCHEDULER_DB not configured — skipping');
    return;
  }
  try {
    const result = await runDeletionDigest({
      db: env.SCHEDULER_DB,
      senderKey: env.NOTIFICATION_PRIVATE_KEY,
      recipientPubkey: ADMIN_PUBKEY,
      publish: (event, relays) => publishEventRaw(event, relays)
    });
    if (result === 'no-sender-key') {
      console.error(
        '[Deletion Digest] deletion requests are pending but NOTIFICATION_PRIVATE_KEY is not set on this worker — nobody was told'
      );
    } else {
      console.log('[Deletion Digest]', result);
    }
  } catch (error) {
    console.error('[Deletion Digest] failed:', error?.message ?? error);
  }
}

async function runSweepTick(env) {
  if (!env.SCHEDULER_DB || !env.SCHEDULE_ENC_KEY) {
    console.error('[Sweep] SCHEDULER_DB / SCHEDULE_ENC_KEY not configured — skipping tick');
    return;
  }

  // Raw-WebSocket publisher (publisher.ts) — NOT nostr-tools. Its
  // inbound-frame queue relies on MessageChannel, which is undefined
  // in the Workers runtime, so it drops every frame after the first;
  // relays that preface OK with AUTH (pantry/khatru) always "timed
  // out". publishEventRaw awaits the id-matched OK per relay, closes
  // sockets in every path, and throws the first relay's verbatim
  // failure reason when nothing accepts — which sweep.ts records as
  // last_error.
  const summary = await sweepDueEvents({
    db: env.SCHEDULER_DB,
    encKeyHex: env.SCHEDULE_ENC_KEY,
    publish: (event, relays) => publishEventRaw(event, relays)
  });
  if (summary.due > 0) console.log('[Sweep]', JSON.stringify(summary));
}

/**
 * Go live sweep. The work is done by the Pages project, which holds the
 * Stream token and the session code: this worker only knocks once a
 * minute. CRON_SECRET must be set on BOTH this worker and the Pages
 * project (the endpoint refuses without it).
 */
async function runLiveSweepTick(env) {
  if (!env.CRON_SECRET) {
    console.error('[LiveSweep] CRON_SECRET not configured on the cron worker — skipping tick');
    return;
  }
  const response = await fetch('https://zap.cooking/api/cron/live-sweep', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CRON_SECRET.trim()}` },
    signal: AbortSignal.timeout(25_000)
  });
  if (!response.ok) {
    console.error(`[LiveSweep] endpoint answered ${response.status}`);
    return;
  }
  const summary = await response.json();
  // Quiet when there was nothing to look at; counts only otherwise.
  const acted =
    summary.examined > 0 ||
    summary.retried?.deleted > 0 ||
    summary.retried?.pending > 0 ||
    summary.orphans?.candidates > 0 ||
    summary.rowsDeleted > 0 ||
    summary.outOfTime;
  if (acted) console.log('[LiveSweep]', JSON.stringify(summary));
}

/**
 * Trigger router, exported for tests: the minutely cron must never
 * hit the membership endpoint or send the digest, and the daily cron
 * must never run either sweep. `impl` is injectable so tests can assert
 * exactly that. The daily jobs are independent — one failing must not
 * stop the other.
 */
export async function dispatchScheduled(event, env, impl) {
  if (event.cron === MINUTELY_CRON) {
    // Independent jobs: a failure or a slow run in one must not stop the
    // other. Failures are logged here because allSettled swallows them.
    const results = await Promise.allSettled([impl.sweep(env), impl.liveSweep(env)]);
    for (const [i, result] of results.entries()) {
      if (result.status === 'rejected') {
        console.error(
          `[${i === 0 ? 'Sweep' : 'LiveSweep'}] tick failed:`,
          result.reason?.message ?? result.reason
        );
      }
    }
    return;
  }
  await Promise.allSettled([impl.membership(env), impl.deletionDigest(env)]);
}

export default {
  async scheduled(event, env, ctx) {
    await dispatchScheduled(event, env, {
      sweep: runSweepTick,
      liveSweep: runLiveSweepTick,
      membership: checkExpiringMemberships,
      deletionDigest
    });
  }
};
