/**
 * Reply Context Prefetching
 * 
 * Batch-fetches parent notes and author profiles for replies in the feed.
 * This prevents the waterfall of individual fetches as replies render.
 */

import type { NDK, NDKEvent } from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ReplyContext {
  authorName: string;
  authorPubkey: string;
  notePreview: string;
  noteId: string;
  fullNote?: NDKEvent;
  error?: 'deleted' | 'failed';
}

// ═══════════════════════════════════════════════════════════════
// CACHE
// ═══════════════════════════════════════════════════════════════

const replyContextCache = new Map<string, ReplyContext>();
const MAX_CACHE_SIZE = 300;

function addToCache(noteId: string, context: ReplyContext): void {
  // Evict oldest if at capacity
  if (replyContextCache.size >= MAX_CACHE_SIZE) {
    const firstKey = replyContextCache.keys().next().value;
    if (firstKey) replyContextCache.delete(firstKey);
  }
  replyContextCache.set(noteId, context);
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Extract the parent note ID from an event's e tags
 */
export function getParentNoteId(event: NDKEvent): string | null {
  const eTags = event.tags.filter(tag => Array.isArray(tag) && tag[0] === 'e');
  
  if (eTags.length === 0) return null;
  
  // Priority 1: Explicit 'reply' marker
  const replyTag = eTags.find(tag => tag[3] === 'reply');
  if (replyTag) return replyTag[1] as string;
  
  // Priority 2: If there's a 'root' and other e tags, non-root is reply target
  const rootTag = eTags.find(tag => tag[3] === 'root');
  if (rootTag && eTags.length > 1) {
    const nonRootTag = eTags.find(tag => tag[1] !== rootTag[1]);
    if (nonRootTag) return nonRootTag[1] as string;
  }
  
  // Priority 3: Only root tag = direct reply to root
  if (rootTag) return rootTag[1] as string;
  
  // Priority 4: Old style - last e tag is typically immediate parent
  return eTags[eTags.length - 1][1] as string;
}

/**
 * Check if an event is a reply
 */
export function isReply(event: NDKEvent): boolean {
  return event.tags.some(tag => Array.isArray(tag) && tag[0] === 'e');
}

/**
 * Clean content for preview (remove URLs, nostr links, extra whitespace)
 */
function cleanContentForPreview(content: string, maxLength = 70): string {
  const cleaned = content
    .replace(/https?:\/\/[^\s]+/g, '')
    .replace(/nostr:[^\s]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.substring(0, maxLength) + '...';
}

/**
 * Get display name from profile with npub fallback
 */
function getDisplayName(pubkey: string, profile?: any): string {
  if (profile?.display_name) return profile.display_name;
  if (profile?.displayName) return profile.displayName;
  if (profile?.name) return profile.name;
  
  // Fallback to truncated npub
  try {
    const npub = nip19.npubEncode(pubkey);
    return npub.substring(0, 12) + '...';
  } catch {
    return pubkey.substring(0, 12) + '...';
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN API
// ═══════════════════════════════════════════════════════════════

/**
 * Get cached reply context (synchronous)
 */
export function getCachedReplyContext(noteId: string): ReplyContext | null {
  return replyContextCache.get(noteId) || null;
}

/**
 * Prefetch reply contexts for multiple events
 * 
 * This batch-fetches all parent notes and their author profiles in just 2 queries,
 * instead of N individual fetches as each reply renders.
 */
export async function prefetchReplyContexts(
  ndk: NDK,
  events: NDKEvent[]
): Promise<Map<string, ReplyContext>> {
  const results = new Map<string, ReplyContext>();
  
  // Collect parent note IDs that aren't cached
  const parentIds = new Set<string>();
  
  for (const event of events) {
    if (!isReply(event)) continue;
    
    const parentId = getParentNoteId(event);
    if (parentId && !replyContextCache.has(parentId)) {
      parentIds.add(parentId);
    }
  }
  
  // Return cached results if nothing new to fetch
  if (parentIds.size === 0) {
    for (const event of events) {
      if (isReply(event)) {
        const parentId = getParentNoteId(event);
        if (parentId) {
          const cached = replyContextCache.get(parentId);
          if (cached) results.set(parentId, cached);
        }
      }
    }
    return results;
  }
  
  try {
    // Batch fetch parent notes
    const parentNotes = await ndk.fetchEvents({
      kinds: [1],
      ids: Array.from(parentIds).slice(0, 100)
    });
    
    const noteMap = new Map<string, NDKEvent>();
    const authorPubkeys = new Set<string>();
    
    for (const note of parentNotes) {
      noteMap.set(note.id, note);
      if (note.pubkey) authorPubkeys.add(note.pubkey);
    }
    
    // Batch fetch author profiles
    const profileMap = new Map<string, any>();
    
    if (authorPubkeys.size > 0) {
      const profiles = await ndk.fetchEvents({
        kinds: [0],
        authors: Array.from(authorPubkeys).slice(0, 100)
      });
      
      for (const profile of profiles) {
        try {
          profileMap.set(profile.pubkey, JSON.parse(profile.content));
        } catch {
          // Invalid profile JSON
        }
      }
    }
    
    // Build contexts
    for (const parentId of parentIds) {
      const note = noteMap.get(parentId);
      
      if (!note) {
        // Note not found (deleted or on unreachable relay)
        const context: ReplyContext = {
          authorName: 'a deleted note',
          authorPubkey: '',
          notePreview: '',
          noteId: parentId,
          error: 'deleted'
        };
        addToCache(parentId, context);
        results.set(parentId, context);
        continue;
      }
      
      const profile = profileMap.get(note.pubkey);
      const context: ReplyContext = {
        authorName: getDisplayName(note.pubkey, profile),
        authorPubkey: note.pubkey,
        notePreview: cleanContentForPreview(note.content || ''),
        noteId: parentId,
        fullNote: note
      };
      
      addToCache(parentId, context);
      results.set(parentId, context);
    }
    
    // Mark unfetched IDs as failed
    for (const parentId of parentIds) {
      if (!results.has(parentId)) {
        const context: ReplyContext = {
          authorName: 'a note',
          authorPubkey: '',
          notePreview: '',
          noteId: parentId,
          error: 'failed'
        };
        addToCache(parentId, context);
        results.set(parentId, context);
      }
    }
    
  } catch (err) {
    console.warn('[ReplyContext] Batch fetch failed:', err);
    
    // Mark all as failed
    for (const parentId of parentIds) {
      if (!results.has(parentId)) {
        const context: ReplyContext = {
          authorName: 'a note',
          authorPubkey: '',
          notePreview: '',
          noteId: parentId,
          error: 'failed'
        };
        addToCache(parentId, context);
        results.set(parentId, context);
      }
    }
  }
  
  return results;
}

/**
 * Fetch a single reply context (for lazy loading on expand)
 */
export async function fetchReplyContext(
  ndk: NDK,
  noteId: string
): Promise<ReplyContext> {
  // Check cache first
  const cached = replyContextCache.get(noteId);
  if (cached) return cached;
  
  try {
    const note = await ndk.fetchEvent({
      kinds: [1],
      ids: [noteId]
    });
    
    if (!note) {
      const context: ReplyContext = {
        authorName: 'a deleted note',
        authorPubkey: '',
        notePreview: '',
        noteId,
        error: 'deleted'
      };
      addToCache(noteId, context);
      return context;
    }
    
    // Fetch author profile
    let profile: any = null;
    try {
      const user = ndk.getUser({ pubkey: note.pubkey });
      await user.fetchProfile();
      profile = user.profile;
    } catch {
      // Profile fetch failed
    }
    
    const context: ReplyContext = {
      authorName: getDisplayName(note.pubkey, profile),
      authorPubkey: note.pubkey,
      notePreview: cleanContentForPreview(note.content || ''),
      noteId,
      fullNote: note
    };
    
    addToCache(noteId, context);
    return context;
    
  } catch (err) {
    const context: ReplyContext = {
      authorName: 'a note',
      authorPubkey: '',
      notePreview: '',
      noteId,
      error: 'failed'
    };
    addToCache(noteId, context);
    return context;
  }
}

/**
 * Clear the reply context cache
 */
export function clearReplyContextCache(): void {
  replyContextCache.clear();
}

/**
 * Get cache stats for debugging
 */
export function getReplyContextCacheStats(): { size: number; maxSize: number } {
  return {
    size: replyContextCache.size,
    maxSize: MAX_CACHE_SIZE
  };
}
