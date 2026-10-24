/**
 * Server-only resolver for PROFILE (kind:0) Open Graph metadata used by the
 * crawler branch of the `handle` hook.
 *
 * Profile links (`/npub1…`, `/nprofile1…`, `/user/npub1…`) previewed as the
 * generic site card because their real tags are fetched client-side. This
 * resolves the author's kind:0 metadata SERVER-SIDE (raw-WebSocket relay race,
 * no NDK — same bundle-safe approach as recipes/notes) into a profile card.
 *
 * Never throws, never hangs past the timeout.
 */

import { nip19 } from 'nostr-tools';
import { raceRelays } from './recipePackOg.server';
import { capRecipeDescription, type RecipeOgMeta } from './recipeOgMeta';

const RESOLVE_TIMEOUT_MS = 4000;
const FALLBACK_IMAGE = 'https://zap.cooking/social-share.png';

/** Emitted when the profile can't be resolved — a generic but valid card. */
export const FALLBACK_PROFILE_OG: RecipeOgMeta = {
  pageTitle: 'Profile - zap.cooking',
  ogTitle: 'A cook on Zap Cooking',
  description: 'A profile on zap.cooking - Food is Open Source',
  image: FALLBACK_IMAGE,
  publishedAt: null,
  authorPubkey: null
};

/** npub1… / nprofile1… / raw-hex → hex pubkey, or null. */
function decodePubkey(slug: string): string | null {
  if (/^[0-9a-f]{64}$/i.test(slug)) return slug;
  try {
    const decoded = nip19.decode(slug);
    if (decoded.type === 'npub') return decoded.data as string;
    if (decoded.type === 'nprofile') return (decoded.data as nip19.ProfilePointer).pubkey;
  } catch {
    /* fall through */
  }
  return null;
}

async function resolveProfile(slug: string): Promise<RecipeOgMeta | null> {
  const pubkey = decodePubkey(slug);
  if (!pubkey) return null;

  const meta = await raceRelays({ kinds: [0], authors: [pubkey] });
  const content = (meta as Record<string, unknown> | null)?.content;
  if (typeof content !== 'string') return null;

  let profile: Record<string, string>;
  try {
    profile = JSON.parse(content) as Record<string, string>;
  } catch {
    return null;
  }

  const name = (profile.display_name || profile.displayName || profile.name || '').trim();
  const about = (profile.about || '').replace(/\s+/g, ' ').trim();
  // Prefer the wide banner for the large card; fall back to the avatar.
  const image = profile.banner || profile.picture || FALLBACK_IMAGE;

  return {
    pageTitle: name ? `${name} - zap.cooking` : 'Profile - zap.cooking',
    ogTitle: name || 'A cook on Zap Cooking',
    description: about
      ? capRecipeDescription(about)
      : 'A profile on zap.cooking - Food is Open Source',
    image,
    publishedAt: null,
    authorPubkey: null
  };
}

/**
 * Resolve a profile's OG metadata. Never throws and never hangs past
 * RESOLVE_TIMEOUT_MS — returns null on decode failure, timeout, or not-found.
 */
export async function fetchProfileOgMeta(slug: string): Promise<RecipeOgMeta | null> {
  try {
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), RESOLVE_TIMEOUT_MS)
    );
    return await Promise.race([resolveProfile(slug), timeout]);
  } catch {
    return null;
  }
}
