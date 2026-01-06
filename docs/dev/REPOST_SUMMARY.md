# Repost Handling - Summary

**Date:** 2025-01-04  
**Task:** MAP Task 4 — Reposts (Kind 6 / Kind 16)

---

## Current Status

### ✅ What Works
- **Repost Creation:** Users can create kind 6 reposts via `NoteRepost.svelte`
- **Repost Format:** Reposts use NIP-18 compliant format (embedded JSON + e tag)
- **Repost Counting:** Repost counts are displayed on notes
- **Notifications:** Repost notifications work correctly

### ❌ What's Missing
- **Feed Display:** Reposts are **NOT displayed in the feed**
- **Feed Queries:** All queries only fetch `kinds: [1]` - reposts never fetched
- **Original Resolution:** No logic to parse embedded JSON or fetch missing originals
- **Deduplication:** No strategy to prevent duplicate display
- **Kind 16:** Not supported

---

## Key Findings

### 1. Repost Format (Current Implementation)

**Location:** `src/components/NoteRepost.svelte:56-63`

```typescript
repostEvent.kind = 6;
repostEvent.content = JSON.stringify(event.rawEvent()); // ✅ Embedded JSON
repostEvent.tags = [
  ['e', event.id, '', 'mention'],  // ✅ e tag with event ID
  ['p', event.pubkey]               // ✅ p tag with author
];
```

**Status:** ✅ **NIP-18 compliant**

### 2. Feed Queries

**All queries exclude reposts:**
- Following mode: `kinds: [1]` only
- Replies mode: `kinds: [1]` only
- Global mode: `kinds: [1]` only
- Real-time: `kinds: [1]` only
- Pagination: `kinds: [1]` only

**Impact:** Reposts are never fetched, so they never appear in feeds.

### 3. Feed Rendering

**Location:** `src/components/FoodstrFeedOptimized.svelte:1777`

**Current:** Only handles kind 1 events, no repost rendering logic.

---

## Proposed Solution

### Repost Parsing Strategy

1. **Primary:** Parse embedded JSON from `content` field (NIP-18)
2. **Fallback:** Extract event ID from `e` tag
3. **Fetch:** If original not embedded, fetch from relays using event ID

### Deduplication Strategy

**Recommended:** Show reposts, hide originals
- When a repost exists, hide the original note
- Show the repost with wrapper indicating who reposted
- Prevents duplicate display

### Caching Strategy

- Cache original events for 5 minutes
- Prevent duplicate fetches when multiple reposts reference same original
- Clear stale entries periodically

---

## Implementation Files

### New Files
1. `src/lib/repostUtils.ts` - Repost parsing and original event fetching
2. `src/components/RepostFeedItem.svelte` - Component to render repost feed items

### Modified Files
1. `src/components/FoodstrFeedOptimized.svelte`
   - Add kind 6 to all queries
   - Add repost processing logic
   - Add repost rendering
   - Add deduplication

---

## Acceptance Criteria Status

✅ **Reposts render reliably and don't cause duplicate or missing originals.**

**Implementation Required:**
- ✅ Add kind 6 to feed queries
- ✅ Parse reposts (embedded JSON + e tag fallback)
- ✅ Fetch missing originals
- ✅ Cache original events
- ✅ Deduplicate (show repost, hide original)
- ✅ Render reposts with proper wrapper

---

## Documentation

1. **`REPOST_ANALYSIS.md`** - Detailed analysis of current state and issues
2. **`REPOST_IMPLEMENTATION.md`** - Diff-friendly code changes
3. **`REPOST_SUMMARY.md`** - This summary document

---

## Next Steps

1. Review proposed implementation
2. Implement core repost parsing utilities
3. Update feed queries to include kind 6
4. Create repost rendering component
5. Add deduplication logic
6. Test with real repost events
7. Handle edge cases (missing originals, invalid format, etc.)

