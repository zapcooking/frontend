<script lang="ts">
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { ndk, userPublickey } from '$lib/nostr';
  import { nip19 } from 'nostr-tools';
  import { format as formatDate } from 'timeago.js';
  import CustomAvatar from './CustomAvatar.svelte';
  import { resolveProfileByPubkey, formatDisplayName } from '$lib/profileResolver';
  import HeartIcon from 'phosphor-svelte/lib/Heart';
  import { onMount } from 'svelte';

  export let event: NDKEvent;
  export let replies: NDKEvent[] = [];
  export let refresh: () => void;
  export let mainEventId: string;

  // Display state
  let displayName = '';
  let isLoading = true;

  // Reply box state
  let showReplyBox = false;
  let replyText = '';
  let postingReply = false;

  // Like state
  let liked = false;
  let likeCount = 0;
  let likesLoading = true;
  let processedLikes = new Set();

  // Load profile
  onMount(async () => {
    if (event.pubkey && $ndk) {
      try {
        const profile = await resolveProfileByPubkey(event.pubkey, $ndk);
        displayName = formatDisplayName(profile);
      } catch (error) {
        displayName = '@Anonymous';
      } finally {
        isLoading = false;
      }
    }

    // Load likes
    const likeSub = $ndk.subscribe({
      kinds: [7],
      '#e': [event.id]
    });

    likeSub.on('event', (e) => {
      // Prevent counting the same like multiple times
      if (processedLikes.has(e.id)) return;
      processedLikes.add(e.id);

      if (e.pubkey === $userPublickey) liked = true;
      likeCount++;
      likesLoading = false;
    });

    likeSub.on('eose', () => {
      likesLoading = false;
    });
  });

  // Like comment
  async function toggleLike() {
    if (liked || !$userPublickey) return;

    const reactionEvent = new NDKEvent($ndk);
    reactionEvent.kind = 7;
    reactionEvent.content = '+';
    reactionEvent.tags = [
      ['e', event.id, '', 'reply'],
      ['p', event.pubkey]
    ];

    await reactionEvent.publish();
    liked = true;
    likeCount++;
  }

  // Post reply
  async function postReply() {
    if (!replyText.trim() || postingReply) return;

    postingReply = true;
    const ev = new NDKEvent($ndk);
    ev.kind = 1;
    ev.content = replyText.trim();

    // Tag the main event, this comment, and relevant people
    ev.tags = [
      ['e', mainEventId, '', 'root'],
      ['e', event.id, '', 'reply'],
      ['p', event.pubkey]
    ];

    await ev.publish();
    replyText = '';
    showReplyBox = false;
    postingReply = false;
    refresh();
  }

  // Filter direct replies to this comment
  $: directReplies = replies.filter((e) => {
    const eTags = e.getMatchingTags('e');
    // Find replies that reference this comment
    return eTags.some(tag => tag[1] === event.id && tag[3] === 'reply');
  });
</script>

<div class="flex gap-2 sm:gap-3">
  <!-- Avatar -->
  <a href="/user/{nip19.npubEncode(event.pubkey)}" class="flex-shrink-0">
    <CustomAvatar className="rounded-full" pubkey={event.pubkey} size={32} />
  </a>

  <!-- Content -->
  <div class="flex-1 min-w-0">
    <!-- Name + Time -->
    <div class="flex items-center gap-2 mb-1">
      <a href="/user/{nip19.npubEncode(event.pubkey)}" class="font-semibold text-sm hover:underline">
        {#if isLoading}
          <span class="animate-pulse">Loading...</span>
        {:else}
          {displayName}
        {/if}
      </a>
      <span class="text-gray-500 text-xs">
        {formatDate(new Date((event.created_at || 0) * 1000))}
      </span>
    </div>

    <!-- Comment Text -->
    <p class="text-sm text-gray-900 mb-2 break-words">
      {event.content}
    </p>

    <!-- Actions -->
    <div class="flex items-center gap-3 text-xs text-gray-600">
      <!-- Like Button -->
      <button
        on:click={toggleLike}
        class="flex items-center gap-1 transition"
        class:text-red-500={liked}
        class:text-black={!liked}
        disabled={!$userPublickey}
      >
        <HeartIcon size={14} weight={liked ? 'fill' : 'regular'} />
        {#if !likesLoading && likeCount > 0}
          <span>{likeCount}</span>
        {/if}
      </button>

      <!-- Reply Button -->
      {#if $userPublickey}
        <button
          on:click={() => (showReplyBox = !showReplyBox)}
          class="hover:text-primary transition font-medium"
        >
          {showReplyBox ? 'Cancel' : 'Reply'}
        </button>
      {/if}
    </div>

    <!-- Inline Reply Box -->
    {#if showReplyBox}
      <div class="mt-2 space-y-2">
        <textarea
          bind:value={replyText}
          placeholder="Add a reply..."
          class="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-primary focus:border-transparent"
          rows="2"
        />
        <div class="flex gap-2">
          <button
            on:click={postReply}
            disabled={!replyText.trim() || postingReply}
            class="px-3 py-1.5 text-xs bg-primary text-white rounded-lg font-medium hover:bg-opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {postingReply ? 'Posting...' : 'Post'}
          </button>
          <button
            on:click={() => {
              showReplyBox = false;
              replyText = '';
            }}
            class="px-3 py-1.5 text-xs bg-gray-100 rounded-lg font-medium hover:bg-gray-200"
          >
            Cancel
          </button>
        </div>
      </div>
    {/if}

    <!-- Nested Replies -->
    {#if directReplies.length > 0}
      <div class="mt-3 space-y-3 pl-3 border-l-2 border-gray-100">
        {#each directReplies as reply}
          <svelte:self event={reply} {replies} {refresh} {mainEventId} />
        {/each}
      </div>
    {/if}
  </div>
</div>
