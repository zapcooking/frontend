# Top Zappers Display Feature

**Date:** January 19, 2026  
**Status:** ✅ Implemented

## Overview

Added a visual display of the top zappers on notes and recipes, showing profile pictures and total amounts zapped. This provides social proof and recognition for supporters.

## Features

### Visual Display
- Shows top 3 zappers by default
- Profile pictures displayed as overlapping circles
- Total sats amount displayed with lightning bolt emoji
- Fallback to initials for users without profile pictures
- "+X more" indicator when there are additional zappers

### Data Tracking
- Tracks individual zapper amounts (aggregated per pubkey)
- Maintains sorted list by amount (descending)
- Extracts actual sender from zap request (not zapper service)
- Keeps top 10 zappers in memory for efficiency
- Cached in localStorage along with other engagement data

## Implementation

### Type Definitions

Added `Zapper` type to `engagementCache.ts`:

```typescript
export interface Zapper {
  pubkey: string;
  amount: number; // in sats
  timestamp: number;
}

// Added to EngagementData
zaps: {
  totalAmount: number;
  count: number;
  userZapped: boolean;
  topZappers: Zapper[]; // Top zappers sorted by amount
}
```

### Zap Processing Logic

Updated `processZap()` function in `engagementCache.ts`:

```typescript
function processZap(data: EngagementData, event: NDKEvent, userPublickey: string): void {
  // ... extract bolt11 amount ...
  
  // Extract actual sender from zap request description
  let zapperPubkey = event.pubkey; // fallback
  try {
    const descTag = event.tags.find(t => t[0] === 'description')?.[1];
    if (descTag) {
      const zapRequest = JSON.parse(descTag);
      if (zapRequest.pubkey) {
        zapperPubkey = zapRequest.pubkey; // The actual sender
      }
    }
  } catch {
    // Failed to parse, use event pubkey
  }
  
  // Add or update zapper in the list
  const existingZapper = data.zaps.topZappers.find(z => z.pubkey === zapperPubkey);
  if (existingZapper) {
    existingZapper.amount += amountSats;
  } else {
    data.zaps.topZappers.push({ pubkey, amount, timestamp });
  }
  
  // Sort by amount descending, keep top 10
  data.zaps.topZappers.sort((a, b) => b.amount - a.amount);
  if (data.zaps.topZappers.length > 10) {
    data.zaps.topZappers = data.zaps.topZappers.slice(0, 10);
  }
}
```

### UI Component

Created `TopZappers.svelte` component:

**Features:**
- Fetches profile info for each zapper
- Displays overlapping profile pictures
- Shows total sats from displayed zappers
- Responsive design with proper z-indexing
- Loading lazy for profile images
- Fallback initials display

**Props:**
- `topZappers: Zapper[]` - Array of zapper data
- `maxDisplay: number` - Number to display (default: 3)

### Integration

Added to `ReactionPills.svelte`:

```svelte
<!-- Top Zappers - shown when there are zaps -->
{#if $store.zaps.topZappers.length > 0}
  <TopZappers topZappers={$store.zaps.topZappers} maxDisplay={3} />
{/if}
```

### Utility Functions

Added `formatSats()` to `utils.ts`:

```typescript
export function formatSats(sats: number): string {
  return sats.toLocaleString('en-US'); // e.g., "1,000"
}
```

## Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────┐
│              Zap Receipt (kind 9735)                     │
│  - bolt11: invoice with amount in millisats             │
│  - description: JSON zap request with sender pubkey     │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                   processZap()                           │
│  1. Decode bolt11 for amount (msats → sats)             │
│  2. Parse description for actual sender pubkey          │
│  3. Add/update zapper in topZappers array               │
│  4. Sort by amount (descending)                          │
│  5. Keep top 10 for efficiency                           │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│              EngagementCache Store                       │
│  zaps: {                                                 │
│    totalAmount: number,                                  │
│    count: number,                                        │
│    userZapped: boolean,                                  │
│    topZappers: [                                         │
│      { pubkey, amount, timestamp },                      │
│      ...                                                 │
│    ]                                                     │
│  }                                                       │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│              ReactionPills.svelte                        │
│  - Shows emoji reactions                                 │
│  - Shows TopZappers component                            │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│               TopZappers.svelte                          │
│  1. Take top N zappers (default 3)                       │
│  2. Fetch profile for each (NDK)                         │
│  3. Display overlapping profile pictures                 │
│  4. Show total sats amount                               │
│  5. Show "+X more" if applicable                         │
└─────────────────────────────────────────────────────────┘
```

### Component Hierarchy

```
FoodstrFeedOptimized.svelte
  └─> NoteReactionPills.svelte
        └─> ReactionPills.svelte
              ├─> (Emoji pills)
              └─> TopZappers.svelte ← NEW!

Recipe.svelte
  └─> RecipeReactionPills.svelte
        └─> ReactionPills.svelte
              ├─> (Emoji pills)
              └─> TopZappers.svelte ← NEW!
```

## Technical Details

### Zap Request Structure

Zap receipts (kind 9735) contain:
- `bolt11` tag: Lightning invoice with amount in millisats
- `description` tag: JSON string containing the original zap request (kind 9734)
  - The zap request contains the actual sender's pubkey
  - Without parsing description, we'd only see the zapper service's pubkey

### Amount Conversion

```typescript
const amountMillisats = Number(amountSection.value);
const amountSats = Math.floor(amountMillisats / 1000);
```

### Aggregation Logic

Multiple zaps from the same user are aggregated:
```typescript
if (existingZapper) {
  existingZapper.amount += amountSats; // Aggregate
  existingZapper.timestamp = Math.max(existing, new); // Keep latest
} else {
  topZappers.push({ pubkey, amount, timestamp }); // New zapper
}
```

### Performance Optimizations

1. **Top 10 limit**: Only keep top 10 zappers in memory
2. **Lazy loading**: Profile images use `loading="lazy"`
3. **Caching**: Top zappers cached in localStorage
4. **Sorted once**: Sorted after each zap, not on render

## UI Design

### Overlapping Avatars

Profile pictures overlap slightly (negative margin):
```svelte
<div class="flex -space-x-2">
  {#each displayZappers as zapper, i}
    <div style="z-index: {length - i}">
      <!-- Avatar -->
    </div>
  {/each}
</div>
```

### Z-index Stacking

First zapper has highest z-index (appears on top):
- Zapper 1: z-index: 3
- Zapper 2: z-index: 2
- Zapper 3: z-index: 1

### Fallback Initials

When no profile picture exists:
```svelte
<div class="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-orange-600">
  {getInitials(displayName)}
</div>
```

### Tooltip Information

Each avatar has a title tooltip:
```
"Alice zapped 10,000 sats"
```

## Files Modified

### Core Logic
1. **`src/lib/engagementCache.ts`**
   - Added `Zapper` type
   - Updated `EngagementData` interface
   - Updated `CachedEngagement` interface
   - Enhanced `processZap()` to track individual zappers
   - Updated cache save/load logic

2. **`src/lib/utils.ts`**
   - Added `formatSats()` utility function

### UI Components
3. **`src/components/TopZappers.svelte`** ✨ NEW
   - Main component for displaying top zappers
   - Fetches profiles, handles fallbacks, overlapping avatars

4. **`src/components/Reactions/ReactionPills.svelte`**
   - Added TopZappers component
   - Conditional display when zaps exist

## Usage

### Basic Usage

The feature works automatically - no configuration needed:

```svelte
<ReactionPills {event} targetType="note" />
```

### Custom Display Count

To show more or fewer zappers:

```svelte
<TopZappers topZappers={zappers} maxDisplay={5} />
```

## Testing Recommendations

### Manual Testing

1. **Find notes with zaps:**
   - Look for popular notes with multiple zappers
   - Verify top 3 zappers are shown correctly

2. **Test aggregation:**
   - Find a note where one user zapped multiple times
   - Verify amounts are aggregated correctly

3. **Test profile loading:**
   - Check profile pictures load correctly
   - Verify fallback initials work for users without profiles

4. **Test edge cases:**
   - Notes with 1-2 zappers (should show all)
   - Notes with 10+ zappers (should show top 3 + "+X more")
   - Notes with no zaps (component should not display)

### Automated Testing (Future)

Consider adding tests for:
- Zap amount aggregation logic
- Sorting by amount (descending)
- Top N selection
- Profile fetching and fallbacks

## Future Enhancements

### Potential Improvements

1. **Click to view all zappers:**
   - Modal showing full list of zappers
   - Sortable by amount/time
   - Include zap messages if present

2. **Animation:**
   - Slide in animation when new zap arrives
   - Pulse effect on avatar

3. **Leaderboard badge:**
   - Crown icon for top zapper
   - Different sized avatars (1st larger than 2nd/3rd)

4. **Real-time updates:**
   - Show new zaps arriving in real-time
   - Smooth transition when zapper position changes

5. **Zap messages:**
   - Show zap comments/messages in tooltip
   - "Alice: Great recipe! ⚡10,000 sats"

## Standards Compliance

### Nostr NIPs

- **NIP-57 (Lightning Zaps):** Correctly parses zap receipts and requests
- **NIP-01 (Basic Protocol):** Standard event handling
- **Profile fetching:** Uses NDK's profile loading

### Best Practices

✅ Graceful fallbacks (initials when no profile picture)  
✅ Performance optimization (top 10 limit, lazy loading)  
✅ Caching for better UX  
✅ Proper error handling  
✅ Accessible tooltips  
✅ Responsive design

## Conclusion

The top zappers feature adds social proof and recognition to notes and recipes, encouraging more zaps by showcasing supporters. The implementation is efficient, cached, and provides a polished UX with profile pictures and amounts.

---

**Feature Implemented:** January 19, 2026  
**Status:** ✅ Ready for Testing  
**Display:** Top 3 zappers by default, expandable
