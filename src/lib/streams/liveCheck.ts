/**
 * Live-stream verification by playlist probe.
 *
 * Ported from Sidecar's stream-core `advancingPlaylist`. Probe only
 * playlists, never video segments: a responding but frozen playlist is not
 * evidence of a live stream, so the media sequence must advance between two
 * reads a target-duration apart.
 */

import { httpsUrl } from './parse';

interface MediaPlaylistRead {
  url: string;
  sequence: bigint;
  /** How long to wait before the second read (ms). */
  delay: number;
}

const PROBE_TIMEOUT_MS = 20000;

async function readPlaylist(
  target: string,
  signal: AbortSignal,
  request: typeof fetch,
  depth = 0
): Promise<MediaPlaylistRead> {
  if (!httpsUrl(target)) throw new Error('Unsafe playlist');
  const response = await request(target, {
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store'
  } as RequestInit);
  if (!response.ok) throw new Error('Unavailable playlist');
  const base = response.url || target;
  if (!httpsUrl(base)) throw new Error('Unsafe redirect');
  const body = await response.text();
  if (
    body.length > 262144 ||
    !body.trimStart().startsWith('#EXTM3U') ||
    body.includes('#EXT-X-ENDLIST')
  ) {
    throw new Error('Not live HLS');
  }
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  const master = lines.findIndex((line) => line.startsWith('#EXT-X-STREAM-INF:'));
  if (master >= 0) {
    const child = lines.slice(master + 1).find((line) => line && !line.startsWith('#'));
    if (depth >= 2 || !child) throw new Error('Invalid master playlist');
    return readPlaylist(new URL(child, base).href, signal, request, depth + 1);
  }
  const sequence = body.match(/^#EXT-X-MEDIA-SEQUENCE:(\d+)\s*$/m);
  if (!sequence || !body.includes('#EXTINF:')) throw new Error('No live sequence');
  const targetDuration = Number(body.match(/^#EXT-X-TARGETDURATION:(\d+)/m)?.[1] || 4);
  return {
    url: base,
    sequence: BigInt(sequence[1]),
    delay: Math.min(10000, Math.max(4000, targetDuration * 1000 + 500))
  };
}

/**
 * True only when the playlist's media sequence advances between two reads.
 * `request` and `pause` are injectable for tests; when `pause` is omitted
 * the probe waits out the playlist's clamped target duration (4–10 s).
 */
export async function advancingPlaylist(
  url: string,
  signal?: AbortSignal,
  request: typeof fetch = fetch,
  pause?: (ms: number, signal?: AbortSignal) => Promise<void>
): Promise<boolean> {
  if (!httpsUrl(url) || signal?.aborted) return false;

  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, PROBE_TIMEOUT_MS);
  const wait =
    pause ||
    ((ms: number, sig?: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        const stop = () => {
          clearTimeout(id);
          controller.signal.removeEventListener('abort', stop);
          reject(new Error('Aborted'));
        };
        const id = setTimeout(() => {
          sig?.removeEventListener('abort', stop);
          resolve();
        }, ms);
        sig?.addEventListener('abort', stop, { once: true });
        if (sig?.aborted) stop();
      }));

  try {
    const first = await readPlaylist(url, controller.signal, request);
    await wait(first.delay, controller.signal);
    if (controller.signal.aborted) return false;
    const second = await readPlaylist(first.url, controller.signal, request);
    return second.sequence > first.sequence;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
