# Integrating Outbox Model into FoodstrFeed

## 1. Add the import

```typescript
// At the top of FoodstrFeed.svelte, add:
import { 
  fetchFollowingEvents, 
  getFollowedPubkeys,
  prewarmOutboxCache,
  clearOutboxCaches,
  type OutboxFetchResult 
} from '$lib/followOutbox';
```

## 2. Remove redundant code

You can remove these since they're now handled by the outbox module:

```typescript
// REMOVE these variables:
let followedPubkeys: string[] = [];
let followListLoading = false;
let followListCached = false;

// REMOVE this function (replaced by outbox module):
async function fetchFollowList(): Promise<string[]> { ... }
```

## 3. Replace the Following mode load logic

Replace the `filterMode === 'following'` block in `loadFoodstrFeed()`:

```typescript
if (filterMode === 'following') {
  if (!$userPublickey) {
    loading = false;
    error = false;
    events = [];
    return;
  }
  
  const since = sevenDaysAgo();
  
  // Use outbox model for optimized fetching
  const result: OutboxFetchResult = await fetchFollowingEvents($ndk, $userPublickey, {
    since,
    kinds: [1],
    limit: 100,
    timeoutMs: 8000
  });
  
  console.log(`[Feed] Outbox fetch: ${result.events.length} events from ${result.queriedRelays.length} relays in ${result.timing.totalMs}ms`);
  
  if (result.failedRelays.length > 0) {
    console.warn(`[Feed] Failed relays:`, result.failedRelays);
  }
  
  // Filter for food-related content AND exclude replies (only top-level notes)
  const validEvents = result.events.filter((event) => {
    // Exclude replies - only show top-level notes in Following
    const isReply = event.tags.some(tag => 
      Array.isArray(tag) && tag[0] === 'e' && tag[3] === 'reply'
    );
    
    if (isReply) return false;
    
    // Apply standard food content filtering
    return shouldIncludeEvent(event);
  });
  
  events = dedupeAndSort(validEvents);
  loading = false;
  error = false;
  
  if (events.length > 0) {
    lastEventTime = Math.max(...events.map(e => e.created_at || 0));
    await cacheEvents();
  }
  
  startRealtimeSubscription();
  return;
}
```

## 4. Replace the Notes & Replies mode load logic

Replace the `filterMode === 'replies'` block:

```typescript
if (filterMode === 'replies') {
  if (!$userPublickey) {
    loading = false;
    error = false;
    events = [];
    return;
  }
  
  const since = sevenDaysAgo();
  
  // Use outbox model - same fetch, different filtering
  const result: OutboxFetchResult = await fetchFollowingEvents($ndk, $userPublickey, {
    since,
    kinds: [1],
    limit: 100,
    timeoutMs: 8000
  });
  
  // Filter for food-related content (both notes AND replies)
  const foodEvents = result.events.filter((event) => {
    return shouldIncludeEvent(event);
  });
  
  events = dedupeAndSort(foodEvents);
  loading = false;
  error = false;
  
  if (events.length > 0) {
    lastEventTime = Math.max(...events.map(e => e.created_at || 0));
    await cacheEvents();
  }
  
  // Prefetch reply contexts for better UX
  await prefetchReplyContexts(events.slice(0, 20));
  
  startRealtimeSubscription();
  return;
}
```

## 5. Update the Global mode to exclude followed users

For the Global feed, you need to get followed pubkeys to exclude them:

```typescript
// In the Global mode section, update this part:

// Get followed users to exclude from Global feed (if logged in)
let followedSet = new Set<string>();
if ($userPublickey && !authorPubkey) {
  // Use the outbox module's function
  const followed = await getFollowedPubkeys($ndk, $userPublickey);
  followedSet = new Set(followed);
}
```

## 6. Update real-time subscriptions

The real-time subscription for Following mode needs the pubkeys. Add a helper:

```typescript
// Add this state variable at the top:
let followedPubkeysForRealtime: string[] = [];

// Update the startRealtimeSubscription function for following modes:
async function startRealtimeSubscription() {
  stopSubscriptions();
  
  const since = lastEventTime > 0 ? lastEventTime + 1 : Math.floor(Date.now() / 1000);
  
  if (filterMode === 'following' || filterMode === 'replies') {
    if (!$userPublickey) return;
    
    // Get followed pubkeys for subscription
    if (followedPubkeysForRealtime.length === 0) {
      followedPubkeysForRealtime = await getFollowedPubkeys($ndk, $userPublickey);
    }
    
    if (followedPubkeysForRealtime.length === 0) return;
    
    // Subscribe in batches of 100 (Nostr relay limit)
    for (let i = 0; i < followedPubkeysForRealtime.length; i += 100) {
      const batch = followedPubkeysForRealtime.slice(i, i + 100);
      
      const filter: NDKFilter = {
        kinds: [1],
        authors: batch,
        since
      };
      
      const sub = $ndk.subscribe(filter, { closeOnEose: false });
      
      sub.on('event', (event: NDKEvent) => {
        // For Following mode, exclude replies
        if (filterMode === 'following') {
          const isReply = event.tags.some(tag => 
            Array.isArray(tag) && tag[0] === 'e' && tag[3] === 'reply'
          );
          if (isReply) return;
        }
        
        if (shouldIncludeEvent(event)) {
          handleRealtimeEvent(event);
        }
      });
      
      activeSubscriptions.push(sub);
    }
    
    return;
  }
  
  // ... rest of Global mode subscription logic
}
```

## 7. Add cache prewarming on mount

For faster subsequent loads, prewarm the cache:

```typescript
onMount(async () => {
  lastFilterMode = filterMode;
  
  // Prewarm outbox cache in background (non-blocking)
  if ($userPublickey) {
    prewarmOutboxCache($ndk, $userPublickey).catch(() => {
      // Ignore prewarm errors - it's just an optimization
    });
  }
  
  try {
    await retryWithDelay();
  } catch {
    loading = false;
    error = true;
  }
});
```

## 8. Clear cache on logout

If you have a logout handler:

```typescript
function handleLogout() {
  clearOutboxCaches();
  // ... other logout logic
}
```

## 9. Fix the subscription cleanup (from earlier recommendations)

```typescript
// Change from tracking IDs to tracking actual subscriptions:
let activeSubscriptions: NDKSubscription[] = [];

function stopSubscriptions() {
  for (const sub of activeSubscriptions) {
    try {
      sub.stop();
    } catch {
      // Subscription already stopped
    }
  }
  activeSubscriptions = [];
}
```

## 10. Add reactive filter mode switching

```typescript
// Add this reactive statement to handle filter mode changes:
$: if (typeof window !== 'undefined' && filterMode !== lastFilterMode && !loading) {
  lastFilterMode = filterMode;
  seenEventIds.clear();
  events = [];
  followedPubkeysForRealtime = []; // Reset for new subscription
  loadFoodstrFeed(false);
}
```

---

## Performance Comparison

**Before (your current approach):**
- Queries 2-3 relays with first 100 follows
- Misses posts from follows who don't use those relays
- Single point of failure if relay is slow

**After (outbox model):**
- Queries each user's actual write relays
- Parallel fetching across all relevant relays
- No arbitrary follow limit
- Graceful degradation when relays fail
- Cached relay configs for fast subsequent loads

## Debugging

Add this to see what's happening:

```typescript
import { getOutboxCacheStats } from '$lib/followOutbox';

// In your component or dev tools:
console.log('Outbox cache stats:', getOutboxCacheStats());
```

Example output:
```
{
  followListCached: true,
  followCount: 347,
  relayConfigsCached: 289
}
```
