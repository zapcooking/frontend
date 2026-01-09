<script lang="ts">
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { ndk, userPublickey } from '$lib/nostr';
  import { nip19 } from 'nostr-tools';
  import { format as formatDate } from 'timeago.js';
  import CustomAvatar from './CustomAvatar.svelte';
  import ZapModal from './ZapModal.svelte';
  import { resolveProfileByPubkey, formatDisplayName } from '$lib/profileResolver';
  import { formatAmount } from '$lib/utils';
  import { addClientTagToEvent } from '$lib/nip89';
  import { buildNip22CommentTags } from '$lib/tagUtils';
  import HeartIcon from 'phosphor-svelte/lib/Heart';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import RichTextNostr from './RichTextNostr.svelte';
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { decode } from '@gandlaf21/bolt11-decode';

  export let event: NDKEvent;
  export let allReplies: NDKEvent[] = []; // All replies for finding parent
  export let refresh: () => void;

  // Display state
  let displayName = '';
  let isLoading = true;

  // Parent comment state (for embedded quote)
  let parentComment: NDKEvent | null = null;
  let parentDisplayName = '';
  let parentLoading = true;

  // Reply box state
  let showReplyBox = false;
  let replyText = '';
  let postingReply = false;
  let replyTextareaEl: HTMLTextAreaElement;

  // @ mention autocomplete state
  let mentionQuery = '';
  let showMentionSuggestions = false;
  let mentionStartPos = 0;
  let mentionSuggestions: { name: string; npub: string; picture?: string; pubkey: string; nip05?: string }[] = [];
  let selectedMentionIndex = 0;
  let mentionProfileCache: Map<string, { name: string; npub: string; picture?: string; pubkey: string; nip05?: string }> = new Map();
  let mentionFollowListLoaded = false;
  let mentionSearchTimeout: ReturnType<typeof setTimeout>;
  let mentionSearching = false;

  // Like state
  let liked = false;
  let likeCount = 0;
  let likesLoading = true;
  let processedLikes = new Set();
  let likeSubscription: any = null;

  // Zap state
  let zapModalOpen = false;
  let totalZapAmount = 0;
  let hasUserZapped = false;
  let processedZaps = new Set<string>();
  let zapSubscription: any = null;

  // Find parent comment ID (if replying to another comment)
  function getParentCommentId(): string | null {
    const eTags = event.getMatchingTags('e');
    // Look for a 'reply' tag
    const replyTag = eTags.find(tag => tag[3] === 'reply');
    if (replyTag) {
      // Check if this reply tag points to another comment (not the root recipe)
      const aTag = event.getMatchingTags('a')[0];
      // If it's a reply and there's another e tag, it might be a nested reply
      const parentEventTag = eTags.find(tag => tag[3] !== 'reply' && tag[3] !== 'root');
      if (parentEventTag) return parentEventTag[1];
      
      // Check if the reply tag points to something we can find in allReplies
      if (allReplies.some(r => r.id === replyTag[1])) {
        return replyTag[1];
      }
    }
    return null;
  }

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
      
      // Load ALL follows
      const followPubkeys = contactEvent.tags
        .filter(t => t[0] === 'p' && t[1])
        .map(t => t[1]);
      
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
              if (name || profile.nip05) {
                mentionProfileCache.set(event.pubkey, {
                  name: name || profile.nip05?.split('@')[0] || 'Unknown',
                  npub: nip19.npubEncode(event.pubkey),
                  picture: profile.picture,
                  pubkey: event.pubkey,
                  nip05: profile.nip05
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
    // Don't wait for follow list - search in parallel
    loadMentionFollowList();
    
    const queryLower = query.toLowerCase();
    const matches: { name: string; npub: string; picture?: string; pubkey: string; nip05?: string }[] = [];
    const seenPubkeys = new Set<string>();
    
    // Search local cache - by name AND NIP-05
    for (const profile of mentionProfileCache.values()) {
      const nameMatch = profile.name.toLowerCase().includes(queryLower);
      const nip05Match = profile.nip05?.toLowerCase().includes(queryLower);
      
      if (nameMatch || nip05Match) {
        matches.push(profile);
        seenPubkeys.add(profile.pubkey);
      }
    }
    
    // Show local matches immediately
    if (matches.length > 0) {
      mentionSuggestions = matches.slice(0, 10);
      selectedMentionIndex = 0;
    }
    
    // Always search the network for more results
    if (query.length >= 1 && $ndk) {
      mentionSearching = true;
      try {
        const searchResults = await $ndk.fetchEvents({
          kinds: [0],
          search: query,
          limit: 50
        });
        
        for (const event of searchResults) {
          if (seenPubkeys.has(event.pubkey)) continue;
          
          try {
            const profile = JSON.parse(event.content);
            const name = profile.display_name || profile.name || '';
            const nip05 = profile.nip05;
            
            const profileData = {
              name: name || nip05?.split('@')[0] || profile.name || 'Unknown',
              npub: nip19.npubEncode(event.pubkey),
              picture: profile.picture,
              pubkey: event.pubkey,
              nip05
            };
            matches.push(profileData);
            seenPubkeys.add(event.pubkey);
            mentionProfileCache.set(event.pubkey, profileData);
          } catch {}
        }
      } catch (e) {
        console.debug('Network search failed:', e);
      } finally {
        mentionSearching = false;
      }
    }
    
    // Sort: prioritize exact matches
    matches.sort((a, b) => {
      const aExact = a.name.toLowerCase().startsWith(queryLower) || a.nip05?.toLowerCase().startsWith(queryLower);
      const bExact = b.name.toLowerCase().startsWith(queryLower) || b.nip05?.toLowerCase().startsWith(queryLower);
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      return a.name.localeCompare(b.name);
    });
    
    mentionSuggestions = matches.slice(0, 10);
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

  // Load profile and parent comment
  onMount(async () => {
    // Preload mention profiles in background
    if ($userPublickey) {
      loadMentionFollowList();
    }
    
    // Load author profile
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

    // Load parent comment if this is a reply to another comment
    const parentId = getParentCommentId();
    if (parentId) {
      // First check in allReplies
      parentComment = allReplies.find(c => c.id === parentId) || null;
      
      // If not found locally, fetch it with timeout
      if (!parentComment && $ndk) {
        try {
          const fetchPromise = $ndk.fetchEvent({
            kinds: [1, 1111],
            ids: [parentId]
          });
          const timeoutPromise = new Promise<null>((resolve) => 
            setTimeout(() => resolve(null), 5000)
          );
          parentComment = await Promise.race([fetchPromise, timeoutPromise]);
        } catch (e) {
          console.debug('Failed to fetch parent comment:', e);
        }
      }
      
      // Load parent author name (resolveProfileByPubkey already has timeout)
      if (parentComment?.pubkey) {
        try {
          const profile = await resolveProfileByPubkey(parentComment.pubkey, $ndk);
          parentDisplayName = formatDisplayName(profile);
        } catch {
          parentDisplayName = '@Anonymous';
        }
      }
      parentLoading = false;
    } else {
      parentLoading = false;
    }

    // Load likes
    likeSubscription = $ndk.subscribe({
      kinds: [7],
      '#e': [event.id]
    });

    likeSubscription.on('event', (e) => {
      if (processedLikes.has(e.id)) return;
      processedLikes.add(e.id);
      if (e.pubkey === $userPublickey) liked = true;
      likeCount++;
      likesLoading = false;
    });

    likeSubscription.on('eose', () => {
      likesLoading = false;
    });

    // Load zaps
    loadZaps();
  });

  // Load zaps for this comment
  function loadZaps() {
    if (!event?.id || !$ndk) return;
    
    totalZapAmount = 0;
    processedZaps.clear();
    hasUserZapped = false;

    zapSubscription = $ndk.subscribe({
      kinds: [9735],
      '#e': [event.id]
    });

    zapSubscription.on('event', (zapEvent: NDKEvent) => {
      if (!zapEvent.sig || processedZaps.has(zapEvent.sig)) return;

      const bolt11 = zapEvent.tags.find((tag) => tag[0] === 'bolt11')?.[1];
      if (!bolt11) return;

      try {
        const decoded = decode(bolt11);
        const amountSection = decoded.sections.find((section: any) => section.name === 'amount');

        if (amountSection && amountSection.value) {
          const amount = Number(amountSection.value);
          if (!isNaN(amount) && amount > 0) {
            totalZapAmount += amount;
            processedZaps.add(zapEvent.sig);

            if (zapEvent.tags.some((tag) => tag[0] === 'P' && tag[1] === $userPublickey)) {
              hasUserZapped = true;
            }
          }
        }
      } catch (error) {
        console.debug('Error decoding bolt11:', error);
      }
    });
  }

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
    addClientTagToEvent(reactionEvent);
    await reactionEvent.publish();
    liked = true;
    likeCount++;
  }

  // Post reply
  async function postReply() {
    if (!replyText.trim() || postingReply) return;

    postingReply = true;
    const ev = new NDKEvent($ndk);
    
    // Check if this is a reply to a recipe comment
    // If the parent comment is kind 1111 or has an 'a' tag referencing kind 30023, use kind 1111
    const aTag = event.getMatchingTags('a')[0];
    const ATag = event.getMatchingTags('A')[0];
    const isRecipeReply = event.kind === 1111 || (aTag && aTag[1]?.startsWith('30023:')) || (ATag && ATag[1]?.startsWith('30023:'));
    ev.kind = isRecipeReply ? 1111 : 1;
    
    ev.content = replyText.trim();
    
    // Reconstruct a minimal event object for the parent comment
    const parentEventObj = {
      id: event.id,
      pubkey: event.pubkey,
      kind: event.kind,
      tags: event.tags
    };
    
    // For recipe replies, we need to get the root event info from the parent's tags
    if (isRecipeReply) {
      // Get root event info from parent comment's tags
      const rootATag = event.getMatchingTags('A')[0] || event.getMatchingTags('a')[0];
      
      if (rootATag) {
        // Parse the address tag to extract root event info
        const [kind, pubkey, ...dTagParts] = rootATag[1].split(':');
        const dTag = dTagParts.join(':');
        const rootEventObj = {
          kind: parseInt(kind),
          pubkey: pubkey,
          id: '', // We don't need the actual event ID for tag generation
          tags: [['d', dTag], ['relay', rootATag[2] || '']]
        };
        
        // Use the utility with both root and parent event
        ev.tags = buildNip22CommentTags(rootEventObj, parentEventObj);
      } else {
        // Fallback: treat parent as if it's the root
        ev.tags = buildNip22CommentTags(parentEventObj, parentEventObj);
      }
    } else {
      // For non-recipe replies, we still need to construct a root event object
      // In this case, we need to find the root event ID from the parent's tags
      const rootETag = event.getMatchingTags('e').find(t => t[3] === 'root');
      if (rootETag) {
        // Derive the root author's pubkey from the parent's p-tags when possible
        const rootPTags = event.getMatchingTags('p');
        const rootPubkey = rootPTags && rootPTags.length > 0 ? rootPTags[0][1] : event.pubkey;
        const rootEventObj = {
          kind: 1,
          pubkey: rootPubkey, // Use root author's pubkey when available, otherwise fall back to parent
          id: rootETag[1], // Root event ID from the e tag
          tags: []
        };
        ev.tags = buildNip22CommentTags(rootEventObj, parentEventObj);
      } else {
        // Use the simplified version for replies
        ev.tags = [
          ['e', event.id, '', 'reply'],
          ['p', event.pubkey]
        ];
      }
    }
    
    // Parse and add @ mention tags (p tags)
    const mentions = parseMentions(replyText.trim());
    for (const pubkey of mentions.values()) {
      if (!ev.tags.some(t => t[0] === 'p' && t[1] === pubkey)) {
        ev.tags.push(['p', pubkey]);
      }
    }
    
    addClientTagToEvent(ev);
    await ev.publish();
    replyText = '';
    showMentionSuggestions = false;
    showReplyBox = false;
    postingReply = false;
    refresh();
  }

  onDestroy(() => {
    if (mentionSearchTimeout) {
      clearTimeout(mentionSearchTimeout);
    }
    if (likeSubscription) {
      likeSubscription.stop();
    }
    if (zapSubscription) {
      zapSubscription.stop();
    }
  });

  // Open zap modal
  function openZapModal() {
    zapModalOpen = true;
  }

  // Truncate content for parent quote
  function truncateContent(content: string, maxLength: number = 100): string {
    const cleaned = content
      .replace(/https?:\/\/[^\s]+/g, '[link]')
      .replace(/nostr:[^\s]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length <= maxLength) return cleaned;
    return cleaned.slice(0, maxLength).trim() + '...';
  }
</script>

<div class="comment-card">
  <!-- Embedded parent quote (if replying to another comment) -->
  {#if !parentLoading && parentComment}
    <div class="parent-quote">
      <div class="parent-quote-header">
        <CustomAvatar pubkey={parentComment.pubkey} size={16} />
        <span class="parent-quote-author">{parentDisplayName || 'Loading...'}</span>
      </div>
      <p class="parent-quote-content">{truncateContent(parentComment.content)}</p>
    </div>
  {/if}

  <!-- Main comment row -->
  <div class="comment-row">
  <!-- Avatar -->
    <a href="/user/{nip19.npubEncode(event.pubkey)}" class="comment-avatar">
    <CustomAvatar className="rounded-full" pubkey={event.pubkey} size={40} />
  </a>

  <!-- Content -->
    <div class="comment-content">
    <!-- Name + Time -->
      <div class="comment-header">
        <a href="/user/{nip19.npubEncode(event.pubkey)}" class="comment-author">
        {#if isLoading}
          <span class="animate-pulse">Loading...</span>
        {:else}
          {displayName}
        {/if}
      </a>
        <span class="comment-time">
        {formatDate(new Date((event.created_at || 0) * 1000))}
      </span>
    </div>

    <!-- Comment Text -->
      <div class="comment-body">
      <!-- TODO: Fix RichTextNostr freezing issue with nostr: references -->
      <p class="whitespace-pre-wrap">{event.content}</p>
    </div>

    <!-- Actions -->
      <div class="comment-actions">
      <!-- Like Button -->
      <button
        on:click={toggleLike}
          class="action-btn"
        class:text-red-500={liked}
        disabled={!$userPublickey}
      >
        <HeartIcon size={16} weight={liked ? 'fill' : 'regular'} />
        {#if !likesLoading && likeCount > 0}
          <span>{likeCount}</span>
        {/if}
      </button>

        <!-- Zap Button -->
        {#if $userPublickey}
          <button
            on:click={openZapModal}
            class="action-btn zap-btn"
            class:text-yellow-500={hasUserZapped}
          >
            <LightningIcon size={16} weight={hasUserZapped ? 'fill' : 'regular'} />
            {#if totalZapAmount > 0}
              <span>{formatAmount(totalZapAmount / 1000)}</span>
            {/if}
          </button>
        {:else}
          <span class="action-btn zap-display">
            <LightningIcon size={16} class={totalZapAmount > 0 ? 'text-yellow-500' : ''} />
            {#if totalZapAmount > 0}
              <span>{formatAmount(totalZapAmount / 1000)}</span>
            {/if}
          </span>
        {/if}

      <!-- Reply Button -->
      <button
        on:click={() => (showReplyBox = !showReplyBox)}
          class="action-btn action-btn-text"
      >
        {showReplyBox ? 'Cancel' : 'Reply'}
      </button>
    </div>

    <!-- Inline Reply Box -->
    {#if showReplyBox}
        <div class="reply-form">
          <div class="relative">
        <textarea
              bind:this={replyTextareaEl}
          bind:value={replyText}
          placeholder="Add a reply..."
              class="reply-textarea"
          rows="3"
              on:input={handleReplyInput}
              on:keydown={handleReplyKeydown}
            />
            
            <!-- Mention suggestions dropdown -->
            {#if showMentionSuggestions}
              <div 
                class="mention-dropdown"
                style="border-color: var(--color-input-border);"
              >
                {#if mentionSuggestions.length > 0}
                  <div class="mention-dropdown-content">
                    {#each mentionSuggestions as suggestion, index}
                      <button
                        type="button"
                        on:click={() => insertMention(suggestion)}
                        on:mousedown|preventDefault={() => insertMention(suggestion)}
                        class="mention-option"
                        class:mention-selected={index === selectedMentionIndex}
                      >
                        <CustomAvatar pubkey={suggestion.pubkey} size={24} />
                        <div class="mention-info">
                          <span class="mention-name">{suggestion.name}</span>
                          {#if suggestion.nip05}
                            <span class="mention-nip05">{suggestion.nip05}</span>
                          {/if}
                        </div>
                      </button>
                    {/each}
                  </div>
                {:else if mentionSearching}
                  <div class="mention-empty">Searching...</div>
                {:else if mentionQuery.length > 0}
                  <div class="mention-empty">No users found</div>
                {/if}
              </div>
            {/if}
          </div>
          <div class="reply-buttons">
          <button
            on:click={postReply}
            disabled={!replyText.trim() || postingReply}
              class="btn-post"
          >
            {postingReply ? 'Posting...' : 'Post'}
          </button>
          <button
            on:click={() => {
              showReplyBox = false;
              replyText = '';
                showMentionSuggestions = false;
            }}
              class="btn-cancel"
          >
            Cancel
          </button>
        </div>
      </div>
    {/if}
      </div>
  </div>
</div>

<!-- Zap Modal -->
{#if zapModalOpen}
  <ZapModal bind:open={zapModalOpen} {event} />
{/if}

<style>
  /* Comment card - full width, no nesting */
  .comment-card {
    width: 100%;
  }

  /* Parent quote embed */
  .parent-quote {
    margin-bottom: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: var(--color-input);
    border-left: 3px solid var(--color-primary, #f97316);
    border-radius: 0.375rem;
  }

  .parent-quote-header {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-bottom: 0.25rem;
  }

  .parent-quote-author {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text-secondary);
  }

  .parent-quote-content {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    line-height: 1.4;
    margin: 0;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  /* Comment row - 2 column flex layout */
  .comment-row {
    display: flex;
    gap: 0.5rem;
  }

  @media (min-width: 640px) {
    .comment-row {
      gap: 0.75rem;
    }
  }

  /* Avatar - fixed width */
  .comment-avatar {
    flex: 0 0 auto;
    width: 40px;
  }

  /* Content - takes remaining width */
  .comment-content {
    flex: 1 1 0%;
    min-width: 0;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  /* Header - wraps on mobile */
  .comment-header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.5rem;
    margin-bottom: 0.25rem;
  }

  .comment-author {
    font-weight: 600;
    font-size: 1rem;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .comment-author:hover {
    text-decoration: underline;
  }

  .comment-time {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  /* Body text */
  .comment-body {
    font-size: 1rem;
    margin-bottom: 0.5rem;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  /* Actions */
  .comment-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
    font-size: 0.875rem;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--color-text-primary);
    transition: color 0.15s;
  }

  .action-btn:hover {
    color: var(--color-primary);
  }

  .action-btn-text {
    font-weight: 500;
  }

  .zap-btn:hover {
    color: #eab308; /* yellow-500 */
  }

  .zap-display {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--color-text-secondary);
  }

  /* Reply form */
  .reply-form {
    margin-top: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .reply-textarea {
    width: 100%;
    padding: 0.5rem 0.75rem;
    font-size: 1rem;
    border-radius: 0.5rem;
    resize: none;
    background: var(--color-input);
    border: 1px solid var(--color-input-border);
    color: var(--color-text-primary);
  }

  .reply-textarea:focus {
    outline: none;
    box-shadow: 0 0 0 2px var(--color-primary);
  }

  .reply-buttons {
    display: flex;
    gap: 0.5rem;
  }

  .btn-post {
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: white;
    background: var(--color-primary);
    border-radius: 0.5rem;
  }

  .btn-post:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-cancel {
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-text-primary);
    background: var(--color-input);
    border-radius: 0.5rem;
  }

  .btn-cancel:hover {
    opacity: 0.8;
  }

  /* Mention dropdown - compact and scrollable */
  .mention-dropdown {
    position: absolute;
    z-index: 50;
    top: 100%;
    left: 0;
    margin-top: 0.25rem;
    width: 280px;
    max-width: calc(100vw - 2rem);
    background: var(--color-input);
    border: 1px solid var(--color-input-border);
    border-radius: 0.5rem;
    box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -1px rgb(0 0 0 / 0.06);
    overflow: hidden;
  }

  .mention-dropdown-content {
    max-height: 200px;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .mention-dropdown-content::-webkit-scrollbar {
    width: 6px;
  }

  .mention-dropdown-content::-webkit-scrollbar-track {
    background: transparent;
  }

  .mention-dropdown-content::-webkit-scrollbar-thumb {
    background: var(--color-input-border);
    border-radius: 3px;
  }

  .mention-dropdown-content::-webkit-scrollbar-thumb:hover {
    background: var(--color-caption);
  }

  .mention-option {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    text-align: left;
    transition: background-color 0.15s;
    border: none;
    background: transparent;
  }

  .mention-option:hover,
  .mention-selected {
    background: var(--color-accent-gray);
  }

  .mention-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .mention-name {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mention-nip05 {
    font-size: 0.75rem;
    color: var(--color-caption);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mention-empty {
    padding: 0.75rem;
    text-align: center;
    font-size: 0.875rem;
    color: var(--color-caption);
  }
</style>
