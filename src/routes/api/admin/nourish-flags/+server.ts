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

const LIST_PAGE_LIMIT = 1000; // KV list per-call cap.
const GET_CONCURRENCY = 16; // max in-flight kv.get calls — bounds memory + CPU.

// KV list response shape — extends what we declared in app.d.ts with the
// pagination fields that actually ship.
interface KvListResult {
  keys: Array<{ name: string }>;
  list_complete?: boolean;
  cursor?: string;
}

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
    // Page through all flag:* keys via cursor so volume past 1000 entries
    // doesn't silently truncate the admin view.
    const allKeys: Array<{ name: string }> = [];
    let cursor: string | undefined;
    do {
      const page = (await (kv.list as (opts?: unknown) => Promise<KvListResult>)({
        prefix: 'flag:',
        limit: LIST_PAGE_LIMIT,
        cursor
      })) as KvListResult;
      allKeys.push(...page.keys);
      cursor = page.list_complete === false ? page.cursor : undefined;
    } while (cursor);

    // Parallelize KV reads in bounded batches. Sequential awaiting (the
    // prior implementation) scales linearly with flag count and is the
    // dominant latency for the admin page at higher volumes.
    const flags: unknown[] = [];
    for (let i = 0; i < allKeys.length; i += GET_CONCURRENCY) {
      const batch = allKeys.slice(i, i + GET_CONCURRENCY);
      const results = await Promise.all(
        batch.map((k) => kv.get(k.name) as Promise<string | null>)
      );
      for (const raw of results) {
        if (!raw) continue;
        try {
          flags.push(JSON.parse(raw));
        } catch {
          // Skip malformed entries; admin surface just shows what parses.
        }
      }
    }

    return json({ flags, count: flags.length });
  } catch (err) {
    console.error('[admin/nourish-flags] KV list failed:', err);
    return json({ error: 'server_error' }, { status: 500 });
  }
};
