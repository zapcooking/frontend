/**
 * Go live — the host page's calls to our own API, and what each reply
 * means for the page. No Cloudflare URL ever reaches this code: publish
 * posts an SDP offer to /api/live/<id>/publish and gets an SDP answer.
 *
 * Every function reports its outcome as a value. Nothing here throws for
 * an HTTP error, and nothing logs SDP.
 */

export type LiveStatus = 'created' | 'live' | 'ended';

/** Signs a NIP-98 Authorization header for one request. */
export type SignRequest = (opts: {
  method: string;
  url: string;
  bodyString?: string;
}) => Promise<string>;

export interface HostSession {
  id: string;
  /** The per-session host token. Kept in sessionStorage; never put in a URL. */
  token: string;
}

export type CreateOutcome =
  | { ok: true; session: HostSession }
  /** The host already has a session open (another tab or device). */
  | { ok: false; reason: 'already_active'; id: string | null }
  | {
      ok: false;
      reason:
        | 'not_allowed' // not on the host list
        | 'membership_required' // confirmed non-member
        | 'membership_unavailable' // could not be checked: NOT "not a member"
        | 'live_off' // switched off by an admin
        | 'rate_limited'
        | 'sign_failed' // the signer refused or is unavailable
        | 'auth_failed'
        | 'bad_request'
        | 'unavailable'; // network or server trouble
    };

const origin = () => (typeof location !== 'undefined' ? location.origin : '');

async function readError(res: Response): Promise<{ error?: string; id?: string; retry?: boolean }> {
  try {
    const data = await res.json();
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

export async function createLiveSession(
  input: { title: string; recipeA: string | null },
  sign: SignRequest,
  fetchFn: typeof fetch = fetch
): Promise<CreateOutcome> {
  const url = `${origin()}/api/live`;
  const bodyString = JSON.stringify({
    title: input.title,
    ...(input.recipeA ? { recipe_a: input.recipeA } : {})
  });
  let authorization: string;
  try {
    authorization = await sign({ method: 'POST', url, bodyString });
  } catch {
    return { ok: false, reason: 'sign_failed' };
  }
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: bodyString
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (res.status === 201) {
    const data = (await readError(res)) as { id?: string; host_token?: string };
    if (typeof data.id === 'string' && typeof data.host_token === 'string') {
      return { ok: true, session: { id: data.id, token: data.host_token } };
    }
    return { ok: false, reason: 'unavailable' };
  }
  const body = await readError(res);
  switch (body.error) {
    case 'already_active':
      return {
        ok: false,
        reason: 'already_active',
        id: typeof body.id === 'string' ? body.id : null
      };
    case 'not_allowed':
    case 'membership_required':
    case 'membership_unavailable':
    case 'live_off':
    case 'rate_limited':
    case 'auth_failed':
      return { ok: false, reason: body.error };
    case 'bad_title':
    case 'bad_recipe':
    case 'bad_request':
    case 'too_large':
      return { ok: false, reason: 'bad_request' };
    default:
      return { ok: false, reason: 'unavailable' };
  }
}

/**
 * What a failed publish means for the page:
 *   retry     try again after a pause (Cloudflare trouble, another publish
 *             in flight, a network error)
 *   ended     the session has ended; stop and say so
 *   off       Go live was switched off by an admin; stop and say so
 *   limit     the session has used all its publish attempts
 *   auth      the host token is not accepted any more; treated as ended
 *   rejected  Cloudflare refused this offer; a fresh offer may work, so
 *             the page retries with a new one
 */
export type PublishFailure = 'retry' | 'ended' | 'off' | 'limit' | 'auth' | 'rejected';

export type PublishOutcome =
  { ok: true; answerSdp: string } | { ok: false; failure: PublishFailure };

export function classifyPublishReply(status: number, error: string | undefined): PublishFailure {
  if (error === 'ended' || status === 404 || status === 410) return 'ended';
  if (error === 'live_off') return 'off';
  if (error === 'publish_limit' || status === 429) return 'limit';
  if (status === 401 || status === 403) return 'auth';
  if (
    error === 'offer_rejected' ||
    status === 400 ||
    status === 413 ||
    status === 415 ||
    status === 422
  ) {
    return 'rejected';
  }
  // 409 publish_in_progress, 503 stream_unavailable, any other 5xx.
  return 'retry';
}

export async function publishOffer(
  session: HostSession,
  offerSdp: string,
  fetchFn: typeof fetch = fetch
): Promise<PublishOutcome> {
  let res: Response;
  try {
    res = await fetchFn(`/api/live/${session.id}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp', Authorization: `Bearer ${session.token}` },
      body: offerSdp
    });
  } catch {
    return { ok: false, failure: 'retry' };
  }
  if (res.status === 201) {
    const answerSdp = await res.text();
    return answerSdp.startsWith('v=0') ? { ok: true, answerSdp } : { ok: false, failure: 'retry' };
  }
  const body = await readError(res);
  return { ok: false, failure: classifyPublishReply(res.status, body.error) };
}

/** End with the host token. True when the server says the session is ended. */
export async function endLiveSession(
  session: HostSession,
  fetchFn: typeof fetch = fetch
): Promise<boolean> {
  try {
    const res = await fetchFn(`/api/live/${session.id}/end`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}` }
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Record the session's "Live now" note so viewers can find its comments
 * and zaps. True when the server has it (now or already).
 */
export async function recordLiveNote(
  session: HostSession,
  noteId: string,
  fetchFn: typeof fetch = fetch
): Promise<boolean> {
  try {
    const res = await fetchFn(`/api/live/${session.id}/note`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ note_id: noteId })
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

/** End a session we hold no token for (opened in another tab or device), by signature. */
export async function endLiveSessionSigned(
  id: string,
  sign: SignRequest,
  fetchFn: typeof fetch = fetch
): Promise<boolean> {
  const url = `${origin()}/api/live/${id}/end`;
  try {
    const authorization = await sign({ method: 'POST', url });
    const res = await fetchFn(url, { method: 'POST', headers: { Authorization: authorization } });
    return res.status === 200;
  } catch {
    return false;
  }
}

/** The session's public status, or null when it could not be read right now. */
export async function readLiveStatus(
  id: string,
  fetchFn: typeof fetch = fetch
): Promise<LiveStatus | 'gone' | null> {
  try {
    const res = await fetchFn(`/api/live/${id}`, { cache: 'no-store' });
    if (res.status === 404) return 'gone';
    if (!res.ok) return null;
    const data = (await res.json()) as { status?: unknown };
    return data.status === 'created' || data.status === 'live' || data.status === 'ended'
      ? data.status
      : null;
  } catch {
    return null;
  }
}
