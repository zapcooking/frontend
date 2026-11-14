/** Restricted moderation incident queue and hold release. NIP-98 admin signature required. */
import { json, type RequestHandler } from '@sveltejs/kit';
import { ADMIN_PUBKEY } from '$lib/adminAuth';
import { verifyNip98 } from '$lib/nip98.server';
import { readBodyCapped } from '$lib/live/body.server';
import { isLiveSessionId, type LiveDb } from '$lib/live/sessions.server';
import { releaseLiveSafetyHold } from '$lib/live/safety.server';
const HEADERS = { 'Cache-Control':'no-store' };
const forbidden = () => json({error:'forbidden'},{status:403,headers:HEADERS});

export const GET: RequestHandler = async ({request,platform}) => {
  const auth = await verifyNip98(request,{expectedPubkey:ADMIN_PUBKEY});
  if (!auth.ok) return forbidden();
  const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
  if (!db) return json({error:'not_configured'},{status:503,headers:HEADERS});
  try {
    const {results} = await db.prepare(`
      SELECT h.session_id, h.opened_at, h.reason AS hold_reason, h.status AS hold_status,
             s.host_pubkey, s.title, s.status AS stream_status, s.ended_at,
             COUNT(r.id) AS reports,
             SUM(CASE WHEN r.reason='child_safety' THEN 1 ELSE 0 END) AS child_safety_reports,
             SUM(CASE WHEN r.reason='violence' THEN 1 ELSE 0 END) AS violence_reports
      FROM live_safety_holds h
      JOIN live_sessions s ON s.id=h.session_id
      LEFT JOIN live_safety_reports r ON r.session_id=h.session_id
      GROUP BY h.session_id
      ORDER BY h.opened_at DESC LIMIT 100
    `).bind().all();
    return json({incidents:results},{headers:HEADERS});
  } catch(err) {
    console.error('[LiveSafety] admin query failed',(err as Error)?.name ?? 'error');
    return json({error:'internal'},{status:500,headers:HEADERS});
  }
};

export const POST: RequestHandler = async ({request,platform}) => {
  const bytes = await readBodyCapped(request,1024);
  if (typeof bytes === 'string') return json({error:'bad_request'},{status:400,headers:HEADERS});
  const auth = await verifyNip98(request,{expectedPubkey:ADMIN_PUBKEY,bodyBytes:bytes});
  if (!auth.ok) return forbidden();
  const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
  if (!db) return json({error:'not_configured'},{status:503,headers:HEADERS});
  let value: unknown;
  try { value=JSON.parse(new TextDecoder().decode(bytes)); } catch { /* invalid */ }
  if (!value || typeof value!=='object' || Array.isArray(value)) return json({error:'bad_request'},{status:400,headers:HEADERS});
  const data=value as Record<string,unknown>;
  if (data.action!=='release_hold' || !isLiveSessionId(data.id))
    return json({error:'bad_request'},{status:400,headers:HEADERS});
  // Review legal preservation requirements *before* using this operation.
  // No automatic release: authorized admin explicitly chooses it.
  try {
    const released=await releaseLiveSafetyHold(db,data.id);
    return json({ok:true,released},{headers:HEADERS});
  } catch(err) {
    console.error('[LiveSafety] hold release failed',(err as Error)?.name ?? 'error');
    return json({error:'internal'},{status:500,headers:HEADERS});
  }
};
