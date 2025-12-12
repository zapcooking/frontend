# Emoji Reaction System Implementation Plan

**Branch**: `feature/reaction-emojis`
**Scope**: Upgrade all 5 like button components to support multiple emoji reactions
**Timeline**: 6-10 days

## Overview

Transform zapcooking's simple heart-based like system into a full emoji reaction system similar to primal-spark, allowing users to react with any emoji. The system will:
- Show multiple emoji types separately with individual counts (e.g., 5 ❤️, 3 🔥, 2 👍)
- Provide a quick 4x2 grid of 8 common emojis
- Include a full emoji picker with search for extended selection
- Maintain backwards compatibility with existing '+' reactions (converted to ❤️)
- Work across all 5 components: NoteTotalLikes, Recipe/TotalLikes, CommentLikes, Comment, FeedComment

## Architecture

### New Components (4 total)

1. **`/src/components/Reactions/EmojiReactionPicker.svelte`**
   - Quick 4x2 grid with 8 common emojis: ❤️, 🔥, 👍, 🤙, 🫂, 😂, 🤔, 💯
   - "+" button to open full picker
   - Absolute positioning relative to trigger button
   - Highlights user's existing reactions

2. **`/src/components/Reactions/FullEmojiPicker.svelte`**
   - Uses `emoji-picker-element` web component
   - Search functionality and categories
   - Lazy-loaded to reduce bundle size
   - Styled to match zapcooking's design system

3. **`/src/components/Reactions/ReactionDisplay.svelte`**
   - Displays all reactions grouped by emoji type
   - Shows count per emoji
   - Horizontal scrollable layout
   - Click to toggle reactions (add/remove)
   - Highlights user's reactions

4. **`/src/components/Reactions/ReactionButton.svelte`**
   - Main trigger button (replaces heart icon)
   - Opens EmojiReactionPicker on click
   - Shows total count and most popular emoji
   - Manages picker positioning and state

### Shared Utilities (4 total)

1. **`/src/lib/reactionAggregator.ts`**
   - Core logic for grouping reactions by emoji
   - Prevents double-counting (one reaction per user per emoji)
   - Handles legacy '+' reactions as ❤️
   - Tracks which emojis current user has used

2. **`/src/lib/reactionCache.ts`**
   - 5-minute localStorage cache per event
   - Reduces relay load
   - Auto-cleanup of expired entries
   - Invalidation on user reaction

3. **`/src/lib/reactions/publishReaction.ts`**
   - Publishes kind 7 Nostr events with emoji content
   - Handles both #e tags (notes/comments) and #a tags (recipes)
   - Optimistic updates with error rollback

4. **`/src/lib/types/reactions.ts`**
   - TypeScript types for reaction system
   - `AggregatedReactions`, `ReactionGroup`, `TargetType`

## Implementation Steps

### Phase 1: Infrastructure (1-2 days)

1. **Install dependencies**
   ```bash
   git checkout -b feature/reaction-emojis
   pnpm add emoji-picker-element
   pnpm add -D @types/emoji-picker-element
   ```

2. **Create type definitions**
   - File: `/src/lib/types/reactions.ts`
   - Define: `ReactionGroup`, `AggregatedReactions`, `TargetType`, `QUICK_EMOJIS`

3. **Build reaction aggregator**
   - File: `/src/lib/reactionAggregator.ts`
   - Function: `aggregateReactions(events: NDKEvent[], userPubkey: string): AggregatedReactions`
   - Handle legacy '+' → '❤️' conversion
   - Prevent double-counting with Set of processed event IDs
   - Track user's reactions

4. **Build reaction cache**
   - File: `/src/lib/reactionCache.ts`
   - 5-minute TTL
   - localStorage with key `zapcooking_reactions_${eventId}`
   - Auto-cleanup on read

5. **Build publish helper**
   - File: `/src/lib/reactions/publishReaction.ts`
   - `publishReaction(ndk, event, emoji, targetType)`
   - Handle #e vs #a tags based on targetType

### Phase 2: Core Components (2-3 days)

6. **Create EmojiReactionPicker**
   - File: `/src/components/Reactions/EmojiReactionPicker.svelte`
   - 4x2 grid of QUICK_EMOJIS
   - Props: `event`, `targetType`, `onReactionSelect`, `userReactions`
   - Use `clickOutside` directive from `/src/lib/clickOutside.ts`
   - Position: absolute, below button (or above if near viewport bottom)

7. **Create FullEmojiPicker**
   - File: `/src/components/Reactions/FullEmojiPicker.svelte`
   - Wrap `emoji-picker-element` web component
   - Props: `onEmojiSelect`, `open`
   - Style to match zapcooking theme
   - Lazy load to reduce bundle

8. **Create ReactionDisplay**
   - File: `/src/components/Reactions/ReactionDisplay.svelte`
   - Subscribe to kind 7 events (based on targetType)
   - Use reactionAggregator to process
   - Horizontal scrollable pills
   - Props: `event`, `targetType`, `onReactionClick`
   - Highlight user's reactions (accent background)

9. **Create ReactionButton**
   - File: `/src/components/Reactions/ReactionButton.svelte`
   - Toggle picker on click
   - Show total count
   - Icon: heart if no reactions, else most popular emoji
   - Props: `event`, `targetType`, `buttonClass`

### Phase 3: Integration (2-3 days)

10. **Update NoteTotalLikes.svelte**
    - Replace heart icon with `<ReactionButton>`
    - Add `<ReactionDisplay>` below button
    - Set `targetType="note"` (uses #e tags)
    - Maintain existing styling classes

11. **Update Recipe/TotalLikes.svelte**
    - Similar to NoteTotalLikes
    - Set `targetType="recipe"` (uses #a tags)
    - Format: `${event.kind}:${event.pubkey}:${dTag}`

12. **Update CommentLikes.svelte**
    - Set `targetType="comment"` (uses #e tags)
    - Smaller sizing for comment context
    - Keep `text-sm` styling

13. **Update Comment.svelte**
    - Replace `toggleLike` function with ReactionButton
    - Update like state to reaction state
    - Maintain threading logic

14. **Update FeedComment.svelte**
    - Similar to Comment.svelte
    - Update like state to reaction state

### Phase 4: Testing & Polish (1-2 days)

15. **Manual testing**
    - Test all 5 components
    - Verify Nostr events published correctly
    - Test with/without authentication
    - Mobile responsive testing
    - Cross-browser emoji rendering

16. **Performance testing**
    - Measure bundle size impact
    - Verify lazy loading works
    - Test with 100+ reactions
    - Check cache hit rates

17. **Edge case handling**
    - Empty reactions state
    - Network errors
    - Invalid emoji content
    - Relay compatibility

## Data Flow

```
User clicks ReactionButton
    ↓
EmojiReactionPicker opens (quick grid)
    ↓
User selects emoji OR clicks "+" for full picker
    ↓
publishReaction() creates kind 7 event
    ↓
Event signed & published to Nostr
    ↓
Optimistic UI update (instant feedback)
    ↓
Subscription receives event
    ↓
reactionAggregator processes & groups by emoji
    ↓
ReactionDisplay updates with new counts
    ↓
Cache updated with 5-minute TTL
```

## Backwards Compatibility

All existing reactions with `content: '+'` will be:
- Converted to ❤️ in display
- Counted alongside new ❤️ reactions
- Fully compatible with new system

Migration function in `reactionAggregator.ts`:
```typescript
function normalizeReactionContent(content: string): string {
  if (content === '+' || content === '') return '❤️';
  if (isEmoji(content)) return content;
  return '❤️'; // Fallback for invalid content
}
```

## Styling

Match existing zapcooking design system:
- Primary color: `#EC4700`
- Input background: `#F6F6F6`
- Font: Geist
- Border radius: `rounded-xl`, `rounded-3xl`
- Transitions: `transition duration-300`
- Hover states: `hover:bg-input`

Reaction pill styling:
```css
.reaction-pill {
  display: inline-flex;
  gap: 4px;
  background: #F6F6F6;
  border: 1px solid #DDDDDD;
  border-radius: 12px;
  padding: 4px 8px;
}

.reaction-pill.user-reacted {
  background: #EC4700;
  color: white;
  border-color: #EC4700;
}
```

## Critical Files

### Files to Create (8)
1. `/src/lib/types/reactions.ts`
2. `/src/lib/reactionAggregator.ts`
3. `/src/lib/reactionCache.ts`
4. `/src/lib/reactions/publishReaction.ts`
5. `/src/components/Reactions/EmojiReactionPicker.svelte`
6. `/src/components/Reactions/FullEmojiPicker.svelte`
7. `/src/components/Reactions/ReactionDisplay.svelte`
8. `/src/components/Reactions/ReactionButton.svelte`

### Files to Modify (5)
1. `/src/components/NoteTotalLikes.svelte`
2. `/src/components/Recipe/TotalLikes.svelte`
3. `/src/components/CommentLikes.svelte`
4. `/src/components/Comment.svelte`
5. `/src/components/FeedComment.svelte`

## Dependencies

```json
{
  "dependencies": {
    "emoji-picker-element": "^1.21.0"
  },
  "devDependencies": {
    "@types/emoji-picker-element": "^1.4.0"
  }
}
```

## Timeline

| Phase | Duration |
|-------|----------|
| Phase 1: Infrastructure | 1-2 days |
| Phase 2: Core Components | 2-3 days |
| Phase 3: Integration | 2-3 days |
| Phase 4: Testing & Polish | 1-2 days |
| **Total** | **6-10 days** |

## Success Metrics

- ✅ All 5 components support emoji reactions
- ✅ Backwards compatible with existing '+' reactions
- ✅ Quick picker opens in <100ms
- ✅ Cache hit rate >70%
- ✅ Bundle size increase <50KB
- ✅ Works on mobile and desktop
- ✅ Renders consistently across browsers

## Future Enhancements (Post-MVP)

- Custom emoji support (NIP-30)
- Reaction animations
- Reaction leaderboards
- Reaction notifications
- Reaction analytics
- Reaction search
