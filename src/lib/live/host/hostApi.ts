/**
 * Go live — the host page's calls to our own API, and what each reply
 * means for the page. No Cloudflare URL ever reaches this code: publish
 * posts an SDP offer to /api/live/<id>/publish and gets an SDP answer.
 *
 * Every function reports its outcome as a value. Nothing here throws for
 * an HTTP error, and nothing logs SDP.
 */

export type LiveStatus = 'created' | 'live' | 'ended';

/** The signed-in account's latest access request, as the server reports it. */
export interface OwnAccessRequest {
  status: 'none' | 'pending' | 'approved' | 'declined';
  /** When a declined account may ask again (unix seconds); null = it may ask now. */
  retry_at: number | null;
}

/** The hosting agreement, as the server reports it for the signer. */
export interface TermsState {
  /** The current LIVE_TERMS_VERSION. */
  version: string;
  /** Whether the signer has agreed to that version. */
  accepted: boolean;
}

export type HostingStatus =
  | {
      known: true;
      approved: boolean;
      request: OwnAccessRequest;
      /** Null when the server did not say (the create route still decides). */
      terms: TermsState | null;
    }
  /** Could not be answered: the page goes ahead and the create route decides. */
  | { known: false };

/**
 * Can the signed-in account host right now (staged rollout)? Signed
 * (NIP-98): the server only answers about the signer.
 */
export async function fetchHostingStatus(
  sign: SignRequest,
  fetchFn: typeof fetch = fetch
): Promise<HostingStatus> {
  const url = `${origin()}/api/live/hosting`;
  let authorization: string;
  try {
    authorization = await sign({ method: 'GET', url });
  } catch {
    return { known: false };
  }
  try {
    const res = await fetchFn(url, { headers: { Authorization: authorization } });
    if (!res.ok) return { known: false };
    const data = (await res.json()) as {
      approved?: unknown;
      request?: { status?: unknown; retry_at?: unknown };
      terms?: { version?: unknown; accepted?: unknown };
    };
    if (typeof data.approved !== 'boolean') return { known: false };
    const status = data.request?.status;
    const terms =
      typeof data.terms?.version === 'string' &&
      data.terms.version &&
      typeof data.terms.accepted === 'boolean'
        ? { version: data.terms.version, accepted: data.terms.accepted }
        : null;
    return {
      known: true,
      approved: data.approved,
      request: {
        status:
          status === 'pending' || status === 'approved' || status === 'declined' ? status : 'none',
        retry_at: typeof data.request?.retry_at === 'number' ? data.request.retry_at : null
      },
      terms
    };
  } catch {
    return { known: false };
  }
}

export type AccessRequestOutcome =
  | { kind: 'sent' }
  | { kind: 'approved' } // already on the list: nothing to ask
  | { kind: 'already_pending' }
  | { kind: 'declined_recently'; retryAt: number | null }
  | { kind: 'membership_required' }
  | { kind: 'sign_failed' }
  | { kind: 'unavailable' };

/** "Request access": saves a request in the admin's queue, with an optional note. */
export async function requestHostingAccess(
  note: string,
  sign: SignRequest,
  fetchFn: typeof fetch = fetch
): Promise<AccessRequestOutcome> {
  const url = `${origin()}/api/live/hosting`;
  const bodyString = JSON.stringify({ note });
  let authorization: string;
  try {
    authorization = await sign({ method: 'POST', url, bodyString });
  } catch {
    return { kind: 'sign_failed' };
  }
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: bodyString
    });
    const data = (await readError(res)) as { error?: string; approved?: boolean; retry_at?: unknown };
    if (res.ok) return data.approved ? { kind: 'approved' } : { kind: 'sent' };
    if (data.error === 'already_pending') return { kind: 'already_pending' };
    if (data.error === 'declined_recently') {
      return {
        kind: 'declined_recently',
        retryAt: typeof data.retry_at === 'number' ? data.retry_at : null
      };
    }
    if (data.error === 'membership_required') return { kind: 'membership_required' };
    return { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

export type AcceptTermsOutcome =
  | { kind: 'accepted' }
  /** The terms moved on since the dialog opened: show them again with this version. */
  | { kind: 'changed'; version: string }
  | { kind: 'membership_required' }
  | { kind: 'sign_failed' }
  | { kind: 'unavailable' };

/** "I'm 18+, agree and go live": records the agreement to `version` on the server. */
export async function acceptLiveTerms(
  version: string,
  sign: SignRequest,
  fetchFn: typeof fetch = fetch
): Promise<AcceptTermsOutcome> {
  const url = `${origin()}/api/live/terms`;
  const bodyString = JSON.stringify({ version });
  let authorization: string;
  try {
    authorization = await sign({ method: 'POST', url, bodyString });
  } catch {
    return { kind: 'sign_failed' };
  }
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: bodyString
    });
    const data = (await readError(res)) as { error?: string; version?: unknown };
    if (res.ok) return { kind: 'accepted' };
    if (data.error === 'terms_changed' && typeof data.version === 'string' && data.version) {
      return { kind: 'changed', version: data.version };
    }
    if (data.error === 'membership_required') return { kind: 'membership_required' };
    return { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

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
  /** The host has not agreed to the current hosting terms: show the dialog. */
  | { ok: false; reason: 'terms_required'; version: string | null }
  | {
      ok: false;
      reason:
        | 'blocked' // blocked from hosting by the admin
        | 'not_approved' // 'approved' rollout mode and not on the list
        | 'membership_required' // confirmed non-member
        | 'membership_unavailable' // could not be checked: NOT "not a member"
        | 'live_off' // switched off by an admin
        | 'live_full' // the open-session cap (all hosts) is reached
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
    case 'terms_required': {
      const version = (body as { version?: unknown }).version;
      return {
        ok: false,
        reason: 'terms_required',
        version: typeof version === 'string' && version ? version : null
      };
    }
    case 'blocked':
    case 'not_approved':
    case 'membership_required':
    case 'membership_unavailable':
    case 'live_off':
    case 'live_full':
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

/** The host's after-the-stream counts (see /api/live/<id>/stats). */
export interface LiveStats {
  peakWatching: number;
  joins: number;
}

function readStats(data: unknown): LiveStats | null {
  const d = data as { peak_watching?: unknown; joins?: unknown } | null;
  return d &&
    Number.isSafeInteger(d.peak_watching) &&
    Number.isSafeInteger(d.joins) &&
    (d.peak_watching as number) >= 0 &&
    (d.joins as number) >= 0
    ? { peakWatching: d.peak_watching as number, joins: d.joins as number }
    : null;
}

/**
 * End with the host token. `ended` is true when the server says the
 * session is ended; `stats` carries the after-the-stream counts when this
 * call ended it (null otherwise, or when they could not be read).
 */
export async function endLiveSessionWithStats(
  session: HostSession,
  fetchFn: typeof fetch = fetch
): Promise<{ ended: boolean; stats: LiveStats | null }> {
  try {
    const res = await fetchFn(`/api/live/${session.id}/end`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}` }
    });
    if (res.status !== 200) return { ended: false, stats: null };
    let stats: LiveStats | null = null;
    try {
      stats = readStats(await res.json());
    } catch {
      /* ended; the counts are optional */
    }
    return { ended: true, stats };
  } catch {
    return { ended: false, stats: null };
  }
}

/** End with the host token. True when the server says the session is ended. */
export async function endLiveSession(
  session: HostSession,
  fetchFn: typeof fetch = fetch
): Promise<boolean> {
  return (await endLiveSessionWithStats(session, fetchFn)).ended;
}

/**
 * The after-the-stream counts, signed by the host (for a stream that was
 * ended elsewhere: time limit, admin, another device). Null on any failure.
 */
export async function fetchLiveStats(
  id: string,
  sign: SignRequest,
  fetchFn: typeof fetch = fetch
): Promise<LiveStats | null> {
  const url = `${origin()}/api/live/${id}/stats`;
  try {
    const authorization = await sign({ method: 'GET', url });
    const res = await fetchFn(url, { headers: { Authorization: authorization } });
    if (!res.ok) return null;
    return readStats(await res.json());
  } catch {
    return null;
  }
}

/** How many are watching now, or null when it cannot be read. */
export async function readWatchingNow(
  id: string,
  fetchFn: typeof fetch = fetch
): Promise<number | null> {
  try {
    const res = await fetchFn(`/api/live/${id}/watching`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { watching?: unknown };
    return typeof data.watching === 'number' && Number.isSafeInteger(data.watching)
      ? data.watching
      : null;
  } catch {
    return null;
  }
}

/**
 * The ended screen's summary, in plain words:
 *   "30 people joined, with up to 12 watching at once. You got 2,100 sats in zaps."
 * The "at once" number never exceeds the people who joined (a reload can
 * briefly count one person twice). Sats are left out when there are none.
 */
export function endedStatsLine(stats: LiveStats, sats: number): string {
  const joins = stats.joins;
  const peak = joins > 0 ? Math.min(stats.peakWatching, joins) : stats.peakWatching;
  let line: string;
  if (joins === 0) {
    line = 'Nobody tuned in this time.';
  } else {
    line = `${joins.toLocaleString()} ${joins === 1 ? 'person' : 'people'} joined`;
    if (joins > 1 && peak > 1) line += `, with up to ${peak.toLocaleString()} watching at once.`;
    else if (joins > 1 && peak <= 1) line += ', one at a time.';
    else line += '.';
  }
  if (Number.isFinite(sats) && sats >= 1) {
    const n = Math.floor(sats);
    line += ` You got ${n.toLocaleString()} ${n === 1 ? 'sat' : 'sats'} in zaps.`;
  }
  return line;
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
