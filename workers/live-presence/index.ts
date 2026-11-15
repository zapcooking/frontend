/**
 * zap-cooking-live-presence — the "watching now" count for Go live.
 *
 * One Durable Object per session (named `<LIVE_INPUT_PREFIX>presence:<id>`
 * by the caller, so preview and production never share one). It counts the
 * heartbeat codes heard in the last ~60 s.
 *
 * Codes are held in memory AND briefly in the object's own storage
 * (`c:<code>` → last heard, ms), because Cloudflare can restart an object
 * at any time and a restart would otherwise empty the count. Each code is
 * deleted by an alarm about a second after it expires (60 s after its last
 * heartbeat). A code is 128 random bits made per page load: it identifies
 * no one.
 *
 * The object also keeps two numbers for the session: the peak and the
 * total viewer time (`vms`, ms; see PresenceCounter). When the last code
 * expires they stay, so the sweep can record them after the stream
 * (POST /finish then wipes the storage). If nobody collects them they are
 * wiped TOTALS_RETAIN_MS after the object went quiet.
 *
 * Reachable only through the Pages project's LIVE_PRESENCE binding: this
 * worker has no route and workers_dev is off, and its default fetch
 * answers 404. The Pages routes check the session and the request shape
 * before anything reaches here (src/routes/api/live/[id]/heartbeat).
 *
 * Internal API (called by src/lib/live/presence.server.ts):
 *   POST /beat     { code, ip } → 200 { watching, peak, newPeak } | 429
 *   GET  /watching              → 200 { watching }
 *   GET  /totals                → 200 { viewer_seconds, peak }
 *   POST /finish                → 200 { ok }   wipes everything
 *
 * `ip` is used for the rate limit only: it is hashed with a random salt
 * made when the object starts, and the hash is kept for one window with two
 * counters, IN MEMORY ONLY (never stored or logged). It is never linked to
 * a code.
 */

import { PresenceCounter, isHeartbeatCode } from '../../src/lib/live/presenceCounter';

/** The slice of the Durable Object state this class uses. */
export interface PresenceState {
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    delete(keys: string[]): Promise<number>;
    list<T>(opts: { prefix: string }): Promise<Map<string, T>>;
    deleteAll(): Promise<void>;
    getAlarm(): Promise<number | null>;
    setAlarm(when: number): Promise<void>;
  };
}

const CODE_PREFIX = 'c:';
const PEAK_KEY = 'peak';
const VIEWER_MS_KEY = 'vms';
/** When the last code expired (ms); set while only the totals are left. */
const IDLE_KEY = 'idle';
/**
 * How long the totals outlive the last heartbeat when nobody collects
 * them. The sweep collects them a few minutes after the stream ends and
 * gives up after an hour (LIVE_METRICS_GIVE_UP_SECONDS), so two days
 * leaves plenty of room for a sweep outage.
 */
export const TOTALS_RETAIN_MS = 2 * 24 * 60 * 60 * 1000;
/** Delete a code this long after it expires. */
const ALARM_SLACK_MS = 1000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export class LivePresence {
  private counter = new PresenceCounter();
  /** Made when the object starts; memory only, never stored or logged. */
  private readonly salt = randomHex(32);
  private readonly state: PresenceState | null;

  constructor(state?: PresenceState) {
    this.state = state ?? null;
    // Restarted: put back the codes that have not expired, before any request.
    if (this.state) void this.state.blockConcurrencyWhile(() => this.restore());
  }

  private async restore(): Promise<void> {
    if (!this.state) return;
    const now = Date.now();
    const stored = await this.state.storage.list<number>({ prefix: CODE_PREFIX });
    for (const [key, seen] of stored) {
      this.counter.restore(key.slice(CODE_PREFIX.length), seen, now);
    }
    this.counter.restorePeak((await this.state.storage.get<number>(PEAK_KEY)) ?? 0);
    this.counter.restoreViewerMs((await this.state.storage.get<number>(VIEWER_MS_KEY)) ?? 0);
    // Anything stored with no alarm (e.g. one lost in a restart) gets one,
    // so leftovers (codes or totals) are always cleaned up.
    const anything = stored.size > 0 || this.counter.peak > 0 || this.counter.viewerMs > 0;
    if (anything && (await this.state.storage.getAlarm()) === null) {
      await this.state.storage.setAlarm(now + ALARM_SLACK_MS);
    }
  }

  private async source(ip: string): Promise<string> {
    const data = new TextEncoder().encode(`${this.salt}:${ip}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest).slice(0, 16), (x) =>
      x.toString(16).padStart(2, '0')
    ).join('');
  }

  /**
   * Delete expired codes. Once none are left, keep the totals (peak and
   * viewer time) for TOTALS_RETAIN_MS, then wipe the storage.
   */
  async alarm(): Promise<void> {
    if (!this.state) return;
    const storage = this.state.storage;
    const now = Date.now();
    const cutoff = now - this.counter.windowMs;
    const stored = await storage.list<number>({ prefix: CODE_PREFIX });
    const expired: string[] = [];
    let oldest = Infinity;
    for (const [key, seen] of stored) {
      if (seen <= cutoff) expired.push(key);
      else oldest = Math.min(oldest, seen);
    }
    for (let i = 0; i < expired.length; i += 128) {
      await storage.delete(expired.slice(i, i + 128));
    }
    if (oldest !== Infinity) {
      await storage.setAlarm(oldest + this.counter.windowMs + ALARM_SLACK_MS);
      return;
    }
    // No codes left. Codes just expired: the object has gone quiet now.
    let idle = await storage.get<number>(IDLE_KEY);
    if (expired.length > 0 || typeof idle !== 'number') {
      idle = now;
      await storage.put(IDLE_KEY, idle);
    }
    const hasTotals =
      (await storage.get<number>(VIEWER_MS_KEY)) !== undefined ||
      (await storage.get<number>(PEAK_KEY)) !== undefined;
    if (!hasTotals || now - idle >= TOTALS_RETAIN_MS) {
      await storage.deleteAll();
      this.counter = new PresenceCounter();
      return;
    }
    await storage.setAlarm(idle + TOTALS_RETAIN_MS);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();
    if (request.method === 'GET' && url.pathname === '/watching') {
      return json({ watching: this.counter.watching(now) });
    }
    if (request.method === 'GET' && url.pathname === '/totals') {
      return json({
        viewer_seconds: Math.floor(this.counter.viewerMs / 1000),
        peak: this.counter.peak
      });
    }
    if (request.method === 'POST' && url.pathname === '/finish') {
      // The sweep has recorded the totals: nothing about the session is kept.
      if (this.state) await this.state.storage.deleteAll();
      this.counter = new PresenceCounter();
      return json({ ok: true });
    }
    if (request.method === 'POST' && url.pathname === '/beat') {
      let body: { code?: unknown; ip?: unknown } | null;
      try {
        body = (await request.json()) as { code?: unknown; ip?: unknown } | null;
      } catch {
        return json({ error: 'bad_request' }, 400);
      }
      const code = body?.code;
      const ip = typeof body?.ip === 'string' && body.ip ? body.ip : 'unknown';
      if (!isHeartbeatCode(code)) return json({ error: 'bad_request' }, 400);
      const result = this.counter.beat(code, await this.source(ip), now);
      if (!result.ok) return json({ error: 'rate_limited' }, 429);
      // Not added (session full): nothing to keep.
      if (this.state && this.counter.has(code)) {
        const storage = this.state.storage;
        // Cleanup is scheduled BEFORE the code is stored, so a code is never
        // in storage without an alarm that will delete it. A later alarm (the
        // totals' retention one) is brought forward to the code's expiry.
        const expiry = now + this.counter.windowMs + ALARM_SLACK_MS;
        const alarmAt = await storage.getAlarm();
        if (alarmAt === null || alarmAt > expiry) await storage.setAlarm(expiry);
        await storage.put(CODE_PREFIX + code, now);
        if (result.newPeak) await storage.put(PEAK_KEY, result.peak);
        await storage.put(VIEWER_MS_KEY, this.counter.viewerMs);
      }
      return json({ watching: result.watching, peak: result.peak, newPeak: result.newPeak });
    }
    return json({ error: 'not_found' }, 404);
  }
}

export default {
  async fetch(): Promise<Response> {
    return new Response('Not found', { status: 404 });
  }
};
