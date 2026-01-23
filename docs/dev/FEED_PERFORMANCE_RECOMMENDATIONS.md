# Feed Performance Recommendations - Action Items

**Priority**: HIGH  
**Estimated Time**: 2-3 hours for Phase 1  
**Expected Impact**: 70-80% faster loads for returning users

## Quick Summary

Your feed system has excellent infrastructure (cache, subscription manager, connection manager) but **the cache isn't being used**. This is the #1 performance opportunity.

## Immediate Actions (Phase 1)

### 1. Enable Feed Caching on Recent Page ⭐ HIGHEST IMPACT

**File**: `src/routes/recent/+page.svelte`  
**Lines**: 43-79 (loadRecipes function)

**Change**:
```typescript
import { feedCacheService } from '$lib/feedCache';

async function loadRecipes() {
  try {
    if (!$ndk) {
      console.warn('NDK not available, skipping subscription');
      loaded = true;
      return;
    }
    
    // NEW: Check cache first
    const cacheFilter = { kinds: [30023], '#t': RECIPE_TAGS };
    const cached = await feedCacheService.getCachedFeed({
      filter: cacheFilter,
      backgroundRefresh: true // Refresh if stale
    });
    
    if (cached && cached.length > 0) {
      events = cached.filter(e => validateMarkdownTemplate(e.content) !== null);
      loaded = true;
      console.log('✨ Loaded from cache:', events.length, 'recipes');
      return; // Cache service will refresh in background if needed
    }
    
    // Stop existing subscription if any
    if (subscription) {
      subscription.stop();
      subscription = null;
    }
    
    // Reset state
    events = [];
    loaded = false;
    
    // Fetch from network
    let filter: NDKFilter = { limit: 100, kinds: [30023], '#t': RECIPE_TAGS }; // REDUCED from 256
    subscription = $ndk.subscribe(filter);
    
    const fetchedEvents: NDKEvent[] = [];

    subscription.on('event', (event: NDKEvent) => {
      if (validateMarkdownTemplate(event.content) !== null) {
        fetchedEvents.push(event);
        events = [...fetchedEvents]; // Update UI as events arrive
        
        // NEW: Show content after first batch
        if (fetchedEvents.length >= 12 && !loaded) {
          loaded = true;
        }
      }
    });

    subscription.on('eose', async () => {
      loaded = true;
      console.log('End of stored events:', fetchedEvents.length);
      
      // NEW: Cache the results
      await feedCacheService.setCachedFeed(fetchedEvents, {
        filter: cacheFilter
      });
    });

  } catch (error) {
    console.error(error);
    loaded = true;
  }
}
```

**Impact**:
- First load: ~1000ms (slightly faster due to reduced limit)
- Cached load: ~50-100ms (20x faster!)
- Background refresh keeps data fresh

---

### 2. Memoize Validation in Feed Component

**File**: `src/components/Feed.svelte`  
**Lines**: 17-32

**Change**:
```typescript
<script lang="ts">
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import RecipeCard from './RecipeCard.svelte';
  import { validateMarkdownTemplate } from '$lib/parser';

  export let events: NDKEvent[];
  export let hideHide = false;
  export let lists = false;
  export let loaded = false;
  
  export let isOwnProfile = false;
  export let isProfileView = false;

  // NEW: Validation cache to avoid re-running expensive checks
  const validationCache = new Map<string, boolean>();
  
  function isValidEvent(e: NDKEvent): boolean {
    // Check cache first
    const eventId = e.id || e.sig || '';
    if (eventId && validationCache.has(eventId)) {
      return validationCache.get(eventId)!;
    }
    
    // Perform validation
    const hasContent = e.content && e.content.trim() !== '';
    const notDeleted = !e.tags.some(t => t[0] === 'deleted');
    const validMarkdown = lists || typeof validateMarkdownTemplate(e.content) !== 'string';
    
    const isValid = hasContent && notDeleted && validMarkdown;
    
    // Cache result
    if (eventId) {
      validationCache.set(eventId, isValid);
    }
    
    return isValid;
  }

  // Filter events reactively
  $: filteredEvents = events.filter(isValidEvent);
</script>

{#if filteredEvents.length > 0}
  <div
    class="grid gap-4 justify-items-center {isProfileView
      ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'
      : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8'}"
  >
    {#each filteredEvents as event (event.id)}
      {#if !(hideHide == true && event.tags.find((t) => t[0] == 't' && t[1] == 'nostrcooking-hide'))}
        <RecipeCard list={lists} {event} />
      {/if}
    {/each}
  </div>
{:else if !loaded}
  <!-- Loading skeletons unchanged -->
  ...
{:else}
  <!-- Empty state unchanged -->
  ...
{/if}
```

**Impact**:
- Validation runs once per event (not on every render)
- Faster re-renders when events update
- Lower CPU usage

---

### 3. Add Relay Generation Check (Prevent Stale Data)

**File**: `src/routes/recent/+page.svelte`  
**Add at top of loadRecipes()**

**Change**:
```typescript
import { getCurrentRelayGeneration } from '$lib/nostr';

function loadRecipes() {
  try {
    // NEW: Track relay generation to prevent stale data
    const startGeneration = getCurrentRelayGeneration();
    
    if (!$ndk) {
      console.warn('NDK not available, skipping subscription');
      loaded = true;
      return;
    }
    
    // ... existing cache check code ...
    
    subscription.on('event', (event: NDKEvent) => {
      // NEW: Ignore events from old relay generation
      if (getCurrentRelayGeneration() !== startGeneration) {
        console.log('🚫 Ignoring event from old relay generation');
        return;
      }
      
      if (validateMarkdownTemplate(event.content) !== null) {
        fetchedEvents.push(event);
        events = [...fetchedEvents];
        
        if (fetchedEvents.length >= 12 && !loaded) {
          loaded = true;
        }
      }
    });
    
    // ... rest of function
  }
}
```

**Impact**:
- Prevents race conditions when switching relays
- Ensures data consistency
- Avoids confusion from stale data

---

### 4. Reduce Explore Timeout

**File**: `src/lib/exploreUtils.ts`  
**Line**: 705

**Change**:
```typescript
// OLD
}, 8000); // 8 second timeout (reduced from 10s)

// NEW
}, 5000); // 5 second timeout - faster UX, still gets quality content
```

**Line**: 698

**Change**:
```typescript
// OLD
const FIRST_PAINT_MIN = Math.min(8, limit);

// NEW
const FIRST_PAINT_MIN = Math.min(6, limit); // Resolve earlier for faster first paint
```

**Impact**:
- 37% faster on slow connections
- Still gets quality content
- Better UX

---

## Testing After Changes

### 1. Test Cache Hit
```bash
# Open DevTools Console
# Navigate to /recent
# Should see: "✨ Loaded from cache: N recipes"
# Refresh page - should be instant

# Check IndexedDB
# Application tab -> IndexedDB -> ZapCookingCache -> cache
# Should see entries with feed_events keys
```

### 2. Test Incremental Load
```bash
# Throttle network to Slow 3G in DevTools
# Navigate to /recent (no cache)
# Should see first recipes appear within 500-1000ms
# Skeleton should disappear after ~12 recipes load
```

### 3. Test Relay Generation
```bash
# Navigate to /recent
# While loading, switch relay mode (if you have relay switcher)
# Should see "🚫 Ignoring event from old relay generation" in console
# New events should come from new relay
```

### 4. Measure Performance
```bash
# Chrome DevTools -> Performance tab
# Record page load to /recent
# Metrics to check:
# - FCP (First Contentful Paint): Should be <500ms cached, <1500ms uncached
# - LCP (Largest Contentful Paint): Should be <1000ms cached, <2500ms uncached
# - Time to first recipe visible: Should be <300ms cached, <700ms uncached
```

---

## Expected Results

### Before Changes
- Cold load: 1500-2500ms to first content
- Warm load: 1500-2500ms (no caching)
- Validation: Runs on every render
- Relay switch: Potential stale data

### After Phase 1
- Cold load: 800-1500ms to first content (incremental)
- Warm load: 50-200ms (cached!)
- Validation: Runs once per event
- Relay switch: Safe, no stale data

### User Experience
- Returning users: **20x faster** (cached)
- New users: **1.5-2x faster** (incremental + reduced limit)
- All users: More reliable, no stale data

---

## Phase 2 (Optional, Additional 2-3 hours)

After Phase 1 is working well, consider:

1. **Virtual Scrolling** - For feeds with 100+ items
2. **Service Worker** - For offline support
3. **Prefetching** - Pre-load likely next pages
4. **Image Optimization** - Lazy load recipe images
5. **Bundle Splitting** - Code split heavy components

---

## Monitoring

Add these metrics to track improvements:

```typescript
// Add to loadRecipes() in recent/+page.svelte
const perfStart = performance.now();

// On cache hit
console.log(`⚡ Cache load: ${(performance.now() - perfStart).toFixed(0)}ms`);

// On EOSE
console.log(`📡 Network load: ${(performance.now() - perfStart).toFixed(0)}ms`);

// Track cache hit rate
let cacheHits = 0;
let cacheMisses = 0;
// Increment appropriately and log periodically
```

---

## Questions?

- **Q: Will cache grow too large?**
  - A: No, TTL is 5 minutes. Old entries auto-expire. IndexedDB has plenty of space.

- **Q: What if cached data is stale?**
  - A: Background refresh updates cache while showing old data. Best of both worlds.

- **Q: Will this break existing functionality?**
  - A: No, it's additive. Cache miss = network fetch (current behavior).

- **Q: How do I clear cache for testing?**
  - A: DevTools -> Application -> IndexedDB -> Delete ZapCookingCache

---

## Implementation Order

1. ✅ Read through all changes above
2. ✅ Test in local dev environment first
3. ✅ Start with #1 (cache integration) - biggest impact
4. ✅ Add #2 (validation memoization) - easy win
5. ✅ Add #3 (relay generation) - safety improvement
6. ✅ Add #4 (reduce timeout) - quick fix
7. ✅ Test thoroughly (see Testing section)
8. ✅ Deploy to staging/production
9. ✅ Monitor metrics
10. ✅ Celebrate faster loads! 🎉

---

**Need help?** Refer to `FEED_PERFORMANCE_ANALYSIS.md` for detailed explanations of each issue and solution.
