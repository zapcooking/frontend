# Repost Implementation - Code Changes

**Date:** 2025-01-04  
**Status:** Proposed Implementation

---

## Summary

This document provides diff-friendly code changes to implement repost (kind 6) support in the feed.

---

## File 1: `src/lib/repostUtils.ts` (NEW FILE)

```typescript
import { NDK, NDKEvent } from '@nostr-dev-kit/ndk';

/**
 * Cache for original events referenced by reposts
 * Prevents duplicate fetches when multiple reposts reference same original
 */
const originalEventCache = new Map<string, {
  event: NDKEvent | null;
  fetchedAt: number;
}>();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Parses a kind 6 repost event to extract the original event
 * 
 * Strategy:
 * 1. Try to parse embedded JSON from content field (NIP-18)
 * 2. Fall back to e tag if JSON parsing fails
 * 3. Return null if neither works
 */
export function parseRepost(repostEvent: NDKEvent): {
  originalEvent: NDKEvent | null;
  originalEventId: string | null;
  parseMethod: 'embedded' | 'etag' | null;
} {
  // Method 1: Parse embedded JSON (NIP-18 standard)
  if (repostEvent.content) {
    try {
      const originalJson = JSON.parse(repostEvent.content);
      if (originalJson.id && originalJson.kind === 1) {
        // Create NDKEvent from parsed JSON
        const originalEvent = new NDKEvent(repostEvent.ndk, originalJson);
        return {
          originalEvent,
          originalEventId: originalJson.id,
          parseMethod: 'embedded'
        };
      }
    } catch (e) {
      // JSON parse failed, try e tag
    }
  }
  
  // Method 2: Extract from e tag (fallback)
  const eTag = repostEvent.tags.find(t => t[0] === 'e' && t[1]);
  if (eTag && eTag[1]) {
    return {
      originalEvent: null, // Need to fetch
      originalEventId: eTag[1] as string,
      parseMethod: 'etag'
    };
  }
  
  return {
    originalEvent: null,
    originalEventId: null,
    parseMethod: null
  };
}

/**
 * Fetches the original event referenced by a repost
 * Uses caching to avoid duplicate fetches
 */
export async function fetchOriginalEvent(
  ndk: NDK,
  eventId: string
): Promise<NDKEvent | null> {
  const cached = originalEventCache.get(eventId);
  const now = Date.now();
  
  // Return cached if still valid
  if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) {
    return cached.event;
  }
  
  // Fetch and cache
  try {
    const event = await ndk.fetchEvent({
      ids: [eventId],
      kinds: [1]
    });
    
    originalEventCache.set(eventId, {
      event: event || null,
      fetchedAt: now
    });
    
    return event;
  } catch (e) {
    console.error('[Repost] Failed to fetch original event:', eventId, e);
    originalEventCache.set(eventId, {
      event: null,
      fetchedAt: now
    });
    return null;
  }
}

/**
 * Clears stale cache entries
 */
export function clearStaleRepostCache(): void {
  const now = Date.now();
  for (const [id, cached] of originalEventCache.entries()) {
    if ((now - cached.fetchedAt) >= CACHE_TTL_MS) {
      originalEventCache.delete(id);
    }
  }
}

/**
 * Checks if an event is a repost (kind 6)
 */
export function isRepost(event: NDKEvent): boolean {
  return event.kind === 6;
}
```

---

## File 2: `src/components/RepostFeedItem.svelte` (NEW FILE)

```svelte
<script lang="ts">
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import CustomAvatar from './CustomAvatar.svelte';
  import FeedPost from './FeedPost.svelte';
  import ArrowsClockwise from 'phosphor-svelte/lib/ArrowsClockwise';

  export let repostEvent: NDKEvent;
  export let originalEvent: NDKEvent | null = null;
  export let loading = false;

  const reposterPubkey = repostEvent.pubkey;
  const reposterName = repostEvent.author?.profile?.name || 
    nip19.npubEncode(reposterPubkey).substring(0, 12) + '...';
</script>

<article class="border-b py-4 sm:py-6" style="border-color: var(--color-input-border)">
  <!-- Repost header -->
  <div class="flex items-center gap-2 px-2 mb-2 text-sm" style="color: var(--color-caption)">
    <ArrowsClockwise size={16} class="text-primary" />
    <a 
      href="/user/{nip19.npubEncode(reposterPubkey)}" 
      class="hover:underline font-medium"
    >
      {reposterName} reposted
    </a>
    <span class="text-xs opacity-70">
      {new Date((repostEvent.created_at || 0) * 1000).toLocaleString()}
    </span>
  </div>
  
  <!-- Original note (wrapped) -->
  {#if loading}
    <div class="pl-4 border-l-2 ml-2" style="border-color: var(--color-input-border)">
      <div class="animate-pulse p-4">
        <div class="h-4 bg-accent-gray rounded w-3/4 mb-2"></div>
        <div class="h-4 bg-accent-gray rounded w-1/2"></div>
      </div>
    </div>
  {:else if originalEvent}
    <div class="pl-4 border-l-2 ml-2" style="border-color: var(--color-input-border)">
      <FeedPost event={originalEvent} hideRepostButton={true} />
    </div>
  {:else}
    <div class="pl-4 border-l-2 ml-2 p-4 text-sm" style="border-color: var(--color-input-border); color: var(--color-caption)">
      Original note not found or could not be loaded
    </div>
  {/if}
</article>
```

---

## File 3: `src/components/FoodstrFeedOptimized.svelte` (MODIFICATIONS)

### Change 1: Add imports

```diff
+ import { parseRepost, fetchOriginalEvent, isRepost } from '$lib/repostUtils';
+ import RepostFeedItem from './RepostFeedItem.svelte';
```

### Change 2: Update Following mode query

```diff
        // Use outbox model for optimized fetching
        const result: OutboxFetchResult = await fetchFollowingEvents($ndk, $userPublickey, {
          since,
-         kinds: [1],
+         kinds: [1, 6], // Include reposts
          limit: 100,
          timeoutMs: 8000
        });
```

### Change 3: Update Replies mode query

```diff
        // Use outbox model - same fetch, different filtering
        const result: OutboxFetchResult = await fetchFollowingEvents($ndk, $userPublickey, {
          since,
-         kinds: [1],
+         kinds: [1, 6], // Include reposts
          limit: 100,
          timeoutMs: 8000
        });
```

### Change 4: Update Global mode query

```diff
      const filter: any = {
-       kinds: [1],
+       kinds: [1, 6], // Include reposts
        '#t': FOOD_HASHTAGS,
        since
      };
```

### Change 5: Update real-time subscription (Following/Replies mode)

```diff
        const filter: any = {
-         kinds: [1],
+         kinds: [1, 6], // Include reposts
          authors: followedPubkeysForRealtime,
          since
        };
```

### Change 6: Update real-time subscription (Global mode)

```diff
    const hashtagFilter: any = {
-     kinds: [1],
+     kinds: [1, 6], // Include reposts
      '#t': FOOD_HASHTAGS,
      since
    };
```

### Change 7: Update pagination query

```diff
        const filter: any = {
-         kinds: [1],
+         kinds: [1, 6], // Include reposts
          '#t': FOOD_HASHTAGS,
          until: oldestEvent.created_at - 1,
          limit: 20
        };
```

### Change 8: Add repost processing and deduplication

Add after `dedupeAndSort()` call in `loadFoodstrFeed()`:

```diff
        events = dedupeAndSort(validEvents);
+       
+       // Process reposts and deduplicate
+       const processedEvents = await processReposts(events);
+       events = dedupeReposts(processedEvents);
+       
        loading = false;
```

### Change 9: Add repost processing function

Add before `loadFoodstrFeed()` function:

```typescript
  /**
   * Processes repost events to fetch original events
   */
  async function processReposts(eventList: NDKEvent[]): Promise<NDKEvent[]> {
    const reposts = eventList.filter(isRepost);
    const processed: NDKEvent[] = [];
    const repostedEventIds = new Set<string>();
    
    // Process reposts first
    for (const repost of reposts) {
      const parsed = parseRepost(repost);
      
      if (parsed.originalEvent) {
        // Original embedded in repost
        repostedEventIds.add(parsed.originalEventId!);
        processed.push(repost);
      } else if (parsed.originalEventId) {
        // Need to fetch original
        const original = await fetchOriginalEvent($ndk, parsed.originalEventId);
        if (original) {
          repostedEventIds.add(parsed.originalEventId);
          processed.push(repost);
        }
        // If fetch fails, skip repost (don't show broken repost)
      }
    }
    
    // Add non-repost events, excluding those that have been reposted
    for (const event of eventList) {
      if (!isRepost(event)) {
        // Skip original if it has been reposted (show repost instead)
        if (!repostedEventIds.has(event.id)) {
          processed.push(event);
        }
      }
    }
    
    return processed;
  }
  
  /**
   * Deduplicates reposts - if multiple reposts reference same original,
   * keep only the most recent one
   */
  function dedupeReposts(eventList: NDKEvent[]): NDKEvent[] {
    const repostMap = new Map<string, NDKEvent>(); // originalEventId -> repost
    
    // Group reposts by original event ID
    for (const event of eventList) {
      if (isRepost(event)) {
        const parsed = parseRepost(event);
        if (parsed.originalEventId) {
          const existing = repostMap.get(parsed.originalEventId);
          if (!existing || (event.created_at || 0) > (existing.created_at || 0)) {
            repostMap.set(parsed.originalEventId, event);
          }
        }
      }
    }
    
    // Filter to keep only most recent repost per original
    return eventList.filter(event => {
      if (isRepost(event)) {
        const parsed = parseRepost(event);
        if (parsed.originalEventId) {
          const mostRecent = repostMap.get(parsed.originalEventId);
          return mostRecent?.id === event.id;
        }
      }
      return true;
    });
  }
```

### Change 10: Update feed rendering loop

Replace the feed rendering section (around line 1777):

```diff
  {:else}
    <div class="space-y-0">
      {#each events as event (event.id)}
-       <article class="border-b py-4 sm:py-6 first:pt-0" style="border-color: var(--color-input-border)">
-         <div class="flex space-x-3 px-2 sm:px-0">
+       {#if isRepost(event)}
+         {@const parsed = parseRepost(event)}
+         {#if parsed.originalEvent}
+           <RepostFeedItem repostEvent={event} originalEvent={parsed.originalEvent} />
+         {:else if parsed.originalEventId}
+           {@const original = await fetchOriginalEvent($ndk, parsed.originalEventId)}
+           <RepostFeedItem 
+             repostEvent={event} 
+             originalEvent={original} 
+             loading={!original && original !== null}
+           />
+         {/if}
+       {:else}
+         <article class="border-b py-4 sm:py-6 first:pt-0" style="border-color: var(--color-input-border)">
+           <div class="flex space-x-3 px-2 sm:px-0">
            {#if !hideAvatar}
              <a href="/user/{nip19.npubEncode(event.author?.hexpubkey || event.pubkey)}" class="flex-shrink-0">
                <CustomAvatar
                  className="cursor-pointer"
                  pubkey={event.author?.hexpubkey || event.pubkey}
                  size={40}
                />
              </a>
            {/if}

            <div class="flex-1 min-w-0">
              {#if isReply(event)}
                <!-- ... existing reply handling ... -->
              {/if}
              <!-- ... rest of existing note rendering ... -->
            </div>
          </div>
        </article>
+       {/if}
      {/each}
    </div>
  {/if}
```

**Note:** The `{#await}` syntax in Svelte doesn't work directly in `{#each}` loops. We need to process reposts before rendering. See alternative approach below.

### Change 10 (Alternative): Pre-process reposts before rendering

Instead of using `{#await}` in the loop, process all reposts upfront:

```typescript
  // Add state for processed reposts
  let repostOriginals = new Map<string, NDKEvent | null>();
  let repostLoading = new Set<string>();
  
  // Process reposts when events change
  $: if (events.length > 0) {
    processRepostsAsync();
  }
  
  async function processRepostsAsync() {
    const reposts = events.filter(isRepost);
    for (const repost of reposts) {
      const parsed = parseRepost(repost);
      if (parsed.originalEventId && !repostOriginals.has(parsed.originalEventId)) {
        repostLoading.add(parsed.originalEventId);
        repostOriginals = new Map(repostOriginals); // Trigger reactivity
        
        const original = await fetchOriginalEvent($ndk, parsed.originalEventId);
        repostOriginals.set(parsed.originalEventId, original);
        repostLoading.delete(parsed.originalEventId);
        repostOriginals = new Map(repostOriginals); // Trigger reactivity
      }
    }
  }
```

Then in the rendering:

```svelte
{#each events as event (event.id)}
  {#if isRepost(event)}
    {@const parsed = parseRepost(event)}
    {#if parsed.originalEvent}
      <RepostFeedItem repostEvent={event} originalEvent={parsed.originalEvent} />
    {:else if parsed.originalEventId}
      {@const original = repostOriginals.get(parsed.originalEventId)}
      {@const loading = repostLoading.has(parsed.originalEventId)}
      <RepostFeedItem 
        repostEvent={event} 
        originalEvent={original || null} 
        loading={loading}
      />
    {/if}
  {:else}
    <!-- Existing note rendering -->
  {/if}
{/each}
```

---

## File 4: Update `FeedPost.svelte` (if it exists)

If `FeedPost.svelte` is used, add `hideRepostButton` prop:

```diff
+ export let hideRepostButton = false;

  <!-- ... existing code ... -->
  
  {#if !hideRepostButton}
    <NoteRepost {event} />
  {/if}
```

---

## Testing Checklist

- [ ] Reposts are fetched in Following mode
- [ ] Reposts are fetched in Replies mode
- [ ] Reposts are fetched in Global mode
- [ ] Reposts are fetched in real-time subscriptions
- [ ] Reposts are fetched in pagination
- [ ] Embedded JSON reposts parse correctly
- [ ] E-tag fallback works for reposts without embedded JSON
- [ ] Missing originals are fetched from relays
- [ ] Original events are cached correctly
- [ ] Deduplication prevents showing both original and repost
- [ ] Reposts render with proper wrapper
- [ ] Original note renders correctly within repost
- [ ] Loading state shows while fetching original
- [ ] Error state shows if original cannot be fetched
- [ ] Multiple reposts of same original are deduplicated

---

## Notes

1. **Performance:** Original event fetching is async and may cause layout shifts. Consider prefetching or showing skeletons.

2. **Caching:** The cache TTL is 5 minutes. Adjust based on needs.

3. **Deduplication:** Current strategy hides originals if reposted. Consider making this configurable.

4. **Error Handling:** If original cannot be fetched, repost is skipped. Consider showing a "broken repost" indicator instead.

5. **Nested Reposts:** Current implementation doesn't handle reposts of reposts. Consider adding support later.

