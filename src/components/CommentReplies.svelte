<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import CustomAvatar from './CustomAvatar.svelte';
  import CustomName from './CustomName.svelte';
  import { nip19 } from 'nostr-tools';
  import { format as formatDate } from 'timeago.js';
  import Button from './Button.svelte';
  import { addClientTagToEvent } from '$lib/nip89';
  import CommentLikes from './CommentLikes.svelte';
  import { get } from 'svelte/store';

  export let parentComment: NDKEvent;
  
  let showReplies = false;
  let replies: NDKEvent[] = [];
  let loading = false;
  let replyText = '';
  let postingReply = false;
  let replyCount = 0;
  let errorMessage = '';
  let successMessage = '';
  let replyTextareaEl: HTMLTextAreaElement;
  let replySubscription: any = null;

  // @ mention autocomplete state
  let mentionQuery = '';
  let showMentionSuggestions = false;
  let mentionStartPos = 0;
  let mentionSuggestions: { name: string; npub: string; picture?: string; pubkey: string }[] = [];
  let selectedMentionIndex = 0;
  let mentionProfileCache: Map<string, { name: string; npub: string; picture?: string; pubkey: string }> = new Map();
  let mentionFollowListLoaded = false;
  let mentionSearchTimeout: ReturnType<typeof setTimeout>;

  // Load follow list profiles for mention autocomplete
  async function loadMentionFollowList() {
    if (mentionFollowListLoaded) return;
    
    const pubkey = get(userPublickey);
    if (!pubkey || !$ndk) return;
    
    try {
      const contactEvent = await $ndk.fetchEvent({
        kinds: [3],
        authors: [pubkey],
        limit: 1
      });
      
      if (!contactEvent) return;
      
      const followPubkeys = contactEvent.tags
        .filter(t => t[0] === 'p' && t[1])
        .map(t => t[1])
        .slice(0, 500);
      
      if (followPubkeys.length === 0) return;
      
      const batchSize = 100;
      for (let i = 0; i < followPubkeys.length; i += batchSize) {
        const batch = followPubkeys.slice(i, i + batchSize);
        try {
          const events = await $ndk.fetchEvents({
            kinds: [0],
            authors: batch
          });
          
          for (const event of events) {
            try {
              const profile = JSON.parse(event.content);
              const name = profile.display_name || profile.name || '';
              if (name) {
                mentionProfileCache.set(event.pubkey, {
                  name,
                  npub: nip19.npubEncode(event.pubkey),
                  picture: profile.picture,
                  pubkey: event.pubkey
                });
              }
            } catch {}
          }
        } catch (e) {
          console.debug('Failed to fetch mention profile batch:', e);
        }
      }
      
      mentionFollowListLoaded = true;
    } catch (e) {
      console.debug('Failed to load mention follow list:', e);
    }
  }

  // Search users for mention autocomplete
  async function searchMentionUsers(query: string) {
    if (!mentionFollowListLoaded) {
      await loadMentionFollowList();
    }
    
    const queryLower = query.toLowerCase();
    const matches: { name: string; npub: string; picture?: string; pubkey: string }[] = [];
    
    for (const profile of mentionProfileCache.values()) {
      if (profile.name.toLowerCase().includes(queryLower)) {
        matches.push(profile);
        if (matches.length >= 8) break;
      }
    }
    
    mentionSuggestions = matches;
    selectedMentionIndex = 0;
  }

  // Handle textarea input for @ mentions
  function handleReplyInput(event: Event) {
    const textarea = event.target as HTMLTextAreaElement;
    const cursorPos = textarea.selectionStart;
    const text = replyText;
    
    const textBeforeCursor = text.substring(0, cursorPos);
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/);
    
    if (mentionMatch) {
      mentionStartPos = cursorPos - mentionMatch[0].length;
      mentionQuery = mentionMatch[1];
      showMentionSuggestions = true;
      
      if (mentionSearchTimeout) clearTimeout(mentionSearchTimeout);
      mentionSearchTimeout = setTimeout(() => {
        if (mentionQuery.length > 0) {
          searchMentionUsers(mentionQuery);
        } else {
          mentionSuggestions = Array.from(mentionProfileCache.values()).slice(0, 8);
          selectedMentionIndex = 0;
        }
      }, 150);
    } else {
      showMentionSuggestions = false;
      mentionSuggestions = [];
    }
  }

  // Insert mention into textarea
  function insertMention(user: { name: string; npub: string }) {
    if (!replyTextareaEl) return;
    
    const beforeMention = replyText.substring(0, mentionStartPos);
    const afterMention = replyText.substring(replyTextareaEl.selectionStart);
    const mentionText = `@${user.name} `;
    
    replyText = beforeMention + mentionText + afterMention;
    showMentionSuggestions = false;
    mentionSuggestions = [];
    
    setTimeout(() => {
      const newPos = beforeMention.length + mentionText.length;
      replyTextareaEl.setSelectionRange(newPos, newPos);
      replyTextareaEl.focus();
    }, 0);
  }

  // Parse @ mentions from content and return pubkeys
  function parseMentions(text: string): Map<string, string> {
    const mentions = new Map<string, string>();
    const mentionRegex = /@(\w+)\s/g;
    let match;
    
    while ((match = mentionRegex.exec(text)) !== null) {
      const username = match[1];
      for (const [pubkey, profile] of mentionProfileCache.entries()) {
        if (profile.name.toLowerCase() === username.toLowerCase()) {
          mentions.set(`@${username}`, pubkey);
          break;
        }
      }
    }
    
    return mentions;
  }

  // Handle keyboard navigation in mention suggestions
  function handleReplyKeydown(event: KeyboardEvent) {
    if (showMentionSuggestions && mentionSuggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedMentionIndex = (selectedMentionIndex + 1) % mentionSuggestions.length;
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedMentionIndex = selectedMentionIndex === 0 ? mentionSuggestions.length - 1 : selectedMentionIndex - 1;
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        insertMention(mentionSuggestions[selectedMentionIndex]);
      } else if (event.key === 'Escape') {
        showMentionSuggestions = false;
        mentionSuggestions = [];
      }
      return;
    }
  }

  // Load replies for this comment
  async function loadReplies() {
    if (loading) return;
    
    loading = true;
    replies = [];
    replyCount = 0;
    
    // Close previous subscription if exists
    if (replySubscription) {
      replySubscription.stop();
    }
    
    try {
      // Use subscribe collection for more reliable reply loading
      replySubscription = $ndk.subscribe({
        kinds: [1],
        '#e': [parentComment.id] // Replies that reference this comment
      }, { closeOnEose: true });
      
      replySubscription.on("event", (ev) => {
        loading = false;
        replies.push(ev);
        replies = replies;
      });
      
      replySubscription.on("eose", () => {
        loading = false;
      });
    } catch (error) {
      console.error('Error loading replies:', error);
      loading = false;
    }
  }

  // Post a new reply
  async function postReply() {
    if (!replyText.trim() || postingReply || !$ndk.signer) return;
    
    postingReply = true;
    errorMessage = '';
    successMessage = '';
    
    try {
      const replyEvent = new NDKEvent($ndk);
      replyEvent.kind = 1;
      replyEvent.content = replyText.trim();
      replyEvent.tags = [
        ['e', parentComment.id, '', 'reply'], // Reference the parent comment
        ['p', parentComment.pubkey], // Reference the parent comment author
        ...parentComment.getMatchingTags('e') // Include any other event references from parent
      ];
      
      // Parse and add @ mention tags (p tags)
      const mentions = parseMentions(replyText.trim());
      for (const pubkey of mentions.values()) {
        // Avoid duplicate p tags
        if (!replyEvent.tags.some(t => t[0] === 'p' && t[1] === pubkey)) {
          replyEvent.tags.push(['p', pubkey]);
        }
      }
      
      // Add NIP-89 client tag
      addClientTagToEvent(replyEvent);
      
      await replyEvent.publish();
      
      // Clear the form and show success
      replyText = '';
      showMentionSuggestions = false;
      successMessage = 'Reply posted successfully!';
      
      // Reload replies to show the new one
      await loadReplies();
      
      // Clear success message after a delay
      setTimeout(() => {
        successMessage = '';
      }, 3000);
      
    } catch (error) {
      console.error('Error posting reply:', error);
      errorMessage = 'Failed to post reply. Please try again.';
    } finally {
      postingReply = false;
    }
  }

  // Toggle replies visibility
  function toggleReplies() {
    showReplies = !showReplies;
    if (showReplies && replies.length === 0) {
      loadReplies();
    }
    // Preload mention profiles when opening replies
    if (showReplies && $userPublickey) {
      loadMentionFollowList();
    }
  }

  onDestroy(() => {
    if (mentionSearchTimeout) {
      clearTimeout(mentionSearchTimeout);
    }
    if (replySubscription) {
      replySubscription.stop();
    }
  });
</script>

<div class="comment-replies" data-comment-id={parentComment.id}>
  <!-- Reply Button -->
  <button
    on:click={toggleReplies}
    class="text-sm text-caption hover:text-primary font-medium cursor-pointer transition duration-300 print:hidden"
  >
    {showReplies ? 'Hide replies' : 'Reply'} {replyCount > 0 ? `(${replyCount})` : ''}
  </button>

  <!-- Replies Section -->
  {#if showReplies}
    <div class="mt-3 space-y-3">
      <!-- Authentication Status -->
      {#if !$ndk.signer}
        <div class="text-xs text-amber-600 bg-amber-50 p-2 rounded">
          <strong>Please log in</strong> to reply to comments.
        </div>
      {/if}
      
      <!-- Error/Success Messages -->
      {#if errorMessage}
        <div class="text-xs text-red-600 bg-red-50 p-2 rounded print:hidden">
          {errorMessage}
        </div>
      {/if}
      
      {#if successMessage}
        <div class="text-xs text-green-600 bg-green-50 p-2 rounded print:hidden">
          {successMessage}
        </div>
      {/if}
      
      <!-- Reply Form -->
      <div class="space-y-1 print:hidden">
        <div class="relative">
          <textarea
            bind:this={replyTextareaEl}
            bind:value={replyText}
            placeholder={$ndk.signer ? "Add a reply..." : "Log in to reply..."}
            disabled={!$ndk.signer}
            class="w-full px-4 py-3 text-sm input rounded-xl resize-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed transition duration-200"
            rows="3"
            on:input={handleReplyInput}
            on:keydown={handleReplyKeydown}
          />
          
          <!-- Mention suggestions dropdown -->
          {#if showMentionSuggestions && mentionSuggestions.length > 0}
            <div 
              class="absolute z-50 mt-1 w-full max-w-md bg-input rounded-lg shadow-lg border overflow-hidden"
              style="border-color: var(--color-input-border); max-height: 200px; overflow-y: auto;"
            >
              {#each mentionSuggestions as suggestion, index}
                <button
                  type="button"
                  on:click={() => insertMention(suggestion)}
                  on:mousedown|preventDefault={() => insertMention(suggestion)}
                  class="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent-gray transition-colors text-left"
                  class:bg-accent-gray={index === selectedMentionIndex}
                >
                  <CustomAvatar pubkey={suggestion.pubkey} size={24} />
                  <span class="text-sm" style="color: var(--color-text-primary)">{suggestion.name}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
        <div class="flex justify-end">
          <Button
            on:click={postReply}
            disabled={!replyText.trim() || postingReply || !$ndk.signer}
            class="px-4 py-2 text-sm"
          >
            {postingReply ? 'Posting...' : ($ndk.signer ? 'Post Reply' : 'Log in to reply')}
          </Button>
        </div>
      </div>

      <!-- Replies List -->
      <div class="replies-list">
        {#if loading}
          <div class="py-2 text-sm text-caption">Loading replies...</div>
        {:else if replies.length === 0}
          <div class="text-center py-2 text-xs text-caption">No replies yet</div>
        {:else}
          {#each replies as reply}
            <div class="reply-row">
              <div class="reply-avatar">
                <CustomAvatar
                  className="flex-shrink-0"
                  pubkey={reply.pubkey}
                  size={24}
                />
              </div>
              <div class="reply-content">
                <div class="reply-header">
                  <span class="reply-author">
                    <CustomName pubkey={reply.pubkey} />
                  </span>
                  <span class="reply-time">
                    {formatDate(new Date((reply.created_at || 0) * 1000))}
                  </span>
                </div>
                <p class="reply-body">
                  {reply.content}
                </p>
                <!-- Reply Actions -->
                <div class="flex items-center gap-2">
                  <CommentLikes event={reply} />
                </div>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  /* Replies list container */
  .replies-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  
  /* Reply row - 2 column flex layout */
  .reply-row {
    display: flex;
    gap: 0.5rem;
  }
  
  /* Avatar gutter - fixed width, never shrinks */
  .reply-avatar {
    flex: 0 0 auto;
    width: 24px;
  }
  
  /* Content column - takes remaining width, CAN shrink */
  .reply-content {
    flex: 1 1 0%;
    min-width: 0; /* Critical: allows content to shrink below intrinsic width */
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  
  /* Name + Time header - wraps naturally on mobile */
  .reply-header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.125rem 0.5rem;
    margin-bottom: 0.25rem;
  }
  
  .reply-author {
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  
  .reply-time {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }
  
  /* Reply body text */
  .reply-body {
    font-size: 0.875rem;
    line-height: 1.625;
    margin-bottom: 0.5rem;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
    word-break: break-word;
  }
</style>

