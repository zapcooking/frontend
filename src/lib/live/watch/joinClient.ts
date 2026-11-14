/**
 * Go live — the viewer's call to our play relay, and the rejoin pass.
 *
 * The browser never holds a Cloudflare URL: it posts its SDP offer to
 * /api/live/<id>/join and gets an SDP answer back. Every reply is reported
 * as a value; nothing here throws for an HTTP error, and nothing logs SDP.
 */

/** What a join attempt means for the player. */
export type JoinFailure =
  /** Not broadcasting right now (not started, or the host is reconnecting): try again. */
  | 'not_live'
  /** Cloudflare or the network failed: try again. */
  | 'retry'
  /** The session has ended, or does not exist. */
  | 'ended'
  /** Go live was switched off by an admin. */
  | 'off'
  /** The guest cap is reached. */
  | 'full'
  /** This offer was refused; a fresh offer may work. */
  | 'rejected';

export type JoinOutcome =
  { ok: true; answerSdp: string; pass: string | null } | { ok: false; failure: JoinFailure };

export const PASS_HEADER = 'Live-Pass';

export function classifyJoinReply(status: number, error: string | undefined): JoinFailure {
  if (status === 410 || status === 404 || error === 'ended' || error === 'not_found')
    return 'ended';
  if (error === 'live_off') return 'off';
  if (error === 'full' || status === 403) return 'full';
  if (error === 'not_live' || status === 409) return 'not_live';
  if (status === 400 || status === 413 || status === 415 || status === 422) return 'rejected';
  return 'retry';
}

export async function joinLiveSession(
  sessionId: string,
  offerSdp: string,
  opts: { pass?: string | null; authorization?: string | null } = {},
  fetchFn: typeof fetch = fetch
): Promise<JoinOutcome> {
  const headers: Record<string, string> = { 'Content-Type': 'application/sdp' };
  if (opts.pass) headers[PASS_HEADER] = opts.pass;
  if (opts.authorization) headers.Authorization = opts.authorization;
  let res: Response;
  try {
    res = await fetchFn(`/api/live/${sessionId}/join`, { method: 'POST', headers, body: offerSdp });
  } catch {
    return { ok: false, failure: 'retry' };
  }
  if (res.status === 201) {
    const answerSdp = await res.text();
    if (!answerSdp.startsWith('v=0')) return { ok: false, failure: 'retry' };
    return { ok: true, answerSdp, pass: res.headers.get(PASS_HEADER) };
  }
  let error: string | undefined;
  try {
    error = ((await res.json()) as { error?: string })?.error;
  } catch {
    /* not JSON */
  }
  return { ok: false, failure: classifyJoinReply(res.status, error) };
}

// ── The pass, kept for the tab ──────────────────────────────────────
//
// sessionStorage: it lasts as long as the tab and is not shared with other
// tabs. A pass only helps the viewer get back in; losing it costs a slot.

const PASS_KEY = 'zc_live_pass:';
type KeyValue = Pick<Storage, 'getItem' | 'setItem'>;

export function loadPass(storage: KeyValue | undefined, sessionId: string): string | null {
  try {
    return storage?.getItem(PASS_KEY + sessionId) ?? null;
  } catch {
    return null;
  }
}

export function savePass(
  storage: KeyValue | undefined,
  sessionId: string,
  pass: string | null
): void {
  if (!pass) return;
  try {
    storage?.setItem(PASS_KEY + sessionId, pass);
  } catch {
    /* storage unavailable: the next rejoin uses a slot */
  }
}
