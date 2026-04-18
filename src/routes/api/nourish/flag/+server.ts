/**
 * POST /api/nourish/flag — anon Nourish-score flag submission endpoint.
 *
 * Logged-in users bypass this endpoint entirely and publish a NIP-32
 * kind 1985 labeling event to the pantry relay directly (see
 * $lib/nourish/flagSubmit.ts). This endpoint exists to let ANONYMOUS
 * users contribute flags without needing a Nostr signer, with
 * per-IP rate limiting + dedup + daily-rotated IP hashing for privacy.
 *
 * Storage: Cloudflare KV namespace `NOURISH_FLAGS`. See flagRateLimit.server.ts
 * for the key schema.
 *
 * Rate limits: 1/min, 10/hr, 30/day per ipHash. Dedup: 1/24h per
 * (ipHash × target × dimension × direction).
 *
 * Request body:
 *   {
 *     target:     "a:<kind>:<pubkey>:<d>" | "scan:<content-hash>",
 *     dimension:  "gut" | "protein" | "realFood" | "overall",
 *     direction:  "too-high" | "too-low",
 *     score:      number,          // 0..10, score at flag time
 *     nourishVer: string,          // Nourish model/prompt version
 *     reason?:    string           // optional free-text, <= 500 chars
 *   }
 *
 * Responses:
 *   200 { ok: true }
 *   200 { ok: true, duplicate: true }             — already flagged (no-op)
 *   400 { error: "bad_request", detail?: string } — payload validation
 *   429 { error: "rate_limited", retryAfter, scope }
 *   500 { error: "server_error" }
 *   503 { error: "kv_unavailable" }               — platform.env.NOURISH_FLAGS missing
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import {
  checkAndIncrementRateLimit,
  checkDedup,
  getTodaySalt,
  hashIp,
  markDedup
} from '$lib/nourish/flagRateLimit.server';

const ALLOWED_DIMENSIONS = new Set(['gut', 'protein', 'realFood', 'overall']);
const ALLOWED_DIRECTIONS = new Set(['too-high', 'too-low']);
const MAX_REASON_LEN = 500;
const FLAG_RECORD_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

function isValidTarget(target: unknown): target is string {
  if (typeof target !== 'string' || target.length > 256) return false;
  return target.startsWith('a:') || target.startsWith('scan:');
}

export const POST: RequestHandler = async ({ request, getClientAddress, platform }) => {
  const kv = platform?.env?.NOURISH_FLAGS;
  if (!kv) {
    return json({ error: 'kv_unavailable' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request', detail: 'invalid JSON' }, { status: 400 });
  }

  const { target, dimension, direction, score, nourishVer, reason } =
    (body as Record<string, unknown>) ?? {};

  if (!isValidTarget(target)) {
    return json({ error: 'bad_request', detail: 'target' }, { status: 400 });
  }
  if (typeof dimension !== 'string' || !ALLOWED_DIMENSIONS.has(dimension)) {
    return json({ error: 'bad_request', detail: 'dimension' }, { status: 400 });
  }
  if (typeof direction !== 'string' || !ALLOWED_DIRECTIONS.has(direction)) {
    return json({ error: 'bad_request', detail: 'direction' }, { status: 400 });
  }
  if (typeof score !== 'number' || !isFinite(score) || score < 0 || score > 10) {
    return json({ error: 'bad_request', detail: 'score' }, { status: 400 });
  }
  if (typeof nourishVer !== 'string' || nourishVer.length === 0 || nourishVer.length > 32) {
    return json({ error: 'bad_request', detail: 'nourishVer' }, { status: 400 });
  }
  const reasonStr =
    typeof reason === 'string' ? reason.slice(0, MAX_REASON_LEN) : '';

  let ip: string;
  try {
    ip = getClientAddress();
  } catch {
    // Local dev without a real request addr; synthesize one so the endpoint
    // still works in `pnpm run dev`.
    ip = '127.0.0.1';
  }

  const salt = await getTodaySalt(kv);
  const ipHash = await hashIp(ip, salt);

  // Dedup pre-check. Duplicate is a 200 no-op so the client UI can show the
  // "you've already flagged this" state without surfacing an error toast.
  const already = await checkDedup(kv, ipHash, target, dimension, direction);
  if (already) {
    return json({ ok: true, duplicate: true });
  }

  const limited = await checkAndIncrementRateLimit(kv, ipHash);
  if (limited) {
    return json(limited, { status: 429 });
  }

  // Record the flag.
  const createdAtIso = new Date().toISOString();
  const flagKey = `flag:${target}:${dimension}:${direction}:${createdAtIso}:${ipHash.slice(0, 8)}`;
  const flagRecord = {
    target,
    dimension,
    direction,
    score: Number(score.toFixed(2)),
    nourishVer,
    reason: reasonStr,
    ipHash,
    createdAt: createdAtIso
  };

  try {
    await kv.put(flagKey, JSON.stringify(flagRecord), {
      expirationTtl: FLAG_RECORD_TTL_SECONDS
    });
    await markDedup(kv, ipHash, target, dimension, direction);
  } catch (err) {
    console.error('[nourish-flag] KV write failed:', err);
    return json({ error: 'server_error' }, { status: 500 });
  }

  return json({ ok: true });
};
