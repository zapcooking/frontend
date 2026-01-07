# NIP-22 Replies Implementation Analysis

## Summary

This document describes the discrepancies that were found and fixed in the codebase to ensure compliance with NIP-22 (Comments) and NIP-23 (Long-form Content) specifications for how replies to longform recipes (kind 30023) should be structured.

**Status:** ✅ All issues have been resolved and the implementation now follows NIP-22/NIP-23 specifications.

## Key Requirements from NIP-22 & NIP-23

### NIP-23 Requirement
- **Replies to `kind 30023` MUST use NIP-22 `kind 1111` comments** ✅ (You're doing this correctly)

### NIP-22 Requirements for Comments (kind 1111)

For **top-level comments** on a longform article (kind 30023):

1. **MUST use uppercase tags for root scope:**
   - `A` tag: The addressable event address (`30023:pubkey:d-tag-value`)
   - `K` tag: The root kind (`30023`)
   - `P` tag: The root author's pubkey

2. **MUST use lowercase tags for parent (same as root for top-level):**
   - `a` tag: Same addressable event address as `A`
   - `e` tag: The parent event ID (the longform article's event ID)
   - `k` tag: The parent kind (`30023` for top-level, `1111` for nested)
   - `p` tag: The parent author's pubkey

3. **MUST NOT use NIP-10 style markers** (`'reply'`, `'root'`) - NIP-22 uses uppercase/lowercase tag distinction instead

For **nested comments** (replying to another comment):

1. Same root scope tags (`A`, `K`, `P`)
2. Parent tags point to the comment being replied to:
   - `e` tag: The parent comment's event ID
   - `k` tag: `1111` (the parent comment kind)
   - `p` tag: The parent comment author's pubkey
   - `a` tag: Should still reference the root article address

## Issues Found and Fixed

The following issues were identified and have been resolved:

### Issue 1: `src/routes/[nip19]/+page.svelte` - `postReply()` function (lines 221-254)

**Current code:**
```typescript
ev.tags = [
  ['e', event.id, '', 'reply'],  // ❌ WRONG: Using NIP-10 style with 'reply' marker
  ['p', event.pubkey]            // ❌ WRONG: Missing required tags
];

// If replying to a recipe, add the 'a' tag
if (isRecipe) {
  const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
  if (dTag) {
    ev.tags.push(['a', `${event.kind}:${event.pubkey}:${dTag}`]);  // ❌ WRONG: Only lowercase 'a', missing uppercase 'A'
  }
}
```

**Problems:**
- Using `'reply'` marker (NIP-10 style) instead of NIP-22 structure
- Missing required `K` tag for root kind
- Missing required `k` tag for parent kind
- Missing required `P` tag for root author
- Only has lowercase `a` tag, missing uppercase `A` tag for root scope
- Missing `e` tag for parent event ID when replying to longform

**Should be:**
```typescript
if (isRecipe) {
  const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
  if (dTag) {
    const addressTag = `${event.kind}:${event.pubkey}:${dTag}`;
    ev.tags = [
      // Root scope (uppercase)
      ['A', addressTag, '', event.pubkey],  // Root addressable event
      ['K', '30023'],                        // Root kind
      ['P', event.pubkey],                  // Root author
      // Parent scope (lowercase) - same as root for top-level comment
      ['a', addressTag, '', event.pubkey],  // Parent addressable event
      ['e', event.id, '', event.pubkey],   // Parent event ID
      ['k', '30023'],                       // Parent kind
      ['p', event.pubkey]                   // Parent author
    ];
  }
}
```

### Issue 2: `src/components/Comments.svelte` - `postComment()` function (lines 52-176)

**Current code:**
```typescript
ev.tags = [
  ['a', filterTag]  // ❌ WRONG: Only has lowercase 'a', missing all required tags
];
```

**Problems:**
- Only has lowercase `a` tag
- Missing all required uppercase tags (`A`, `K`, `P`)
- Missing required lowercase tags (`e`, `k`, `p`)

**Should be:**
```typescript
const dTag = event.tags.find((e) => e[0] == 'd')?.[1];
const addressTag = `${event.kind}:${event.author.pubkey}:${dTag}`;

ev.tags = [
  // Root scope (uppercase)
  ['A', addressTag, '', event.author.pubkey],
  ['K', String(event.kind)],
  ['P', event.author.pubkey],
  // Parent scope (lowercase) - same as root for top-level comment
  ['a', addressTag, '', event.author.pubkey],
  ['e', event.id, '', event.author.pubkey],
  ['k', String(event.kind)],
  ['p', event.author.pubkey]
];
```

### Issue 3: `src/components/Comment.svelte` - `postReply()` function (lines 438-469)

**Current code:**
```typescript
ev.tags = [
  ['a', event.getMatchingTags('a')[0][1]],  // ❌ WRONG: Only lowercase 'a'
  ['e', event.id, '', 'reply'],              // ❌ WRONG: Using 'reply' marker
  ['p', event.pubkey],
  ...event.getMatchingTags('e')
];
```

**Problems:**
- Using `'reply'` marker instead of proper NIP-22 structure
- Missing uppercase root scope tags (`A`, `K`, `P`)
- Missing `k` tag for parent kind
- Incorrectly copying parent's `e` tags

**Should be:**
```typescript
// Get root scope from parent comment
const rootATag = event.getMatchingTags('A')[0] || event.getMatchingTags('a')[0];
const rootKTag = event.getMatchingTags('K')[0];
const rootPTag = event.getMatchingTags('P')[0];

if (rootATag && rootKTag && rootPTag) {
  ev.tags = [
    // Root scope (uppercase) - same as parent
    ['A', rootATag[1], rootATag[2] || '', rootPTag[1]],
    ['K', rootKTag[1]],
    ['P', rootPTag[1]],
    // Parent scope (lowercase) - points to the comment being replied to
    ['a', rootATag[1], rootATag[2] || '', rootPTag[1]],  // Keep root address
    ['e', event.id, '', event.pubkey],                  // Parent comment ID
    ['k', '1111'],                                      // Parent is a comment
    ['p', event.pubkey]                                 // Parent comment author
  ];
}
```

### Issue 4: Reply Fetching Logic

**Current code in `fetchReplies()` (line 89-113):**
```typescript
const sub = $ndk.subscribe({
  kinds: [1, 1111],
  '#e': [eventId]  // ❌ WRONG: NIP-22 comments use 'A' tags, not 'e' tags for root scope
}, { closeOnEose: false });
```

**Problems:**
- Using `'#e'` filter which won't find NIP-22 comments that use `A` tags for root scope
- Should also filter by `'#A'` tag for addressable events

**Should be:**
```typescript
// For longform (kind 30023), use 'A' tag filter
if (event.kind === 30023) {
  const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
  if (dTag) {
    const addressTag = `${event.kind}:${event.pubkey}:${dTag}`;
    const sub = $ndk.subscribe({
      kinds: [1111],
      '#A': [addressTag]  // Filter by root address
    }, { closeOnEose: false });
  }
} else {
  // For kind 1 notes, use NIP-10 style
  const sub = $ndk.subscribe({
    kinds: [1],
    '#e': [eventId]
  }, { closeOnEose: false });
}
```

### Issue 5: Reply Filtering Logic

**Current code in `directReplies` filter (lines 257-285):**
```typescript
const replyTag = eTags.find(tag => tag[3] === 'reply');  // ❌ WRONG: NIP-22 doesn't use 'reply' markers
```

**Problems:**
- Looking for `'reply'` markers which NIP-22 doesn't use
- Should check for `A`/`a` tags and `e` tags with proper parent relationship

**Should be:**
```typescript
$: directReplies = replies.filter((r) => {
  if (!event) return false;
  
  // For NIP-22 comments (kind 1111)
  if (r.kind === 1111) {
    const aTags = r.getMatchingTags('a');
    const eTags = r.getMatchingTags('e');
    const kTags = r.getMatchingTags('k');
    
    // Check if this comment's 'a' tag matches the root article address
    const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
    if (dTag) {
      const rootAddress = `${event.kind}:${event.pubkey}:${dTag}`;
      const matchesRoot = aTags.some(tag => tag[1] === rootAddress);
      
      // Check if parent 'e' tag points to root event (top-level comment)
      // or if 'k' tag shows parent is the root kind (30023)
      const isTopLevel = eTags.some(tag => tag[1] === event.id) && 
                         kTags.some(tag => tag[1] === String(event.kind));
      
      return matchesRoot && isTopLevel;
    }
  }
  
  // For NIP-10 replies (kind 1)
  // ... existing logic ...
});
```

## Fixes Implemented

✅ **All issues have been resolved:**

1. ✅ **Updated all reply posting functions** to use proper NIP-22 tag structure
   - `src/routes/[nip19]/+page.svelte` - `postReply()`
   - `src/components/Comments.svelte` - `postComment()`
   - `src/components/Comment.svelte` - `postReply()`
   - `src/components/FeedComments.svelte` - `postComment()`
   - `src/components/InlineComments.svelte` - `postComment()`
   - `src/components/FeedComment.svelte` - `postReply()`
   - `src/components/CommentReplies.svelte` - reply posting

2. ✅ **Updated reply fetching** to use `'#A'` filter for longform comments
   - `src/routes/[nip19]/+page.svelte` - `fetchReplies()`
   - `src/components/Comments.svelte` - subscription filter
   - `src/components/FeedComments.svelte` - subscription filter
   - `src/components/InlineComments.svelte` - subscription filter

3. ✅ **Updated reply filtering** to check `A`/`a` tags instead of `'reply'` markers
   - `src/routes/[nip19]/+page.svelte` - `directReplies` and `getNestedReplies()`

4. ✅ **Ensured nested comments** properly inherit root scope from parent comments

## Example: Correct NIP-22 Comment Structure

For a top-level comment on a longform article:

```json
{
  "kind": 1111,
  "content": "Great recipe!",
  "tags": [
    ["A", "30023:abc123...:recipe-slug", "wss://relay.example.com", "abc123..."],
    ["K", "30023"],
    ["P", "abc123..."],
    ["a", "30023:abc123...:recipe-slug", "wss://relay.example.com", "abc123..."],
    ["e", "def456...", "wss://relay.example.com", "abc123..."],
    ["k", "30023"],
    ["p", "abc123..."]
  ]
}
```

For a nested comment (reply to another comment):

```json
{
  "kind": 1111,
  "content": "I agree!",
  "tags": [
    ["A", "30023:abc123...:recipe-slug", "wss://relay.example.com", "abc123..."],
    ["K", "30023"],
    ["P", "abc123..."],
    ["a", "30023:abc123...:recipe-slug", "wss://relay.example.com", "abc123..."],
    ["e", "ghi789...", "wss://relay.example.com", "xyz789..."],
    ["k", "1111"],
    ["p", "xyz789..."]
  ]
}
```

