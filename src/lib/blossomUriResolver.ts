/**
 * Resolves BUD-10 `blossom:` URIs to concrete https URLs by fetching the
 * blob from the servers that might hold it — the URI's own `xs` hints
 * first, then any caller-supplied account servers — on the BUD-01 route
 * (`https://<server>/<sha256>`), and verifying each download's SHA-256
 * against the URI's hash before trusting it: the URI is content-addressed,
 * so a server answering 200 with the wrong bytes (a "404 image", or a
 * planted blob) is rejected and the next candidate is tried. Amethyst
 * verifies the same way. Candidates are tried sequentially so a bad server
 * costs one download, not N. Resolutions are cached per URI (a note's
 * inline image, carousel tile and lightbox can all ask in one render) and
 * misses for five minutes, so an unreachable blob isn't re-fetched on
 * every scroll.
 */
import { blossomCandidateUrl, parseBlossomUri } from './blossomUri';

const resolved = new Map<string, string>();
const misses = new Map<string, number>();
const inFlight = new Map<string, Promise<string | null>>();

const MISS_TTL_MS = 5 * 60 * 1000;
const PROBE_TIMEOUT_MS = 15_000;

async function fetchVerified(url: string, sha256: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    let body: ArrayBuffer;
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return null;
      body = await response.arrayBuffer();
    } finally {
      clearTimeout(timer);
    }
    const digest = await crypto.subtle.digest('SHA-256', body);
    const hex = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    // The URI's hash is the blob's identity — a server that serves anything
    // else (placeholder, 404 page, planted content) is not the blob's host.
    return hex === sha256.toLowerCase() ? url : null;
  } catch {
    return null;
  }
}

export async function resolveBlossomUri(rawUri: string, extraServers: string[] = []): Promise<string | null> {
  const hit = resolved.get(rawUri);
  if (hit) return hit;

  const missedAt = misses.get(rawUri);
  if (missedAt !== undefined && Date.now() - missedAt < MISS_TTL_MS) return null;

  const pending = inFlight.get(rawUri);
  if (pending) return pending;

  const task = (async () => {
    const uri = parseBlossomUri(rawUri);
    if (!uri) return null;
    const servers = [...new Set([...uri.serverHints, ...extraServers])];
    for (const server of servers) {
      const hit = await fetchVerified(blossomCandidateUrl(uri, server), uri.sha256);
      if (hit) {
        resolved.set(rawUri, hit);
        return hit;
      }
    }
    misses.set(rawUri, Date.now());
    return null;
  })().finally(() => {
    inFlight.delete(rawUri);
  });
  inFlight.set(rawUri, task);
  return task;
}
