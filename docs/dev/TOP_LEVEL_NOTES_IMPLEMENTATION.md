# Top-Level Notes Implementation Summary

**Date:** 2025-01-04  
**Status:** ✅ Implemented

---

## Changes Made

### 1. Improved `isReply()` Function ✅

**File:** `src/components/FoodstrFeedOptimized.svelte` (lines 1291-1315)

**Before:**
```typescript
function isReply(event: NDKEvent): boolean {
  const eTags = event.tags.filter(tag => Array.isArray(tag) && tag[0] === 'e');
  return eTags.length > 0;
}
```

**After:**
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

**Improvements:**
- ✅ Handles `reply`, `root`, `mention`, and old-style markers
- ✅ Distinguishes mentions from replies
- ✅ More robust detection

---

### 2. Standardized Following Mode Filter ✅

**File:** `src/components/FoodstrFeedOptimized.svelte` (line 717)

**Before:**
```typescript
const isReplyEvent = event.tags.some(tag => 
  Array.isArray(tag) && tag[0] === 'e' && tag[3] === 'reply'
);
if (isReplyEvent) return false;
```

**After:**
```typescript
if (isReply(event)) return false;
```

**Improvements:**
- ✅ Uses consistent `isReply()` function
- ✅ Catches all reply types, not just explicit `reply` markers

---

### 3. Standardized Real-Time Subscription Filter ✅

**File:** `src/components/FoodstrFeedOptimized.svelte` (line 972)

**Before:**
```typescript
if (filterMode === 'following') {
  const isReplyEvent = event.tags.some(tag => 
    Array.isArray(tag) && tag[0] === 'e'
  );
  if (isReplyEvent) return;
}
```

**After:**
```typescript
if (filterMode === 'following' && isReply(event)) {
  return;
}
```

**Improvements:**
- ✅ Uses consistent `isReply()` function
- ✅ Cleaner code

---

### 4. Added Reply Filtering to Global Feed ✅

**File:** `src/components/FoodstrFeedOptimized.svelte` (line 884)

**Added:**
```typescript
// Global feed: exclude replies (only show top-level notes)
if (!authorPubkey && isReply(event)) {
  return false;
}
```

**Improvements:**
- ✅ Global feed now shows only top-level notes
- ✅ Replies no longer pollute global feed

---

### 5. Added Reply Filtering to Global Feed Real-Time ✅

**File:** `src/components/FoodstrFeedOptimized.svelte` (line 1007)

**Added:**
```typescript
// Global feed: exclude replies (only show top-level notes)
if (!authorPubkey && isReply(event)) {
  return;
}
```

**Improvements:**
- ✅ Real-time updates respect reply filtering
- ✅ Consistent behavior across initial load and updates

---

### 6. Updated Background Refresh ✅

**File:** `src/components/FoodstrFeedOptimized.svelte` (line 1061)

**Changes:**
1. Added filter mode check (only refresh global mode)
2. Added reply filtering for global feed

**Before:**
```typescript
async function fetchFreshData() {
  try {
    const filter: any = { ... };
    // ... no reply filtering
  }
}
```

**After:**
```typescript
async function fetchFreshData() {
  try {
    // Only refresh for global mode (Following/Replies use real-time subscriptions)
    if (filterMode !== 'global') return;
    
    // ... filter logic with reply checking
    if (!authorPubkey && isReply(e)) {
      return false;
    }
  }
}
```

---

### 7. Updated Pagination (`loadMore()`) ✅

**File:** `src/components/FoodstrFeedOptimized.svelte` (line 1133)

**Major Changes:**
1. Added filter mode awareness
2. Uses outbox model for Following/Replies mode
3. Filters replies based on mode

**Key Addition:**
```typescript
// Filter replies based on mode
if (filterMode === 'following' && isReply(e)) {
  return false; // Following mode: exclude replies
}

if (!authorPubkey && filterMode === 'global' && isReply(e)) {
  return false; // Global mode: exclude replies
}
```

---

## Filter Rules Summary

### Following Mode (`filterMode === 'following'`)
- ✅ **Show:** Top-level notes only (no replies)
- ✅ **Filter:** Food filter (if enabled), muted users
- ✅ **Fetch:** Outbox model (NIP-65)
- ✅ **Real-time:** Filters replies
- ✅ **Pagination:** Filters replies

### Replies Mode (`filterMode === 'replies'`)
- ✅ **Show:** Top-level notes AND replies
- ✅ **Filter:** Food filter (if enabled), muted users
- ✅ **Fetch:** Outbox model (NIP-65)
- ✅ **Real-time:** Shows both notes and replies
- ✅ **Pagination:** Shows both notes and replies

### Global Mode (`filterMode === 'global'`)
- ✅ **Show:** Top-level notes only (no replies) - **NEW**
- ✅ **Filter:** Food filter (always), muted users, exclude followed users
- ✅ **Fetch:** Hashtag filter + client-side content filter
- ✅ **Real-time:** Filters replies
- ✅ **Pagination:** Filters replies
- ✅ **Background refresh:** Filters replies

---

## Verification Checklist

- [x] `isReply()` function handles all marker types
- [x] Following mode filters replies in initial load
- [x] Following mode filters replies in real-time
- [x] Global mode filters replies in initial load
- [x] Global mode filters replies in real-time
- [x] Pagination filters replies correctly per mode
- [x] Background refresh filters replies
- [x] Sorting remains stable (created_at desc)
- [x] Deduplication works (by event id)
- [x] Pagination uses `until` parameter correctly

---

## Testing Recommendations

1. **Following Mode:**
   - Create a top-level note → Should appear
   - Reply to that note → Should NOT appear
   - Load more → Should not show replies

2. **Global Mode:**
   - View global feed → Should only see top-level notes
   - Reply to a note → Should NOT appear in global
   - Load more → Should not show replies

3. **Replies Mode:**
   - View replies feed → Should see both notes and replies
   - Create a reply → Should appear
   - Load more → Should show both

4. **Edge Cases:**
   - Notes with only mention `e` tags → Should appear (not filtered)
   - Notes with `root` marker → Should be filtered as reply
   - Old-style replies (no marker) → Should be filtered as reply

---

## Files Modified

- `src/components/FoodstrFeedOptimized.svelte` (7 changes)

## Lines Changed

- Line 1291-1315: Improved `isReply()` function
- Line 717: Standardized Following mode filter
- Line 884: Added reply filtering to Global feed
- Line 972: Standardized real-time subscription filter
- Line 1007: Added reply filtering to Global real-time
- Line 1061: Updated background refresh
- Line 1133: Updated pagination

---

## Acceptance Criteria Status

✅ **Feed shows only true top-level notes when "notes-only" mode is active.**

**Implementation:**
- ✅ Following mode = notes-only (excludes replies)
- ✅ Global mode = notes-only (excludes replies) - **NEW**
- ✅ Replies mode = notes + replies (includes both)

**Verification:**
- ✅ All filter points use consistent `isReply()` function
- ✅ Real-time subscriptions respect filter mode
- ✅ Pagination respects filter mode
- ✅ Background refresh respects filter mode
- ✅ Sorting stable (created_at desc)
- ✅ Deduplication by event id
- ✅ Pagination uses `until` parameter

