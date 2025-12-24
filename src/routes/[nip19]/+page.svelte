<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { nip19 } from 'nostr-tools';
  import { ndk, userPublickey } from '$lib/nostr';
  import { onMount } from 'svelte';
  import CustomAvatar from '../../components/CustomAvatar.svelte';
  import CustomName from '../../components/CustomName.svelte';
  import AuthorName from '../../components/AuthorName.svelte';
  import { formatDistanceToNow } from 'date-fns';
  import NoteContent from '../../components/NoteContent.svelte';
  import NoteTotalLikes from '../../components/NoteTotalLikes.svelte';
  import NoteTotalComments from '../../components/NoteTotalComments.svelte';
  import NoteTotalZaps from '../../components/NoteTotalZaps.svelte';
  import ZapModal from '../../components/ZapModal.svelte';
  import Button from '../../components/Button.svelte';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import type { PageData } from './$types';

  export const data: PageData = {} as PageData;

  let decoded: any = null;
  let event: NDKEvent | null = null;
  let loading = true;
  let error = false;
  let zapModal = false;
  
  // Thread hierarchy
  let parentThread: NDKEvent[] = []; // Parent notes above this one
  let loadingParents = false;
  
  // Replies/comments
  let replies: NDKEvent[] = [];
  let loadingReplies = false;
  let commentText = '';
  let processedReplies = new Set<string>();

  // Get the parent note ID from an event's e tags
  function getParentNoteId(evt: NDKEvent): string | null {
    // Look for reply tag first
    const replyTag = evt.tags.find(tag => Array.isArray(tag) && tag[0] === 'e' && tag[3] === 'reply');
    if (replyTag) return replyTag[1] as string;
    
    // Fallback to root tag
    const rootTag = evt.tags.find(tag => Array.isArray(tag) && tag[0] === 'e' && tag[3] === 'root');
    if (rootTag) return rootTag[1] as string;
    
    // Fallback to first e tag
    const firstETag = evt.tags.find(tag => Array.isArray(tag) && tag[0] === 'e');
    if (firstETag) return firstETag[1] as string;
    
    return null;
  }

  // Fetch parent thread recursively
  async function fetchParentThread(evt: NDKEvent) {
    loadingParents = true;
    const parents: NDKEvent[] = [];
    let currentEvent = evt;
    const seenIds = new Set<string>();
    
    try {
      while (true) {
        const parentId = getParentNoteId(currentEvent);
        if (!parentId || seenIds.has(parentId)) break;
        
        seenIds.add(parentId);
        
        const parentNote = await $ndk.fetchEvent({ kinds: [1], ids: [parentId] });
        if (!parentNote) break;
        
        parents.unshift(parentNote); // Add to beginning for chronological order
        currentEvent = parentNote;
        
        // Limit depth to prevent infinite loops
        if (parents.length >= 10) break;
      }
    } catch {
      // Failed to fetch parent thread
    }
    
    parentThread = parents;
    loadingParents = false;
  }

  // Fetch replies to this note
  function fetchReplies(eventId: string) {
    loadingReplies = true;
    replies = [];
    processedReplies.clear();
    
    const sub = $ndk.subscribe({
      kinds: [1],
      '#e': [eventId]
    }, { closeOnEose: false });

    sub.on('event', (e: NDKEvent) => {
      if (processedReplies.has(e.id)) return;
      processedReplies.add(e.id);
      replies = [...replies, e].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    });

    sub.on('eose', () => {
      loadingReplies = false;
    });
    
    // Timeout
    setTimeout(() => {
      loadingReplies = false;
    }, 5000);
  }

  async function loadEvent(nip19Id: string) {
    decoded = null;
    event = null;
    parentThread = [];
    replies = [];
    loading = true;
    error = false;
    zapModal = false;
    
    if (!nip19Id) {
      error = true;
      loading = false;
      return;
    }

    if (nip19Id.startsWith("nostr:")) {
      nip19Id = nip19Id.split("nostr:")[1];
    }

    // Validate NIP-19 identifier format
    if (nip19Id.length < 8 || !nip19Id.match(/^[a-z0-9]+$/)) {
      error = true;
      loading = false;
      return;
    }

    try {
      // Decode the NIP-19 identifier
      decoded = nip19.decode(nip19Id);
      
      if (decoded.type === 'nevent' || decoded.type === 'note') {
        // Fetch the referenced event
        let eventId = '';
        switch (decoded.type) {
          case "nevent":
            eventId = (decoded as nip19.DecodedNevent).data.id;
            break;
          case "note":
            eventId = (decoded as nip19.DecodedNote).data;
            break;
        }
        const filter = {
          ids: [eventId]
        };
        
        const subscription = $ndk.subscribe(filter, { closeOnEose: false });
        let resolved = false;
        
        subscription.on('event', async (receivedEvent: NDKEvent) => {
          if (!event) {
            event = receivedEvent;
            // Fetch parent thread and replies
            fetchParentThread(receivedEvent);
            fetchReplies(receivedEvent.id);
          }
        });
        
        subscription.on('eose', () => {
          if (!resolved) {
            resolved = true;
            subscription.stop();
            if (!event) {
              error = true;
            }
            loading = false;
          }
        });
        
        // Handle timeout - resolve with whatever we have
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            subscription.stop();
            if (!event) {
              error = true;
            }
            loading = false;
          }
        }, 5000);
      } else {
        error = true;
        loading = false;
      }
    } catch {
      error = true;
      loading = false;
    }
  }

  $: {
    if ($page.params.nip19) {
      (async () => {
      await loadEvent($page.params.nip19!);
    })()
    }
  }

  function formatTimeAgo(timestamp: number): string {
    return formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true });
  }

  function openZapModal() {
    zapModal = true;
  }
  
  // Post a reply
  async function postReply() {
    if (!commentText.trim() || !event) return;

    try {
      const ev = new (await import('@nostr-dev-kit/ndk')).NDKEvent($ndk);
      ev.kind = 1;
      ev.content = commentText;
      ev.tags = [
        ['e', event.id, '', 'reply'],
        ['p', event.pubkey]
      ];

      await ev.publish();
      commentText = '';
    } catch {
      // Failed to post reply
    }
  }
  
  // Filter to get only direct replies (not nested)
  $: directReplies = replies.filter((r) => {
    if (!event) return false;
    const eTags = r.getMatchingTags('e');
    
    const replyTag = eTags.find(tag => tag[3] === 'reply');
    const rootTag = eTags.find(tag => tag[3] === 'root');
    
    // If there's a specific reply marker, check if it points to main event
    if (replyTag) {
      return replyTag[1] === event.id;
    }
    
    // If only one e tag, it's a direct reply
    if (eTags.length === 1 && eTags[0][1] === event.id) {
      return true;
    }
    
    // If root is main event and no reply marker, it's a direct reply
    if (rootTag && rootTag[1] === event.id && !replyTag) {
      return true;
    }
    
    // Otherwise, check if any e tag references main event (handles older tagging)
    if (eTags.length > 0 && !replyTag && !rootTag) {
      return eTags.some(tag => tag[1] === event?.id);
    }
    
    return false;
  });
  
  // Get nested replies for a comment
  function getNestedReplies(parentId: string): NDKEvent[] {
    return replies.filter((r) => {
      const eTags = r.getMatchingTags('e');
      const replyTag = eTags.find(tag => tag[3] === 'reply');
      
      // Check if reply marker points to parent
      if (replyTag && replyTag[1] === parentId) {
        return true;
      }
      
      // Check if this is a reply to the parent (without markers)
      if (!replyTag && eTags.some(tag => tag[1] === parentId)) {
        // Make sure it's not actually replying to the main event
        return !eTags.some(tag => tag[1] === event?.id && (tag[3] === 'reply' || eTags.length === 1));
      }
      
      return false;
    });
  }
</script>

<svelte:head>
  <title>Note Thread - zap.cooking</title>
</svelte:head>

<div class="max-w-2xl mx-auto px-4">
  {#if loading}
    <div class="py-12 text-center">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
      <p class="mt-4 text-gray-600">Loading note...</p>
    </div>
  {:else if error}
    <div class="py-12 text-center">
      <div class="max-w-sm mx-auto space-y-6">
        <div class="text-gray-500">
          <svg class="h-12 w-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <p class="text-lg font-medium">Note not found</p>
          <p class="text-sm">The referenced note could not be loaded.</p>
        </div>
        <button 
          on:click={() => goto('/community')}
          class="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
        >
          Back to Community
        </button>
      </div>
    </div>
  {:else if event}
    <!-- Thread Header -->
    {#if parentThread.length > 0 || loadingParents}
      <div class="pt-4 pb-2">
        <div class="flex items-center gap-2 text-xs text-gray-500">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <span>Thread</span>
        </div>
      </div>
    {/if}
    
    <!-- Parent Thread (notes above) -->
    {#if loadingParents}
      <div class="py-4">
        <div class="animate-pulse space-y-3">
          <div class="flex gap-3">
            <div class="w-10 h-10 bg-gray-200 rounded-full"></div>
            <div class="flex-1 space-y-2">
              <div class="h-4 bg-gray-200 rounded w-1/4"></div>
              <div class="h-4 bg-gray-200 rounded w-3/4"></div>
            </div>
          </div>
        </div>
      </div>
    {:else if parentThread.length > 0}
      <div class="space-y-0">
        {#each parentThread as parentNote, index}
          <div class="relative">
            <!-- Thread line connecting to next note -->
            <div class="absolute left-5 top-12 bottom-0 w-0.5 bg-gray-200"></div>
            
            <article class="py-3">
              <a 
                href="/{nip19.noteEncode(parentNote.id)}"
                class="flex space-x-3 group hover:bg-gray-50 -mx-2 px-2 py-2 rounded-lg transition-colors"
              >
                <div class="flex-shrink-0 z-10">
                  <CustomAvatar
                    pubkey={parentNote.author?.hexpubkey || parentNote.pubkey}
                    size={40}
                  />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center space-x-2 mb-1">
                    <span class="font-semibold text-sm text-gray-900 group-hover:text-blue-600">
                      <CustomName pubkey={parentNote.author?.hexpubkey || parentNote.pubkey} />
                    </span>
                    <span class="text-gray-400 text-sm">·</span>
                    <span class="text-gray-400 text-sm">
                      {parentNote.created_at ? formatTimeAgo(parentNote.created_at) : ''}
                    </span>
                  </div>
                  <div class="text-sm text-gray-700 leading-relaxed line-clamp-3">
                    <NoteContent content={parentNote.content} />
                  </div>
                </div>
              </a>
            </article>
          </div>
        {/each}
      </div>
    {/if}
    
    <!-- Main Note (highlighted) -->
    <article class="bg-white border border-gray-200 rounded-xl p-4 my-2 shadow-sm">
      <div class="flex space-x-3">
        <a href="/user/{nip19.npubEncode(event.author?.hexpubkey || event.pubkey)}" class="flex-shrink-0">
          <CustomAvatar
            className="cursor-pointer"
            pubkey={event.author?.hexpubkey || event.pubkey}
            size={48}
          />
        </a>
        <div class="flex-1 min-w-0">
          <div class="flex items-center space-x-2 mb-2">
            <a href="/user/{nip19.npubEncode(event.author?.hexpubkey || event.pubkey)}" class="font-semibold text-gray-900 hover:underline">
              <CustomName pubkey={event.author?.hexpubkey || event.pubkey} />
            </a>
            <span class="text-gray-400">·</span>
            <span class="text-gray-400 text-sm">
              {event.created_at ? formatTimeAgo(event.created_at) : 'Unknown time'}
            </span>
          </div>
          <div class="text-gray-900 leading-relaxed mb-4">
            <NoteContent content={event.content} />
          </div>
          <div class="flex items-center space-x-4 text-sm text-gray-500 pt-3 border-t border-gray-100">
            <NoteTotalLikes {event} />
            <NoteTotalComments {event} />
            <button 
              class="cursor-pointer hover:bg-gray-100 rounded px-1 py-0.5 transition duration-200"
              on:click={openZapModal}
            >
              <NoteTotalZaps {event} />
            </button>
          </div>
        </div>
      </div>
    </article>
    
    <!-- Replies Section -->
    <div class="mt-4">
      <div class="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <span>Replies ({directReplies.length})</span>
      </div>
      
      <!-- Reply Input -->
      {#if $userPublickey}
        <div class="mb-4 p-3 bg-gray-50 rounded-lg">
          <div class="flex gap-3">
            <CustomAvatar pubkey={$userPublickey} size={32} />
            <div class="flex-1">
              <textarea
                bind:value={commentText}
                placeholder="Write a reply..."
                class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none focus:ring-2 focus:ring-primary focus:border-transparent bg-white"
                rows="2"
              ></textarea>
              <div class="flex justify-end mt-2">
                <Button on:click={postReply} disabled={!commentText.trim()} class="text-sm px-4 py-1.5">
                  Reply
                </Button>
              </div>
            </div>
          </div>
        </div>
      {:else}
        <div class="mb-4 p-3 bg-gray-50 rounded-lg text-sm text-gray-500">
          <a href="/login" class="text-primary hover:underline font-medium">Log in</a> to reply
        </div>
      {/if}
      
      <!-- Replies List -->
      {#if loadingReplies}
        <div class="space-y-3">
          {#each [1, 2] as _}
            <div class="animate-pulse flex gap-3 p-3">
              <div class="w-8 h-8 bg-gray-200 rounded-full"></div>
              <div class="flex-1 space-y-2">
                <div class="h-3 bg-gray-200 rounded w-1/4"></div>
                <div class="h-3 bg-gray-200 rounded w-full"></div>
              </div>
            </div>
          {/each}
        </div>
      {:else if directReplies.length === 0}
        <p class="text-sm text-gray-500 py-4 text-center">No replies yet. Be the first to reply!</p>
      {:else}
        <div class="space-y-0">
          {#each directReplies as reply}
            <div class="relative">
              <!-- Thread line for nested replies -->
              {#if getNestedReplies(reply.id).length > 0}
                <div class="absolute left-4 top-12 bottom-0 w-0.5 bg-gray-100"></div>
              {/if}
              
              <article class="py-3 border-b border-gray-100 last:border-0">
                <div class="flex space-x-3">
                  <a href="/user/{nip19.npubEncode(reply.author?.hexpubkey || reply.pubkey)}" class="flex-shrink-0">
                    <CustomAvatar
                      pubkey={reply.author?.hexpubkey || reply.pubkey}
                      size={32}
                    />
                  </a>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center space-x-2 mb-1">
                      <a href="/user/{nip19.npubEncode(reply.author?.hexpubkey || reply.pubkey)}" class="font-medium text-sm text-gray-900 hover:underline">
                        <CustomName pubkey={reply.author?.hexpubkey || reply.pubkey} />
                      </a>
                      <span class="text-gray-400 text-xs">·</span>
                      <span class="text-gray-400 text-xs">
                        {reply.created_at ? formatTimeAgo(reply.created_at) : ''}
                      </span>
                    </div>
                    <div class="text-sm text-gray-700 leading-relaxed">
                      <NoteContent content={reply.content} />
                    </div>
                    <div class="flex items-center gap-4 mt-2 text-xs text-gray-400">
                      <a 
                        href="/{nip19.noteEncode(reply.id)}"
                        class="hover:text-blue-600 transition-colors flex items-center gap-1"
                      >
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                        View thread
                      </a>
                    </div>
                  </div>
                </div>
              </article>
              
              <!-- Nested Replies (1 level deep shown inline) -->
              {#each getNestedReplies(reply.id).slice(0, 2) as nestedReply}
                <div class="ml-8 pl-3 border-l-2 border-gray-100">
                  <article class="py-2">
                    <div class="flex space-x-2">
                      <a href="/user/{nip19.npubEncode(nestedReply.author?.hexpubkey || nestedReply.pubkey)}" class="flex-shrink-0">
                        <CustomAvatar
                          pubkey={nestedReply.author?.hexpubkey || nestedReply.pubkey}
                          size={24}
                        />
                      </a>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center space-x-2 mb-0.5">
                          <span class="font-medium text-xs text-gray-900">
                            <CustomName pubkey={nestedReply.author?.hexpubkey || nestedReply.pubkey} />
                          </span>
                          <span class="text-gray-400 text-xs">·</span>
                          <span class="text-gray-400 text-xs">
                            {nestedReply.created_at ? formatTimeAgo(nestedReply.created_at) : ''}
                          </span>
                        </div>
                        <div class="text-xs text-gray-600 leading-relaxed line-clamp-2">
                          <NoteContent content={nestedReply.content} />
                        </div>
                      </div>
                    </div>
                  </article>
                </div>
              {/each}
              
              <!-- Show more nested replies link -->
              {#if getNestedReplies(reply.id).length > 2}
                <a 
                  href="/{nip19.noteEncode(reply.id)}"
                  class="ml-8 pl-3 border-l-2 border-gray-100 py-2 block text-xs text-blue-600 hover:text-blue-700"
                >
                  Show {getNestedReplies(reply.id).length - 2} more {getNestedReplies(reply.id).length - 2 === 1 ? 'reply' : 'replies'}
                </a>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Back to Community -->
    <div class="py-6 text-center border-t border-gray-200 mt-6">
      <button 
        on:click={() => goto('/community')}
        class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
      >
        ← Back to Community
      </button>
    </div>
  {/if}
</div>

<!-- Zap Modal -->
{#if zapModal && event}
  <ZapModal 
    event={event} 
    on:close={() => zapModal = false} 
  />
{/if}
