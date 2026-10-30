/**
 * Resolves BUD-10 `blossom:` URIs to concrete https URLs by probing the
 * servers that might hold the blob — the URI's own `xs` hints first, then
 * any caller-supplied account servers — and keeping the first candidate
 * that actually loads as an image. Amethyst resolves the same way on its
 * image path.
 *
 * Candidate loads go through `new Image()` rather than `fetch`: media CDNs
 * vary in CORS headers, and an `<img>` load needs none. Resolutions are
 * cached per URI (a note's inline image, carousel tile and lightbox can all
 * ask in one render) and misses for five minutes, so an unreachable blob
 * isn't re-probed on every scroll.
 */
import { blossomCandidateUrl, parseBlossomUri } from './blossomUri';

const resolved = new Map<string, string>();
const misses = new Map<string, number>();
const inFlight = new Map<string, Promise<string | null>>();

const MISS_TTL_MS = 5 * 60 * 1000;
const PROBE_TIMEOUT_MS = 8_000;

function imageLoads(url: string): Promise<string | null> {
  return new Promise((settle) => {
    const img = new Image();
    const timer = setTimeout(() => {
      img.onload = null;
      img.onerror = null;
      img.src = '';
      settle(null);
    }, PROBE_TIMEOUT_MS);
    img.onload = () => {
      clearTimeout(timer);
      settle(url);
    };
    img.onerror = () => {
      clearTimeout(timer);
      settle(null);
    };
    img.src = url;
  });
}

export function resolveBlossomUri(rawUri: string, extraServers: string[] = []): Promise<string | null> {
  const hit = resolved.get(rawUri);
  if (hit) return Promise.resolve(hit);

  const missedAt = misses.get(rawUri);
  if (missedAt !== undefined && Date.now() - missedAt < MISS_TTL_MS) return Promise.resolve(null);

  const pending = inFlight.get(rawUri);
  if (pending) return pending;

  const task = (async () => {
    const uri = parseBlossomUri(rawUri);
    if (!uri) return null;
    const servers = [...new Set([...uri.serverHints, ...extraServers])];
    const outcomes = await Promise.all(servers.map((server) => imageLoads(blossomCandidateUrl(uri, server))));
    const winner = outcomes.find((url): url is string => url !== null) ?? null;
    if (winner) {
      resolved.set(rawUri, winner);
    } else {
      misses.set(rawUri, Date.now());
    }
    return winner;
  })().finally(() => {
    inFlight.delete(rawUri);
  });
  inFlight.set(rawUri, task);
  return task;
}
