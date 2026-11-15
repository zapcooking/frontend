/**
 * Go live — talk to a session's presence Durable Object (the "watching
 * now" count). The object lives in the separate worker
 * workers/live-presence, bound to the Pages project as LIVE_PRESENCE.
 *
 * Every call is bounded by a short timeout and reported as a value: a
 * missing binding or a slow object means "no count right now", never an
 * error for the page. Callers check the session in D1 first, so an object
 * is only ever made for a real session.
 */
import { liveKvKey } from './config';
import { readLiveEnv } from './env.server';

/** The slice of a Durable Object namespace binding this module uses. */
export interface PresenceNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> };
}

const TIMEOUT_MS = 2000;

function namespace(platform: Readonly<App.Platform> | undefined): PresenceNamespace | null {
  const ns = (platform?.env as Record<string, unknown> | undefined)?.LIVE_PRESENCE as
    PresenceNamespace | undefined;
  return ns && typeof ns.idFromName === 'function' ? ns : null;
}

/**
 * The object's name: the environment's input prefix plus the session id,
 * so preview and production (one Cloudflare account) never share one.
 */
export function presenceName(prefix: string | undefined, sessionId: string): string {
  return liveKvKey(prefix, `presence:${sessionId}`);
}

function stub(platform: Readonly<App.Platform> | undefined, sessionId: string) {
  const ns = namespace(platform);
  if (!ns) return null;
  return ns.get(ns.idFromName(presenceName(readLiveEnv(platform, 'LIVE_INPUT_PREFIX'), sessionId)));
}

async function call(
  platform: Readonly<App.Platform> | undefined,
  sessionId: string,
  path: string,
  init?: RequestInit
): Promise<Response | null> {
  const s = stub(platform, sessionId);
  if (!s) return null;
  try {
    return await Promise.race([
      s.fetch(`https://presence${path}`, init),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS))
    ]);
  } catch {
    return null;
  }
}

export type SendBeatResult =
  | { ok: true; watching: number; peak: number; newPeak: boolean }
  | { ok: false; reason: 'rate_limited' | 'unavailable' };

/** Record one heartbeat. `ip` feeds the rate limit only (see the worker). */
export async function sendBeat(
  platform: Readonly<App.Platform> | undefined,
  sessionId: string,
  code: string,
  ip: string
): Promise<SendBeatResult> {
  const res = await call(platform, sessionId, '/beat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, ip })
  });
  if (!res) return { ok: false, reason: 'unavailable' };
  if (res.status === 429) return { ok: false, reason: 'rate_limited' };
  if (!res.ok) return { ok: false, reason: 'unavailable' };
  try {
    const data = (await res.json()) as { watching?: unknown; peak?: unknown; newPeak?: unknown };
    if (typeof data.watching !== 'number' || typeof data.peak !== 'number') {
      return { ok: false, reason: 'unavailable' };
    }
    return { ok: true, watching: data.watching, peak: data.peak, newPeak: data.newPeak === true };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/** The session's count right now, or null when it cannot be read. */
export async function readWatching(
  platform: Readonly<App.Platform> | undefined,
  sessionId: string
): Promise<number | null> {
  const res = await call(platform, sessionId, '/watching');
  if (!res?.ok) return null;
  try {
    const data = (await res.json()) as { watching?: unknown };
    return typeof data.watching === 'number' && Number.isSafeInteger(data.watching)
      ? data.watching
      : null;
  } catch {
    return null;
  }
}
