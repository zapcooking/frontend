/**
 * Vanity share URLs for premium members: zap.cooking/<handle>/<slug>
 *
 * The handle must be the author's verified @zap.cooking name (pantry
 * nostr.json + static directory, same source the [handle]/[slug] route
 * resolves against). Returns '' when the author has no handle — callers
 * keep their minted-short-link default in that case.
 */

const HANDLE_RE = /^[a-z0-9-_.]{1,30}$/;

interface DirectoryCache {
  at: number;
  entries: Array<[handle: string, pubkey: string]>;
}

// Shared by the reads page and the Recipe component (both render share
// modals for the same event); a short memo keeps the double resolution
// to one nostr.json fetch.
const DIRECTORY_TTL_MS = 30_000;
let directoryCache: DirectoryCache | null = null;

async function loadDirectoryEntries(): Promise<Array<[string, string]>> {
  const now = Date.now();
  if (directoryCache && now - directoryCache.at < DIRECTORY_TTL_MS) {
    return directoryCache.entries;
  }

  try {
    const res = await fetch('/.well-known/nostr.json');
    if (!res.ok) return [];
    const names = (await res.json())?.names as Record<string, unknown> | undefined;
    if (!names || typeof names !== 'object') return [];
    const entries = Object.entries(names).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && HANDLE_RE.test(entry[0])
    );
    directoryCache = { at: now, entries };
    return entries;
  } catch {
    return [];
  }
}

/** Drop the memoized handle directory (tests, forced refresh). */
export function clearVanityDirectoryCache(): void {
  directoryCache = null;
}

/**
 * Reverse lookup: the author's verified handle, or '' when they don't
 * have one. Used for namespaced short codes (zap.cooking/<handle>/<code>).
 */
export async function resolveHandleForPubkey(pubkey: string): Promise<string> {
  if (!pubkey) return '';
  const entries = await loadDirectoryEntries();
  for (const [handle, pk] of entries) {
    if (pk === pubkey) return handle;
  }
  return '';
}

/**
 * Resolve the author's vanity share URL for a `d` identifier, or '' when
 * the author has no verified handle.
 */
export async function resolveVanityShareUrl(pubkey: string, dTag: string): Promise<string> {
  if (!pubkey || !dTag) return '';
  const handle = await resolveHandleForPubkey(pubkey);
  return handle ? `https://zap.cooking/${handle}/${dTag}` : '';
}
