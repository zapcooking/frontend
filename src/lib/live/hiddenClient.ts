/**
 * Commenters hidden from a Go live stream's chat, read from and written
 * to our server (GET/POST /api/live/<id>/hidden).
 *
 *  - 'host': hidden by the stream's host, in all of their streams.
 *  - 'global': hidden by the admin, in every Go live chat.
 *
 * Writes are NIP-98 signed by the host (their list) or the admin (any).
 * Nothing is published on Nostr; the host's private mute list is separate.
 */

export type HiddenScope = 'host' | 'global';

export interface HiddenAuthor {
  pubkey: string;
  scope: HiddenScope;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** The session's hidden commenters, or null when it could not be read. */
export async function fetchHiddenAuthors(
  sessionId: string,
  fetchFn: typeof fetch = fetch
): Promise<HiddenAuthor[] | null> {
  try {
    const res = await fetchFn(`/api/live/${sessionId}/hidden`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { hidden?: unknown };
    if (!Array.isArray(data.hidden)) return null;
    return data.hidden.filter(
      (h): h is HiddenAuthor =>
        !!h &&
        typeof (h as HiddenAuthor).pubkey === 'string' &&
        HEX64.test((h as HiddenAuthor).pubkey) &&
        ((h as HiddenAuthor).scope === 'host' || (h as HiddenAuthor).scope === 'global')
    );
  } catch {
    return null;
  }
}

export type SetHiddenOutcome = 'ok' | 'forbidden' | 'full' | 'sign_failed' | 'error';

/** Hide or unhide a commenter. `sign` makes the NIP-98 header for this exact request. */
export async function setHiddenAuthor(
  opts: {
    sessionId: string;
    pubkey: string;
    hidden: boolean;
    scope: HiddenScope;
    sign: (req: { method: 'POST'; url: string; bodyString: string }) => Promise<string>;
  },
  fetchFn: typeof fetch = fetch
): Promise<SetHiddenOutcome> {
  const origin = typeof location !== 'undefined' ? location.origin : '';
  const url = `${origin}/api/live/${opts.sessionId}/hidden`;
  const bodyString = JSON.stringify({
    pubkey: opts.pubkey,
    hidden: opts.hidden,
    scope: opts.scope
  });
  let authorization: string;
  try {
    authorization = await opts.sign({ method: 'POST', url, bodyString });
  } catch {
    return 'sign_failed';
  }
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: bodyString
    });
    if (res.status === 200) return 'ok';
    if (res.status === 403) return 'forbidden';
    if (res.status === 409) return 'full';
    return 'error';
  } catch {
    return 'error';
  }
}
