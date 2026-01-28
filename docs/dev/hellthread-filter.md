# Hellthread Filter

## Overview

A "hellthread" is a Nostr event that tags an excessive number of users via `p` (pubkey) tags. These are often used for spam, mass-tagging attacks, or low-quality engagement farming. They create noise in users' notifications and feeds.

The hellthread filter prevents these events from appearing in both the main feed and notifications.

## Configuration

The filter threshold is configurable in **Settings > Hellthread Threshold**:
- Default: **25** mentions (events with 25+ `p` tags are hidden)
- Set to **0** to disable the filter entirely
- The setting is stored in localStorage (`zapcooking_hellthread_threshold`)

## Implementation

The hellthread filter is implemented in three locations:

### 1. Feed Filter (`src/components/FoodstrFeedOptimized.svelte`)

The `isHellthread()` function checks if an event has `p` tags exceeding the threshold:

```typescript
function isHellthread(event: NDKEvent, threshold: number): boolean {
  if (threshold === 0) return false; // Disabled
  if (!event.tags || !Array.isArray(event.tags)) return false;
  const mentionCount = event.tags.filter((tag) => 
    Array.isArray(tag) && tag[0] === 'p'
  ).length;
  return mentionCount >= threshold;
}
```

This is called in `shouldIncludeEvent()` for both:
- Regular events (fetched via hashtag subscriptions)
- NIP-50 search results (events marked with `_fromNip50Search`)

### 2. Notification Store (`src/lib/notificationStore.ts`)

Incoming notification events are checked before being added to the store:

```typescript
// Filter out hellthreads (events with excessive p tags)
if (isHellthread(event)) {
  console.log('[Notifications] Ignoring hellthread event');
  return;
}
```

This prevents hellthread events from generating notifications in real-time.

### 3. Notifications Page (`src/routes/notifications/+page.svelte`)

For notifications that reference other events (reactions, zaps, reposts), the referenced event is fetched to display context. During this fetch, we check if the referenced event is a hellthread:

```typescript
if (ev && isHellthread(ev)) {
  // Mark as hellthread so we can filter out notifications referencing it
  hellthreadEventIds = new Set([...hellthreadEventIds, id]);
  contextById = { ...contextById, [id]: null };
}
```

Notifications referencing hellthread events are then filtered from display:

```typescript
// Filter out notifications referencing hellthread events
const refId = getReferencedEventId(n);
if (refId && hellthreadEventIds.has(refId)) {
  return false;
}
```

## Why Three Locations?

1. **Feed**: Direct filtering of hellthread posts appearing in the feed
2. **Notification Store**: Prevents hellthread posts you're tagged in from generating notifications
3. **Notifications Page**: Filters out reactions/zaps/reposts that reference hellthread events (e.g., someone reacting to a hellthread you were tagged in)

The third case is important because:
- A reaction event (kind 7) typically only has 1-2 `p` tags (the reactor and you)
- The reaction itself isn't a hellthread, but it references one
- We need to fetch the referenced event to determine if it's a hellthread
- This happens during the context preview fetch on the notifications page

## Example

Consider this scenario:
1. Spammer creates a hellthread tagging 2000+ users including you
2. Another user reacts to the hellthread
3. Without the filter:
   - The hellthread appears in your feed (blocked by feed filter)
   - The hellthread generates a "mention" notification (blocked by notification store)
   - The reaction generates a "reaction" notification showing "Someone reacted to your post" (blocked by notifications page filter)

All three paths are now protected.

## Settings Store (`src/lib/hellthreadFilterSettings.ts`)

The threshold is managed by a Svelte store that:
- Loads from localStorage on initialization
- Provides `setThreshold()` to update the value
- Provides `reset()` to restore the default (25)
- Persists changes to localStorage automatically
