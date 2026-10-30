/**
 * A BUD-10 `blossom:` media reference — `blossom:<sha256>[.<ext>][?params]`.
 *
 * Content-addressed, so it names no server: resolution hints ride in the
 * query — repeatable `xs` (servers that hold the blob), `as` (author hex
 * pubkey, whose kind:10063 list may hold more servers), and `sz` (blob size
 * in bytes). Pure and environment-agnostic, like `$lib/imageUrls`.
 */

export const BLOSSOM_SCHEME = 'blossom:';

export interface BlossomUri {
  sha256: string;
  ext: string | null;
  serverHints: string[];
  authors: string[];
  sizeBytes: number | null;
}

const HEX64_RE = /^[0-9a-f]{64}$/i;
const EXT_RE = /^[a-z0-9]+$/i;

export function isBlossomUri(raw: string): boolean {
  return raw.toLowerCase().startsWith(BLOSSOM_SCHEME);
}

export function parseBlossomUri(raw: string): BlossomUri | null {
  if (!isBlossomUri(raw)) return null;
  const reference = raw.slice(BLOSSOM_SCHEME.length);
  const queryStart = reference.indexOf('?');
  const hashPart = queryStart === -1 ? reference : reference.slice(0, queryStart);
  const query = queryStart === -1 ? null : reference.slice(queryStart + 1);

  const dot = hashPart.indexOf('.');
  const hash = dot === -1 ? hashPart : hashPart.slice(0, dot);
  if (!HEX64_RE.test(hash)) return null;
  const extRaw = dot === -1 ? null : hashPart.slice(dot + 1);
  const ext = extRaw && EXT_RE.test(extRaw) ? extRaw.toLowerCase() : null;

  const serverHints: string[] = [];
  const authors: string[] = [];
  let sizeBytes: number | null = null;
  if (query) {
    for (const pair of query.split('&')) {
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const key = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (key === 'xs') {
        if (value) serverHints.push(value);
      } else if (key === 'as') {
        if (HEX64_RE.test(value)) authors.push(value.toLowerCase());
      } else if (key === 'sz') {
        const n = Number(value);
        if (Number.isFinite(n)) sizeBytes = n;
      }
    }
  }
  return { sha256: hash.toLowerCase(), ext, serverHints, authors, sizeBytes };
}

/**
 * The BUD-01 blob route on `server` — `https://<host>/<sha256>`, without the
 * extension: the bare hash is the canonical GET, and some servers 404 the
 * extended path. A hint that already carries a scheme is used as-is.
 */
export function blossomCandidateUrl(uri: BlossomUri, server: string): string {
  const base = server.includes('://') ? server.replace(/\/+$/, '') : `https://${server}`.replace(/\/+$/, '');
  return `${base}/${uri.sha256}`;
}
