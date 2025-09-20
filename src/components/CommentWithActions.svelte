<script lang="ts">
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { ndk } from '$lib/nostr';
  import { format as formatDate } from 'timeago.js';
  import CustomAvatar from './CustomAvatar.svelte';
  import { resolveProfileByPubkey, formatDisplayName } from '$lib/profileResolver';
  import CommentLikes from './CommentLikes.svelte';
  import CommentReplies from './CommentReplies.svelte';
  import { onMount } from 'svelte';

  export let event: NDKEvent;

  let displayName: string = '';
  let isLoading: boolean = true;

  onMount(async () => {
    if (event.pubkey && $ndk) {
      try {
        isLoading = true;
        const profile = await resolveProfileByPubkey(event.pubkey, $ndk);
        displayName = formatDisplayName(profile);
      } catch (error) {
        console.error('Failed to load profile:', error);
        displayName = '@Anonymous';
      } finally {
        isLoading = false;
      }
    }
  });
</script>

<div class="flex gap-3 mb-3">
  <CustomAvatar
    className="flex-shrink-0"
    pubkey={event.pubkey}
    size={32}
  />
  <div class="flex-1 min-w-0">
    <div class="flex items-center gap-2 mb-1">
      <span class="font-medium text-sm text-gray-900">
        {#if isLoading}
          <span class="animate-pulse">Loading...</span>
        {:else}
          {displayName}
        {/if}
      </span>
      <span class="text-xs text-gray-500">
        {formatDate(new Date((event.created_at || 0) * 1000))}
      </span>
    </div>
    <p class="text-sm text-gray-700 leading-relaxed mb-2">
      {event.content}
    </p>
    
    <!-- Comment Actions -->
    <div class="flex items-center gap-3">
      <CommentLikes {event} />
      <CommentReplies parentComment={event} />
    </div>
  </div>
</div>

