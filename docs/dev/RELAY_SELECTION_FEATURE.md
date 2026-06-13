# Relay Selection Feature for Posting Modal

## Overview
The posting modal offers relay selection, letting users choose which relays to post to when creating new posts.

> **History note:** this feature originally offered `garden` and
> `garden-pantry` modes targeting `wss://garden.zap.cooking`. Those
> were removed when the Garden relay was decommissioned; persisted
> queue items with the old modes are migrated to `all` on startup
> (see `publishQueue.ts`).

## Implementation Details

### Files Involved

#### 1. `src/components/PostModal.svelte`
Relay selection dropdown in the modal header:
- **Relay Options:**
  - `all` - Post to all connected relays (default behavior)
  - `pantry` - Post only to `wss://pantry.zap.cooking`

- **UI Implementation:**
  - Dropdown selector in modal title bar
  - Visual indicator with emoji (🏪 Pantry)
  - Theme-aware styling matching app design system
  - Focus state with orange accent color

#### 2. `src/components/PostComposer.svelte`
Posting logic supports explicit relay selection:

- **Type Definition:**
  ```typescript
  type RelaySelection = 'all' | 'pantry';
  ```

- **Prop:**
  - `selectedRelay?: RelaySelection` - Optional prop for explicit relay selection (used by modal)

- **Posting Logic:**
  - Priority system: `selectedRelay` prop (from modal) takes precedence over `activeTab` (from feed context)
  - Relay mode determination:
    - `pantry` → Posts to Pantry relay only (the `members` feed tab also maps here)
    - `all` → Posts to all connected relays (default NDK behavior)

- **Visual Feedback:**
  - Color-coded relay indicators:
    - Pantry: Blue theme 🏪
    - All relays: Orange theme 📡
  - Indicators show before posting to confirm destination

- **Error Handling:**
  - Validates successful publishing to selected relays
  - Clear error messages if publishing fails; failures queue for
    IndexedDB-backed background retry via `publishQueue`

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

### Usage

#### From Modal
```typescript
// User opens posting modal via CreateMenuButton
// Selects relay from dropdown
// Posts to selected relay(s)
```

#### From Feed
```typescript
// PostComposer in feed context uses activeTab prop
<PostComposer variant="inline" activeTab="members" />
// Posts to the pantry relay
```

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
- No breaking changes to existing functionality
