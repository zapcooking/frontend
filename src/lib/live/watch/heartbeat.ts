/**
 * Go live — the anonymous "watching now" heartbeat, browser side.
 *
 * While a Go live stream is playing and the tab is visible, the player
 * posts { code } to /api/live/<id>/heartbeat about every 30 s and gets the
 * session's count back.
 *
 * The code is random, made once per page load, and kept in this module's
 * memory only: never in localStorage, sessionStorage or a cookie, and
 * never sent with an account, a key or a signature. A reload makes a new
 * one. The host is not counted: a viewer signed in as the session's host
 * sends nothing.
 *
 * Started once, by the layout-level dock (which owns playback on every
 * surface), so a stream that keeps playing in the corner dock after the
 * viewer leaves the watch page still counts.
 */
import { get, writable, type Readable } from 'svelte/store';
import { LIVE_HEARTBEAT_MS } from '$lib/live/config';
import type { StreamItem, StreamPlayStatus } from '$lib/streams/types';

/** 128 random bits, hex. A new one on every page load. */
function newCode(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

let code: string | null = null;
/** This page load's heartbeat code (memory only). */
export function heartbeatCode(): string {
  code ??= newCode();
  return code;
}

/** The latest count heard back, for the session it belongs to. */
export const liveWatching = writable<{ sessionId: string; watching: number } | null>(null);

/** What a heartbeat reply means for the sender. */
export type BeatOutcome =
  | { kind: 'counted'; watching: number }
  /** The session is over or unknown: stop sending. */
  | { kind: 'stop' }
  /** Not counted this time (rate limit, not live yet, server trouble): keep going. */
  | { kind: 'skip' };

export async function sendHeartbeat(
  sessionId: string,
  beatCode: string,
  fetchFn: typeof fetch = fetch
): Promise<BeatOutcome> {
  try {
    const res = await fetchFn(`/api/live/${sessionId}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: beatCode }),
      // No cookies or credentials: nothing ties the beat to an account.
      credentials: 'omit',
      cache: 'no-store'
    });
    if (res.status === 404 || res.status === 410) return { kind: 'stop' };
    if (!res.ok) return { kind: 'skip' };
    const data = (await res.json()) as { watching?: unknown };
    return typeof data.watching === 'number' && Number.isSafeInteger(data.watching)
      ? { kind: 'counted', watching: data.watching }
      : { kind: 'skip' };
  } catch {
    return { kind: 'skip' };
  }
}

/** The player state the heartbeat reads. */
export interface HeartbeatInput {
  item: StreamItem | null;
  status: StreamPlayStatus;
  /** Paused by the viewer: not watching, so not counted. */
  paused?: boolean;
}

/**
 * The session to send heartbeats for right now, or null. Only a Go live
 * stream that is live and playing (not paused), in a visible tab, from
 * someone who is not its host. Buffering counts only once the stream has
 * actually played (`hasPlayed`): a failed first join also reads as
 * buffering, and that viewer has not seen anything yet.
 */
export function heartbeatTarget(
  state: HeartbeatInput,
  viewer: string | null | undefined,
  hidden: boolean,
  hasPlayed = true
): string | null {
  const item = state.item;
  if (!item || item.source !== 'zapcooking' || !item.sessionId) return null;
  if (item.status === 'ended') return null;
  if (state.paused) return null;
  if (state.status !== 'playing' && !(state.status === 'buffering' && hasPlayed)) return null;
  if (hidden) return null;
  if (viewer && viewer.toLowerCase() === item.host.toLowerCase()) return null;
  return item.sessionId;
}

export interface HeartbeatDeps {
  player: Readable<HeartbeatInput>;
  viewer: Readable<string | null | undefined>;
  isHidden: () => boolean;
  onVisibility: (fn: () => void) => () => void;
  /** Called with each count heard back. */
  onCount: (sessionId: string, watching: number) => void;
  send?: typeof sendHeartbeat;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

/** Start sending heartbeats as the player state says. Returns a stop function. */
export function startHeartbeat(deps: HeartbeatDeps): () => void {
  const send = deps.send ?? sendHeartbeat;
  const setTimer = deps.setTimer ?? ((fn, ms) => setInterval(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  let target: string | null = null;
  let timer: unknown = null;
  /** Sessions the server said are over: never beat for them again. */
  const stopped = new Set<string>();

  const beat = async (sessionId: string) => {
    const out = await send(sessionId, heartbeatCode());
    if (out.kind === 'stop') {
      stopped.add(sessionId);
      if (target === sessionId) evaluate();
      return;
    }
    if (out.kind === 'counted' && target === sessionId) deps.onCount(sessionId, out.watching);
  };

  /** Sessions that have actually played in this page (buffering counts after that). */
  const played = new Set<string>();

  function evaluate() {
    const state = get(deps.player);
    const sid = state.item?.sessionId;
    if (sid && state.status === 'playing') played.add(sid);
    const next = heartbeatTarget(
      state,
      get(deps.viewer),
      deps.isHidden(),
      !!sid && played.has(sid)
    );
    const want = next && !stopped.has(next) ? next : null;
    if (want === target) return;
    if (timer !== null) clearTimer(timer);
    timer = null;
    target = want;
    if (!want) return;
    void beat(want);
    timer = setTimer(() => {
      if (target === want) void beat(want);
    }, LIVE_HEARTBEAT_MS);
  }

  const unsubPlayer = deps.player.subscribe(() => evaluate());
  const unsubViewer = deps.viewer.subscribe(() => evaluate());
  const unsubVisibility = deps.onVisibility(() => evaluate());
  return () => {
    unsubPlayer();
    unsubViewer();
    unsubVisibility();
    if (timer !== null) clearTimer(timer);
    timer = null;
    target = null;
  };
}
