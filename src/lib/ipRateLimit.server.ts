/**
 * Simple per-IP rate limiting for anon/public endpoints.
 *
 * Backed by a Cloudflare KV namespace. The helper is intentionally thin:
 * one caller, one (scope, ipHash) counter per bucket, read-then-write
 * without atomicity — acceptable at the low rates these endpoints see.
 *
 * Privacy: callers pass a raw IP; the helper salts and hashes it with a
 * daily-rotated salt stored under the same KV namespace, mirroring the
 * pattern in `$lib/nourish/flagRateLimit.server.ts`. IPs are never
 * stored in plaintext.
 *
 * Usage:
 *   const kv = platform?.env?.NOURISH_FLAGS; // or any KV binding
 *   const res = await checkPerIpRateLimit(kv, {
 *     ip,
 *     scope: 'extract-url',
 *     perHour: 8
 *   });
 *   if (res.limited) return json(res.body, { status: 429 });
 */

type IpRateLimitKV = {
  get(key: string, type?: 'text' | 'json'): Promise<string | unknown | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number }
  ): Promise<void>;
};

const SALT_RETENTION_DAYS = 3;
const SALT_KEY_PREFIX = 'config:ip-salt-v2';

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function utcHour(d = new Date()): string {
  return d.toISOString().slice(0, 13);
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function getTodaySalt(kv: IpRateLimitKV): Promise<string> {
  const day = utcDay();
  const key = `${SALT_KEY_PREFIX}:${day}`;
  const existing = (await kv.get(key)) as string | null;
  if (existing) return existing;

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const salt = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  await kv.put(key, salt, {
    expirationTtl: SALT_RETENTION_DAYS * 24 * 60 * 60
  });
  return salt;
}

export interface IpRateLimitParams {
  ip: string;
  scope: string;
  perHour: number;
  /** Optional per-day cap. When omitted, only the hourly tier is enforced. */
  perDay?: number;
}

export type IpRateLimitResult =
  | { limited: false; ipHash: string }
  | {
      limited: true;
      ipHash: string;
      body: { error: 'rate_limited'; retryAfter: number; scope: 'per-hour' | 'per-day' };
    };

/**
 * Atomically-ish check and increment the rate-limit buckets for `ip`.
 *
 * Returns `limited: false` (with the IP hash for downstream logging) if
 * the request is allowed, or `limited: true` with a 429 body describing
 * which tier tripped. Fails open on unexpected KV errors — the cost of
 * dropping a legitimate anon request is higher than the cost of an
 * occasional extra OpenAI call during KV degradation.
 */
export async function checkPerIpRateLimit(
  kv: IpRateLimitKV | undefined,
  params: IpRateLimitParams
): Promise<IpRateLimitResult> {
  if (!kv) {
    // No KV bound (e.g. local dev without bindings). Allow — the caller
    // still has client-side rate limiting as a first line.
    return { limited: false, ipHash: 'no-kv' };
  }

  const { ip, scope, perHour, perDay } = params;

  try {
    const salt = await getTodaySalt(kv);
    const ipHash = await sha256Hex(`${ip}:${salt}`);

    const hourKey = `rl:${scope}:hr:${ipHash}:${utcHour()}`;
    const dayKey = perDay ? `rl:${scope}:day:${ipHash}:${utcDay()}` : null;

    const hourCount = Number((await kv.get(hourKey)) as string | null) || 0;
    if (hourCount >= perHour) {
      return {
        limited: true,
        ipHash,
        body: { error: 'rate_limited', retryAfter: 60 * 60, scope: 'per-hour' }
      };
    }

    if (dayKey && perDay) {
      const dayCount = Number((await kv.get(dayKey)) as string | null) || 0;
      if (dayCount >= perDay) {
        return {
          limited: true,
          ipHash,
          body: { error: 'rate_limited', retryAfter: 24 * 60 * 60, scope: 'per-day' }
        };
      }
    }

    // Increment both buckets. Not transactional, but at this traffic
    // level the race window is irrelevant — worst case a few extra
    // requests squeak past the cap at minute boundaries.
    await Promise.all([
      kv.put(hourKey, String(hourCount + 1), { expirationTtl: 2 * 60 * 60 }),
      dayKey
        ? kv
            .get(dayKey)
            .then((raw) =>
              kv.put(dayKey, String((Number(raw as string | null) || 0) + 1), {
                expirationTtl: 26 * 60 * 60
              })
            )
        : Promise.resolve()
    ]);

    return { limited: false, ipHash };
  } catch (err) {
    console.warn('[ipRateLimit] KV error — failing open:', err);
    return { limited: false, ipHash: 'kv-error' };
  }
}
