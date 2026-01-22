# Share Note as Image Feature

## Overview

The "Share Note as Image" feature allows users to convert Nostr kind 1 notes into shareable PNG images that can be posted on traditional social media platforms like Instagram, Twitter, etc. This helps drive awareness of zap.cooking while making Nostr content more shareable.

## Implementation

### Components Created

1. **`ShareNoteImageCard.svelte`** - Svelte component for the note card design (for future use)
2. **`shareNoteImage.ts`** - Core image generation logic using html2canvas
3. **Updated `PostActionsMenu.svelte`** - Added "Share as Image" option

### Features

- **Visual Note Card** with:
  - User avatar (generated from pubkey with initials)
  - Author display name or npub
  - Formatted timestamp (e.g., "2 hours ago", "3 days ago")
  - Note content (properly wrapped, handles long notes)
  - Engagement metrics:
    - ⚡ Total zaps in sats
    - 💜 Reaction count
    - 💬 Comment count
  - zap.cooking branding/watermark
  - Dark gradient background with subtle decoration

- **Image Formats**:
  - Square: 1080x1080px (Instagram-friendly)
  - Landscape: 1200x675px (Twitter-friendly) - can be added later

- **Share/Download**:
  - Uses native share API on mobile (if available)
  - Falls back to direct download on desktop
  - Filename: `zap-cooking-[first-words]-[note-id].png`

### Technical Details

- Uses `html2canvas` library to convert HTML to PNG
- Creates temporary off-screen DOM element
- Waits for images to load before capturing
- Cleans up temporary elements after generation
- Handles errors gracefully with user feedback

## How to Use

1. **Find a note** in the feed
2. **Click the "..." button** in the top right of the post
3. **Select "Share as Image"** from the menu
4. **Wait for generation** (shows loading overlay)
5. **Image is shared/downloaded** automatically

## Testing

### Desktop Testing

1. Open the app in a desktop browser
2. Navigate to any feed (Home, Explore, etc.)
3. Find a post with engagement (zaps, reactions, comments)
4. Click the "..." button in the top right
5. Click "Share as Image"
6. You should see:
   - Loading overlay appears
   - Image generation takes 2-5 seconds
   - File downloads automatically (check Downloads folder)
   - Filename should be like `zap-cooking-note-abc123.png`

### Mobile Testing

1. Open the app on mobile device
2. Find a post
3. Click "..." → "Share as Image"
4. Should use native share sheet (if supported)
5. Can share to Instagram, Twitter, etc.

### What to Check

- ✅ Image generates successfully
- ✅ Author name displays correctly (or npub fallback)
- ✅ Timestamp is formatted nicely
- ✅ Note content is readable and properly wrapped
- ✅ Engagement metrics show correctly
- ✅ zap.cooking branding is visible
- ✅ Image dimensions are correct (1080x1080 for square)
- ✅ File downloads/shares successfully
- ✅ Error handling works (try with very long notes)

### Edge Cases to Test

1. **Very long notes** - Should truncate gracefully
2. **Notes with line breaks** - Should preserve formatting
3. **Notes with emojis** - Should display correctly
4. **Notes with no engagement** - Should still work
5. **Notes with missing author profile** - Should use npub fallback
6. **Network issues during generation** - Should show error

## Code Structure

```
src/
  components/
    PostActionsMenu.svelte          # Menu with share options
    ShareNoteImageCard.svelte        # Card component (for future use)
  lib/
    shareNoteImage.ts                # Image generation logic
```

## Future Enhancements

- [ ] Add QR code generation (requires qrcode library)
- [ ] Add format selection (square vs landscape)
- [ ] Add preview modal before sharing
- [ ] Cache generated images for quick re-sharing
- [ ] Support for recipe posts (kind 30023)
- [ ] Custom branding options
- [ ] Better avatar rendering (fetch actual profile pictures)

## Known Limitations

- QR code generation is not yet implemented (placeholder exists)
- Only supports square format currently (landscape can be added)
- Avatar uses generated color + initials (doesn't fetch actual profile picture yet)
- Author name fetching may timeout on slow connections (falls back to npub)

## Dependencies

- `html2canvas` - For HTML to canvas conversion
- `date-fns` - For timestamp formatting (already in project)
