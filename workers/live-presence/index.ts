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
 * heartbeat); when none are left the object's storage is wiped. A code is
 * 128 random bits made per page load: it identifies no one.
 *
 * Reachable only through the Pages project's LIVE_PRESENCE binding: this
 * worker has no route and workers_dev is off, and its default fetch
 * answers 404. The Pages routes check the session and the request shape
 * before anything reaches here (src/routes/api/live/[id]/heartbeat).
 *
 * Internal API (called by src/lib/live/presence.server.ts):
 *   POST /beat     { code, ip } → 200 { watching, peak, newPeak } | 429
 *   GET  /watching              → 200 { watching }
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
  private readonly counter = new PresenceCounter();
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
    // Anything stored with no alarm (e.g. one lost in a restart) gets one,
    // so leftovers are always cleaned up.
    if (stored.size > 0 && (await this.state.storage.getAlarm()) === null) {
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

  /** Delete expired codes; wipe the storage once none are left. */
  async alarm(): Promise<void> {
    if (!this.state) return;
    const now = Date.now();
    const cutoff = now - this.counter.windowMs;
    const stored = await this.state.storage.list<number>({ prefix: CODE_PREFIX });
    const expired: string[] = [];
    let oldest = Infinity;
    for (const [key, seen] of stored) {
      if (seen <= cutoff) expired.push(key);
      else oldest = Math.min(oldest, seen);
    }
    if (oldest === Infinity) {
      await this.state.storage.deleteAll();
      return;
    }
    for (let i = 0; i < expired.length; i += 128) {
      await this.state.storage.delete(expired.slice(i, i + 128));
    }
    await this.state.storage.setAlarm(oldest + this.counter.windowMs + ALARM_SLACK_MS);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();
    if (request.method === 'GET' && url.pathname === '/watching') {
      return json({ watching: this.counter.watching(now) });
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
        // in storage without an alarm that will delete it.
        if ((await storage.getAlarm()) === null) {
          await storage.setAlarm(now + this.counter.windowMs + ALARM_SLACK_MS);
        }
        await storage.put(CODE_PREFIX + code, now);
        if (result.newPeak) await storage.put(PEAK_KEY, result.peak);
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
