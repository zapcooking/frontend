# NIP-89 Client Tag Implementation

## Overview

This implementation adds NIP-89 client tags to all published events, allowing other Nostr clients to identify Zap Cooking as the publishing client.

## Implementation Details

### Files Created/Modified

1. **`src/lib/consts.ts`**
   - Added `CLIENT_TAG_IDENTIFIER = 'zap.cooking'`
   - Added `CLIENT_DISPLAY_NAME = 'Zap Cooking'`

2. **`src/lib/nip89.ts`** (NEW)
   - `ensureClientTag(tags: string[][])` - Ensures client tag exists in tags array
   - `addClientTagToEvent(event: NDKEvent)` - Adds client tag to NDKEvent before publishing

3. **Test File**: `src/lib/nip89.test.ts` (NEW)
   - Comprehensive tests for client tag functionality
   - Note: Requires vitest to be set up (currently not in package.json)

### Updated Files (Event Publishing Locations)

The following files have been updated to include client tags:

#### Core Components
- ✅ `src/components/PostModal.svelte` - Post creation
- ✅ `src/components/NoteTotalLikes.svelte` - Reactions/likes
- ✅ `src/components/NoteRepost.svelte` - Reposts (kind 6)
- ✅ `src/components/InlineComments.svelte` - Comments/replies
- ✅ `src/components/CommentReplies.svelte` - Reply threads
- ✅ `src/components/CommentLikes.svelte` - Comment reactions
- ✅ `src/components/Comments.svelte` - Comment posting
- ✅ `src/components/Comment.svelte` - Individual comment actions
- ✅ `src/components/FeedComments.svelte` - Feed comments
- ✅ `src/components/FeedComment.svelte` - Feed comment actions

#### Routes
- ✅ `src/routes/feed-post/+page.svelte` - Feed posting
- ✅ `src/routes/community/+page.svelte` - Community posts
- ✅ `src/routes/create/+page.svelte` - Recipe creation
- ✅ `src/routes/[nip19]/+page.svelte` - Note thread replies

#### Library/Manager Files
- ✅ `src/lib/zapManager.ts` - Zap requests (kind 9734)
- ✅ `src/lib/authManager.ts` - Anonymous posting

#### Recipe Components
- ✅ `src/components/Recipe/TotalLikes.svelte` - Recipe reactions
- ✅ `src/components/Recipe/Recipe.svelte` - Recipe events

### How It Works

1. **Before Publishing**: Call `addClientTagToEvent(event)` right before `.sign()` or `.publish()`
2. **Tag Format**: Adds `["client", "zap.cooking"]` tag to event
3. **Deduplication**: If client tag already exists with a value, it's preserved (not overwritten)
4. **Tag Position**: Client tag is appended at the end of tags array

### Example Usage

```typescript
import { addClientTagToEvent } from '$lib/nip89';

// Create event
const event = new NDKEvent($ndk);
event.kind = 1;
event.content = 'Hello world';
event.tags = [['t', 'zapcooking']];

// Add client tag before publishing
addClientTagToEvent(event);

// Publish
await event.publish();
```

### Remaining Files That May Need Updates

The following files contain `.publish()` calls and may need client tag additions:
- `src/routes/user/[slug]/+page.svelte` - User actions (follows, mutes)
- `src/routes/login/+page.svelte` - Profile metadata
- `src/routes/onboarding/+page.svelte` - Profile metadata
- `src/routes/fork/[slug]/+page.svelte` - Recipe forking
- `src/routes/list/create/+page.svelte` - List creation
- `src/routes/list/[slug]/fork/+page.svelte` - List forking
- `src/routes/bookmarks/edit/+page.svelte` - Bookmark lists
- `src/routes/bookmarks/+page.svelte` - Bookmark actions
- `src/components/ImageUploader.svelte` - Image uploads (if publishing events)

**Note**: Some of these may not need updates if they:
- Only publish metadata events (kind 0, 3, etc.) where client tags are less critical
- Are user configuration events rather than content

### Testing

To verify client tags are being added:

1. **Manual Testing**: 
   - Create a post, like, repost, or comment
   - Check the published event's tags array
   - Verify `["client", "zap.cooking"]` is present

2. **Automated Testing**:
   - Set up vitest: `npm install -D vitest`
   - Run: `npm test src/lib/nip89.test.ts`

### NIP-89 Specification

According to NIP-89, the client tag should:
- Use the format: `["client", "<identifier>"]`
- Be included in published events
- Allow other clients to display "via Zap Cooking" or similar attribution

### Notes

- Client tags are added at the end of the tags array for consistency
- Existing client tags with values are preserved (we don't override other clients)
- Empty client tags are updated to "zap.cooking"
- All content events (notes, reactions, reposts, zaps) now include client tags

