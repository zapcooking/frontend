/**
 * zap-cooking-cron — two triggers, routed on event.cron:
 *
 *   "0 9 * * *"  daily membership-expiry check (pre-existing behavior)
 *   "* * * * *"  scheduled-posts sweep/broadcast (spec §6)
 *
 * Anything that isn't the minutely cron falls through to the
 * membership check, preserving the original worker's behavior for the
 * daily trigger and for manual `wrangler triggers` invocations.
 */

import { sweepDueEvents } from './sweep';
import { publishEventRaw } from './publisher';

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
 * Trigger router, exported for tests: the minutely cron must never
 * hit the membership endpoint and the daily cron must never run the
 * sweep. `impl` is injectable so tests can assert exactly that.
 */
export async function dispatchScheduled(event, env, impl) {
  if (event.cron === MINUTELY_CRON) {
    return impl.sweep(env);
  }
  return impl.membership(env);
}

export default {
  async scheduled(event, env, ctx) {
    await dispatchScheduled(event, env, {
      sweep: runSweepTick,
      membership: checkExpiringMemberships
    });
  }
};
