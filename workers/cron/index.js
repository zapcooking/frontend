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

import { SimplePool } from 'nostr-tools';
import { sweepDueEvents } from './sweep';

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

  // One pool per tick, closed in finally (spec §6.6). Workers supports
  // outbound WebSockets, which is all SimplePool needs.
  const pool = new SimplePool();
  const openedRelays = new Set();
  try {
    const summary = await sweepDueEvents({
      db: env.SCHEDULER_DB,
      encKeyHex: env.SCHEDULE_ENC_KEY,
      publish: async (event, relays) => {
        relays.forEach((r) => openedRelays.add(r));
        // pool.publish returns one promise per relay, fulfilled on OK.
        const results = await Promise.allSettled(pool.publish(relays, event));
        const okCount = results.filter((r) => r.status === 'fulfilled').length;
        if (okCount === 0) {
          const first = results.find((r) => r.status === 'rejected');
          throw new Error(String(first?.reason ?? 'no relay accepted').slice(0, 500));
        }
        return okCount;
      }
    });
    if (summary.due > 0) console.log('[Sweep]', JSON.stringify(summary));
  } finally {
    pool.close([...openedRelays]);
  }
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
