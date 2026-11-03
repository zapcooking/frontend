import { json, type RequestHandler } from '@sveltejs/kit';
import { verifyNip98 } from '$lib/nip98.server';
import { trialRemaining } from '$lib/cheffyTrial.server';
import { CHEFFY_TRIAL_LIMIT } from '$lib/cheffyTrial';

/** Authenticated status is never included in shared HTML or query parameters. */
export const POST: RequestHandler = async ({ request, platform }) => {
  let bodyBytes: Uint8Array;
  try {
    bodyBytes = new Uint8Array(await request.arrayBuffer());
  } catch {
    return json({ error: 'Invalid request' }, { status: 400 });
  }
  const verification = await verifyNip98(request, { bodyBytes });
  if (!verification.ok) return json({ error: 'Sign in to try Cheffy.' }, { status: 401 });
  const db = platform?.env?.SCHEDULER_DB;
  if (!db) return json({ error: 'Free samples are temporarily unavailable.' }, { status: 503 });
  try {
    return json(
      { remaining: await trialRemaining(db, verification.pubkey), limit: CHEFFY_TRIAL_LIMIT },
      { headers: { 'cache-control': 'private, no-store' } }
    );
  } catch {
    return json({ error: 'Free samples are temporarily unavailable.' }, { status: 503 });
  }
};
