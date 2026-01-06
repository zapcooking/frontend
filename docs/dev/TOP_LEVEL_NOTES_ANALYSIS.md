# Top-Level Notes Feed Correctness Analysis

**Date:** 2025-01-04  
**Task:** MAP Task 2 — Notes (Top-Level Feed Correctness)  
**Goal:** Ensure kind 1 top-level notes render correctly and aren't polluted by replies.

---

## 🔍 Current State Analysis

### Reply Detection Logic

The codebase has **inconsistent reply detection** across different parts of the feed:

#### 1. Following Mode Filter (Initial Load)
**Location:** `FoodstrFeedOptimized.svelte:717-719`

```typescript
const isReplyEvent = event.tags.some(tag => 
  Array.isArray(tag) && tag[0] === 'e' && tag[3] === 'reply'
);
if (isReplyEvent) return false;
```

**Problem:** Only checks for explicit `reply` marker. **Misses many replies** that use:
- `root` marker only
- Old-style `e` tags without markers
- `mention` markers

#### 2. Following Mode Real-Time Subscription
**Location:** `FoodstrFeedOptimized.svelte:974-976`

```typescript
const isReplyEvent = event.tags.some(tag => 
  Array.isArray(tag) && tag[0] === 'e'
);
if (isReplyEvent) return;
```

**Problem:** Checks for ANY `e` tag, which is better but still inconsistent with initial load filter.

#### 3. `isReply()` Helper Function
**Location:** `FoodstrFeedOptimized.svelte:1291-1295`

```typescript
function isReply(event: NDKEvent): boolean {
  // Check if this event has any e tags (indicating it's a reply)
  const eTags = event.tags.filter(tag => Array.isArray(tag) && tag[0] === 'e');
  return eTags.length > 0;
}
```

**Status:** ✅ Correct logic, but **not used consistently** throughout the codebase.

#### 4. Global Feed
**Location:** `FoodstrFeedOptimized.svelte:882-908`

**Problem:** ❌ **Does NOT filter replies at all** - shows all kind 1 events that match food filter.

---

## 🐛 Issues Identified

### Issue 1: Inconsistent Reply Detection

**Severity:** High  
**Impact:** Replies appear in "Following" feed when they shouldn't

**Root Cause:** Different detection logic in:
- Initial load (too strict - only `reply` marker)
- Real-time subscription (checks any `e` tag)
- Helper function exists but unused

**Evidence:**
- Line 717: Only checks `tag[3] === 'reply'`
- Line 974: Checks any `e` tag
- Line 1291: `isReply()` function exists but not used in filters

### Issue 2: Global Feed Shows Replies

**Severity:** Medium  
**Impact:** Replies pollute the global "top-level notes" feed

**Root Cause:** Global feed filter (line 882-908) doesn't check for replies at all.

**Evidence:**
```typescript
// Global feed filter - NO reply checking
const validEvents = allFetchedEvents.filter(event => {
  // ... muted users check
  // ... food filter check
  // ... followed users exclusion
  // ❌ NO reply filtering
  return true;
});
```

### Issue 3: Pagination Doesn't Filter Replies

**Severity:** Medium  
**Impact:** Replies appear when loading more in Following mode

**Location:** `loadMore()` function (line 1127-1201)

**Problem:** `loadMore()` doesn't apply reply filtering for Following mode.

### Issue 4: Background Refresh Doesn't Filter Replies

**Severity:** Low  
**Impact:** Replies may appear in background refresh for Following mode

**Location:** `fetchFreshData()` function (line 1061-1121)

**Problem:** Doesn't check filter mode or apply reply filtering.

---

## 📊 Sorting & Deduplication Analysis

### Sorting ✅ CORRECT

**Location:** `dedupeAndSort()` function (line 642-652)

```typescript
return unique.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
```

**Status:** ✅ Stable descending sort by `created_at`

### Deduplication ✅ CORRECT

**Location:** `dedupeAndSort()` function (line 642-652)

```typescript
const seenEventIds = new Set<string>();
// ...
if (!event.id || seenEventIds.has(event.id)) continue;
seenEventIds.add(event.id);
```

**Status:** ✅ Deduplicates by event `id` correctly

### Pagination Strategy

**Location:** `loadMore()` function (line 1127-1201)

```typescript
const filter: any = {
  kinds: [1],
  '#t': FOOD_HASHTAGS,
  until: oldestEvent.created_at - 1,  // ✅ Correct pagination
  limit: 20
};
```

**Status:** ✅ Uses `until` parameter correctly for pagination

**Issue:** ❌ Doesn't respect `filterMode` - always uses hashtag filter, even in Following mode

---

## ✅ Proposed Filter Rules for "Top-Level Notes"

### Definition: Top-Level Note

A **top-level note** is a kind 1 event that:
1. Has **no `e` tags** (event references), OR
2. Has `e` tags but they are **only for mentions** (not replies)

### Reply Detection Algorithm

```typescript
/**
 * Determines if a kind 1 event is a reply (not a top-level note)
 * 
 * A reply is an event that references another event via 'e' tags with:
 * - Explicit 'reply' marker: ['e', <event_id>, <relay>, 'reply']
 * - 'root' marker (indicates thread participation): ['e', <event_id>, <relay>, 'root']
 * - Any 'e' tag without a marker (old-style reply convention)
 * 
 * NOT a reply if:
 * - Only has 'e' tags with 'mention' marker (these are mentions, not replies)
 * - Has no 'e' tags at all
 */
function isReply(event: NDKEvent): boolean {
  if (event.kind !== 1) return false;
  
  const eTags = event.tags.filter(tag => 
    Array.isArray(tag) && tag[0] === 'e' && tag[1]
  );
  
  if (eTags.length === 0) return false; // No e tags = top-level
  
  // Check if any e tag indicates a reply (not just a mention)
  return eTags.some(tag => {
    const marker = tag[3]?.toLowerCase();
    
    // Explicit reply marker
    if (marker === 'reply') return true;
    
    // Root marker (indicates thread participation)
    if (marker === 'root') return true;
    
    // Old-style: e tag without marker (assumed to be reply)
    if (!marker) return true;
    
    // Mention marker - NOT a reply
    if (marker === 'mention') return false;
    
    // Unknown marker - treat as reply to be safe
    return true;
  });
}

/**
 * Determines if an event is a top-level note (not a reply)
 */
function isTopLevelNote(event: NDKEvent): boolean {
  return !isReply(event);
}
```

### Filter Application Rules

1. **Following Mode (`filterMode === 'following'`):**
   - ✅ Show only top-level notes (exclude replies)
   - ✅ Apply food filter (if enabled)
   - ✅ Exclude muted users
   - ✅ Use outbox model for efficient fetching

2. **Replies Mode (`filterMode === 'replies'`):**
   - ✅ Show both top-level notes AND replies
   - ✅ Apply food filter (if enabled)
   - ✅ Exclude muted users
   - ✅ Use outbox model

3. **Global Mode (`filterMode === 'global'`):**
   - ✅ Show only top-level notes (exclude replies) - **NEW REQUIREMENT**
   - ✅ Apply food filter (always)
   - ✅ Exclude muted users
   - ✅ Exclude followed users (they belong in Following/Replies)

---

## 🔧 Code Changes Required

### Change 1: Standardize Reply Detection

**File:** `src/components/FoodstrFeedOptimized.svelte`

**Replace the existing `isReply()` function (lines 1291-1295) with the improved version:**

```typescript
function isReply(event: NDKEvent): boolean {
  if (event.kind !== 1) return false;
  
  const eTags = event.tags.filter(tag => 
    Array.isArray(tag) && tag[0] === 'e' && tag[1]
  );
  
  if (eTags.length === 0) return false; // No e tags = top-level
  
  // Check if any e tag indicates a reply (not just a mention)
  return eTags.some(tag => {
    const marker = tag[3]?.toLowerCase();
    
    // Explicit reply marker
    if (marker === 'reply') return true;
    
    // Root marker (indicates thread participation)
    if (marker === 'root') return true;
    
    // Old-style: e tag without marker (assumed to be reply)
    if (!marker) return true;
    
    // Mention marker - NOT a reply
    if (marker === 'mention') return false;
    
    // Unknown marker - treat as reply to be safe
    return true;
  });
}
```

### Change 2: Use `isReply()` in Following Mode Filter

**File:** `src/components/FoodstrFeedOptimized.svelte`  
**Location:** Line 715-735

**Replace:**
```typescript
const validEvents = result.events.filter((event) => {
  // Exclude replies - only show top-level notes in Following
  const isReplyEvent = event.tags.some(tag => 
    Array.isArray(tag) && tag[0] === 'e' && tag[3] === 'reply'
  );
  if (isReplyEvent) return false;
```

**With:**
```typescript
const validEvents = result.events.filter((event) => {
  // Exclude replies - only show top-level notes in Following
  if (isReply(event)) return false;
```

### Change 3: Use `isReply()` in Real-Time Subscription

**File:** `src/components/FoodstrFeedOptimized.svelte`  
**Location:** Line 971-978

**Replace:**
```typescript
sub.on('event', (event: NDKEvent) => {
  // For Following mode, exclude replies
  if (filterMode === 'following') {
    const isReplyEvent = event.tags.some(tag => 
      Array.isArray(tag) && tag[0] === 'e'
    );
    if (isReplyEvent) return;
  }
```

**With:**
```typescript
sub.on('event', (event: NDKEvent) => {
  // For Following mode, exclude replies
  if (filterMode === 'following' && isReply(event)) {
    return;
  }
```

### Change 4: Filter Replies in Global Feed

**File:** `src/components/FoodstrFeedOptimized.svelte`  
**Location:** Line 882-908

**Add reply filtering to global feed:**

```typescript
// Filter, dedupe, and sort - exclude followed users from Global feed
const validEvents = allFetchedEvents.filter(event => {
  // Check muted users first
  if ($userPublickey) {
    const mutedUsers = getMutedUsers();
    const authorKey = event.author?.hexpubkey || event.pubkey;
    if (authorKey && mutedUsers.includes(authorKey)) return false;
  }
  
  // Global feed: exclude replies (only show top-level notes)
  if (!authorPubkey && isReply(event)) {
    return false;
  }
  
  // Apply food filter based on context
  if (authorPubkey) {
    // Profile view: respect the toggle
    if (foodFilterEnabled && !shouldIncludeEvent(event)) return false;
  } else {
    // Global feed: always apply food filter
    if (!shouldIncludeEvent(event)) return false;
    
    // Also exclude posts from followed users
    if (followedSet.size > 0) {
      const authorKey = event.author?.hexpubkey || event.pubkey;
      if (authorKey && followedSet.has(authorKey)) {
        return false; // Exclude - this belongs in Following/Notes & Replies
      }
    }
  }
  
  return true;
});
```

### Change 5: Filter Replies in Global Feed Real-Time Subscription

**File:** `src/components/FoodstrFeedOptimized.svelte`  
**Location:** Line 1007-1016

**Add reply filtering:**

```typescript
hashtagSub.on('event', (event: NDKEvent) => {
  // Global feed: exclude replies (only show top-level notes)
  if (!authorPubkey && isReply(event)) {
    return;
  }
  
  // For Global feed, exclude posts from followed users
  if (!authorPubkey && followedPubkeysForRealtime.length > 0) {
    const authorKey = event.author?.hexpubkey || event.pubkey;
    if (authorKey && followedPubkeysForRealtime.includes(authorKey)) {
      return; // Skip - belongs in Following/Notes & Replies
    }
  }
  handleRealtimeEvent(event);
});
```

### Change 6: Filter Replies in `loadMore()` for Following Mode

**File:** `src/components/FoodstrFeedOptimized.svelte`  
**Location:** Line 1127-1201

**Add filter mode awareness and reply filtering:**

```typescript
async function loadMore() {
  if (loadingMore || !hasMore) return;
  
  try {
    loadingMore = true;
    
    const oldestEvent = events[events.length - 1];
    if (!oldestEvent?.created_at) {
      hasMore = false;
      return;
    }
    
    let olderEvents: NDKEvent[] = [];
    
    // Handle different filter modes
    if (filterMode === 'following' || filterMode === 'replies') {
      if (!$userPublickey) {
        hasMore = false;
        return;
      }
      
      // Use outbox model for Following/Replies mode
      const result = await fetchFollowingEvents($ndk, $userPublickey, {
        since: 0, // Get all history
        until: oldestEvent.created_at - 1,
        kinds: [1],
        limit: 20,
        timeoutMs: 8000
      });
      
      olderEvents = result.events;
    } else {
      // Global mode - use hashtag filter
      const filter: any = {
        kinds: [1],
        '#t': FOOD_HASHTAGS,
        until: oldestEvent.created_at - 1,
        limit: 20
      };
      
      if (authorPubkey) {
        filter.authors = [authorPubkey];
      }
      
      olderEvents = await fetchFromRelays(
        filter, 
        [...RELAY_POOLS.recipes, ...RELAY_POOLS.fallback]
      );
    }
    
    // For Global feed, exclude posts from followed users
    const followedSet = new Set(followedPubkeysForRealtime);
    
    const validOlder = olderEvents.filter(e => {
      if (seenEventIds.has(e.id)) return false;
      
      // Check muted users
      if ($userPublickey) {
        const mutedUsers = getMutedUsers();
        const authorKey = e.author?.hexpubkey || e.pubkey;
        if (authorKey && mutedUsers.includes(authorKey)) return false;
      }
      
      // Filter replies based on mode
      if (filterMode === 'following' && isReply(e)) {
        return false; // Following mode: exclude replies
      }
      
      if (!authorPubkey && filterMode === 'global' && isReply(e)) {
        return false; // Global mode: exclude replies
      }
      
      // Apply food filter based on context
      if (authorPubkey) {
        // Profile view: respect the toggle
        if (foodFilterEnabled && !shouldIncludeEvent(e)) return false;
      } else {
        // Global feed: always apply food filter
        if (!shouldIncludeEvent(e)) return false;
        
        // Exclude followed users from Global feed
        if (followedSet.size > 0 && filterMode === 'global') {
          const authorKey = e.author?.hexpubkey || e.pubkey;
          if (authorKey && followedSet.has(authorKey)) {
            return false;
          }
        }
      }
      
      return true;
    });
    
    if (validOlder.length > 0) {
      validOlder.forEach(e => seenEventIds.add(e.id));
      events = [...events, ...validOlder];
      hasMore = olderEvents.length === 20;
      await cacheEvents();
    } else {
      hasMore = olderEvents.length === 20;
    }
  } catch {
    // Load more failed
  } finally {
    loadingMore = false;
  }
}
```

### Change 7: Filter Replies in `fetchFreshData()` for Following Mode

**File:** `src/components/FoodstrFeedOptimized.svelte`  
**Location:** Line 1061-1121

**Add filter mode awareness:**

```typescript
async function fetchFreshData() {
  try {
    // Only refresh for global mode (Following/Replies use real-time subscriptions)
    if (filterMode !== 'global') return;
    
    const filter: any = {
      kinds: [1],
      '#t': FOOD_HASHTAGS,
      limit: 50,
      since: sevenDaysAgo()
    };
    
    if (authorPubkey) {
      filter.authors = [authorPubkey];
    }
    
    const freshEvents = await fetchFromRelays(
      filter, 
      [...RELAY_POOLS.recipes, ...RELAY_POOLS.fallback]
    );
    
    // For Global feed, exclude posts from followed users
    const followedSet = new Set(followedPubkeysForRealtime);
    
    const validNew = freshEvents.filter(e => {
      if (seenEventIds.has(e.id)) return false;
      
      // Global feed: exclude replies
      if (!authorPubkey && isReply(e)) {
        return false;
      }
      
      // Check muted users
      if ($userPublickey) {
        const mutedUsers = getMutedUsers();
        const authorKey = e.author?.hexpubkey || e.pubkey;
        if (authorKey && mutedUsers.includes(authorKey)) return false;
      }
      
      // Apply food filter
      if (!shouldIncludeEvent(e)) return false;
      
      // Exclude followed users from Global feed
      if (followedSet.size > 0) {
        const authorKey = e.author?.hexpubkey || e.pubkey;
        if (authorKey && followedSet.has(authorKey)) {
          return false;
        }
      }
      
      return true;
    });
    
    if (validNew.length > 0) {
      validNew.forEach(e => seenEventIds.add(e.id));
      events = [...validNew, ...events].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      lastEventTime = Math.max(lastEventTime, ...validNew.map(e => e.created_at || 0));
      await cacheEvents();
    }
  } catch {
    // Background refresh failed - non-critical
  }
}
```

---

## 📋 Summary of Changes

### Files Modified
- `src/components/FoodstrFeedOptimized.svelte`

### Changes Summary

1. ✅ **Improved `isReply()` function** - Handles all reply marker types correctly
2. ✅ **Standardized reply detection** - Use `isReply()` everywhere instead of inline checks
3. ✅ **Filter replies in Following mode** - Both initial load and real-time
4. ✅ **Filter replies in Global mode** - New requirement
5. ✅ **Filter replies in pagination** - `loadMore()` respects filter mode
6. ✅ **Filter replies in background refresh** - `fetchFreshData()` respects filter mode

### Testing Checklist

- [ ] Following mode shows only top-level notes (no replies)
- [ ] Replies mode shows both notes and replies
- [ ] Global mode shows only top-level notes (no replies)
- [ ] Real-time subscriptions filter correctly per mode
- [ ] Pagination (`loadMore`) filters correctly per mode
- [ ] Background refresh filters correctly
- [ ] Sorting remains stable (created_at desc)
- [ ] Deduplication works (no duplicate IDs)
- [ ] Events with only mention `e` tags are NOT filtered as replies

---

## ✅ Acceptance Criteria

✅ **Feed shows only true top-level notes when "notes-only" mode is active.**

**Implementation:**
- Following mode = notes-only (excludes replies)
- Global mode = notes-only (excludes replies) - **NEW**
- Replies mode = notes + replies (includes both)

**Verification:**
- All filter points use consistent `isReply()` function
- Real-time subscriptions respect filter mode
- Pagination respects filter mode
- Background refresh respects filter mode

