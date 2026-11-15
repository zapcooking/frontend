/**
 * zap-cooking-live-presence — the "watching now" count for Go live.
 *
 * One Durable Object per session (named `<LIVE_INPUT_PREFIX><session id>`
 * by the caller, so preview and production never share one). It holds the
 * heartbeat codes heard in the last ~60 s IN MEMORY ONLY: it never touches
 * Durable Object storage, so nothing outlives the object. If Cloudflare
 * evicts it the count starts again from zero and refills within one
 * heartbeat interval.
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
 * made when the object starts (in memory, never stored or logged), and
 * the hash is kept for one window with two counters. It is never linked
 * to a code.
 */

import { PresenceCounter, isHeartbeatCode } from '../../src/lib/live/presenceCounter';

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

  // The runtime passes (state, env); neither is used: nothing is stored.
  private async source(ip: string): Promise<string> {
    const data = new TextEncoder().encode(`${this.salt}:${ip}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest).slice(0, 16), (x) =>
      x.toString(16).padStart(2, '0')
    ).join('');
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
