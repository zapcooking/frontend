# Feed Performance Analysis & Optimization Opportunities

**Date**: 2026-01-20  
**Status**: Performance Review Complete  
**Priority**: High

## Executive Summary

After a comprehensive review of the feed loading system, the codebase shows a well-architected foundation with several performance optimizations already in place. However, there are specific opportunities to improve loading speed, consistency, and accuracy.

## Current Architecture Strengths

### ✅ Good Implementations

1. **Feed Subscription Manager** (`src/lib/feedSubscriptionManager.ts`)
   - ✅ Subscription reuse prevents duplicate connections
   - ✅ EOSE tracking for accurate loading states
   - ✅ Single subscriptions per mode (not multiple batched)
   - ✅ Proper cleanup with stopAll()

2. **Caching System** (`src/lib/cache.ts`, `src/lib/feedCache.ts`)
   - ✅ IndexedDB for large datasets
   - ✅ localStorage for smaller data
   - ✅ TTL-based expiration (5 min for feeds)
   - ✅ Background refresh support

3. **Connection Management** (`src/lib/connectionManager.ts`)
   - ✅ Circuit breaker pattern for failed relays
   - ✅ Health checks run in background
   - ✅ Exponential backoff for reconnections
   - ✅ Heartbeat monitoring

4. **Explore Page Optimizations** (`src/lib/exploreUtils.ts`)
   - ✅ Early resolve (stops waiting once minimum recipes found)
   - ✅ Parallel data loading (collections, cooks, recipes)
   - ✅ Quality-weighted sampling for diversity
   - ✅ Popular cooks cache (10 min TTL)

## Performance Issues Identified

### 🔴 Critical Issues

#### 1. **Recent Page Not Using Feed Cache** (`/recent/+page.svelte`)
**Issue**: Line 61 shows direct subscription without checking cache first
```typescript
let filter: NDKFilter = { limit: 256, kinds: [30023], '#t': RECIPE_TAGS };
subscription = $ndk.subscribe(filter);
```

**Impact**: Every visit to `/recent` makes fresh network requests, even if data was just loaded
**Fix Priority**: HIGH

#### 2. **Feed Cache Service Not Integrated**
**Issue**: `feedCache.ts` exists but is not used by any feed components
**Impact**: 
- No benefit from caching infrastructure
- Redundant network requests
- Slower perceived performance
**Fix Priority**: HIGH

#### 3. **Redundant Validation on Every Render** (`Feed.svelte`)
**Issue**: Lines 17-32 run validation on every component render
```typescript
events = events.filter((e) => {
  if (!e.content || e.content.trim() === '') return false;
  if (e.tags.some(t => t[0] === 'deleted')) return false;
  return typeof validateMarkdownTemplate(e.content) !== 'string';
});
```

**Impact**: 
- Expensive markdown validation runs repeatedly
- Blocks UI rendering
- Degrades performance with large event lists
**Fix Priority**: MEDIUM

#### 4. **Large Limit on Recent Page**
**Issue**: Recent page requests 256 events (line 61)
**Impact**: 
- Longer EOSE wait times
- More data to validate and filter
- Slower initial render
**Fix Priority**: MEDIUM

### 🟡 Medium Priority Issues

#### 5. **No Incremental Loading**
**Issue**: All feeds wait for EOSE before showing any content
**Impact**: 
- Users see loading skeletons longer than necessary
- First contentful paint is delayed
**Fix Priority**: MEDIUM

#### 6. **Explore Page Timeout Too Long**
**Issue**: `fetchDiscoverRecipes` has 8-second timeout (line 705)
```typescript
}, 8000); // 8 second timeout (reduced from 10s)
```

**Impact**: Users wait up to 8 seconds on slow connections
**Fix Priority**: MEDIUM

#### 7. **Duplicate Engagement Queries**
**Issue**: `exploreUtils.ts` fetches likes and zaps separately for scoring
**Impact**:
- 2x the subscriptions needed
- Longer processing time
- More relay load
**Fix Priority**: LOW

### 🟢 Minor Optimizations

#### 8. **No Virtual Scrolling**
**Issue**: `Feed.svelte` renders all events at once
**Impact**: Performance degrades with 100+ recipes
**Fix Priority**: LOW

#### 9. **Profile Fetching in Batches Could Be Larger**
**Issue**: Popular cooks processed in batches of 15 (line 271)
**Impact**: Could be faster with larger batches (20-25)
**Fix Priority**: LOW

## Recommended Optimizations

### Phase 1: Quick Wins (1-2 hours)

#### A. Integrate Feed Cache into Recent Page
```typescript
// /recent/+page.svelte - Modified loadRecipes()
async function loadRecipes() {
  try {
    if (!$ndk) {
      console.warn('NDK not available');
      loaded = true;
      return;
    }
    
    // Check cache first
    const cached = await feedCacheService.getCachedFeed({
      filter: { kinds: [30023], '#t': RECIPE_TAGS },
      backgroundRefresh: true
    });
    
    if (cached && cached.length > 0) {
      events = cached;
      loaded = true;
      console.log('Loaded from cache:', cached.length);
      // Cache will refresh in background if stale
      return;
    }
    
    // ... existing subscription code
  }
}
```

**Expected Impact**: 
- Instant load for returning users (0-50ms vs 500-2000ms)
- Reduced relay load
- Better UX

#### B. Reduce Recent Page Limit
```typescript
// Change from 256 to 100
let filter: NDKFilter = { limit: 100, kinds: [30023], '#t': RECIPE_TAGS };
```

**Expected Impact**:
- Faster EOSE (30-40% reduction)
- Less data to validate
- Still plenty of content

#### C. Memoize Validation Results
```typescript
// Feed.svelte - Add validation cache
const validationCache = new Map<string, boolean>();

function isValidEvent(e: NDKEvent): boolean {
  const cached = validationCache.get(e.id);
  if (cached !== undefined) return cached;
  
  if (!e.content || e.content.trim() === '') {
    validationCache.set(e.id, false);
    return false;
  }
  if (e.tags.some(t => t[0] === 'deleted')) {
    validationCache.set(e.id, false);
    return false;
  }
  
  const isValid = typeof validateMarkdownTemplate(e.content) !== 'string';
  validationCache.set(e.id, isValid);
  return isValid;
}
```

**Expected Impact**:
- Validation runs once per event
- Faster re-renders
- Lower CPU usage

### Phase 2: Incremental Loading (2-4 hours)

#### D. Show Events as They Arrive
```typescript
// recent/+page.svelte
subscription.on('event', (event: NDKEvent) => {
  if (validateMarkdownTemplate(event.content) !== null) {
    events = [...events, event];
    
    // Show content after first batch
    if (events.length >= 12 && !loaded) {
      loaded = true; // Remove skeleton
    }
  }
});

subscription.on('eose', () => {
  loaded = true;
  console.log('End of stored events');
});
```

**Expected Impact**:
- First content visible in 200-500ms
- Progressive enhancement
- Better perceived performance

#### E. Reduce Explore Timeouts
```typescript
// exploreUtils.ts - Line 705
}, 5000); // Reduce from 8s to 5s
```

And implement early resolve threshold:
```typescript
// Line 698
const FIRST_PAINT_MIN = 6; // Reduce from 8 to 6
```

**Expected Impact**:
- Faster explore page loads
- Still gets quality content
- 37% faster on slow connections

### Phase 3: Advanced Optimizations (4-8 hours)

#### F. Implement Virtual Scrolling
Use `svelte-virtual-list` for large recipe grids

**Expected Impact**:
- Smooth scrolling with 500+ items
- Lower memory usage
- Faster initial render

#### G. Batch Engagement Queries
Combine likes and zaps into single query where possible

**Expected Impact**:
- 50% fewer subscriptions
- Faster engagement loading

#### H. Add Service Worker for Offline Support
Cache recipes in service worker for offline browsing

**Expected Impact**:
- Instant loads when offline
- Better PWA experience

## Consistency & Accuracy Checks

### ✅ Data Consistency
- Events properly deduplicated by ID
- Subscription manager prevents duplicate subscriptions
- EOSE tracking ensures complete data loads

### ✅ Filter Accuracy
- Correct use of `kinds: [30023]` for recipes
- Proper tag filtering with `RECIPE_TAGS` constant
- NIP-22 compliant comment handling

### ⚠️ Potential Race Conditions

#### Issue 1: Relay Switch During Load
**Location**: Multiple pages subscribe without checking relay generation
**Impact**: Stale data may be displayed after relay switch
**Fix**: Check `getCurrentRelayGeneration()` before setting events

```typescript
const startGeneration = getCurrentRelayGeneration();

subscription.on('event', (event: NDKEvent) => {
  // Ignore events from old relay generation
  if (getCurrentRelayGeneration() !== startGeneration) {
    console.log('Ignoring event from old relay generation');
    return;
  }
  // ... process event
});
```

#### Issue 2: Component Unmount During Async Cache Load
**Location**: `feedCache.ts` background refresh
**Impact**: Memory leaks and state updates on unmounted components
**Fix**: Use cancellation tokens or check component mount state

## Performance Metrics Targets

### Current (Estimated)
- Recent page first paint: 1500-2500ms
- Explore page first paint: 2000-3500ms
- Cache hit rate: 0% (not implemented)

### Phase 1 Targets (Quick Wins)
- Recent page first paint: 100-500ms (cached) / 1000-1500ms (uncached)
- Explore page first paint: 1500-2500ms
- Cache hit rate: 60-70% for returning users

### Phase 2 Targets (Incremental)
- Recent page first paint: 50-200ms (cached) / 300-700ms (uncached)
- Explore page first paint: 800-1500ms
- Cache hit rate: 70-80%

### Phase 3 Targets (Advanced)
- Recent page first paint: 0-50ms (PWA)
- Explore page first paint: 500-1000ms
- Cache hit rate: 85-95%

## Implementation Checklist

### Phase 1 (Recommended Now)
- [ ] Integrate feedCache into /recent page
- [ ] Reduce recent page limit from 256 to 100
- [ ] Add validation memoization to Feed.svelte
- [ ] Add relay generation checks to prevent stale data
- [ ] Test cache hit rates in production

### Phase 2
- [ ] Implement incremental event display
- [ ] Reduce explore timeouts
- [ ] Add early render thresholds
- [ ] Monitor performance metrics

### Phase 3
- [ ] Add virtual scrolling to Feed component
- [ ] Batch engagement queries
- [ ] Implement service worker caching
- [ ] Add offline support

## Testing Recommendations

1. **Performance Testing**
   - Use Chrome DevTools Performance tab
   - Measure First Contentful Paint (FCP)
   - Measure Time to Interactive (TTI)
   - Test on slow 3G connection

2. **Cache Testing**
   - Clear cache and measure cold load
   - Measure warm load (cache hit)
   - Test cache expiration behavior
   - Monitor IndexedDB size growth

3. **Relay Testing**
   - Test with single relay
   - Test with all relays
   - Test relay switch behavior
   - Monitor relay response times

4. **Load Testing**
   - Test with 10, 50, 100, 500 events
   - Measure render time scaling
   - Test memory usage with large datasets
   - Test scroll performance

## Conclusion

The codebase has a solid foundation with good architectural patterns. The main issues are:

1. **Cache is built but not used** - Easy fix with high impact
2. **Recent page loads too much data** - Simple limit adjustment
3. **Validation runs repeatedly** - Memoization solves this
4. **No incremental loading** - Progressive enhancement opportunity

Implementing Phase 1 optimizations would provide immediate, significant improvements with minimal risk. The existing infrastructure (cache, subscription manager, connection manager) is well-designed and just needs to be fully integrated.

**Estimated Total Impact**: 70-80% faster perceived load times for returning users after Phase 1, with additional 30-40% improvements from Phase 2.
