/**
 * Rate-limiting + IP-hashing helpers for anon Nourish flag submissions.
 *
 * Runs server-side only (Cloudflare Workers / SvelteKit +server.ts). Per
 * Task 6 Stage 5 conventions, errors surface to the client as structured
 * 429 responses — the client maps them to a friendly toast.
 *
 * Rate-limit tiers (per ipHash):
 *   - per-minute: 1
 *   - per-hour:   10
 *   - per-day:    30
 *
 * Dedup: one flag per (ipHash × target × dimension × direction) per 24h.
 *
 * IP privacy:
 *   - IPs are hashed with a daily-rotated server-side salt.
 *   - Salts are retained for 3 days to avoid midnight race conditions
 *     (a dedup check just after rotation would otherwise miss yesterday's
 *     submissions).
 *   - Same IP across days becomes unlinkable — intentional.
 */

type NourishFlagsKV = {
  get(key: string, type?: 'text' | 'json'): Promise<string | unknown | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number }
  ): Promise<void>;
};

export type RateLimitScope = 'per-minute' | 'per-hour' | 'per-day';

export interface RateLimitedError {
  error: 'rate_limited';
  retryAfter: number;
  scope: RateLimitScope;
}

export interface DedupHit {
  error: 'duplicate';
}

// Limits (public constants — referenced by tests/docs if they appear).
export const LIMIT_PER_MINUTE = 1;
export const LIMIT_PER_HOUR = 10;
export const LIMIT_PER_DAY = 30;
export const DEDUP_TTL_SECONDS = 24 * 60 * 60;
export const SALT_RETENTION_DAYS = 3;

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function utcHour(d = new Date()): string {
  return d.toISOString().slice(0, 13); // YYYY-MM-DDTHH
}

function utcMinute(d = new Date()): string {
  return d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Return today's rotating salt, creating it on first call of the day.
 * Past salts (up to SALT_RETENTION_DAYS back) are accessed via
 * `getSaltForDay` for dedup lookups that span midnight.
 */
export async function getTodaySalt(kv: NourishFlagsKV): Promise<string> {
  const day = utcDay();
  const key = `config:ip-salt:${day}`;
  const existing = (await kv.get(key)) as string | null;
  if (existing) return existing;

  // First call today — mint a fresh salt. 32 bytes of entropy.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const salt = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Salt TTL = 3 days. Yesterday's dedup still works the day after.
  await kv.put(key, salt, {
    expirationTtl: SALT_RETENTION_DAYS * 24 * 60 * 60
  });
  return salt;
}

/**
 * Look up the salt for a prior day (within SALT_RETENTION_DAYS). Returns
 * null if the salt has aged out. Used by dedup to recompute yesterday's
 * ipHash so a flag made at 23:59 UTC still deduplicates at 00:01 UTC.
 */
export async function getSaltForDay(
  kv: NourishFlagsKV,
  day: string
): Promise<string | null> {
  const key = `config:ip-salt:${day}`;
  const existing = (await kv.get(key)) as string | null;
  return existing ?? null;
}

/** YYYY-MM-DD of N days ago (UTC). */
export function utcDayOffset(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

export async function hashIp(ip: string, salt: string): Promise<string> {
  return sha256Hex(`${ip}:${salt}`);
}

/**
 * Increment the three rate-limit buckets for `ipHash`. Returns a
 * RateLimitedError object if any tier is exceeded, otherwise null.
 *
 * Read-then-write is not atomic on Cloudflare KV, but the tiers are
 * coarse enough that racing is acceptable — the worst case is one extra
 * request squeezes through per bucket boundary.
 */
export async function checkAndIncrementRateLimit(
  kv: NourishFlagsKV,
  ipHash: string
): Promise<RateLimitedError | null> {
  const tiers: Array<{
    scope: RateLimitScope;
    bucket: string;
    limit: number;
    ttlSeconds: number;
    retryAfter: number;
  }> = [
    {
      scope: 'per-minute',
      bucket: `rl:min:${ipHash}:${utcMinute()}`,
      limit: LIMIT_PER_MINUTE,
      ttlSeconds: 2 * 60,
      retryAfter: 60
    },
    {
      scope: 'per-hour',
      bucket: `rl:hr:${ipHash}:${utcHour()}`,
      limit: LIMIT_PER_HOUR,
      ttlSeconds: 2 * 60 * 60,
      retryAfter: 60 * 60
    },
    {
      scope: 'per-day',
      bucket: `rl:day:${ipHash}:${utcDay()}`,
      limit: LIMIT_PER_DAY,
      ttlSeconds: 26 * 60 * 60,
      retryAfter: 24 * 60 * 60
    }
  ];

  // First pass: read all counts. If any tier is already at limit, reject
  // without bumping anything (fail-closed).
  for (const tier of tiers) {
    const raw = (await kv.get(tier.bucket)) as string | null;
    const count = raw ? parseInt(raw, 10) : 0;
    if (count >= tier.limit) {
      return {
        error: 'rate_limited',
        retryAfter: tier.retryAfter,
        scope: tier.scope
      };
    }
  }

  // Second pass: increment all buckets. KV writes are not transactional,
  // but at this low rate the race-window is practically irrelevant.
  await Promise.all(
    tiers.map(async (tier) => {
      const raw = (await kv.get(tier.bucket)) as string | null;
      const count = raw ? parseInt(raw, 10) : 0;
      await kv.put(tier.bucket, String(count + 1), {
        expirationTtl: tier.ttlSeconds
      });
    })
  );

  return null;
}

/**
 * Dedup grain: one anon flag per (ipHash × target × dimension × direction)
 * per 24 hours. Returns true if a prior flag exists (caller should
 * respond 200-no-op with {duplicate: true}).
 *
 * Midnight-race fix: the salt rotates daily, so the same IP produces a
 * different `ipHash` across days. A naive lookup under today's ipHash
 * alone would miss a flag made moments before UTC midnight. We therefore
 * check dedup under today's AND yesterday's ipHash. Yesterday's salt is
 * retained (SALT_RETENTION_DAYS) for exactly this.
 */
export async function checkDedup(
  kv: NourishFlagsKV,
  ip: string,
  target: string,
  dimension: string,
  direction: string
): Promise<{ hit: boolean; todayIpHash: string }> {
  const todaySalt = await getTodaySalt(kv);
  const todayIpHash = await hashIp(ip, todaySalt);

  const todayKey = `dedup:${todayIpHash}:${target}:${dimension}:${direction}`;
  if ((await kv.get(todayKey)) !== null) {
    return { hit: true, todayIpHash };
  }

  // Also check yesterday's ipHash (if the salt is still in retention).
  const yesterdaySalt = await getSaltForDay(kv, utcDayOffset(1));
  if (yesterdaySalt) {
    const yesterdayIpHash = await hashIp(ip, yesterdaySalt);
    const yesterdayKey = `dedup:${yesterdayIpHash}:${target}:${dimension}:${direction}`;
    if ((await kv.get(yesterdayKey)) !== null) {
      return { hit: true, todayIpHash };
    }
  }

  return { hit: false, todayIpHash };
}

export async function markDedup(
  kv: NourishFlagsKV,
  ipHash: string,
  target: string,
  dimension: string,
  direction: string
): Promise<void> {
  const key = `dedup:${ipHash}:${target}:${dimension}:${direction}`;
  await kv.put(key, Date.now().toString(), { expirationTtl: DEDUP_TTL_SECONDS });
}
