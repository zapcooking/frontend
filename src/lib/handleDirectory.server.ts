/**
 * Server-side zap.cooking handle directory.
 *
 * Premium members get verified @zap.cooking NIP-05 identifiers; the
 * mapping lives in the pantry's nostr.json (dynamic members) plus a few
 * static names. Shared by /.well-known/nostr.json and the vanity-URL
 * routes (`zap.cooking/<handle>/<slug>`), with a short in-isolate cache
 * so vanity resolutions don't hammer the pantry.
 */

export const STATIC_NAMES: Record<string, string> = {
  jack: 'c5fb6ecc876e0458e3eca9918e370cbcd376901c58460512fe537a46e58c38bb',
  _: '319ad3e790634dbe86f14db9c2995b26ee3c6228be55f89c4c7fea9acc01d50a',
  seth: 'a723805cda67251191c8786f4da58f797e6977582301354ba8e91bcb0342dc9c',
  daniel: 'ee6ea13ab9fe5c4a68eaf9b1a34fe014a66b40117c50ee2a614f4cda959b6e74'
};

const PANTRY_NOSTR_JSON = 'https://pantry.zap.cooking/.well-known/nostr.json';
const DIRECTORY_TTL_MS = 5 * 60 * 1000;

let directory: { names: Record<string, string>; fetchedAt: number } | null = null;
let directoryInFlight: Promise<Record<string, string>> | null = null;

async function fetchDirectory(): Promise<Record<string, string>> {
  try {
    const res = await fetch(PANTRY_NOSTR_JSON, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });
    if (!res.ok) return {};
    const data = await res.json();
    if (data?.names && typeof data.names === 'object') {
      return data.names as Record<string, string>;
    }
  } catch {
    // Pantry unreachable — static names still resolve below.
  }
  return {};
}

/** Load the merged handle directory (dynamic members + static names). */
export async function loadHandleDirectory(): Promise<Record<string, string>> {
  if (directory && Date.now() - directory.fetchedAt < DIRECTORY_TTL_MS) {
    return directory.names;
  }
  if (directoryInFlight) return directoryInFlight;

  directoryInFlight = fetchDirectory().then((dynamic) => {
    // Static names take precedence, mirroring /.well-known/nostr.json.
    directory = { names: { ...dynamic, ...STATIC_NAMES }, fetchedAt: Date.now() };
    directoryInFlight = null;
    return directory.names;
  });
  return directoryInFlight;
}

/**
 * Resolve a zap.cooking handle (NIP-05 name) to a pubkey. Lowercases the
 * handle (NIP-05 names are case-insensitive by convention). Returns null
 * for unknown handles — never throws.
 */
export async function resolveHandlePubkey(handle: string): Promise<string | null> {
  const normalized = handle.trim().toLowerCase();
  if (!normalized) return null;

  // Static names resolve without touching the network.
  const staticPubkey = STATIC_NAMES[normalized];
  if (staticPubkey) return staticPubkey;

  const names = await loadHandleDirectory();
  const pubkey = names[normalized];
  return typeof pubkey === 'string' && /^[0-9a-f]{64}$/.test(pubkey) ? pubkey : null;
}
