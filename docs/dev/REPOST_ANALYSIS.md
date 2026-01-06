# Repost (Kind 6 / Kind 16) Analysis

**Date:** 2025-01-04  
**Task:** MAP Task 4 — Reposts (Kind 6 / Kind 16)  
**Goal:** Correct handling of reposts and original note resolution without duplication.

---

## 🔍 Current State Analysis

### Repost Support Status

#### Kind 6 (Repost) - ⚠️ **PARTIALLY SUPPORTED**

**What Works:**
- ✅ **Creating reposts:** `NoteRepost.svelte` component allows users to create kind 6 reposts
- ✅ **Repost format:** Creates reposts with embedded JSON in `content` field (NIP-18 compliant)
- ✅ **Repost tags:** Includes `e` tag with event ID and `p` tag with author pubkey
- ✅ **Repost counting:** `NoteRepost.svelte` subscribes to kind 6 events and counts reposts
- ✅ **Notifications:** `notificationStore.ts` handles kind 6 events for notifications

**What's Missing:**
- ❌ **Feed display:** Kind 6 reposts are **NOT displayed in the feed**
- ❌ **Feed queries:** All feed queries only fetch `kinds: [1]` - reposts are never fetched
- ❌ **Repost rendering:** No component renders repost events as feed items
- ❌ **Original event resolution:** No logic to parse embedded JSON or fetch missing originals
- ❌ **Deduplication:** No strategy to prevent showing both original and repost

#### Kind 16 (Generic Repost) - ❌ **NOT SUPPORTED**

- No code references to kind 16
- No handling in any component
- Not mentioned in documentation

---

## 📊 Current Implementation Details

### Repost Creation (`NoteRepost.svelte`)

**Location:** `src/components/NoteRepost.svelte:38-90`

**Format:**
```typescript
repostEvent.kind = 6;
repostEvent.content = JSON.stringify(event.rawEvent()); // ✅ Embedded JSON
repostEvent.tags = [
  ['e', event.id, '', 'mention'],  // ✅ e tag with event ID
  ['p', event.pubkey]               // ✅ p tag with author
];
```

**Status:** ✅ **NIP-18 compliant** - Uses embedded JSON format

### Repost Counting (`NoteRepost.svelte`)

**Location:** `src/components/NoteRepost.svelte:17-36`

**Implementation:**
```typescript
const sub = $ndk.subscribe({
  kinds: [6],
  '#e': [event.id]  // ✅ Queries reposts of specific event
});
```

**Status:** ✅ Works correctly for counting reposts of a specific note

### Feed Queries

**Location:** `src/components/FoodstrFeedOptimized.svelte`

**All queries only fetch kind 1:**
- Line 697: `kinds: [1]` (Following mode)
- Line 771: `kinds: [1]` (Replies mode)
- Line 831: `kinds: [1]` (Global mode)
- Line 990: `kinds: [1]` (Real-time subscription)
- Line 1155: `kinds: [1]` (Pagination)

**Status:** ❌ **Reposts are never fetched or displayed**

### Feed Rendering

**Location:** `src/components/FoodstrFeedOptimized.svelte:1777-2236`

**Implementation:**
```svelte
{#each events as event (event.id)}
  <article>
    <!-- Only renders kind 1 events -->
    {#if isReply(event)}
      <!-- Reply handling -->
    {/if}
    <!-- Note content -->
  </article>
{/each}
```

**Status:** ❌ **No handling for kind 6 events**

---

## 🐛 Issues Identified

### Issue 1: Reposts Not Fetched in Feed

**Severity:** High  
**Impact:** Users never see reposts in their feed, even from people they follow

**Root Cause:** All feed queries filter for `kinds: [1]` only

**Evidence:**
- Following mode: `kinds: [1]` (line 697)
- Replies mode: `kinds: [1]` (line 771)
- Global mode: `kinds: [1]` (line 831)
- Real-time: `kinds: [1]` (line 990)
- Pagination: `kinds: [1]` (line 1155)

### Issue 2: No Repost Rendering Component

**Severity:** High  
**Impact:** Even if reposts were fetched, there's no component to display them

**Root Cause:** Feed rendering loop only handles kind 1 events

**Evidence:**
- Feed loop (line 1777) has no `event.kind === 6` check
- No component similar to `NoteRepost` that renders repost feed items

### Issue 3: No Original Event Resolution

**Severity:** Medium  
**Impact:** If reposts were displayed, missing originals wouldn't be fetched

**Root Cause:** No logic to:
- Parse embedded JSON from repost `content`
- Extract event ID from `e` tag as fallback
- Fetch missing original events from relays

**Current Format:**
- Reposts use embedded JSON: `content = JSON.stringify(event.rawEvent())`
- Also includes `e` tag: `['e', event.id, '', 'mention']`

### Issue 4: No Deduplication Strategy

**Severity:** Medium  
**Impact:** If reposts were displayed, could show both original and repost back-to-back

**Root Cause:** No logic to:
- Track which events have been reposted
- Prevent showing original if repost is shown (or vice versa)
- Handle "show reposts" vs "show originals" preference

### Issue 5: Kind 16 Not Supported

**Severity:** Low  
**Impact:** Generic reposts (kind 16) are not handled

**Root Cause:** No code references to kind 16

---

## 📋 NIP-18 Repost Specification

### Kind 6 Format

**Content:** The `content` field MUST be the JSON-encoded original event:
```json
{
  "id": "...",
  "pubkey": "...",
  "created_at": 1234567890,
  "kind": 1,
  "tags": [...],
  "content": "...",
  "sig": "..."
}
```

**Tags:**
- `e` tag: Event ID of the reposted event (optional but recommended)
- `p` tag: Pubkey of the reposted event's author (optional but recommended)

### Kind 16 Format (Generic Repost)

**Content:** Similar to kind 6, but can reference any event kind

**Status:** Not widely used, but some clients support it

---

## ✅ Proposed Solution

### 1. Repost Parsing Function

**Location:** New utility function or in `FoodstrFeedOptimized.svelte`

```typescript
/**
 * Parses a kind 6 repost event to extract the original event
 * 
 * Strategy:
 * 1. Try to parse embedded JSON from content field (NIP-18)
 * 2. Fall back to e tag if JSON parsing fails
 * 3. Return null if neither works
 */
function parseRepost(repostEvent: NDKEvent): {
  originalEvent: NDKEvent | null;
  originalEventId: string | null;
  parseMethod: 'embedded' | 'etag' | null;
} {
  // Method 1: Parse embedded JSON (NIP-18 standard)
  if (repostEvent.content) {
    try {
      const originalJson = JSON.parse(repostEvent.content);
      if (originalJson.id && originalJson.kind === 1) {
        const originalEvent = new NDKEvent($ndk, originalJson);
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
```

### 2. Original Event Fetcher

**Location:** New utility function or in `FoodstrFeedOptimized.svelte`

```typescript
/**
 * Fetches the original event referenced by a repost
 * Uses caching to avoid duplicate fetches
 */
const originalEventCache = new Map<string, NDKEvent | null>();

async function fetchOriginalEvent(eventId: string): Promise<NDKEvent | null> {
  // Check cache first
  if (originalEventCache.has(eventId)) {
    return originalEventCache.get(eventId) || null;
  }
  
  try {
    const event = await $ndk.fetchEvent({
      ids: [eventId],
      kinds: [1]
    });
    
    originalEventCache.set(eventId, event || null);
    return event;
  } catch (e) {
    console.error('[Repost] Failed to fetch original event:', eventId, e);
    originalEventCache.set(eventId, null);
    return null;
  }
}
```

### 3. Repost Rendering Component

**Location:** New component `RepostFeedItem.svelte` or add to `FoodstrFeedOptimized.svelte`

```svelte
<!-- RepostFeedItem.svelte -->
<script lang="ts">
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import CustomAvatar from './CustomAvatar.svelte';
  import NoteContent from './NoteContent.svelte';
  import { nip19 } from 'nostr-tools';
  
  export let repostEvent: NDKEvent;
  export let originalEvent: NDKEvent | null = null;
  export let loading = false;
  
  const reposterPubkey = repostEvent.pubkey;
  const reposterName = repostEvent.author?.profile?.name || 
    nip19.npubEncode(reposterPubkey).substring(0, 12) + '...';
</script>

<article class="border-b py-4" style="border-color: var(--color-input-border)">
  <!-- Repost header -->
  <div class="flex items-center gap-2 px-2 mb-2 text-sm text-caption">
    <ArrowsClockwise size={16} />
    <a href="/user/{nip19.npubEncode(reposterPubkey)}" class="hover:underline">
      {reposterName} reposted
    </a>
  </div>
  
  <!-- Original note (wrapped) -->
  {#if loading}
    <div class="pl-4 border-l-2" style="border-color: var(--color-input-border)">
      <div class="animate-pulse">Loading...</div>
    </div>
  {:else if originalEvent}
    <div class="pl-4 border-l-2" style="border-color: var(--color-input-border)">
      <NoteFeedItem event={originalEvent} hideRepostButton={true} />
    </div>
  {:else}
    <div class="pl-4 border-l-2 text-caption" style="border-color: var(--color-input-border)">
      Original note not found
    </div>
  {/if}
</article>
```

### 4. Feed Query Updates

**Location:** `src/components/FoodstrFeedOptimized.svelte`

**Add kind 6 to all feed queries:**

```typescript
// Following mode
const result = await fetchFollowingEvents($ndk, $userPublickey, {
  since,
  kinds: [1, 6], // ✅ Add kind 6
  limit: 100,
  timeoutMs: 8000
});

// Replies mode
const result = await fetchFollowingEvents($ndk, $userPublickey, {
  since,
  kinds: [1, 6], // ✅ Add kind 6
  limit: 100,
  timeoutMs: 8000
});

// Global mode - hashtag filter
const filter: any = {
  kinds: [1, 6], // ✅ Add kind 6
  '#t': FOOD_HASHTAGS,
  since
};

// Real-time subscription
const filter: any = {
  kinds: [1, 6], // ✅ Add kind 6
  authors: followedPubkeysForRealtime
};

// Pagination
const filter: any = {
  kinds: [1, 6], // ✅ Add kind 6
  '#t': FOOD_HASHTAGS,
  until: oldestEvent.created_at - 1,
  limit: 20
};
```

### 5. Feed Rendering Updates

**Location:** `src/components/FoodstrFeedOptimized.svelte:1777`

**Add repost handling to feed loop:**

```svelte
{#each events as event (event.id)}
  {#if event.kind === 6}
    <!-- Render repost -->
    {@const parsed = parseRepost(event)}
    {#if parsed.originalEvent}
      <RepostFeedItem repostEvent={event} originalEvent={parsed.originalEvent} />
    {:else if parsed.originalEventId}
      {@const original = await fetchOriginalEvent(parsed.originalEventId)}
      <RepostFeedItem repostEvent={event} originalEvent={original} loading={!original} />
    {:else}
      <!-- Invalid repost - skip or show error -->
    {/if}
  {:else if event.kind === 1}
    <!-- Existing note rendering -->
    <article>...</article>
  {/if}
{/each}
```

### 6. Deduplication Strategy

**Option A: Show Reposts, Hide Originals (Recommended)**

```typescript
// Track which events have been reposted
const repostedEventIds = new Set<string>();

// When processing reposts, mark originals as reposted
reposts.forEach(repost => {
  const parsed = parseRepost(repost);
  if (parsed.originalEventId) {
    repostedEventIds.add(parsed.originalEventId);
  }
});

// Filter out originals that have been reposted
const filteredEvents = allEvents.filter(event => {
  if (event.kind === 1 && repostedEventIds.has(event.id)) {
    return false; // Hide original, show repost instead
  }
  return true;
});
```

**Option B: Show Originals, Hide Reposts**

```typescript
// Filter out reposts if original is already shown
const originalEventIds = new Set(
  events.filter(e => e.kind === 1).map(e => e.id)
);

const filteredEvents = allEvents.filter(event => {
  if (event.kind === 6) {
    const parsed = parseRepost(event);
    if (parsed.originalEventId && originalEventIds.has(parsed.originalEventId)) {
      return false; // Hide repost, original already shown
    }
  }
  return true;
});
```

**Option C: Show Both (Current Behavior for Other Events)**

```typescript
// No filtering - show both original and repost
// User can see who reposted what
```

**Recommendation:** **Option A** - Show reposts, hide originals. This is the most common UX pattern (similar to Twitter/X).

### 7. Caching Strategy

**Location:** New utility or in `FoodstrFeedOptimized.svelte`

```typescript
/**
 * Cache for original events referenced by reposts
 * Prevents duplicate fetches when multiple reposts reference same original
 */
const originalEventCache = new Map<string, {
  event: NDKEvent | null;
  fetchedAt: number;
}>();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getOriginalEvent(eventId: string): Promise<NDKEvent | null> {
  const cached = originalEventCache.get(eventId);
  const now = Date.now();
  
  // Return cached if still valid
  if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) {
    return cached.event;
  }
  
  // Fetch and cache
  try {
    const event = await $ndk.fetchEvent({
      ids: [eventId],
      kinds: [1]
    });
    
    originalEventCache.set(eventId, {
      event: event || null,
      fetchedAt: now
    });
    
    return event;
  } catch (e) {
    originalEventCache.set(eventId, {
      event: null,
      fetchedAt: now
    });
    return null;
  }
}

// Clear stale cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, cached] of originalEventCache.entries()) {
    if ((now - cached.fetchedAt) >= CACHE_TTL_MS) {
      originalEventCache.delete(id);
    }
  }
}, 60000); // Check every minute
```

---

## 📝 Implementation Plan

### Phase 1: Core Repost Parsing
1. ✅ Create `parseRepost()` function
2. ✅ Create `fetchOriginalEvent()` function with caching
3. ✅ Add original event cache

### Phase 2: Feed Integration
1. ✅ Update feed queries to include `kinds: [1, 6]`
2. ✅ Add repost detection in feed processing
3. ✅ Create `RepostFeedItem.svelte` component
4. ✅ Update feed rendering loop

### Phase 3: Deduplication
1. ✅ Implement deduplication strategy (Option A recommended)
2. ✅ Add user preference for repost behavior (optional)

### Phase 4: Testing & Edge Cases
1. ✅ Handle missing original events gracefully
2. ✅ Handle invalid repost format
3. ✅ Handle reposts of reposts (nested)
4. ✅ Test with real repost events

---

## 🎯 Acceptance Criteria

✅ **Reposts render reliably and don't cause duplicate or missing originals.**

**Verification:**
- ✅ Kind 6 reposts are fetched in all feed modes
- ✅ Reposts parse correctly (embedded JSON and e tag fallback)
- ✅ Missing originals are fetched from relays
- ✅ Original events are cached to prevent duplicate fetches
- ✅ Deduplication prevents showing both original and repost
- ✅ Reposts render with proper wrapper showing reposter
- ✅ Original note renders correctly within repost wrapper

---

## 📊 Files to Modify

1. `src/components/FoodstrFeedOptimized.svelte`
   - Add kind 6 to all queries
   - Add repost parsing logic
   - Add original event fetching
   - Add repost rendering
   - Add deduplication logic

2. `src/components/RepostFeedItem.svelte` (NEW)
   - Component to render repost feed items

3. `src/lib/repostUtils.ts` (NEW - Optional)
   - Utility functions for repost parsing
   - Original event fetching
   - Caching logic

---

## 🔮 Future Enhancements

1. **Kind 16 Support:** Add support for generic reposts (kind 16)
2. **Repost Preferences:** User setting to control repost behavior
3. **Repost Analytics:** Track repost counts and trends
4. **Nested Reposts:** Handle reposts of reposts (show original, not intermediate)
5. **Repost Threading:** Show repost chains

