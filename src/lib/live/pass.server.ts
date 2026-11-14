/**
 * Go live — the guest rejoin pass.
 *
 * A viewer admitted to a session (a guest using a slot, or a confirmed
 * member) is given a short-lived pass in the `Live-Pass` response header.
 * A later join for the SAME session that presents a valid, unexpired pass
 * is admitted without taking a new guest slot. That is what lets a guest
 * get back in after the host reconnects, when the session is at its cap.
 *
 * The pass is `<expiry>.<signature>`: an HMAC-SHA256, keyed by the
 * LIVE_PASS_SECRET secret, over the session id and the expiry. Nothing is
 * stored on the server, and the pass says nothing about who holds it.
 *
 * Known limit: because nothing ties a pass to a viewer, a pass can be
 * copied to another device and used there until it expires. The guest cap
 * is therefore a soft limit for anyone willing to copy a header; the
 * Cloudflare rate-limiting rule on /join bounds what that can cost.
 */

/** How long a pass is good for. Longer than the 90-minute session limit. */
export const LIVE_PASS_TTL_SECONDS = 2 * 60 * 60;

/** Request and response header carrying the pass. */
export const LIVE_PASS_HEADER = 'Live-Pass';

const encoder = new TextEncoder();

function toBase64Url(bytes: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(value)) return null;
  try {
    const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

const message = (sessionId: string, expiry: number) =>
  encoder.encode(`live-pass:${sessionId}:${expiry}`);

/** A fresh pass for this session. */
export async function issuePass(
  secret: string,
  sessionId: string,
  now: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  const expiry = now + LIVE_PASS_TTL_SECONDS;
  const signature = await crypto.subtle.sign('HMAC', await key(secret), message(sessionId, expiry));
  return `${expiry}.${toBase64Url(signature)}`;
}

/**
 * True only for a well-formed pass, signed with this secret, for this
 * session, that has not expired. Never throws. The signature check is
 * constant-time (WebCrypto `verify`).
 */
export async function verifyPass(
  secret: string,
  sessionId: string,
  pass: string | null,
  now: number = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  if (!pass || pass.length > 200) return false;
  const match = /^(\d{10})\.([A-Za-z0-9_-]+)$/.exec(pass.trim());
  if (!match) return false;
  const expiry = Number(match[1]);
  if (!Number.isFinite(expiry) || expiry <= now || expiry > now + LIVE_PASS_TTL_SECONDS + 60)
    return false;
  const signature = fromBase64Url(match[2]);
  if (!signature) return false;
  try {
    return await crypto.subtle.verify(
      'HMAC',
      await key(secret),
      signature,
      message(sessionId, expiry)
    );
  } catch {
    return false;
  }
}
