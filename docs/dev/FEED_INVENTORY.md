# Community Feed Inventory & Baseline

**Date:** 2025-01-04  
**Task:** MAP Task 1 — Inventory & Baseline  
**Goal:** Identify where the community feed is built and how NIP-01 events flow through the app.

---

## 📁 File Map

### Core Feed Components

| File | Purpose | Key Functions |
|------|---------|---------------|
| `src/routes/community/+page.svelte` | Main community feed page | Tab switching, post composer, feed rendering |
| `src/components/FoodstrFeedOptimized.svelte` | Feed component (2,178 lines) | Event fetching, filtering, caching, real-time subscriptions |
| `src/components/Feed.svelte` | Recipe feed display | Grid layout for recipe cards |
| `src/lib/nostr.ts` | NDK initialization & relay config | NDK setup, connection management |
| `src/lib/followOutbox.ts` | Outbox model implementation | Following feed optimization via NIP-65 |
| `src/lib/compressedCache.ts` | Feed caching with compression | Gzip compression, localStorage/IndexedDB |
| `src/lib/feedCache.ts` | Legacy feed cache service | Background refresh, cache invalidation |
| `src/lib/connectionManager.ts` | Relay health & circuit breaker | Connection monitoring, failure handling |

### Supporting Files

| File | Purpose |
|------|---------|
| `src/lib/consts.ts` | Relay URLs, food hashtags, tag definitions |
| `src/lib/replyContext.ts` | Reply context prefetching |
| `src/lib/imageOptimizer.ts` | Image URL optimization |
| `src/components/NoteContent.svelte` | Note content rendering |
| `src/components/FeedComments.svelte` | Comment thread display |

---

## 🔌 Relays Used

### Standard Relays (from `consts.ts`)
```typescript
[
  'wss://relay.damus.io',      // Fastest
  'wss://kitchen.zap.cooking', // Your relay
  'wss://nos.lol',
  'wss://purplepag.es',
  'wss://relay.primal.net',
  'wss://nostr.wine'
]
```

### Relay Pools (from `FoodstrFeedOptimized.svelte`)
```typescript
RELAY_POOLS = {
  recipes: ['wss://kitchen.zap.cooking'],      // Curated recipe content
  fallback: ['wss://nos.lol', 'wss://relay.damus.io'],  // Fast general relays
  discovery: ['wss://nostr.wine', 'wss://relay.primal.net', 'wss://purplepag.es'],  // Additional relays
  profiles: ['wss://purplepag.es']             // Profile metadata
}
```

### Outbox Relays (NDK config)
```typescript
outboxRelayUrls: ["wss://purplepag.es", "wss://kitchen.zap.cooking"]
```

### Blocked Relays (from `followOutbox.ts`)
- `wss://relay.nostr.band`
- `wss://nostr.wine`
- `wss://filter.nostr.wine`
- `wss://relay.nostr.bg`
- `wss://nostrelites.org`
- `wss://nostr.fmt.wiz.biz`
- `wss://relayable.org`
- `wss://lightningrelay.com`
- `wss://nostr.mutinywallet.com`
- `wss://relay.nostrplebs.com`
- `wss://relay.0xchat.com`
- `wss://relay.nos.social`
- `wss://relay.momostr.pink`
- `wss://offchain.pub`
- `wss://nostr-pub.wellorder.net`

---

## 🔍 Subscription Filters

### Global Feed Filter
```typescript
{
  kinds: [1],
  '#t': FOOD_HASHTAGS,  // 64+ food-related hashtags
  limit: 50,
  since: sevenDaysAgo()  // 7 days back
}
```

### Following Feed Filter (via Outbox Model)
```typescript
{
  kinds: [1],
  authors: [/* followed pubkeys in batches of 100 */],
  since: sevenDaysAgo(),
  limit: 100
}
```

### Replies Feed Filter
```typescript
{
  kinds: [1],
  authors: [/* followed pubkeys */],
  since: sevenDaysAgo(),
  limit: 100
}
// Note: Client-side filtering includes replies (has 'e' tags)
```

### Notes Without Hashtags (Client-Side Discovery)
```typescript
{
  kinds: [1],
  limit: 300,
  since: sevenDaysAgo()
}
// Then filtered client-side for food words
```

### Real-Time Subscription Filters

**Global Mode:**
```typescript
{
  kinds: [1],
  '#t': FOOD_HASHTAGS,
  since: lastEventTime + 1
}
```

**Following/Replies Mode:**
```typescript
{
  kinds: [1],
  authors: [/* followed pubkeys in batches of 100 */],
  since: lastEventTime + 1
}
```

### Food Hashtags (64+ tags)
Key tags: `foodstr`, `cook`, `cookstr`, `zapcooking`, `cooking`, `drinkstr`, `foodies`, `carnivor`, `soup`, `soupstr`, `drink`, `eat`, `burger`, `steak`, `steakstr`, `dine`, `dinner`, `lunch`, `breakfast`, `supper`, `yum`, `snack`, `snackstr`, `dessert`, `beef`, `chicken`, `bbq`, `coffee`, `mealprep`, `meal`, `recipe`, `recipestr`, `recipes`, `food`, `foodie`, `foodporn`, `instafood`, `foodstagram`, `foodblogger`, `homecooking`, `fromscratch`, `baking`, `baker`, `pastry`, `chef`, `chefs`, `cuisine`, `gourmet`, `restaurant`, `restaurants`, `pasta`, `pizza`, `sushi`, `tacos`, `taco`, `burrito`, `sandwich`, `salad`, `soup`, `stew`, `curry`, `stirfry`, `grill`, `grilled`, `roast`, `roasted`, `fried`, `baked`, `smoked`, `fermented`, `pickled`, `preserved`, `homemade`, `vegan`, `vegetarian`, `keto`, `paleo`, `glutenfree`, `dairyfree`, `healthy`, `nutrition`, `nutritionist`, `dietitian`, `mealplan`, `mealprep`, `batchcooking`

---

## 📊 Event Handlers

### onEvent Handlers

**Location:** `FoodstrFeedOptimized.svelte` lines 971-983, 1007-1016

```typescript
// Following/Replies mode
sub.on('event', (event: NDKEvent) => {
  // For Following mode, exclude replies
  if (filterMode === 'following') {
    const isReplyEvent = event.tags.some(tag => 
      Array.isArray(tag) && tag[0] === 'e'
    );
    if (isReplyEvent) return;
  }
  
  if (shouldIncludeEvent(event)) {
    handleRealtimeEvent(event);
  }
});

// Global mode
hashtagSub.on('event', (event: NDKEvent) => {
  // Exclude posts from followed users
  if (!authorPubkey && followedPubkeysForRealtime.length > 0) {
    const authorKey = event.author?.hexpubkey || event.pubkey;
    if (authorKey && followedPubkeysForRealtime.includes(authorKey)) {
      return; // Skip - belongs in Following/Notes & Replies
    }
  }
  handleRealtimeEvent(event);
});
```

### onEOSE Handlers

**Location:** `FoodstrFeedOptimized.svelte` lines 567-573

```typescript
sub.on('eose', () => {
  if (!resolved) {
    resolved = true;
    sub.stop();
    resolve(fetchedEvents);
  }
});
```

**Note:** Real-time subscriptions use `closeOnEose: false` to keep streams open.

### Deduplication

**Location:** `FoodstrFeedOptimized.svelte` lines 210-211, 642-652

```typescript
// In-memory Set for deduplication
const seenEventIds = new Set<string>();

function dedupeAndSort(eventList: NDKEvent[]): NDKEvent[] {
  const unique: NDKEvent[] = [];
  
  for (const event of eventList) {
    if (!event.id || seenEventIds.has(event.id)) continue;
    seenEventIds.add(event.id);
    unique.push(event);
  }
  
  return unique.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
}
```

### Sorting

**Primary Sort:** By `created_at` descending (newest first)
```typescript
events.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
```

**Location:** Multiple places:
- `dedupeAndSort()` - line 651
- `processBatch()` - line 1048
- `fetchFollowingEvents()` - line 613

---

## 💾 Storage/Caching

### 1. Compressed Cache (Primary)

**File:** `src/lib/compressedCache.ts`  
**Storage:** localStorage (with gzip compression)  
**Key:** `foodstr_feed_cache`  
**TTL:** 5 minutes  
**Format:**
```typescript
{
  events: Array<{
    id, pubkey, content, created_at, tags, author
  }>,
  timestamp: number,
  lastEventTime: number
}
```

**Compression:** Gzip via CompressionStream API  
**Metrics:** Tracks hits, misses, compression ratio

### 2. NDK Dexie Cache

**File:** `src/lib/nostr.ts` line 13  
**Storage:** IndexedDB via `@nostr-dev-kit/ndk-cache-dexie`  
**Database:** `zapcooking-ndk-cache-db`  
**Purpose:** NDK's built-in event caching

### 3. Outbox Relay Config Cache

**File:** `src/lib/followOutbox.ts`  
**Storage:** localStorage  
**Key:** `outbox_relay_configs`  
**TTL:** 24 hours  
**Format:**
```typescript
{
  version: 1,
  timestamp: number,
  data: Map<pubkey, UserRelayConfig>
}
```

### 4. Follow List Cache

**File:** `src/lib/followOutbox.ts`  
**Storage:** In-memory  
**TTL:** 5 minutes  
**Format:** `FollowWithRelays[]`

### 5. Reply Context Cache

**File:** `FoodstrFeedOptimized.svelte` lines 200-207  
**Storage:** In-memory Map  
**Format:**
```typescript
Map<eventId, {
  authorName, authorPubkey, notePreview, noteId,
  loading: boolean, error?: string
}>
```

### 6. Muted Users

**File:** `FoodstrFeedOptimized.svelte` lines 399-407  
**Storage:** localStorage  
**Key:** `mutedUsers`  
**Format:** `string[]` (array of pubkeys)

---

## 📝 Event Types Supported

### Currently Supported

| Kind | Description | Usage |
|------|-------------|-------|
| **1** | Text notes | Primary feed content |
| **0** | Profile metadata | Author info, mentions |
| **3** | Contact list | Follow list, outbox model |
| **10002** | Relay list (NIP-65) | Outbox model relay hints |

### Not Currently Used in Feed

- **Kind 6** (Reposts) - Handled via reactions
- **Kind 7** (Reactions) - Displayed via `NoteReactionPills`
- **Kind 9735** (Zaps) - Displayed via `NoteTotalZaps`
- **Kind 30023** (Long-form) - Not in community feed

---

## ⚠️ Known Issues / Risks

### 1. **Food Filter False Positives/Negatives**

**Risk:** Client-side keyword filtering may miss food content or include non-food posts.

**Location:** `FoodstrFeedOptimized.svelte` lines 330-383

**Details:**
- Hard words (1 hit = include): `recipe`, `cooking`, `chef`, `kitchen`, `ingredient`, `breakfast`, `lunch`, `dinner`, `pasta`, `pizza`, `sushi`, etc.
- Soft words (2 hits = include): `food`, `meal`, `spicy`, `sweet`, `flavor`, `healthy`, `organic`, `grill`, `roast`, cuisines
- Known exclusions: "root" (standalone), "excluding food and energy" (economics phrase)

**Impact:** Some food posts may be filtered out, some non-food posts may slip through.

---

### 2. **Hashtag Spam Filter**

**Risk:** Posts with >5 hashtags are filtered out.

**Location:** `FoodstrFeedOptimized.svelte` lines 441-445

```typescript
const hashtagCount = getHashtagCount(event);
if (hashtagCount > MAX_HASHTAGS) {  // MAX_HASHTAGS = 5
  return false;
}
```

**Impact:** Legitimate posts with many tags may be excluded.

---

### 3. **Real-Time Subscription Batching**

**Risk:** Following feed subscriptions are batched in groups of 100 (Nostr relay limit).

**Location:** `FoodstrFeedOptimized.svelte` lines 959-986

**Impact:** Users with >100 follows may have delayed updates if events arrive on relays not yet queried.

---

### 4. **Cache Invalidation**

**Risk:** Cache may serve stale data if events are deleted or updated.

**Location:** `FoodstrFeedOptimized.svelte` lines 454-517

**Details:**
- Cache TTL: 5 minutes
- No invalidation on event updates/deletes
- Background refresh runs 100ms after cache load

**Impact:** Deleted posts may appear briefly, updated content may be stale.

---

### 5. **Outbox Model Relay Blocklist**

**Risk:** 15+ relays are permanently blocked, potentially missing content.

**Location:** `followOutbox.ts` lines 93-109

**Impact:** If a followed user only posts to blocked relays, their content won't appear.

---

### 6. **Global Feed Excludes Followed Users**

**Risk:** Global feed explicitly excludes posts from followed users.

**Location:** `FoodstrFeedOptimized.svelte` lines 898-904

**Impact:** If a followed user posts with food hashtags, it won't appear in Global (only in Following/Replies).

---

### 7. **Client-Side NIP-50 Search**

**Risk:** Notes without hashtags are discovered via client-side filtering of 300 recent notes.

**Location:** `FoodstrFeedOptimized.svelte` lines 587-639

**Impact:**
- Limited to 300 most recent notes
- Only works if food keywords are in content
- May miss older food posts without hashtags

---

### 8. **Reply Detection Logic**

**Risk:** Multiple heuristics for detecting replies may misclassify some notes.

**Location:** `FoodstrFeedOptimized.svelte` lines 1261-1289

**Priority Order:**
1. `e` tag with `reply` marker
2. `root` tag + other `e` tags (non-root is parent)
3. Only `root` tag (direct reply to root)
4. Any `e` tag (old style, use last one)

**Impact:** Some replies may not show parent context correctly.

---

### 9. **Subscription Cleanup**

**Risk:** Subscriptions may not be properly cleaned up on component destroy.

**Location:** `FoodstrFeedOptimized.svelte` lines 1229-1254

**Details:**
- `stopSubscriptions()` called in `cleanup()`
- `cleanup()` called in `onDestroy()`
- But subscriptions stored in `activeSubscriptions` array

**Impact:** Memory leaks if subscriptions aren't properly stopped.

---

### 10. **Timeout Handling**

**Risk:** Multiple timeout mechanisms may conflict.

**Locations:**
- `fetchFromRelays()`: 4s timeout
- `fetchNotesWithoutHashtags()`: 10s timeout
- `fetchFollowingEvents()`: 2.5s per relay, 5s global
- `SUBSCRIPTION_TIMEOUT_MS`: 4s

**Impact:** Inconsistent timeout behavior, some queries may hang.

---

## 🎯 Key Functions for Feed Subscription + Merge Logic

### Primary Entry Points

1. **`loadFoodstrFeed(useCache)`** - `FoodstrFeedOptimized.svelte:658`
   - Main feed loading function
   - Handles cache, different filter modes, event fetching

2. **`fetchFollowingEvents()`** - `followOutbox.ts:492`
   - Outbox model implementation
   - Fetches from user-specific relays via NIP-65

3. **`startRealtimeSubscription()`** - `FoodstrFeedOptimized.svelte:942`
   - Sets up real-time event streams
   - Different filters for global/following/replies modes

4. **`handleRealtimeEvent()`** - `FoodstrFeedOptimized.svelte:1021`
   - Processes incoming real-time events
   - Batches updates via debouncing

5. **`dedupeAndSort()`** - `FoodstrFeedOptimized.svelte:642`
   - Deduplication and sorting logic
   - Uses `seenEventIds` Set for tracking

6. **`shouldIncludeEvent()`** - `FoodstrFeedOptimized.svelte:409`
   - Content filtering (food words, hashtags, spam)
   - Muted user filtering

---

## 📈 Performance Characteristics

### Caching Strategy
- **Cache-first:** Loads from cache immediately, refreshes in background
- **Compression:** Gzip compression reduces storage by ~70%
- **TTL:** 5 minutes for feed cache, 30 minutes for profiles

### Fetch Strategy
- **Parallel fetching:** Multiple relay pools queried simultaneously
- **Early termination:** Stops after 300 events or 12+ relays queried
- **Timeout protection:** Per-relay and global timeouts prevent hanging

### Real-Time Updates
- **Debounced batching:** 300ms debounce for real-time events
- **Incremental updates:** New events prepended to existing feed
- **Subscription management:** Active subscriptions tracked for cleanup

---

## ✅ Acceptance Criteria Met

✅ **I can point to the exact files/functions where feed subscription + merge logic lives:**

- **Subscription:** `FoodstrFeedOptimized.svelte:942` (`startRealtimeSubscription()`)
- **Merge Logic:** `FoodstrFeedOptimized.svelte:642` (`dedupeAndSort()`)
- **Event Handlers:** `FoodstrFeedOptimized.svelte:971-1016` (onEvent handlers)
- **Filtering:** `FoodstrFeedOptimized.svelte:409` (`shouldIncludeEvent()`)
- **Caching:** `FoodstrFeedOptimized.svelte:454` (`cacheEvents()`), `compressedCache.ts`

---

## 📚 Additional Notes

### Feed Modes

1. **Global Food** (`filterMode: 'global'`)
   - Hashtag filter + client-side content filter
   - Excludes followed users
   - Shows all food-related content from network

2. **Following** (`filterMode: 'following'`)
   - Outbox model (NIP-65) for efficient fetching
   - Only top-level notes (excludes replies)
   - Optional food filter toggle

3. **Notes & Replies** (`filterMode: 'replies'`)
   - Same outbox fetch as Following
   - Includes both notes and replies
   - Optional food filter toggle

### Outbox Model Benefits

- Fetches from user-specific relays (where they actually post)
- Reduces query load on general relays
- Faster for users with many follows
- Respects NIP-65 relay hints

### Food Filtering Philosophy

- **Hashtag-first:** Posts with food hashtags are always included
- **Content analysis:** Posts without hashtags analyzed for food keywords
- **Spam protection:** Max 5 hashtags, muted users filtered
- **False positive mitigation:** Hard/soft word system reduces non-food posts

