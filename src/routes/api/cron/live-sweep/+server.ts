/**
 * Go live — sweep endpoint.
 *
 * POST /api/cron/live-sweep
 *   Auth: Authorization: Bearer <CRON_SECRET>
 *   200:  the sweep's summary (counts only)
 *
 * Called once a minute by the zap-cooking-cron worker. See
 * $lib/live/sweep.server for what a sweep does.
 *
 * This route REFUSES when CRON_SECRET is not configured. (The older
 * membership cron route skips its check in that case; that must not be
 * copied here, because this route ends broadcasts.)
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { readLiveEnv } from '$lib/live/env.server';
import { runLiveSweep } from '$lib/live/sweep.server';
import type { LiveDb } from '$lib/live/sessions.server';
import { readStreamConfig } from '$lib/live/stream.server';

const NO_STORE = { 'Cache-Control': 'no-store' };

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const POST: RequestHandler = async ({ request, platform }) => {
  const secret = readLiveEnv(platform, 'CRON_SECRET');
  if (!secret) {
    console.error('[LiveSweep] CRON_SECRET not configured; refusing to run');
    return json({ error: 'not_configured' }, { status: 503, headers: NO_STORE });
  }
  const header = request.headers.get('Authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!given || !sameSecret(given, secret)) {
    return json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }

  const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
  if (!db) {
    console.error('[LiveSweep] SCHEDULER_DB not configured');
    return json({ error: 'not_configured' }, { status: 500, headers: NO_STORE });
  }

  try {
    const cfg = readStreamConfig(platform);
    if (!cfg)
      console.error(
        '[LiveSweep] Stream is not configured; statuses cannot be read and inputs cannot be deleted'
      );
    const summary = await runLiveSweep(db, cfg);
    return json(summary, { headers: NO_STORE });
  } catch (err) {
    console.error(`[LiveSweep] failed: ${(err as Error)?.name ?? 'error'}`);
    return json({ error: 'internal' }, { status: 500, headers: NO_STORE });
  }
};
