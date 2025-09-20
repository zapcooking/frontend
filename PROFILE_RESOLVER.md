# Nostr Profile Name Resolution Implementation

This implementation provides comprehensive Nostr profile name resolution for the zap.cooking app, converting raw `nostr:nprofile1...` links into readable `@username` format.

## Features

- ✅ **Decode nostr profile strings** - Extracts pubkey from `nostr:nprofile1...` format
- ✅ **Fetch profile metadata** - Retrieves kind 0 events from relays
- ✅ **Parse display names** - Shows `@display_name` or `@name` from profile content
- ✅ **Graceful fallbacks** - Falls back to truncated npub if no name available
- ✅ **Intelligent caching** - 5-minute cache with automatic cleanup
- ✅ **Batch processing** - Efficiently handles multiple profiles
- ✅ **Error handling** - Robust error handling for network issues
- ✅ **TypeScript support** - Full type safety throughout

## Architecture

### Core Files

1. **`src/lib/profileResolver.ts`** - Core resolution logic and caching
2. **`src/lib/profileStore.ts`** - Svelte store for state management
3. **`src/lib/contentProcessor.ts`** - Content processing utilities
4. **`src/components/ProfileLink.svelte`** - Reusable profile link component
5. **`src/components/NoteContent.svelte`** - Updated to use profile resolution

### Data Flow

```
nostr:nprofile1... → decodeNostrProfile() → pubkey → fetchProfileFromRelays() → ProfileData → @username
```

## Usage

### Basic Usage

```svelte
<script>
  import ProfileLink from '$lib/components/ProfileLink.svelte';
</script>

<ProfileLink nostrString="nostr:nprofile1qqs..." />
```

### Programmatic Usage

```typescript
import { resolveProfile, formatDisplayName } from '$lib/profileResolver';

// Resolve a single profile
const profile = await resolveProfile('nostr:nprofile1qqs...');
const displayName = formatDisplayName(profile); // "@username"

// Batch resolve multiple profiles
const profiles = await resolveProfiles([
  'nostr:nprofile1qqs...',
  'nostr:nprofile1qqs...'
]);
```

### Store Usage

```typescript
import { profileActions, profiles } from '$lib/profileStore';

// Load profiles
await profileActions.loadProfile('nostr:nprofile1qqs...');
await profileActions.loadProfiles(['nostr:nprofile1qqs...', 'nostr:nprofile1qqs...']);

// Access resolved data
$profiles.get('nostr:nprofile1qqs...');
```

## Configuration

### Cache Settings

- **Cache Duration**: 5 minutes (configurable in `profileResolver.ts`)
- **Max Cache Size**: 1000 entries (prevents memory bloat)
- **Cleanup Strategy**: Automatic cleanup of expired entries

### Relay Configuration

Uses existing NDK relay configuration from `src/lib/nostr.ts`:
- `wss://kitchen.zap.cooking`
- `wss://nostr.mom`
- `wss://relay.nostr.band`
- `wss://relay.primal.net`
- `wss://relay.damus.io`
- `wss://nos.lol`
- `wss://relay.snort.social`
- `wss://purplepag.es`

## Component Props

### ProfileLink Component

```typescript
interface ProfileLinkProps {
  nostrString: string;           // Required: nostr profile string
  className?: string;           // Optional: CSS classes
  showLoading?: boolean;        // Optional: Show loading state (default: true)
  fallbackToRaw?: boolean;      // Optional: Fallback to raw string (default: true)
}
```

## Error Handling

The implementation handles various error scenarios:

1. **Invalid nostr strings** - Returns null gracefully
2. **Network failures** - Shows error state with fallback
3. **Missing profiles** - Falls back to truncated pubkey
4. **Relay timeouts** - Handled by NDK with retry logic

## Performance Optimizations

1. **In-memory caching** - Avoids repeated relay queries
2. **Batch processing** - Loads multiple profiles efficiently
3. **Preloading** - Automatically preloads profiles in content
4. **Cache cleanup** - Prevents memory leaks
5. **Concurrent limits** - Processes profiles in batches of 10

## Testing

Visit `/profile-test` route to test the implementation with sample profile links.

### Test Scenarios

- Valid profile links with names
- Anonymous profiles (no name)
- Network errors
- Cache behavior
- Batch loading

## Integration Points

### NoteContent Component

The `NoteContent.svelte` component automatically:
- Detects `nostr:nprofile1...` links
- Renders them as `ProfileLink` components
- Preloads profiles for better UX
- Falls back to raw links for other nostr types

### Existing Components

Compatible with existing profile components:
- `AuthorProfile.svelte` - Uses NDK's built-in components
- `ProfileLists.svelte` - Can be enhanced to use new resolver

## Future Enhancements

1. **NIP-05 verification** - Display verified usernames
2. **Profile pictures** - Show profile avatars in links
3. **Offline support** - Cache profiles for offline viewing
4. **Custom relays** - Allow user-defined relay lists
5. **Profile search** - Search profiles by name or pubkey

## Troubleshooting

### Common Issues

1. **Profiles not loading** - Check relay connectivity
2. **Cache not working** - Clear cache with `profileActions.clearAll()`
3. **TypeScript errors** - Ensure all imports are correct

### Debug Tools

```typescript
import { getCacheStats, clearProfileCache } from '$lib/profileResolver';

// Check cache status
console.log(getCacheStats());

// Clear cache manually
clearProfileCache();
```

## Dependencies

- `nostr-tools` - NIP-19 encoding/decoding
- `@nostr-dev-kit/ndk` - Relay communication
- `svelte/store` - State management
- `@nostr-dev-kit/ndk-cache-dexie` - Persistent caching

## License

MIT License - Same as the main project.


