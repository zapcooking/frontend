/**
 * Go live — Cloudflare Stream client for the relay.
 *
 * The browser never talks to Stream's signalling endpoints. The server
 * creates a live input, posts the browser's SDP offer to it once, and
 * hands back only the SDP answer. Rules this module keeps:
 *
 *  - Cloudflare's `Location` header (it embeds the publish secret, or the
 *    input id on the play side), `ETag` and `Link` are never returned to
 *    a caller and never logged. `relayOffer` reads the status and the
 *    body and nothing else.
 *  - The publish URL exists only inside `createLiveInput`'s result for
 *    the duration of one request. It is not stored and not logged.
 *  - SDP is never logged, in either direction: it carries the host's
 *    network addresses.
 *  - Log lines carry a step name, an HTTP status and Cloudflare error
 *    CODES. No URL, no input id, no body.
 *
 * Every call has a timeout and reports failure as a value, not a throw,
 * so the routes can map "Cloudflare did not answer" to a try-again reply.
 */
import { readLiveEnv } from './env.server';

/** Upper bound on any one call to Cloudflare. Three calls fit well inside the 30 s publish lock. */
export const STREAM_TIMEOUT_MS = 8000;

export interface StreamConfig {
  accountId: string;
  token: string;
}

/** Stream credentials for this deployment, trimmed, or null when not configured. */
export function readStreamConfig(
  platform: Readonly<App.Platform> | undefined
): StreamConfig | null {
  const accountId = readLiveEnv(platform, 'CF_STREAM_ACCOUNT_ID');
  const token = readLiveEnv(platform, 'CF_STREAM_API_TOKEN');
  if (!accountId || !token) return null;
  if (!/^[0-9a-f]{32}$/.test(accountId)) return null;
  return { accountId, token };
}

const apiBase = (cfg: StreamConfig) =>
  `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/stream/live_inputs`;

/** Cloudflare's numeric error codes only: safe to log, unlike messages. */
function errorCodes(json: unknown): string {
  const errors = (json as { errors?: { code?: unknown }[] } | null)?.errors;
  if (!Array.isArray(errors)) return '';
  return errors
    .map((e) => (typeof e?.code === 'number' || typeof e?.code === 'string' ? String(e.code) : '?'))
    .join(',');
}

export interface CreatedLiveInput {
  uid: string;
  /** WHIP endpoint. A credential: use once, never store, never log. */
  publishUrl: string;
  /** WHEP endpoint. Server-side only. */
  playUrl: string;
}

export type CreateLiveInputResult = { ok: true; input: CreatedLiveInput } | { ok: false };

/** Only Stream's own customer hostnames are ever fetched with a browser's offer. */
function isStreamUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname.endsWith('.cloudflarestream.com');
  } catch {
    return false;
  }
}

/** Create a live input with recording off. `name` is for operators only. */
export async function createLiveInput(
  cfg: StreamConfig,
  name: string
): Promise<CreateLiveInputResult> {
  try {
    const res = await fetch(apiBase(cfg), {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta: { name }, recording: { mode: 'off' } }),
      signal: AbortSignal.timeout(STREAM_TIMEOUT_MS)
    });
    let json: {
      result?: { uid?: unknown; webRTC?: { url?: unknown }; webRTCPlayback?: { url?: unknown } };
    } | null = null;
    try {
      json = await res.json();
    } catch {
      /* not JSON */
    }
    const uid = json?.result?.uid;
    const publishUrl = json?.result?.webRTC?.url;
    const playUrl = json?.result?.webRTCPlayback?.url;
    if (
      res.status !== 200 ||
      typeof uid !== 'string' ||
      !/^[0-9a-f]{32}$/.test(uid) ||
      !isStreamUrl(publishUrl) ||
      !isStreamUrl(playUrl)
    ) {
      console.error(`[Live] stream create failed: http ${res.status} codes [${errorCodes(json)}]`);
      // An input that exists but came back unusable must not be left behind.
      if (res.status === 200 && typeof uid === 'string' && /^[0-9a-f]{32}$/.test(uid)) {
        await deleteLiveInput(cfg, uid);
      }
      return { ok: false };
    }
    return { ok: true, input: { uid, publishUrl, playUrl } };
  } catch (err) {
    console.error(`[Live] stream create failed: ${(err as Error)?.name ?? 'error'}`);
    return { ok: false };
  }
}

/**
 * Delete a live input. Deleting is what ends a broadcast for its viewers.
 *   'deleted'  Cloudflare confirmed the delete
 *   'gone'     it did not exist any more (404): as good as deleted
 *   'failed'   anything else: the input may still exist and must be retried
 */
export async function deleteLiveInput(
  cfg: StreamConfig,
  uid: string
): Promise<'deleted' | 'gone' | 'failed'> {
  if (!/^[0-9a-f]{32}$/.test(uid)) return 'failed';
  try {
    const res = await fetch(`${apiBase(cfg)}/${uid}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(STREAM_TIMEOUT_MS)
    });
    // Drain without reading into a log.
    await res.arrayBuffer().catch(() => undefined);
    if (res.status === 200) return 'deleted';
    if (res.status === 404) return 'gone';
    console.error(`[Live] stream delete failed: http ${res.status}`);
    return 'failed';
  } catch (err) {
    console.error(`[Live] stream delete failed: ${(err as Error)?.name ?? 'error'}`);
    return 'failed';
  }
}

export type RelayResult =
  /** Cloudflare accepted the offer; `answer` is the SDP answer, byte for byte. */
  | { ok: true; answer: ArrayBuffer }
  /** Cloudflare refused this offer (a 4xx): retrying the same offer will not help. */
  | { ok: false; reason: 'rejected'; status: number }
  /** Cloudflare failed or did not answer: worth trying again. */
  | { ok: false; reason: 'unavailable'; status: number };

/**
 * Post an SDP offer to a Stream signalling URL and return the answer.
 * Reads the status and the body only. No response header is inspected,
 * returned or logged.
 */
export async function relayOffer(
  url: string,
  offer: Uint8Array,
  what: 'publish' | 'play'
): Promise<RelayResult> {
  if (!isStreamUrl(url)) return { ok: false, reason: 'unavailable', status: 0 };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: offer as BodyInit,
      redirect: 'manual',
      signal: AbortSignal.timeout(STREAM_TIMEOUT_MS)
    });
    const answer = await res.arrayBuffer();
    if (res.status === 201 && answer.byteLength > 0) return { ok: true, answer };
    console.error(`[Live] stream ${what} relay failed: http ${res.status}`);
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      return { ok: false, reason: 'rejected', status: res.status };
    }
    return { ok: false, reason: 'unavailable', status: res.status };
  } catch (err) {
    console.error(`[Live] stream ${what} relay failed: ${(err as Error)?.name ?? 'error'}`);
    return { ok: false, reason: 'unavailable', status: 0 };
  }
}
