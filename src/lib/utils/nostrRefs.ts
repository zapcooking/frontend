import { nip19 } from 'nostr-tools';
import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { resolveProfileByPubkey, formatDisplayName, type ProfileData } from '$lib/profileResolver';
import { buildCanonicalRecipeShareUrl } from './share';

// Cache for resolved profiles
const profileCache = new Map<string, ProfileData | null>();

// Cache for resolved recipes/events
interface RecipeMetadata {
  title: string;
  canonicalUrl: string;
  lastFetched: number;
}

const recipeCache = new Map<string, RecipeMetadata>();

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const FETCH_TIMEOUT = 5000; // 5 seconds timeout for fetches

/**
 * Validate that eventId is exactly 64 hex characters (Nostr event ID format)
 */
const EVENT_ID_PATTERN = /^[a-f0-9]{64}$/i;
export function isValidEventId(id: unknown): id is string {
  return typeof id === 'string' && EVENT_ID_PATTERN.test(id);
}

/**
 * Resolve a profile by pubkey or npub string
 */
export async function resolveProfile(
  pubkeyOrNpub: string,
  ndkInstance: NDK
): Promise<ProfileData | null> {
  try {
    let pubkey: string;

    // If it's an npub, decode it
    if (pubkeyOrNpub.startsWith('npub1')) {
      try {
        const decoded = nip19.decode(pubkeyOrNpub);
        if (decoded.type === 'npub') {
          pubkey = decoded.data;
        } else {
          return null;
        }
      } catch {
        return null;
      }
    } else {
      pubkey = pubkeyOrNpub;
    }

    // Check cache
    const cached = profileCache.get(pubkey);
    if (cached !== undefined) {
      return cached;
    }

    // Resolve profile
    const profile = await resolveProfileByPubkey(pubkey, ndkInstance);
    profileCache.set(pubkey, profile);
    return profile;
  } catch (error) {
    console.warn('Failed to resolve profile:', error);
    return null;
  }
}

/**
 * Get display name for a profile (with @ prefix for mentions)
 */
export function getProfileDisplayName(profile: ProfileData | null, npub?: string): string {
  if (profile) {
    const name = formatDisplayName(profile);
    return name || '@Unknown';
  }
  
  // Fallback to shortened npub
  if (npub && npub.startsWith('npub1')) {
    return `@${npub.slice(0, 8)}...${npub.slice(-4)}`;
  }
  
  return '@Unknown';
}

/**
 * Resolve a recipe/event by naddr
 */
export async function resolveRecipe(
  naddr: string,
  ndkInstance: NDK
): Promise<RecipeMetadata | null> {
  try {
    // Check cache
    const cached = recipeCache.get(naddr);
    if (cached && Date.now() - cached.lastFetched < CACHE_DURATION) {
      return cached;
    }

    // Decode naddr
    let decoded: { type: string; data: any };
    try {
      decoded = nip19.decode(naddr);
    } catch {
      return null;
    }

    if (decoded.type !== 'naddr') {
      return null;
    }

    const { identifier, pubkey, kind } = decoded.data;

    // Fetch event with timeout
    const fetchPromise = ndkInstance.fetchEvent({
      kinds: [kind || 30023],
      '#d': [identifier],
      authors: [pubkey]
    });
    const timeoutPromise = new Promise<null>((resolve) => 
      setTimeout(() => resolve(null), FETCH_TIMEOUT)
    );
    const event = await Promise.race([fetchPromise, timeoutPromise]);

    if (!event) {
      return null;
    }

    // Extract title
    const title = event.tags.find((t) => t[0] === 'title')?.[1] || 
                  event.tags.find((t) => t[0] === 'd')?.[1] || 
                  'Recipe';

    // Build canonical URL
    const canonicalUrl = buildCanonicalRecipeShareUrl(naddr);

    const metadata: RecipeMetadata = {
      title,
      canonicalUrl,
      lastFetched: Date.now()
    };

    recipeCache.set(naddr, metadata);
    return metadata;
  } catch (error) {
    console.warn('Failed to resolve recipe:', error);
    return null;
  }
}

/**
 * Resolve a note/event by note1 or nevent1
 */
export async function resolveNote(
  noteId: string,
  ndkInstance: NDK
): Promise<{ title: string; url: string } | null> {
  try {
    let eventId: string;

    // Decode note1 or nevent1
    if (noteId.startsWith('note1') || noteId.startsWith('nevent1')) {
      try {
        const decoded = nip19.decode(noteId);
        if (decoded.type === 'note') {
          eventId = decoded.data;
        } else if (decoded.type === 'nevent') {
          eventId = decoded.data.id;
        } else {
          return null;
        }
      } catch {
        return null;
      }
    } else {
      eventId = noteId;
    }

    // Fetch event with timeout
    const fetchPromise = ndkInstance.fetchEvent(eventId);
    const timeoutPromise = new Promise<null>((resolve) => 
      setTimeout(() => resolve(null), FETCH_TIMEOUT)
    );
    const event = await Promise.race([fetchPromise, timeoutPromise]);
    
    if (!event) {
      return null;
    }

    // Extract title or content preview
    let title = event.tags.find((t) => t[0] === 'title')?.[1];
    if (!title) {
      if (event.content) {
        title = event.content.slice(0, 50) + (event.content.length > 50 ? '...' : '');
      } else {
        title = 'Note';
      }
    }

    // Build URL (use /nip19 route for notes)
    const url = `/${noteId}`;

    return { title, url };
  } catch (error) {
    console.warn('Failed to resolve note:', error);
    return null;
  }
}

