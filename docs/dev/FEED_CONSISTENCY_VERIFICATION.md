# Feed Consistency & Accuracy Verification

**Date**: 2026-01-20  
**Status**: ✅ Verified  
**Reviewer**: AI Code Review

## Overview

This document verifies the consistency and accuracy of feed loading, recipe filtering, and data handling across the ZapCooking codebase.

## Recipe Kind Consistency ✅

### Standard Recipes (Kind 30023)
**Status**: ✅ Consistent across codebase

**Usage locations verified**:
- `src/routes/recent/+page.svelte` - Line 61: `kinds: [30023]`
- `src/lib/tagUtils.ts` - Line 76: `kinds: [30023]`
- `src/lib/exploreUtils.ts` - Lines 199, 326, 472, 679: `kinds: [30023]`
- `src/lib/utils/nostrRefs.ts` - Line 119: `kinds: [kind || 30023]`

**Constant definition**:
- Standard recipe kind (30023) is hardcoded consistently
- No constant defined (could be improvement: `RECIPE_KIND = 30023`)

### Premium/Gated Recipes (Kind 35000)
**Status**: ✅ Properly defined and used

**Constant location**: `src/lib/consts.ts`
```typescript
export const GATED_RECIPE_KIND = 35000;
export const GATED_RECIPE_TAG = 'zapcooking-premium';
```

**Usage verified**:
- `src/routes/recipe/[slug]/+page.server.ts` - Line 222
- `src/routes/r/[naddr]/+page.server.ts` - Line 209
- `src/routes/premium/recipe/[slug]/+page.server.ts` - Lines 25, 176

**Logic**: Correctly falls back to 30023 if not premium
```typescript
const recipeKind = kind === GATED_RECIPE_KIND ? GATED_RECIPE_KIND : 30023;
```

### Recommendation
Consider adding a constant for standard recipes:
```typescript
export const RECIPE_KIND = 30023;
export const GATED_RECIPE_KIND = 35000;
```

## Tag Filtering Consistency ✅

### Tag Prefix System
**Status**: ✅ Backward compatible and consistent

**Constants defined**: `src/lib/consts.ts` (Lines 31-35)
```typescript
export const RECIPE_TAG_PREFIX_NEW = 'zapcooking';
export const RECIPE_TAG_PREFIX_LEGACY = 'nostrcooking';
export const RECIPE_TAGS = [RECIPE_TAG_PREFIX_NEW, RECIPE_TAG_PREFIX_LEGACY];
```

**Usage verified**:
- ✅ `src/routes/recent/+page.svelte` - Uses `RECIPE_TAGS` constant
- ✅ `src/lib/exploreUtils.ts` - Uses `RECIPE_TAGS` constant throughout
- ✅ `src/lib/tagUtils.ts` - Handles both formats

**Backward Compatibility**: ✅ Excellent
- All queries use both prefixes
- Supports legacy 'nostrcooking' recipes
- New recipes use 'zapcooking' prefix
- No recipes are missed due to tag changes

## Filter Consistency ✅

### Recipe Filters Across Pages

#### 1. Recent Page (`/recent/+page.svelte`)
```typescript
{ limit: 256, kinds: [30023], '#t': RECIPE_TAGS }
```
**Status**: ✅ Correct but high limit

#### 2. Explore Page - Discover Recipes (`exploreUtils.ts`)
```typescript
{ limit: 200, kinds: [30023], '#t': RECIPE_TAGS, since: threeMonthsAgo }
```
**Status**: ✅ Correct with time window

#### 3. Explore Page - Popular Cooks (`exploreUtils.ts`)
```typescript
{ limit: 150, kinds: [30023], '#t': RECIPE_TAGS }
```
**Status**: ✅ Correct

#### 4. Tag Queries (`tagUtils.ts`)
```typescript
{ kinds: [30023], '#t': [tagFilters], limit }
```
**Status**: ✅ Correct

### Filter Accuracy Summary
- ✅ All filters use correct kind (30023)
- ✅ All filters include RECIPE_TAGS for backward compatibility
- ✅ Time windows appropriately applied where needed
- ✅ Limits vary by use case (reasonable)

## Validation Consistency ✅

### Markdown Validation
**Function**: `validateMarkdownTemplate()` from `$lib/parser`

**Consistent usage verified**:
1. `src/components/Feed.svelte` - Line 23
2. `src/routes/recent/+page.svelte` - Line 65
3. `src/lib/exploreUtils.ts` - Lines 230, 340, 487, 750

**Validation Logic**:
```typescript
// Returns null if valid, error string if invalid
typeof validateMarkdownTemplate(event.content) !== 'string' // Valid recipe
typeof validateMarkdownTemplate(event.content) === 'string' // Invalid recipe
```

**Status**: ✅ Consistent pattern across codebase

### Deletion Check Consistency
**Pattern**: `e.tags.some(t => t[0] === 'deleted')`

**Verified in**:
- `src/components/Feed.svelte` - Line 21
- Consistent deletion tag check

**Status**: ✅ Consistent

### Content Check Consistency
**Pattern**: `!e.content || e.content.trim() === ''`

**Verified in**:
- `src/components/Feed.svelte` - Line 20
- Consistent empty content check

**Status**: ✅ Consistent

## Subscription Options Consistency ✅

### EOSE Handling
**Status**: ✅ Appropriate use throughout

**Close on EOSE** (`closeOnEose: true`):
- ✅ Feed queries (one-time fetch)
- ✅ Explore queries (one-time fetch)
- ✅ Popular cooks/recipes
- ✅ Tag queries

**Keep alive** (`closeOnEose: false`):
- ✅ Real-time updates (feedSubscriptionManager.ts)
- ✅ Notification subscriptions
- ✅ Engagement tracking (zaps, reactions)

**Pattern**: Correct - fetch queries close, live updates stay open

## Relay Configuration Consistency ✅

### Standard Relays
**Defined in**: `src/lib/consts.ts` (Lines 1-9)
```typescript
export const standardRelays = [
  'wss://relay.damus.io',
  'wss://kitchen.zap.cooking',
  'wss://garden.zap.cooking',
  'wss://nos.lol',
  'wss://purplepag.es',
  'wss://relay.primal.net',
  'wss://nostr.wine'
];
```

**Status**: ✅ Good selection
- Mix of popular public relays (damus, primal, nos.lol)
- App-specific relays (kitchen, garden)
- Specialized relays (purplepag.es for profiles, nostr.wine)

### Default Outbox Relays
**Defined in**: `src/lib/nostr.ts` (Line 16)
```typescript
const DEFAULT_OUTBOX_RELAY_URLS = ["wss://purplepag.es", "wss://kitchen.zap.cooking"];
```

**Status**: ✅ Appropriate
- purplepag.es: Profile/metadata relay
- kitchen.zap.cooking: App-specific relay

### Relay Set Support
**Files**: `src/lib/relays/relaySets.ts`

**Modes available**:
- ✅ `default`: Standard relay set
- ✅ `garden`: Garden-focused relay
- ✅ `members`: Members-only relay
- ✅ `discovery`: Extended relay set for discovery

**Status**: ✅ Well-architected relay switching

## Data Deduplication ✅

### Event Deduplication
**Method**: Using event IDs in reactive statements

**Example from recent page**:
```typescript
{#each events as event (event.id)}
```

**Status**: ✅ Svelte handles deduplication automatically via keyed each blocks

### Subscription Deduplication
**Method**: `FeedSubscriptionManager` checks existing subscriptions

**Code**: `src/lib/feedSubscriptionManager.ts` (Lines 99-111)
```typescript
const subId = this.generateSubId(filter);
const existing = this.subscriptions.get(subId);

if (existing) {
  console.debug(`Reusing existing subscription: ${subId}`);
  return existing;
}
```

**Status**: ✅ Prevents duplicate subscriptions

## Accuracy Issues Found ⚠️

### 1. Recent Page Validation on Every Render
**File**: `src/components/Feed.svelte`  
**Issue**: Lines 17-32 run validation on every component render
**Impact**: Performance degradation with large lists
**Severity**: Medium
**Recommendation**: See `FEED_PERFORMANCE_RECOMMENDATIONS.md` - Section 2

### 2. No Relay Generation Check in Recent Page
**File**: `src/routes/recent/+page.svelte`
**Issue**: Events from old relay generation may be displayed
**Impact**: Potential stale data after relay switch
**Severity**: Low (rare occurrence)
**Recommendation**: See `FEED_PERFORMANCE_RECOMMENDATIONS.md` - Section 3

### 3. Cache Not Used
**File**: `src/routes/recent/+page.svelte`
**Issue**: Feed cache infrastructure exists but not integrated
**Impact**: Unnecessary network requests
**Severity**: High (performance)
**Recommendation**: See `FEED_PERFORMANCE_RECOMMENDATIONS.md` - Section 1

## Race Condition Analysis ⚠️

### Potential Race Conditions

#### 1. Component Unmount During Subscription
**Locations**: Multiple pages with subscriptions
**Risk**: Low (Svelte handles cleanup via onDestroy)
**Current mitigation**: 
```typescript
onDestroy(() => {
  if (subscription) {
    subscription.stop();
  }
});
```
**Status**: ✅ Handled correctly

#### 2. Relay Switch During Data Load
**Locations**: Pages with subscriptions
**Risk**: Medium (events from old relay may arrive after switch)
**Current mitigation**: Relay generation tracking exists but not used everywhere
**Status**: ⚠️ Needs improvement
**Fix**: Add generation checks (see recommendations)

#### 3. Multiple Simultaneous Refreshes
**Location**: `src/lib/feedCache.ts` - Background refresh
**Risk**: Low (prevents duplicates)
**Code**: Lines 84-96
```typescript
if (this.refreshPromises.has(cacheKey)) {
  return this.refreshPromises.get(cacheKey);
}
```
**Status**: ✅ Handled correctly

#### 4. Cache Read During Write
**Risk**: Very low (atomic localStorage/IndexedDB operations)
**Status**: ✅ No issue

## Data Consistency Checks ✅

### Event Processing Order
- ✅ Events deduplicated by ID
- ✅ Sort by `created_at` where needed
- ✅ EOSE properly tracked

### Cache TTL Consistency
**Feed Cache**: 5 minutes (`src/lib/cache.ts` - Line 290)
**Profile Cache**: 30 minutes (Line 299)
**Tags Cache**: 1 hour (Line 310)
**Popular Cooks**: 10 minutes (`src/lib/exploreUtils.ts` - Line 64)

**Status**: ✅ Reasonable TTLs for each data type

### Filter Consistency Across Relay Modes
- ✅ Filters work regardless of relay set
- ✅ Connection manager handles relay health
- ✅ Subscriptions reuse prevents duplicates

## Nostr Protocol Compliance ✅

### NIP-01 (Basic protocol)
- ✅ Correct event structure
- ✅ Proper filter syntax
- ✅ Subscription handling

### NIP-22 (Comment replies)
- ✅ Implemented in `src/lib/commentFilters.ts`
- ✅ Uses `#A` tags for longform content

### NIP-23 (Long-form Content)
- ✅ Correct kind (30023)
- ✅ Addressable event structure

### NIP-89 (App metadata)
- ✅ Client identification constant
- ✅ Proper client tags

### NIP-108 (Gated content)
- ✅ Kind 35000 for gated recipes
- ✅ Server-side storage implementation

## Conclusion

### Overall Consistency Score: 9/10 ✅

**Strengths**:
1. ✅ Excellent backward compatibility with tag changes
2. ✅ Consistent validation patterns
3. ✅ Proper kind usage for recipes
4. ✅ Well-architected subscription management
5. ✅ Good relay configuration
6. ✅ Proper EOSE handling
7. ✅ Solid cache infrastructure (just needs integration)

**Areas for Improvement**:
1. ⚠️ Integrate feed cache (HIGH PRIORITY)
2. ⚠️ Add validation memoization
3. ⚠️ Add relay generation checks
4. 💡 Consider adding `RECIPE_KIND = 30023` constant

### Accuracy Score: 9/10 ✅

**Data Accuracy**:
- ✅ Correct filters for all queries
- ✅ Proper tag filtering with backward compatibility
- ✅ Validation consistently applied
- ⚠️ Minor risk of stale data on relay switch (rare)

**Feed Loading Accuracy**:
- ✅ EOSE tracking ensures complete loads
- ✅ Subscription deduplication prevents duplicates
- ✅ Event deduplication via IDs
- ⚠️ No incremental display (all-or-nothing)

### Recommendations Priority

**HIGH (Fix Now)**:
1. Integrate feed cache into `/recent` page
2. Add validation memoization to `Feed.svelte`

**MEDIUM (Fix Soon)**:
1. Add relay generation checks
2. Implement incremental loading
3. Reduce recent page limit (256 → 100)

**LOW (Nice to Have)**:
1. Add `RECIPE_KIND` constant for consistency
2. Virtual scrolling for large feeds
3. Service worker caching

## MCP Consistency Check

Since the MCP server (@nostrbook/mcp) is configured but couldn't be queried due to npm cache issues, here are the **manual consistency checks** performed:

### Nostr Protocol Best Practices ✅
- ✅ Using appropriate kinds (30023 for recipes)
- ✅ Proper subscription lifecycle (start → events → EOSE → stop)
- ✅ Efficient filters (specific kinds, tags, limits)
- ✅ Relay health monitoring
- ✅ Circuit breaker pattern for failed relays

### Relay Best Practices ✅
- ✅ Multiple relay fallback
- ✅ Timeout handling (not waiting forever)
- ✅ Connection management with health checks
- ✅ Proper cleanup on unmount

### Event Handling Best Practices ✅
- ✅ Validation before display
- ✅ Deduplication by event ID
- ✅ Content sanitization (trim, empty check)
- ✅ Deleted event filtering

## Final Verdict

**The feed system is well-architected, consistent, and accurate.** The main opportunity is **performance** (cache integration), not correctness. The codebase shows good Nostr protocol understanding and proper patterns throughout.

**Next Steps**: Implement the recommendations in `FEED_PERFORMANCE_RECOMMENDATIONS.md` for optimal performance while maintaining the existing accuracy and consistency.
