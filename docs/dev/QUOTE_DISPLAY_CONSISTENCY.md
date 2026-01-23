# Quote Display Consistency

**Date:** January 19, 2026  
**Status:** ✅ Implemented

## Overview

Fixed inconsistent display of quoted/reply notes in the feed. Now both replies and quote reposts use the same consistent orange bracket style at the top of the post.

---

## Problem

### Before (Inconsistent)

**Reply Notes (top style):**
```
┌────────────────────────────────────────┐
│ │ SuperJohn                            │ ← Orange bracket
│ │ I'm in the future, it's not pretty.  │
│ │ View full thread →                   │
│                                         │
│ seth · about 2 hours ago               │
│ Is life without challenge even living? │
└────────────────────────────────────────┘
```

**Quote Reposts (bubble style):**
```
┌────────────────────────────────────────┐
│ seth · about 3 hours ago               │
│ Big if true                            │
│                                         │
│ ┌────────────────────────────────────┐ │ ← Bubble card
│ │ HODL · about 4 hours ago           │ │
│ │ The trick is to accelerate...      │ │
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

**Issues:**
- Inconsistent visual language
- Confusing for users
- Quote appears BELOW content instead of ABOVE
- Different styling breaks visual flow

---

## Solution

### After (Consistent)

**Both use orange bracket style at the TOP:**

**Reply:**
```
┌────────────────────────────────────────┐
│ │ SuperJohn                            │ ← Orange bracket
│ │ I'm in the future...                 │
│ │ View full thread →                   │
│                                         │
│ seth · about 2 hours ago               │
│ Is life without challenge even living? │
└────────────────────────────────────────┘
```

**Quote Repost:**
```
┌────────────────────────────────────────┐
│ │ HODL                                 │ ← Orange bracket (same style!)
│ │ The trick is to accelerate...        │
│ │ View quoted note →                   │
│                                         │
│ seth · about 3 hours ago               │
│ Big if true                            │
└────────────────────────────────────────┘
```

**Benefits:**
- Consistent visual language
- Clear hierarchy (context first, then response)
- Easy to scan and understand
- Unified user experience

---

## Implementation

### New Helper Functions

**File:** `src/components/FoodstrFeedOptimized.svelte`

```typescript
// Regex to match quoted note references in content
const QUOTED_NOTE_REGEX = /nostr:(nevent1[...]+|note1[...]+)/g;

// Extract the first quoted note ID from content
function getQuotedNoteId(event: NDKEvent): string | null {
  if (!event.content) return null;
  
  // First check for q tag (NIP-18 style quote repost)
  const qTag = event.tags.find(tag => tag[0] === 'q');
  if (qTag && qTag[1]) {
    return qTag[1];
  }
  
  // Then check for nostr:nevent1 or nostr:note1 in content
  const match = event.content.match(QUOTED_NOTE_REGEX);
  if (match && match[0]) {
    // Decode nevent1 or note1 to get event ID
    // ...
  }
  return null;
}

// Check if an event has a quoted note (but is not a reply)
function hasQuotedNote(event: NDKEvent): boolean {
  // Don't show quote embed if it's already a reply
  if (isReply(event)) return false;
  return getQuotedNoteId(event) !== null;
}

// Get content without the quoted note reference
function getContentWithoutQuote(content: string): string {
  return content
    .replace(QUOTED_NOTE_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim();
}
```

### Template Logic

```svelte
{#if isReply(event)}
  <!-- Reply context (orange bracket for replies) -->
  {@const parentNoteId = getParentNoteId(event)}
  <!-- Render with orange bracket style -->
  
{:else if hasQuotedNote(event)}
  <!-- Quote repost (orange bracket for quoted notes) -->
  {@const quotedNoteId = getQuotedNoteId(event)}
  <!-- Render with SAME orange bracket style -->
{/if}

<!-- Content -->
{#if hasQuotedNote(event)}
  <!-- Strip quoted note reference from content -->
  {@const cleanContent = getContentWithoutMedia(getContentWithoutQuote(event.content))}
  <NoteContent content={cleanContent} />
{:else}
  {@const cleanContent = getContentWithoutMedia(event.content)}
  <NoteContent content={cleanContent} />
{/if}
```

---

## Visual Design

### Orange Bracket Style

```css
.parent-quote-embed {
  padding: 0.5rem 0.75rem;
  background: var(--color-input);
  border-left: 3px solid var(--color-primary, #f97316); /* Orange */
  border-radius: 0.375rem;
}
```

### Elements

1. **Header Row:**
   - Small avatar (16px)
   - Author name
   
2. **Content Preview:**
   - Truncated text (max 2 lines)
   - Clean preview without URLs/nostr links
   
3. **Action Link:**
   - "View full thread →" (for replies)
   - "View quoted note →" (for quotes)

---

## Detection Logic

### Replies (Already Implemented)

**Detection:** `isReply(event)` checks for `e` tags

```typescript
function isReply(event: NDKEvent): boolean {
  return event.tags.some(tag => tag[0] === 'e');
}
```

### Quote Reposts (New)

**Detection:** Check for:
1. `q` tag (NIP-18 style)
2. `nostr:nevent1...` in content
3. `nostr:note1...` in content

```typescript
function hasQuotedNote(event: NDKEvent): boolean {
  if (isReply(event)) return false; // Skip if already a reply
  return getQuotedNoteId(event) !== null;
}
```

### Priority

1. **Reply takes precedence** - If it's a reply, show reply context
2. **Quote shown only if not reply** - Prevents double embeds

---

## Content Processing

### Problem

When content contains `nostr:nevent1...`:
- Old behavior: Renders as inline bubble card
- New behavior: Extracted to top, removed from inline content

### Solution

```typescript
function getContentWithoutQuote(content: string): string {
  return content
    .replace(QUOTED_NOTE_REGEX, '')  // Remove nostr: references
    .replace(/\s+/g, ' ')            // Normalize whitespace
    .trim();
}
```

**Template:**
```svelte
{#if hasQuotedNote(event)}
  {@const cleanContent = getContentWithoutMedia(getContentWithoutQuote(event.content))}
  <!-- Content without the nostr: reference -->
{:else}
  {@const cleanContent = getContentWithoutMedia(event.content)}
  <!-- Normal content -->
{/if}
```

---

## Nostr Standards

### NIP-10: Replies

- Uses `e` tags to reference parent notes
- Markers: `root`, `reply`, `mention`

### NIP-18: Quote Reposts

- Uses `q` tag to reference quoted note
- Alternative: Include `nostr:nevent1...` in content

### Both Supported

The implementation handles:
- ✅ Traditional replies (e tags)
- ✅ NIP-18 quote reposts (q tag)
- ✅ Inline note references (nostr:nevent1/note1)

---

## Testing

### Manual Testing Steps

#### 1. Reply Notes
- [ ] Find a reply note in the feed
- [ ] Verify orange bracket appears at TOP
- [ ] Verify parent note preview shown
- [ ] Verify "View full thread →" link
- [ ] Click link → navigates to parent note

#### 2. Quote Reposts
- [ ] Find a quote repost in the feed
- [ ] Verify orange bracket appears at TOP
- [ ] Verify quoted note preview shown
- [ ] Verify "View quoted note →" link
- [ ] Click link → navigates to quoted note
- [ ] Verify no bubble embed in content area

#### 3. Mixed Content
- [ ] Quote repost with text before/after quote
- [ ] Verify text renders WITHOUT the nostr: reference
- [ ] Verify quoted note shown at top with bracket

#### 4. Edge Cases
- [ ] Note that is BOTH reply AND quote
- [ ] Verify reply context takes precedence
- [ ] Note with multiple nostr: references
- [ ] Verify only first one extracted

#### 5. Visual Consistency
- [ ] Compare reply and quote side by side
- [ ] Verify identical styling (orange bracket)
- [ ] Verify identical positioning (top of post)

---

## Examples

### Example 1: Reply

**Event:**
```json
{
  "content": "Is life without challenge even living?",
  "tags": [["e", "abc123", "", "reply"]]
}
```

**Display:**
```
│ SuperJohn
│ I'm in the future, it's not pretty.
│ View full thread →

seth · about 2 hours ago
Is life without challenge even living?
```

### Example 2: Quote Repost

**Event:**
```json
{
  "content": "Big if true nostr:nevent1abc123..."
}
```

**Display:**
```
│ HODL
│ The trick is to accelerate into an unknown...
│ View quoted note →

seth · about 3 hours ago
Big if true
```

### Example 3: Quote with q Tag

**Event:**
```json
{
  "content": "This is brilliant!",
  "tags": [["q", "xyz789"]]
}
```

**Display:**
```
│ Alice
│ Just published my new recipe!
│ View quoted note →

bob · about 1 hour ago
This is brilliant!
```

---

## Performance

### No Impact

- Uses existing `resolveReplyContext()` function
- Same caching mechanism
- Same prefetching strategy
- Just different trigger (quoted note vs reply)

### Regex Efficiency

- Simple regex for nostr: detection
- Only runs once per event
- Compiled constant (not recreated)

---

## Accessibility

### Maintained

✅ **Link Elements:** Both use `<a>` tags  
✅ **Keyboard Nav:** Focusable and clickable  
✅ **Screen Readers:** Proper link text  
✅ **Visual Consistency:** Same styling for both  

---

## Future Enhancements

### Potential Improvements

1. **Differentiate Visually**
   - Subtle icon difference (reply vs quote)
   - Different link text (already implemented)
   - Optional border color variation

2. **Multiple Quotes**
   - Handle multiple quoted notes
   - Stack multiple orange brackets
   - Or show "Quoting 3 notes" summary

3. **Quote Preview Enhancement**
   - Show images from quoted note
   - Expand/collapse quoted content
   - Thread visualization

---

## Conclusion

Quote reposts now display consistently with replies:
- **Same visual style:** Orange bracket on left
- **Same position:** Top of post, before content
- **Same interaction:** Click to view original note
- **Clear hierarchy:** Context first, response second

This creates a unified, predictable user experience across the feed.

---

**Feature Implemented:** January 19, 2026  
**Status:** ✅ Ready for Testing  
**Components:** FoodstrFeedOptimized.svelte  
**Styles:** Uses existing .parent-quote-embed CSS
