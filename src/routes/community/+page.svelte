<script lang="ts">
  import FoodstrFeedOptimized from '../../components/FoodstrFeedOptimized.svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import ImageIcon from 'phosphor-svelte/lib/Image';
  import CustomAvatar from '../../components/CustomAvatar.svelte';
  import ProfileLink from '../../components/ProfileLink.svelte';
  import { nip19 } from 'nostr-tools';
  import NoteContent from '../../components/NoteContent.svelte';
  import { page } from '$app/stores';
  import { addClientTagToEvent } from '$lib/nip89';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import { Fetch } from 'hurdak';
  import type { PageData } from './$types';
  import type { NDKEvent as NDKEventType } from '@nostr-dev-kit/ndk';
  import { get } from 'svelte/store';

  export const data: PageData = {} as PageData;

  // Tab state - use local state for immediate reactivity
  type FilterMode = 'global' | 'following' | 'replies';
  
  // Local state for immediate UI updates
  let activeTab: FilterMode = 'following';
  
  // Tab initialization is now in the onMount with quote listener
  
  // Key to force component recreation
  let feedKey = 0;
  
  function setTab(tab: FilterMode) {
    if (tab === activeTab) return;
    
    activeTab = tab;
    feedKey++;
    
    // Update URL for bookmarking/sharing
    const url = new URL($page.url);
    url.searchParams.set('tab', tab);
    goto(url.pathname + url.search, { noScroll: true, replaceState: true });
  }

  let isComposerOpen = false;
  let content = '';
  let posting = false;
  let success = false;
  let error = '';
  let textareaEl: HTMLTextAreaElement;
  let uploadedImages: string[] = [];
  let uploadingImage = false;
  let imageInputEl: HTMLInputElement;
  let quotedNote: { nevent: string; event: NDKEventType } | null = null;

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

  // Global search state
  let searchQuery = '';
  let showSearchResults = false;
  let searchTab: 'users' | 'notes' = 'users';
  let searchingUsers = false;
  let searchingNotes = false;
  let userSearchResults: { name: string; npub: string; picture?: string; pubkey: string; nip05?: string }[] = [];
  let noteSearchResults: NDKEvent[] = [];
  let searchDebounceTimeout: ReturnType<typeof setTimeout>;

  // Listen for quote-note events from NoteRepost component
  function handleQuoteNote(e: CustomEvent) {
    quotedNote = e.detail;
    openComposer();
  }

  onMount(() => {
    const tab = $page.url.searchParams.get('tab');
    if (tab === 'following' || tab === 'replies' || tab === 'global') {
      activeTab = tab;
    }
    
    window.addEventListener('quote-note', handleQuoteNote as EventListener);
    
    // Preload mention profiles in background
    if ($userPublickey) {
      loadMentionFollowList();
    }
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('quote-note', handleQuoteNote as EventListener);
    }
    if (mentionSearchTimeout) {
      clearTimeout(mentionSearchTimeout);
    }
    if (searchDebounceTimeout) {
      clearTimeout(searchDebounceTimeout);
    }
  });

  function openComposer() {
    isComposerOpen = true;
    setTimeout(() => {
      textareaEl?.focus();
    }, 50);
  }

  function closeComposer() {
    if (!posting) {
      isComposerOpen = false;
      content = '';
      error = '';
      uploadedImages = [];
      quotedNote = null;
    }
  }

  async function uploadToNostrBuild(body: FormData) {
    const url = 'https://nostr.build/api/v2/upload/files';
    const template = new NDKEvent($ndk);
    template.kind = 27235;
    template.created_at = Math.floor(Date.now() / 1000);
    template.content = '';
    template.tags = [
      ['u', url],
      ['method', 'POST']
    ];

    await template.sign();
    
    const authEvent = {
      id: template.id,
      pubkey: template.pubkey,
      created_at: template.created_at,
      kind: template.kind,
      tags: template.tags,
      content: template.content,
      sig: template.sig
    };

    return Fetch.fetchJson(url, {
      body,
      method: 'POST',
      headers: {
        Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}`
      }
    });
  }

  async function handleImageUpload(event: Event) {
    const target = event.target as HTMLInputElement;
    if (!target.files || target.files.length === 0) return;
    
    uploadingImage = true;
    error = '';
    
    try {
      const file = target.files[0];
      
      // Validate file type
      if (!file.type.startsWith('image/')) {
        error = 'Please upload an image file';
        uploadingImage = false;
        return;
      }
      
      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        error = 'Image must be less than 10MB';
        uploadingImage = false;
        return;
      }
      
      const body = new FormData();
      body.append('file[]', file);
      
      const result = await uploadToNostrBuild(body);
      
      if (result && result.data && result.data[0]?.url) {
        uploadedImages = [...uploadedImages, result.data[0].url];
      } else {
        error = 'Failed to upload image';
      }
    } catch (err) {
      console.error('Error uploading image:', err);
      error = 'Failed to upload image. Please try again.';
    } finally {
      uploadingImage = false;
      // Reset input so same file can be selected again
      if (imageInputEl) {
        imageInputEl.value = '';
      }
    }
  }

  function removeImage(index: number) {
    uploadedImages = uploadedImages.filter((_, i) => i !== index);
  }

  async function postToFeed() {
    if (!content.trim() && !quotedNote && uploadedImages.length === 0) {
      error = 'Please enter some content';
      return;
    }

    if (!$userPublickey) {
      error = 'Please sign in to post';
      return;
    }

    posting = true;
    error = '';

    try {
      // Ensure NIP-46 signer is ready if using remote signer
      const { getAuthManager } = await import('$lib/authManager');
      const authManager = getAuthManager();
      if (authManager) {
        await authManager.ensureNip46SignerReady();
      }

      const event = new NDKEvent($ndk);
      event.kind = 1;
      
      // Build content with text and image URLs
      let postContent = content.trim();
      if (uploadedImages.length > 0) {
        // Add image URLs to content (one per line for better display)
        const imageUrls = uploadedImages.join('\n');
        postContent = postContent ? `${postContent}\n\n${imageUrls}` : imageUrls;
      }
      
      // Add quoted note reference if quoting
      if (quotedNote) {
        postContent = postContent ? `${postContent}\n\nnostr:${quotedNote.nevent}` : `nostr:${quotedNote.nevent}`;
      }
      
      event.content = postContent;
      event.tags = [['t', 'zapcooking']];
      
      // Parse and add @ mention tags (p tags)
      const mentions = parseMentions(postContent);
      for (const pubkey of mentions.values()) {
        // Avoid duplicate p tags
        if (!event.tags.some(t => t[0] === 'p' && t[1] === pubkey)) {
          event.tags.push(['p', pubkey]);
        }
      }
      
      // Add quote tags if quoting
      if (quotedNote) {
        const quotedPubkey = quotedNote.event.pubkey;
        event.tags.push(['q', quotedNote.event.id]);
        // Only add p tag if not already mentioned
        if (!event.tags.some(t => t[0] === 'p' && t[1] === quotedPubkey)) {
          event.tags.push(['p', quotedPubkey]);
        }
      }
      
      // Add NIP-89 client tag
      addClientTagToEvent(event);

      // Publish with timeout
      const publishPromise = event.publish();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Publishing timeout - signer may not be responding')), 30000);
      });
      
      const publishedEvent = await Promise.race([publishPromise, timeoutPromise]);
      
      if (publishedEvent) {
        success = true;
        content = '';
        uploadedImages = [];
        quotedNote = null;
        
        setTimeout(() => {
          isComposerOpen = false;
          success = false;
        }, 2500);
      } else {
        error = 'Failed to publish';
      }
    } catch (err) {
      console.error('Error posting to feed:', err);
      error = err instanceof Error ? err.message : 'Failed to post. Please try again.';
    } finally {
      posting = false;
    }
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
      
      // Load ALL follows, not just 500
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
    
    // Search local cache first (follows) - search by name AND NIP-05
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
    
    // Always search the network for more results (even if we have local matches)
    if (query.length >= 1 && $ndk) {
      mentionSearching = true;
      
      try {
        // Search for profiles by name using NIP-50 search
        const searchResults = await $ndk.fetchEvents({
          kinds: [0],
          search: query,
          limit: 50
        });
        
        for (const event of searchResults) {
          // Skip if already in matches
          if (seenPubkeys.has(event.pubkey)) continue;
          
          try {
            const profile = JSON.parse(event.content);
            const name = profile.display_name || profile.name || '';
            const nip05 = profile.nip05;
            
            // Check if matches query (be more lenient - include all search results)
            const nameMatch = name.toLowerCase().includes(queryLower);
            const nip05Match = nip05?.toLowerCase().includes(queryLower);
            const usernameMatch = (profile.name || '').toLowerCase().includes(queryLower);
            
            if (nameMatch || nip05Match || usernameMatch || true) { // Include all NIP-50 results
              const profileData = {
                name: name || nip05?.split('@')[0] || profile.name || 'Unknown',
                npub: nip19.npubEncode(event.pubkey),
                picture: profile.picture,
                pubkey: event.pubkey,
                nip05
              };
              
              matches.push(profileData);
              seenPubkeys.add(event.pubkey);
              // Cache for future lookups
              mentionProfileCache.set(event.pubkey, profileData);
            }
          } catch {}
        }
      } catch (e) {
        console.debug('Network search failed:', e);
      } finally {
        mentionSearching = false;
      }
    }
    
    // Sort: prioritize exact matches, then by name
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
  function handleContentInput(event: Event) {
    const textarea = event.target as HTMLTextAreaElement;
    const cursorPos = textarea.selectionStart;
    const text = content;
    
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
          // Show all cached users if query is empty
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
    if (!textareaEl) return;
    
    const beforeMention = content.substring(0, mentionStartPos);
    const afterMention = content.substring(textareaEl.selectionStart);
    const mentionText = `@${user.name} `;
    
    content = beforeMention + mentionText + afterMention;
    showMentionSuggestions = false;
    mentionSuggestions = [];
    
    // Set cursor position after mention
    setTimeout(() => {
      const newPos = beforeMention.length + mentionText.length;
      textareaEl.setSelectionRange(newPos, newPos);
      textareaEl.focus();
    }, 0);
  }

  // Handle keyboard navigation in mention suggestions
  function handleKeydown(event: KeyboardEvent) {
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
    
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      postToFeed();
    }
    if (event.key === 'Escape') {
      closeComposer();
    }
  }

  // Parse @ mentions from content and return pubkeys
  function parseMentions(text: string): Map<string, string> {
    // Map of @username to pubkey
    const mentions = new Map<string, string>();
    const mentionRegex = /@(\w+)\s/g;
    let match;
    
    while ((match = mentionRegex.exec(text)) !== null) {
      const username = match[1];
      // Find user in cache by name (case-insensitive)
      for (const [pubkey, profile] of mentionProfileCache.entries()) {
        if (profile.name.toLowerCase() === username.toLowerCase()) {
          mentions.set(`@${username}`, pubkey);
          break;
        }
      }
    }
    
    return mentions;
  }

  // Global search functions
  function handleSearchInput(event: Event) {
    const target = event.target as HTMLInputElement;
    searchQuery = target.value;
    
    if (searchDebounceTimeout) clearTimeout(searchDebounceTimeout);
    
    if (searchQuery.trim().length === 0) {
      showSearchResults = false;
      userSearchResults = [];
      noteSearchResults = [];
      return;
    }
    
    showSearchResults = true;
    
    searchDebounceTimeout = setTimeout(() => {
      if (searchQuery.trim().length >= 2) {
        performSearch(searchQuery.trim());
      }
    }, 300);
  }

  async function performSearch(query: string) {
    // Search both users and notes in parallel
    searchUsers(query);
    searchNotes(query);
  }

  async function searchUsers(query: string) {
    if (!$ndk) return;
    
    searchingUsers = true;
    const queryLower = query.toLowerCase();
    const results: { name: string; npub: string; picture?: string; pubkey: string; nip05?: string }[] = [];
    
    // First search local cache
    for (const profile of mentionProfileCache.values()) {
      const nameMatch = profile.name.toLowerCase().includes(queryLower);
      const nip05Match = profile.nip05?.toLowerCase().includes(queryLower);
      
      if (nameMatch || nip05Match) {
        results.push(profile);
        if (results.length >= 5) break;
      }
    }
    
    // Then search network
    try {
      const searchResults = await $ndk.fetchEvents({
        kinds: [0],
        search: query,
        limit: 30
      });
      
      for (const event of searchResults) {
        if (results.some(r => r.pubkey === event.pubkey)) continue;
        
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
            results.push(profileData);
            // Cache for future use
            mentionProfileCache.set(event.pubkey, profileData);
            if (results.length >= 15) break;
          }
        } catch {}
      }
    } catch (e) {
      console.debug('User search failed:', e);
    }
    
    userSearchResults = results;
    searchingUsers = false;
  }

  async function searchNotes(query: string) {
    if (!$ndk) return;
    
    searchingNotes = true;
    
    try {
      // Search for notes using NIP-50
      const searchResults = await $ndk.fetchEvents({
        kinds: [1],
        search: query,
        limit: 30
      });
      
      // Filter and sort by time
      const results = Array.from(searchResults)
        .filter(e => e.content && e.content.length > 0)
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
        .slice(0, 15);
      
      noteSearchResults = results;
    } catch (e) {
      console.debug('Note search failed:', e);
      noteSearchResults = [];
    }
    
    searchingNotes = false;
  }

  function clearSearch() {
    searchQuery = '';
    showSearchResults = false;
    userSearchResults = [];
    noteSearchResults = [];
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      clearSearch();
    }
  }

  function navigateToUser(pubkey: string) {
    clearSearch();
    goto(`/user/${nip19.npubEncode(pubkey)}`);
  }

  function navigateToNote(eventId: string) {
    clearSearch();
    goto(`/${nip19.noteEncode(eventId)}`);
  }
</script>

<svelte:head>
  <title>Community - zap.cooking</title>
  <meta name="description" content="Community - Share and discover delicious food content from the Nostr network" />
</svelte:head>

<div class="container mx-auto px-4 max-w-2xl community-page">
  <!-- Orientation text for signed-out users -->
  {#if $userPublickey === ''}
    <div class="mb-4 pt-1">
      <p class="text-sm text-caption">A place to share food with friends.</p>
      <p class="text-xs text-caption mt-0.5">People share meals, recipes, and food ideas here. <a href="/login" class="text-caption hover:opacity-80 underline">Sign in</a> to share your own and follow cooks you like.</p>
    </div>
  {/if}

  <!-- Inline Post Composer for logged-in users -->
  {#if $userPublickey !== ''}
    <div class="mb-4 bg-input rounded-xl overflow-hidden transition-all" style="border: 1px solid var(--color-input-border)">
      {#if !isComposerOpen}
        <!-- Collapsed state -->
        <button
          class="w-full p-3 hover:bg-accent-gray transition-colors cursor-pointer text-left"
          on:click={openComposer}
        >
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 bg-accent-gray rounded-full flex items-center justify-center">
              <PencilSimpleIcon size={18} class="text-caption" />
            </div>
            <span class="text-caption text-sm">Share what you're eating, cooking, or loving</span>
          </div>
        </button>
      {:else}
        <!-- Expanded composer -->
        <div class="p-3">
          <div class="flex gap-3">
            <CustomAvatar pubkey={$userPublickey} size={36} />
            <div class="flex-1">
              <div class="relative">
              <textarea
                bind:this={textareaEl}
                bind:value={content}
                placeholder="What are you eating, cooking, or loving?"
                class="w-full min-h-[80px] p-2 text-sm border-0 focus:outline-none focus:ring-0 resize-none bg-transparent"
                style="color: var(--color-text-primary)"
                disabled={posting}
                on:keydown={handleKeydown}
                  on:input={handleContentInput}
              ></textarea>
                
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
                      <div class="px-3 py-3 text-sm text-caption text-center">
                        Searching...
                      </div>
                    {:else if mentionQuery.length > 0}
                      <div class="px-3 py-3 text-sm text-caption text-center">
                        No users found for "{mentionQuery}"
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
              
              {#if error}
                <p class="text-red-500 text-xs mb-2">{error}</p>
              {/if}
              
              {#if success}
                <p class="text-green-600 text-xs mb-2">Posted!</p>
              {/if}
              
              <!-- Quoted note preview -->
              {#if quotedNote}
                <div class="mb-3 rounded-xl overflow-hidden bg-input" style="border: 1px solid var(--color-input-border)">
                  <!-- Header with remove button -->
                  <div class="flex items-center justify-between px-3 py-2 bg-accent-gray" style="border-bottom: 1px solid var(--color-input-border)">
                    <span class="text-xs font-medium text-caption">Quoting post</span>
                    <button
                      type="button"
                      on:click={() => quotedNote = null}
                      class="text-caption hover:opacity-80 p-1 hover:bg-input rounded transition-colors"
                      aria-label="Remove quote"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  
                  <!-- Quoted note content -->
                  <div class="p-3">
                    <!-- Author info -->
                    <div class="flex items-center gap-2 mb-2">
                      <CustomAvatar pubkey={quotedNote.event.pubkey} size={24} />
                      <ProfileLink nostrString={'nostr:' + nip19.npubEncode(quotedNote.event.pubkey)} />
                    </div>
                    
                    <!-- Note content with proper rendering -->
                    <div class="text-sm max-h-32 overflow-hidden" style="color: var(--color-text-primary)">
                      <NoteContent content={quotedNote.event.content || ''} />
                    </div>
                  </div>
                </div>
              {/if}
              
              <!-- Image previews -->
              {#if uploadedImages.length > 0}
                <div class="mb-2 flex flex-wrap gap-2">
                  {#each uploadedImages as imageUrl, index}
                    <div class="relative group">
                      <img
                        src={imageUrl}
                        alt="Upload preview"
                        class="w-20 h-20 object-cover rounded-lg"
                        style="border: 1px solid var(--color-input-border)"
                      />
                      <button
                        type="button"
                        on:click={() => removeImage(index)}
                        class="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 shadow-lg transition-all opacity-90 hover:opacity-100"
                        disabled={posting}
                        aria-label="Remove image"
                      >
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  {/each}
                </div>
              {/if}
              
              <div class="flex items-center justify-between pt-2 border-t" style="border-color: var(--color-input-border)">
                <div class="flex items-center gap-3">
                  <!-- Image upload button -->
                  <label
                    class="cursor-pointer p-1.5 rounded-full hover:bg-accent-gray transition-colors"
                    class:opacity-50={posting || uploadingImage}
                    class:cursor-not-allowed={posting || uploadingImage}
                    aria-disabled={posting || uploadingImage}
                  >
                    <ImageIcon size={18} class="text-caption" />
                    <input
                      bind:this={imageInputEl}
                      type="file"
                      accept="image/*"
                      class="sr-only"
                      on:change={handleImageUpload}
                      disabled={posting || uploadingImage}
                    />
                  </label>
                  
                  {#if uploadingImage}
                    <span class="text-xs text-caption">Uploading...</span>
                  {/if}
                </div>

                <div class="flex items-center gap-2">
                  <button
                    on:click={closeComposer}
                    class="px-3 py-1.5 text-xs text-caption hover:opacity-80 transition-colors"
                    disabled={posting}
                  >
                    Cancel
                  </button>
                  <button
                    on:click={postToFeed}
                    disabled={posting || uploadingImage || (!content.trim() && uploadedImages.length === 0 && !quotedNote)}
                    class="px-4 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {posting ? 'Posting...' : 'Post'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Search Bar -->
  <div class="mb-4 relative">
    <div class="relative">
      <input
        type="text"
        bind:value={searchQuery}
        on:input={handleSearchInput}
        on:keydown={handleSearchKeydown}
        placeholder="Search users or notes..."
        class="w-full px-4 py-2.5 pl-10 text-sm rounded-xl bg-input focus:ring-2 focus:ring-primary focus:outline-none"
        style="border: 1px solid var(--color-input-border); color: var(--color-text-primary)"
      />
      <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style="color: var(--color-caption)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      {#if searchQuery}
        <button
          on:click={clearSearch}
          class="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-accent-gray rounded-full transition-colors"
        >
          <svg class="w-4 h-4" style="color: var(--color-caption)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      {/if}
    </div>

    <!-- Search Results Dropdown -->
    {#if showSearchResults}
      <div 
        class="absolute z-50 mt-2 w-full bg-input rounded-xl shadow-xl border overflow-hidden"
        style="border-color: var(--color-input-border); max-height: 400px;"
      >
        <!-- Search Tabs -->
        <div class="flex border-b" style="border-color: var(--color-input-border)">
          <button
            on:click={() => searchTab = 'users'}
            class="flex-1 px-4 py-2.5 text-sm font-medium transition-colors relative"
            style="color: {searchTab === 'users' ? 'var(--color-text-primary)' : 'var(--color-caption)'}"
          >
            Users {#if userSearchResults.length > 0}<span class="text-xs ml-1">({userSearchResults.length})</span>{/if}
            {#if searchTab === 'users'}
              <span class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"></span>
            {/if}
          </button>
          <button
            on:click={() => searchTab = 'notes'}
            class="flex-1 px-4 py-2.5 text-sm font-medium transition-colors relative"
            style="color: {searchTab === 'notes' ? 'var(--color-text-primary)' : 'var(--color-caption)'}"
          >
            Notes {#if noteSearchResults.length > 0}<span class="text-xs ml-1">({noteSearchResults.length})</span>{/if}
            {#if searchTab === 'notes'}
              <span class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"></span>
            {/if}
          </button>
        </div>

        <!-- Results Content -->
        <div class="overflow-y-auto" style="max-height: 340px;">
          {#if searchTab === 'users'}
            {#if searchingUsers}
              <div class="px-4 py-6 text-center text-caption text-sm">
                <div class="animate-pulse">Searching users...</div>
              </div>
            {:else if userSearchResults.length === 0}
              <div class="px-4 py-6 text-center text-caption text-sm">
                {#if searchQuery.length < 2}
                  Type at least 2 characters to search
                {:else}
                  No users found for "{searchQuery}"
                {/if}
              </div>
            {:else}
              {#each userSearchResults as user}
                <button
                  on:click={() => navigateToUser(user.pubkey)}
                  class="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent-gray transition-colors text-left"
                >
                  <CustomAvatar pubkey={user.pubkey} size={40} />
                  <div class="flex flex-col min-w-0 flex-1">
                    <span class="font-medium truncate" style="color: var(--color-text-primary)">{user.name}</span>
                    {#if user.nip05}
                      <span class="text-xs truncate" style="color: var(--color-caption)">{user.nip05}</span>
                    {:else}
                      <span class="text-xs truncate" style="color: var(--color-caption)">{user.npub.slice(0, 20)}...</span>
                    {/if}
                  </div>
                  <svg class="w-4 h-4 flex-shrink-0" style="color: var(--color-caption)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              {/each}
            {/if}
          {:else}
            {#if searchingNotes}
              <div class="px-4 py-6 text-center text-caption text-sm">
                <div class="animate-pulse">Searching notes...</div>
              </div>
            {:else if noteSearchResults.length === 0}
              <div class="px-4 py-6 text-center text-caption text-sm">
                {#if searchQuery.length < 2}
                  Type at least 2 characters to search
                {:else}
                  No notes found for "{searchQuery}"
                {/if}
              </div>
            {:else}
              {#each noteSearchResults as note}
                <button
                  on:click={() => navigateToNote(note.id)}
                  class="w-full px-4 py-3 hover:bg-accent-gray transition-colors text-left border-b"
                  style="border-color: var(--color-input-border)"
                >
                  <div class="flex items-start gap-3">
                    <CustomAvatar pubkey={note.pubkey} size={32} />
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 mb-1">
                        <ProfileLink nostrString={nip19.npubEncode(note.pubkey)} className="text-sm font-medium" />
                        <span class="text-xs" style="color: var(--color-caption)">
                          {note.created_at ? new Date(note.created_at * 1000).toLocaleDateString() : ''}
                        </span>
                      </div>
                      <p class="text-sm line-clamp-2" style="color: var(--color-text-secondary)">
                        {note.content.slice(0, 150)}{note.content.length > 150 ? '...' : ''}
                      </p>
                    </div>
                  </div>
                </button>
              {/each}
            {/if}
          {/if}
        </div>
      </div>
    {/if}
  </div>

  <!-- Filter Tabs -->
  <div class="mb-4 border-b" style="border-color: var(--color-input-border)">
    <div class="flex gap-1">
      <button
        on:click={() => setTab('global')}
        class="px-4 py-2 text-sm font-medium transition-colors relative"
        style="color: {activeTab === 'global' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'}"
      >
        Global Food
        {#if activeTab === 'global'}
          <span class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"></span>
        {/if}
      </button>

      <button
        on:click={() => setTab('following')}
        class="px-4 py-2 text-sm font-medium transition-colors relative"
        style="color: {activeTab === 'following' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'}"
        disabled={!$userPublickey}
        class:opacity-50={!$userPublickey}
        class:cursor-not-allowed={!$userPublickey}
        class:cursor-pointer={$userPublickey}
      >
        Following
        {#if activeTab === 'following'}
          <span class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"></span>
        {/if}
      </button>

      <button
        on:click={() => setTab('replies')}
        class="px-4 py-2 text-sm font-medium transition-colors relative"
        style="color: {activeTab === 'replies' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'}"
      >
        Notes & Replies
        {#if activeTab === 'replies'}
          <span class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"></span>
        {/if}
      </button>
    </div>
  </div>

  <!-- Show login prompt for Following/Replies tabs if not logged in -->
  {#if (activeTab === 'following' || activeTab === 'replies') && !$userPublickey}
    <div class="mb-4 p-4 bg-accent-gray rounded-lg" style="border: 1px solid var(--color-input-border)">
      <p class="text-sm" style="color: var(--color-text-primary)">
        <a href="/login" class="font-medium underline hover:opacity-80">Log in</a> to see {activeTab === 'following' ? 'posts from people you follow' : 'replies from people you follow'}.
      </p>
    </div>
  {/if}
  
  {#key feedKey}
    <FoodstrFeedOptimized filterMode={activeTab} />
  {/key}
</div>

<style>
  /* Bottom padding to prevent fixed mobile nav from covering content */
  .community-page {
    padding-bottom: calc(80px + env(safe-area-inset-bottom, 0px));
  }
  
  /* Desktop doesn't need bottom nav spacing */
  @media (min-width: 768px) {
    .community-page {
      padding-bottom: 2rem;
    }
  }

  /* Line clamp for note previews */
  .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
