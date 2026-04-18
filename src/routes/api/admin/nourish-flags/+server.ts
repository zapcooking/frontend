/**
 * GET /api/admin/nourish-flags — admin-only aggregate of anon flag records.
 *
 * Returns every flag:* record currently stored in the NOURISH_FLAGS KV
 * namespace (90-day TTL enforces bounded storage). Signed kind 1985
 * flags live on the pantry relay and are queried client-side by the
 * admin page — this endpoint covers only the anon-via-Worker path.
 *
 * Auth: `x-admin-pubkey` header must match ADMIN_PUBKEY from
 * $lib/adminAuth. Same weak-but-consistent pattern as /sponsors.
 * A future FOLLOWUPS item formalizes this with NIP-98 HTTP-Auth.
 *
 * Response:
 *   {
 *     flags: Array<{
 *       target: string,
 *       dimension: string,
 *       direction: string,
 *       score: number,
 *       nourishVer: string,
 *       reason: string,
 *       ipHash: string,       // full hash, so admin can spot brigading
 *       createdAt: string,
 *     }>,
 *     count: number
 *   }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { ADMIN_PUBKEY } from '$lib/adminAuth';

const LIST_PAGE_LIMIT = 1000; // KV list per-call cap; plenty for v1 volume.

export const GET: RequestHandler = async ({ request, platform }) => {
  const adminPubkey = request.headers.get('x-admin-pubkey');
  if (!adminPubkey || adminPubkey !== ADMIN_PUBKEY) {
    return json({ error: 'forbidden' }, { status: 403 });
  }

  const kv = platform?.env?.NOURISH_FLAGS;
  if (!kv) {
    return json({ error: 'kv_unavailable' }, { status: 503 });
  }

  try {
    const { keys } = await kv.list({ prefix: 'flag:', limit: LIST_PAGE_LIMIT });
    const flags: unknown[] = [];
    for (const { name } of keys) {
      const raw = (await kv.get(name)) as string | null;
      if (!raw) continue;
      try {
        flags.push(JSON.parse(raw));
      } catch {
        // Skip malformed entries; admin surface just shows what parses.
      }
    }
    return json({ flags, count: flags.length });
  } catch (err) {
    console.error('[admin/nourish-flags] KV list failed:', err);
    return json({ error: 'server_error' }, { status: 500 });
  }
};
