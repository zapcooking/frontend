<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import Button from './Button.svelte';
  import { addClientTagToEvent } from '$lib/nip89';
  import FeedComment from './FeedComment.svelte';
  import CustomAvatar from './CustomAvatar.svelte';
  import { nip19 } from 'nostr-tools';
  import { get } from 'svelte/store';

  export let event: NDKEvent;
  let events: NDKEvent[] = [];
  let commentText = '';
  let processedEvents = new Set();
  let subscribed = false;
  let showComments = false;
  let commentTextareaEl: HTMLTextAreaElement;

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
  function handleCommentInput(event: Event) {
    const textarea = event.target as HTMLTextAreaElement;
    const cursorPos = textarea.selectionStart;
    const text = commentText;
    
    // Find @ mention before cursor
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
    if (!commentTextareaEl) return;
    
    const beforeMention = commentText.substring(0, mentionStartPos);
    const afterMention = commentText.substring(commentTextareaEl.selectionStart);
    const mentionText = `@${user.name} `;
    
    commentText = beforeMention + mentionText + afterMention;
    showMentionSuggestions = false;
    mentionSuggestions = [];
    
    setTimeout(() => {
      const newPos = beforeMention.length + mentionText.length;
      commentTextareaEl.setSelectionRange(newPos, newPos);
      commentTextareaEl.focus();
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
  function handleCommentKeydown(event: KeyboardEvent) {
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

  // Listen for toggle event from NoteTotalComments
  onMount(() => {
    const handleToggleEvent = () => {
      toggleComments();
    };

    const element = document.querySelector(`[data-event-id="${event.id}"]`);
    if (element) {
      element.addEventListener('toggleComments', handleToggleEvent);

      // Cleanup
      return () => {
        element.removeEventListener('toggleComments', handleToggleEvent);
      };
    }

    // Preload mention profiles in background
    if ($userPublickey) {
      loadMentionFollowList();
    }
  });

  onDestroy(() => {
    if (mentionSearchTimeout) {
      clearTimeout(mentionSearchTimeout);
    }
  });

  // Create subscription once when ndk is ready
  $: if ($ndk && !subscribed && showComments) {
    subscribed = true;

    const sub = $ndk.subscribe({
      kinds: [1],
      '#e': [event.id]
    }, { closeOnEose: false });

    sub.on('event', (e) => {
      if (processedEvents.has(e.id)) return;
      processedEvents.add(e.id);
      events.push(e);
      events = events;
    });

    sub.on('eose', () => {});
  }

  // Dummy refresh function for FeedComment component - not needed since subscription stays open
  function refresh() {
    // No-op: the subscription will automatically receive new events
  }

  async function postComment() {
    if (!commentText.trim()) return;

    try {
      const ev = new NDKEvent($ndk);
      ev.kind = 1;
      ev.content = commentText;
      ev.tags = [
        ['e', event.id, '', 'reply'],
        ['p', event.pubkey]
      ];
      
      // Parse and add @ mention tags (p tags)
      const mentions = parseMentions(commentText);
      for (const pubkey of mentions.values()) {
        // Avoid duplicate p tags
        if (!ev.tags.some(t => t[0] === 'p' && t[1] === pubkey)) {
          ev.tags.push(['p', pubkey]);
        }
      }
      
      // Add NIP-89 client tag
      addClientTagToEvent(ev);

      await ev.publish();
      commentText = '';
      showMentionSuggestions = false;
    } catch {
      // Failed to post comment
    }
  }

  function toggleComments() {
    showComments = !showComments;
  }

  // Sort all comments chronologically (oldest first for thread view)
  $: sortedComments = [...events].sort((a, b) => 
    (a.created_at || 0) - (b.created_at || 0)
  );
</script>

<div class="inline-comments" data-event-id={event.id}>
  {#if showComments}
    <div class="mt-3 space-y-4 pt-3" style="border-top: 1px solid var(--color-input-border)">
      <!-- Comments List - flat list with embedded parent quotes -->
      <div class="comments-list">
        {#if sortedComments.length === 0}
          <p class="text-sm text-caption">No comments yet. Be the first to comment!</p>
        {:else}
          {#each sortedComments as comment (comment.id)}
            <FeedComment event={comment} allComments={events} {refresh} mainEventId={event.id} />
          {/each}
        {/if}
      </div>

      <!-- Add Comment Form -->
      {#if $userPublickey}
        <div class="space-y-2 pt-2" style="border-top: 1px solid var(--color-input-border)">
          <div class="relative">
            <textarea
              bind:this={commentTextareaEl}
              bind:value={commentText}
              placeholder="Add a comment..."
              class="w-full px-3 py-2 text-sm rounded-lg resize-none focus:ring-2 focus:ring-primary focus:border-transparent bg-input"
              style="border: 1px solid var(--color-input-border); color: var(--color-text-primary)"
              rows="2"
              on:input={handleCommentInput}
              on:keydown={handleCommentKeydown}
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
          <div class="flex justify-end">
            <Button on:click={postComment} disabled={!commentText.trim()} class="text-sm px-4 py-2">
              Post Comment
            </Button>
          </div>
        </div>
      {:else}
        <div class="text-sm text-caption pt-2" style="border-top: 1px solid var(--color-input-border)">
          <a href="/login" class="text-primary hover:underline">Log in</a> to comment
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* Comments list - flat layout with spacing */
  .comments-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
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
