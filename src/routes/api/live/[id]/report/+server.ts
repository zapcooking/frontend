/** Anonymous Go Live incident reporting: stored in D1, separate from Reads reports. */
import { json, type RequestHandler } from '@sveltejs/kit';
import { checkPerIpRateLimit } from '$lib/ipRateLimit.server';
import { submitLiveSafetyReport, SAFETY_REASONS, type SafetyReason } from '$lib/live/safety.server';
import { isLiveSessionId, type LiveDb } from '$lib/live/sessions.server';
import { readStreamConfig } from '$lib/live/stream.server';
import { readLiveEnv } from '$lib/live/env.server';

const NO_STORE = { 'Cache-Control':'no-store' };
export const POST: RequestHandler = async ({ request, params, getClientAddress, platform }) => {
  const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
  if (!db) return json({error:'not_configured'},{status:503,headers:NO_STORE});
  if (!isLiveSessionId(params.id)) return json({error:'bad_request'},{status:400,headers:NO_STORE});
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 2048) return json({error:'too_large'},{status:413,headers:NO_STORE});
  let raw: string;
  try { raw = await request.text(); } catch { return json({error:'bad_request'},{status:400,headers:NO_STORE}); }
  if (new TextEncoder().encode(raw).byteLength > 2048) return json({error:'too_large'},{status:413,headers:NO_STORE});
  let data: Record<string,unknown>;
  try {
    const parsed:unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
    data = parsed as Record<string,unknown>;
  } catch { return json({error:'bad_request'},{status:400,headers:NO_STORE}); }
  if (typeof data.reason !== 'string' || !SAFETY_REASONS.has(data.reason as SafetyReason) ||
      (data.details !== undefined && (typeof data.details !== 'string' || data.details.length > 300))) {
    return json({error:'bad_request'},{status:400,headers:NO_STORE});
  }

  // Privacy-preserving, best-effort rate limiting. If no trustworthy
  // pseudonymous reporter hash exists, reports are accepted for review but
  // never counted toward automated enforcement.
  let ip = '';
  try { ip = getClientAddress(); } catch { /* no trustworthy IP */ }
  let hash = '';
  if (ip) {
    const kv = platform?.env?.GATED_CONTENT ?? platform?.env?.NOURISH_FLAGS;
    const rate = await checkPerIpRateLimit(kv,{ip,scope:'live-safety-report',perHour:4,perDay:10});
    if (rate.limited) return json(rate.body,{status:429,headers:NO_STORE});
    hash = rate.ipHash;
  }

  try {
    // Automation OFF unless explicitly enabled. Threshold is deliberately
    // at least 3; a hash is not identity verification.
    const enabled = readLiveEnv(platform,'LIVE_SAFETY_AUTO_END') === 'true';
    const result = await submitLiveSafetyReport(db, readStreamConfig(platform), {
      sessionId:params.id, reporterHash:hash, reason:data.reason as SafetyReason,
      details:typeof data.details === 'string' ? data.details.trim() : '',
      autoShutdown:enabled
    });
    // Avoid leaking other users' report totals or incident status.
    return json({ok:true,duplicate:result.duplicate},{headers:NO_STORE});
  } catch (err) {
    if ((err as Error).message === 'not_found') return json({error:'not_found'},{status:404,headers:NO_STORE});
    console.error('[LiveSafety] report failed:',(err as Error)?.name ?? 'error');
    return json({error:'internal'},{status:500,headers:NO_STORE});
  }
};
