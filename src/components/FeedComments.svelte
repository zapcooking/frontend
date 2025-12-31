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
    if (!mentionFollowListLoaded) {
      await loadMentionFollowList();
    }
    
    const queryLower = query.toLowerCase();
    const matches: { name: string; npub: string; picture?: string; pubkey: string; nip05?: string }[] = [];
    
    // Search local cache - by name AND NIP-05
    for (const profile of mentionProfileCache.values()) {
      const nameMatch = profile.name.toLowerCase().includes(queryLower);
      const nip05Match = profile.nip05?.toLowerCase().includes(queryLower);
      
      if (nameMatch || nip05Match) {
        matches.push(profile);
        if (matches.length >= 8) break;
      }
    }
    
    // If not enough local matches, search network
    if (matches.length < 3 && query.length >= 2 && $ndk) {
      mentionSearching = true;
      try {
        const searchResults = await $ndk.fetchEvents({
          kinds: [0],
          search: query,
          limit: 20
        });
        
        for (const event of searchResults) {
          if (matches.some(m => m.pubkey === event.pubkey)) continue;
          
          try {
            const profile = JSON.parse(event.content);
            const name = profile.display_name || profile.name || '';
            const nip05 = profile.nip05;
            
            const nameMatch = name.toLowerCase().includes(queryLower);
            const nip05Match = nip05?.toLowerCase().includes(queryLower);
            
            if (nameMatch || nip05Match) {
              const profileData = {
                name: name || nip05?.split('@')[0] || 'Unknown',
                npub: nip19.npubEncode(event.pubkey),
                picture: profile.picture,
                pubkey: event.pubkey,
                nip05
              };
              matches.push(profileData);
              mentionProfileCache.set(event.pubkey, profileData);
              if (matches.length >= 8) break;
            }
          } catch {}
        }
      } catch (e) {
        console.debug('Network search failed:', e);
      } finally {
        mentionSearching = false;
      }
    }
    
    mentionSuggestions = matches;
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
                class="absolute z-50 mt-1 w-full max-w-md bg-input rounded-lg shadow-lg border overflow-hidden"
                style="border-color: var(--color-input-border); max-height: 240px; overflow-y: auto;"
              >
                {#if mentionSuggestions.length > 0}
                  {#each mentionSuggestions as suggestion, index}
                    <button
                      type="button"
                      on:click={() => insertMention(suggestion)}
                      on:mousedown|preventDefault={() => insertMention(suggestion)}
                      class="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent-gray transition-colors text-left"
                      class:bg-accent-gray={index === selectedMentionIndex}
                    >
                      <CustomAvatar pubkey={suggestion.pubkey} size={28} />
                      <div class="flex flex-col min-w-0">
                        <span class="text-sm font-medium truncate" style="color: var(--color-text-primary)">{suggestion.name}</span>
                        {#if suggestion.nip05}
                          <span class="text-xs truncate" style="color: var(--color-caption)">{suggestion.nip05}</span>
                        {/if}
                      </div>
                    </button>
                  {/each}
                {:else if mentionSearching}
                  <div class="px-3 py-3 text-sm text-caption text-center">Searching...</div>
                {:else if mentionQuery.length > 0}
                  <div class="px-3 py-3 text-sm text-caption text-center">No users found</div>
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
</style>
