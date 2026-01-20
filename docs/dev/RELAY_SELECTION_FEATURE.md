# Relay Selection Feature for Posting Modal

## Overview
Added relay selection capability to the posting modal, allowing users to choose which relays to post to when creating new posts.

## Implementation Details

### Files Modified

#### 1. `src/components/PostModal.svelte`
Added relay selection dropdown in the modal header:
- **Relay Options:**
  - `all` - Post to all connected relays (default behavior)
  - `garden` - Post only to `wss://garden.zap.cooking`
  - `pantry` - Post only to `wss://pantry.zap.cooking`
  - `garden-pantry` - Post to both Garden and Pantry relays

- **UI Implementation:**
  - Dropdown selector in modal title bar
  - Visual indicators with emojis (🌱 Garden, 🥫 Pantry)
  - Theme-aware styling matching app design system
  - Focus state with orange accent color

#### 2. `src/components/PostComposer.svelte`
Enhanced posting logic to support explicit relay selection:

- **New Type Definition:**
  ```typescript
  type RelaySelection = 'all' | 'garden' | 'pantry' | 'garden-pantry';
  ```

- **New Prop:**
  - `selectedRelay?: RelaySelection` - Optional prop for explicit relay selection (used by modal)

- **Posting Logic Updates:**
  - Priority system: `selectedRelay` prop (from modal) takes precedence over `activeTab` (from feed context)
  - Relay mode determination:
    - `garden` → Posts to Garden relay only
    - `pantry` → Posts to Pantry relay only (replaces old "members" terminology)
    - `garden-pantry` → Posts to both Garden and Pantry relays
    - `all` → Posts to all connected relays (default NDK behavior)

- **Visual Feedback:**
  - Color-coded relay indicators:
    - Garden: Green theme 🌱
    - Pantry: Blue theme 🥫
    - Garden+Pantry: Purple theme 🌱🥫
    - All relays: Orange theme 📡
  - Indicators show before posting to confirm destination

- **Error Handling:**
  - Validates successful publishing to selected relays
  - Warns if partial success (e.g., only one relay in garden-pantry mode)
  - Clear error messages if publishing fails

### Key Features

1. **Backward Compatible:**
   - Inline PostComposer (used in feeds) continues to work with `activeTab` prop
   - Modal PostComposer uses explicit `selectedRelay` prop
   - Defaults to "all relays" if no selection made

2. **User Experience:**
   - Default selection is "All relays" (safest option)
   - Clear visual indicators before and during posting
   - Dropdown preserves selection during modal session
   - Resets to "all" on next modal open

3. **Relay Terminology Update:**
   - Changed "members.zap.cooking" to "pantry.zap.cooking" throughout
   - Updated relay URLs to use pantry endpoint
   - Consistent naming: Garden = community, Pantry = members-only

### Usage

#### From Modal (New Feature)
```typescript
// User opens posting modal via CreateMenuButton
// Selects relay from dropdown
// Posts to selected relay(s)
```

#### From Feed (Existing Behavior)
```typescript
// PostComposer in feed context uses activeTab prop
<PostComposer variant="inline" activeTab="garden" />
// Still works as before, posts to garden relay
```

### Testing Checklist

- [ ] Open posting modal from CreateMenuButton
- [ ] Verify dropdown shows all 4 options
- [ ] Select "Garden only" - verify green indicator appears
- [ ] Post and verify it goes to garden.zap.cooking
- [ ] Select "Pantry only" - verify blue indicator appears
- [ ] Post and verify it goes to pantry.zap.cooking
- [ ] Select "Garden + Pantry" - verify purple indicator appears
- [ ] Post and verify it goes to both relays
- [ ] Select "All relays" - verify orange indicator appears
- [ ] Post and verify it uses default NDK publishing
- [ ] Test inline composer in feed still works
- [ ] Verify garden feed posting still works
- [ ] Test dark/light theme styling

### Future Enhancements

1. **Remember User Preference:**
   - Save last selected relay to localStorage
   - Persist selection across sessions

2. **Custom Relay Selection:**
   - Allow users to select from any connected relay
   - Multi-select for custom relay combinations

3. **Relay Status Indicators:**
   - Show connection status next to relay names
   - Disable unavailable relays

4. **Publishing Feedback:**
   - Show which relays successfully accepted the post
   - Display relay-specific errors

### Technical Notes

- Uses NDK's `NDKRelaySet.fromRelayUrls()` for targeted publishing
- Validates published relays using `normalizeRelayUrl()` for consistency
- Maintains existing garden/members feed behavior
- No breaking changes to existing functionality
