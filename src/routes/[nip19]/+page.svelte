<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { nip19 } from 'nostr-tools';
  import { ndk, userPublickey } from '$lib/nostr';
  import { mutedPubkeys, muteListStore } from '$lib/muteListStore';
  import { onMount } from 'svelte';
  import Avatar from '../../components/Avatar.svelte';
  import CustomName from '../../components/CustomName.svelte';
  import NoteContent from '../../components/NoteContent.svelte';
  import PollDisplay from '../../components/PollDisplay.svelte';
  import NoteActionBar from '../../components/NoteActionBar.svelte';
  import ClientAttribution from '../../components/ClientAttribution.svelte';
  import { NDKRelaySet } from '@nostr-dev-kit/ndk';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { createCommentFilter } from '$lib/commentFilters';
  import { stripTrackingParams } from '$lib/utils/stripTrackingParams';
  import PostActionsMenu from '../../components/PostActionsMenu.svelte';
  import ReplyComposer from '../../components/comments/ReplyComposer.svelte';

  let decoded: any = null;
  let event: NDKEvent | null = null;
  let loading = true;
  let error = false;
  let authorName: string | null = null;
  // Track the identifier we've already loaded so the reactive block below
  // only fires loadEvent() when the nip19 param actually changes — not on
  // every $page update (e.g. the stripTrackingParams goto in onMount, which
  // strips query params but leaves the route param unchanged).
  let loadedNip19: string | undefined;

  // ── Client-side OG meta (no server load) ──────────────────────────
  // Derived from the note we fetch over NDK. Crawler-grade SSR OG was
  // removed with the +page.server.ts that caused the __data.json 500s.
  const IMG_EXT = /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)(\?.*)?$/i;
  const VID_EXT = /\.(mp4|webm|mov|avi|mkv|ogv)(\?.*)?$/i;
  const IMG_HOSTS = [
    'image.nostr.build', 'nostr.build', 'imgur.com', 'imgproxy',
    'primal.b-cdn.net', 'media.tenor.com', 'i.ibb.co'
  ];

  function extractFirstImageUrl(content: string): string | null {
    const urls = (content || '').match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
    for (const url of urls) {
      try {
        const u = new URL(url);
        if (VID_EXT.test(u.pathname)) continue;
        if (IMG_EXT.test(u.pathname)) return url;
        if (IMG_HOSTS.some((h) => u.hostname.includes(h))) {
          if (u.hostname.includes('nostr.build') && !u.pathname.includes('/i/')) continue;
          return url;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  function cleanNoteContent(content: string): string {
    const text = (content || '')
      .replace(/nostr:[a-z0-9]+/gi, '')
      .replace(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg|bmp|avif|mp4|webm|mov)(\?[^\s]*)?/gi, '')
      .replace(/https?:\/\/[^\s]+/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > 155) {
      const truncated = text.slice(0, 155);
      const lastSpace = truncated.lastIndexOf(' ');
      const lastSentence = Math.max(
        truncated.lastIndexOf('.'),
        truncated.lastIndexOf('!'),
        truncated.lastIndexOf('?')
      );
      if (lastSentence > 80) return text.slice(0, lastSentence + 1);
      return (lastSpace > 80 ? truncated.slice(0, lastSpace) : truncated) + '...';
    }
    return text || 'A note shared on zap.cooking';
  }

  // Resolve the author's display name for the OG title once the note loads.
  $: if (event?.author) {
    event.author
      .fetchProfile()
      .then((p) => {
        authorName = p?.displayName || p?.name || null;
      })
      .catch(() => {});
  }

  $: ogTitle = authorName ? `${authorName} on zap.cooking` : 'Note on zap.cooking';
  $: ogDescription = event
    ? cleanNoteContent(event.content)
    : 'A note shared on zap.cooking - Food. Friends. Freedom.';
  $: ogImage = (event && extractFirstImageUrl(event.content)) || 'https://zap.cooking/social-share.png';
  $: ogCreatedAt = event?.created_at ?? null;

  // Thread hierarchy
  let parentThread: NDKEvent[] = []; // Parent notes above this one
  let loadingParents = false;

  // Replies/comments
  let replies: NDKEvent[] = [];
  let loadingReplies = false;
  let processedReplies = new Set<string>();

  // Get the parent note ID from an event's e tags
  function getParentNoteId(evt: NDKEvent): string | null {
    // Look for reply tag first
    const replyTag = evt.tags.find(
      (tag) => Array.isArray(tag) && tag[0] === 'e' && tag[3] === 'reply'
    );
    if (replyTag) return replyTag[1] as string;

    // Fallback to root tag
    const rootTag = evt.tags.find(
      (tag) => Array.isArray(tag) && tag[0] === 'e' && tag[3] === 'root'
    );
    if (rootTag) return rootTag[1] as string;

    // Fallback to first e tag
    const firstETag = evt.tags.find((tag) => Array.isArray(tag) && tag[0] === 'e');
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

        const parentNote = await $ndk.fetchEvent({ kinds: [1, 1068, 1111] as any, ids: [parentId] });
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

  // Encode a note/reply event as nevent1 with relay hints for better discoverability.
  function noteUrl(evt: NDKEvent): string {
    const relayUrl = evt.relay?.url ?? (evt as any).onRelays?.[0]?.url;
    try {
      return '/' + nip19.neventEncode({
        id: evt.id,
        relays: relayUrl ? [relayUrl] : [],
        kind: evt.kind ?? 1
      });
    } catch {
      return '/' + nip19.noteEncode(evt.id);
    }
  }

  // Fetch replies to this note
  function fetchReplies(eventId: string) {
    loadingReplies = true;
    replies = [];
    processedReplies.clear();

    if (!event) return;

    const filter = createCommentFilter(event);

    // Build a wider relay set: NDK's default pool + the relay that served the
    // main event + any relay hints embedded in the event's e/p tags.
    // This handles the common case where replies live on the author's write
    // relay but not on all of NDK's default pool relays.
    let relaySet: NDKRelaySet | undefined;
    try {
      const extraUrls = new Set<string>();
      // Relay that served the main event
      const sourceRelay = event.relay?.url || event.onRelays?.[0]?.url;
      if (sourceRelay) extraUrls.add(sourceRelay);
      // Relay hints in event e/p tags (NIP-10 clients often include them)
      for (const tag of event.tags) {
        if ((tag[0] === 'e' || tag[0] === 'p') && tag[2]?.startsWith('wss://')) {
          extraUrls.add(tag[2]);
        }
      }
      if (extraUrls.size > 0 && $ndk) {
        relaySet = NDKRelaySet.fromRelayUrls([...extraUrls].slice(0, 3), $ndk, true);
      }
    } catch { /* non-fatal */ }

    const sub = $ndk.subscribe(filter, { closeOnEose: false }, relaySet);

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

    if (!nip19Id) {
      error = true;
      loading = false;
      return;
    }

    if (nip19Id.startsWith('nostr:')) {
      nip19Id = nip19Id.split('nostr:')[1];
    }

    // Plain zap.cooking NIP-05 username (not a NIP-19 identifier): resolve to
    // a pubkey via /.well-known/nostr.json and redirect to the profile page.
    // This mirrors the behavior the deleted +page.server.ts used to provide.
    const isNip19 = /^(?:npub1|nprofile1|note1|nevent1|naddr1)/.test(nip19Id);
    if (!isNip19 && /^[a-zA-Z0-9_]{3,20}$/.test(nip19Id)) {
      const username = nip19Id.toLowerCase();
      try {
        const res = await fetch('/.well-known/nostr.json?name=' + encodeURIComponent(username));
        if (res.ok) {
          const json = await res.json();
          const pubkey = json?.names?.[username];
          if (pubkey) {
            goto(`/user/${nip19.npubEncode(pubkey)}`);
            return;
          }
        }
      } catch {
        // Resolution failed — fall through to the not-found state below.
      }
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
        let neventRelays: string[] = [];
        switch (decoded.type) {
          case 'nevent':
            eventId = (decoded as nip19.DecodedNevent).data.id;
            neventRelays = ((decoded as nip19.DecodedNevent).data.relays ?? [])
              .filter((r) => r.startsWith('wss://'))
              .slice(0, 3);
            break;
          case 'note':
            eventId = (decoded as nip19.DecodedNote).data;
            break;
        }
        const filter = {
          ids: [eventId]
        };

        // Include relay hints from nevent1 when fetching the main event
        let eventRelaySet: NDKRelaySet | undefined;
        if (neventRelays.length > 0 && $ndk) {
          try {
            eventRelaySet = NDKRelaySet.fromRelayUrls(neventRelays, $ndk, true);
          } catch { /* non-fatal */ }
        }

        const subscription = $ndk.subscribe(filter, { closeOnEose: false }, eventRelaySet);
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

  $: if (browser && $page.params.nip19 && $page.params.nip19 !== loadedNip19) {
    loadedNip19 = $page.params.nip19;
    loadEvent($page.params.nip19);
  }

  // Compact "X-unit-ago" formatter for note headers (e.g. "10m", "3h",
  // "2d", "1y"). Mirrors the helper in FoodstrFeedOptimized — short
  // form avoids mid-phrase wrap on mobile.
  function formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor(Date.now() / 1000) - timestamp;
    if (seconds < 60) return 'now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 365) return `${days}d`;
    return `${Math.floor(days / 365)}y`;
  }


  onMount(() => {
    stripTrackingParams($page.url);
    if ($userPublickey) {
      muteListStore.load();
    }
  });

  function handleReplyPosted(posted: NDKEvent) {
    if (processedReplies.has(posted.id)) return;
    processedReplies.add(posted.id);
    replies = [...replies, posted].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  }

  // Filter to get only direct replies (not nested)
  $: directReplies = replies.filter((r) => {
    if (!event) return false;
    const rootEvent = event;

    // For NIP-22 comments (kind 1111)
    if (r.kind === 1111) {
      const aTags = r.getMatchingTags('a');
      const eTags = r.getMatchingTags('e');
      const kTags = r.getMatchingTags('k');

      // Check if this comment's 'a' tag matches the root article address
      const dTag = rootEvent.tags.find((t) => t[0] === 'd')?.[1];
      if (dTag) {
        const rootAddress = `${rootEvent.kind}:${rootEvent.pubkey}:${dTag}`;
        const matchesRoot = aTags.some((tag) => tag[1] === rootAddress);

        // Check if parent 'e' tag points to root event (top-level comment)
        // and 'k' tag shows parent is the root kind (30023)
        const isTopLevel =
          eTags.some((tag) => tag[1] === rootEvent.id) &&
          kTags.some((tag) => tag[1] === String(rootEvent.kind));

        return matchesRoot && isTopLevel;
      }
      return false;
    }

    // For NIP-10 replies (kind 1)
    const eTags = r.getMatchingTags('e');
    const replyTag = eTags.find((tag) => tag[3] === 'reply');
    const rootTag = eTags.find((tag) => tag[3] === 'root');

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
      return eTags.some((tag) => tag[1] === event?.id);
    }

    return false;
  });

  // Get nested replies for a comment
  function getNestedReplies(parentId: string): NDKEvent[] {
    return replies.filter((r) => {
      // For NIP-22 comments (kind 1111)
      if (r.kind === 1111) {
        const eTags = r.getMatchingTags('e');
        const kTags = r.getMatchingTags('k');
        // Check if parent 'e' tag points to the parent comment
        // and 'k' tag shows parent is a comment (1111)
        return eTags.some((tag) => tag[1] === parentId) && kTags.some((tag) => tag[1] === '1111');
      }

      // For NIP-10 replies (kind 1)
      const eTags = r.getMatchingTags('e');
      const replyTag = eTags.find((tag) => tag[3] === 'reply');

      // Check if reply marker points to parent
      if (replyTag && replyTag[1] === parentId) {
        return true;
      }

      // Check if this is a reply to the parent (without markers)
      if (!replyTag && eTags.some((tag) => tag[1] === parentId)) {
        // Make sure it's not actually replying to the main event
        return !eTags.some(
          (tag) => tag[1] === event?.id && (tag[3] === 'reply' || eTags.length === 1)
        );
      }

      return false;
    });
  }
</script>

<svelte:head>
  <title>{ogTitle}</title>
  <meta name="description" content={ogDescription} />

  <!-- Open Graph -->
  <meta property="og:type" content="article" />
  <meta property="og:url" content={`https://zap.cooking/${$page.params.nip19}`} />
  <meta property="og:title" content={ogTitle} />
  <meta property="og:description" content={ogDescription} />
  <meta property="og:image" content={ogImage} />
  <meta property="og:site_name" content="zap.cooking" />
  {#if ogCreatedAt}
    <meta property="article:published_time" content={new Date(ogCreatedAt * 1000).toISOString()} />
  {/if}

  <!-- Twitter -->
  <meta name="twitter:card" content={ogImage !== 'https://zap.cooking/social-share.png' ? 'summary_large_image' : 'summary'} />
  <meta name="twitter:title" content={ogTitle} />
  <meta name="twitter:description" content={ogDescription} />
  <meta name="twitter:image" content={ogImage} />
</svelte:head>

<div class="max-w-2xl mx-auto px-4">
  <!-- Back link -->
  {#if !loading}
    <div class="pt-4 pb-2">
      <button
        on:click={() => goto('/community')}
        class="flex items-center gap-1 text-sm transition-opacity hover:opacity-70"
        style="color: var(--color-caption)"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15 19l-7-7 7-7"
          />
        </svg>
        Community
      </button>
    </div>
  {/if}

  {#if loading}
    <div class="py-12 text-center">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
      <p class="mt-4" style="color: var(--color-caption)">Loading note...</p>
    </div>
  {:else if error}
    <div class="py-12 text-center">
      <div class="max-w-sm mx-auto space-y-6">
        <div style="color: var(--color-caption)">
          <svg
            class="h-12 w-12 mx-auto mb-4 opacity-50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            ></path>
          </svg>
          <p class="text-lg font-medium">Note not found</p>
          <p class="text-sm">The referenced note could not be loaded.</p>
        </div>
      </div>
    </div>
  {:else if event && $mutedPubkeys.has(event.author?.hexpubkey || event.pubkey)}
    <!-- Muted user content -->
    <div class="py-12 text-center">
      <div class="max-w-sm mx-auto space-y-6">
        <div style="color: var(--color-caption)">
          <svg
            class="h-12 w-12 mx-auto mb-4 opacity-50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
            />
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
            />
          </svg>
          <p class="text-lg font-medium">Content from muted user</p>
          <p class="text-sm">You have muted this user. Their content is hidden.</p>
        </div>
        <button
          on:click={() => goto('/community')}
          class="px-4 py-2 bg-input rounded-lg hover:bg-accent-gray transition-colors"
          style="color: var(--color-text-primary)"
        >
          Back to Community
        </button>
      </div>
    </div>
  {:else if event}
    <!-- Thread Header -->
    {#if parentThread.length > 0 || loadingParents}
      <div class="pt-4 pb-2">
        <div class="flex items-center gap-2 text-xs" style="color: var(--color-caption)">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
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
            <div class="w-10 h-10 rounded-full skeleton-bg"></div>
            <div class="flex-1 space-y-2">
              <div class="h-4 rounded w-1/4 skeleton-bg"></div>
              <div class="h-4 rounded w-3/4 skeleton-bg"></div>
            </div>
          </div>
        </div>
      </div>
    {:else if parentThread.length > 0}
      <div class="space-y-0">
        {#each parentThread as parentNote, index}
          <div>
            <article class="py-3">
              <div class="flex space-x-3 -mx-2 px-2 py-2 rounded-lg">
                <div class="flex-shrink-0">
                  <a
                    href="/user/{nip19.npubEncode(
                      parentNote.author?.hexpubkey || parentNote.pubkey
                    )}"
                  >
                    <Avatar
                      pubkey={parentNote.author?.hexpubkey || parentNote.pubkey}
                      size={40}
                    />
                  </a>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between mb-1">
                    <div class="flex items-center space-x-2 min-w-0">
                      <a
                        href="/user/{nip19.npubEncode(
                          parentNote.author?.hexpubkey || parentNote.pubkey
                        )}"
                        class="font-semibold text-sm transition-colors username-link truncate min-w-0"
                        style="color: var(--color-text-primary)"
                      >
                        <CustomName pubkey={parentNote.author?.hexpubkey || parentNote.pubkey} />
                      </a>
                      <span class="text-sm flex-shrink-0" style="color: var(--color-caption)">·</span>
                      <span class="text-sm whitespace-nowrap flex-shrink-0" style="color: var(--color-caption)">
                        {parentNote.created_at ? formatTimeAgo(parentNote.created_at) : ''}
                      </span>
                    </div>
                    <PostActionsMenu event={parentNote} />
                  </div>
                  {#if parentNote.kind === 1068}
                    <PollDisplay event={parentNote} />
                  {:else}
                    <a
                      href="{noteUrl(parentNote)}"
                      class="block text-base leading-relaxed hover:opacity-80"
                      style="color: var(--color-text-secondary)"
                    >
                      <NoteContent content={parentNote.content} showNostrEmbeds={false} />
                    </a>
                  {/if}
                  <!-- Parent note actions -->
                  <div class="mt-2">
                    <NoteActionBar event={parentNote} variant="compact" />
                  </div>
                </div>
              </div>
            </article>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Main Note -->
    <article class="py-6">
      <div class="flex space-x-3">
        <a
          href="/user/{nip19.npubEncode(event.author?.hexpubkey || event.pubkey)}"
          class="flex-shrink-0"
        >
          <Avatar
            className="cursor-pointer"
            pubkey={event.author?.hexpubkey || event.pubkey}
            size={40}
          />
        </a>
        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between">
            <div class="flex-1 min-w-0">
              <div class="flex items-center space-x-2 mb-2 flex-wrap">
                <a
                  href="/user/{nip19.npubEncode(event.author?.hexpubkey || event.pubkey)}"
                  class="font-semibold text-sm transition-colors username-link truncate min-w-0"
                  style="color: var(--color-text-primary)"
                >
                  <CustomName pubkey={event.author?.hexpubkey || event.pubkey} />
                </a>
                <span class="text-sm flex-shrink-0" style="color: var(--color-caption)">·</span>
                <span class="text-sm whitespace-nowrap flex-shrink-0" style="color: var(--color-caption)">
                  {event.created_at ? formatTimeAgo(event.created_at) : 'Unknown time'}
                </span>
                <ClientAttribution tags={event.tags} enableEnrichment={true} />
              </div>
              <div class="text-base leading-relaxed mb-3" style="color: var(--color-text-primary)">
                {#if event.kind === 1068}
                  <PollDisplay {event} />
                {:else}
                  <NoteContent content={event.content} />
                {/if}
              </div>
            </div>
            <PostActionsMenu {event} />
          </div>
          <NoteActionBar {event} />
        </div>
      </div>
    </article>

    <!-- Replies Section -->
    <div class="border-t mt-2" style="border-color: var(--color-input-border)">


      <!-- Replies List -->
      {#if loadingReplies}
        <div class="space-y-3">
          {#each [1, 2] as _}
            <div class="animate-pulse flex gap-3 p-3">
              <div class="w-8 h-8 rounded-full skeleton-bg"></div>
              <div class="flex-1 space-y-2">
                <div class="h-3 rounded w-1/4 skeleton-bg"></div>
                <div class="h-3 rounded w-full skeleton-bg"></div>
              </div>
            </div>
          {/each}
        </div>
      {:else if directReplies.length === 0}
        <p class="text-sm py-4 text-center" style="color: var(--color-caption)">
          No replies yet. {#if !$userPublickey}<a href="/login?redirect={encodeURIComponent($page.url.pathname)}" class="underline hover:opacity-80" style="color: var(--color-primary)">Sign in</a> to reply!{:else}Be the first to reply!{/if}
        </p>
      {:else}
        <div class="space-y-0">
          {#each directReplies as reply (reply.id)}
            {#if !$mutedPubkeys.has(reply.author?.hexpubkey || reply.pubkey)}
              <div>
                <article
                  class="py-8 border-b last:border-0 cursor-pointer hover:bg-[var(--color-bg-hover,rgba(255,255,255,0.03))]"
                  style="border-color: var(--color-input-border)"
                  on:click={(e) => { if ((e.target as HTMLElement).closest('a, button')) return; goto(noteUrl(reply)); }}
                  role="link"
                  tabindex="0"
                  on:keydown|self={(e) => e.key === 'Enter' && goto(noteUrl(reply))}
                >
                  <div class="flex space-x-3">
                    <a
                      href="/user/{nip19.npubEncode(reply.author?.hexpubkey || reply.pubkey)}"
                      class="flex-shrink-0"
                      on:click|stopPropagation
                    >
                      <Avatar pubkey={reply.author?.hexpubkey || reply.pubkey} size={32} />
                    </a>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center justify-between mb-1">
                        <div class="flex items-center space-x-2 min-w-0">
                          <a
                            href="/user/{nip19.npubEncode(reply.author?.hexpubkey || reply.pubkey)}"
                            class="font-medium text-sm transition-colors username-link truncate min-w-0"
                            style="color: var(--color-text-primary)"
                            on:click|stopPropagation
                          >
                            <CustomName pubkey={reply.author?.hexpubkey || reply.pubkey} />
                          </a>
                          <span class="text-xs flex-shrink-0" style="color: var(--color-caption)">·</span>
                          <span class="text-xs whitespace-nowrap flex-shrink-0" style="color: var(--color-caption)">
                            {reply.created_at ? formatTimeAgo(reply.created_at) : ''}
                          </span>
                        </div>
                        <span on:click|stopPropagation>
                          <PostActionsMenu event={reply} />
                        </span>
                      </div>
                      <div
                        class="text-base leading-relaxed"
                        style="color: var(--color-text-primary)"
                      >
                        {#if reply.kind === 1068}
                          <PollDisplay event={reply} />
                        {:else}
                          <NoteContent content={reply.content} showNostrEmbeds={false} />
                        {/if}
                      </div>
                      <!-- Reply actions -->
                      <div class="mt-2" on:click|stopPropagation>
                        <NoteActionBar event={reply} />
                      </div>
                    </div>
                  </div>
                </article>

                <!-- Nested Replies (1 level deep shown inline) -->
                {#each getNestedReplies(reply.id).slice(0, 2) as nestedReply (nestedReply.id)}
                  {#if !$mutedPubkeys.has(nestedReply.author?.hexpubkey || nestedReply.pubkey)}
                    <div class="ml-8 pl-3">
                      <article
                        class="py-2 cursor-pointer hover:bg-[var(--color-bg-hover,rgba(255,255,255,0.03))] rounded"
                        on:click={(e) => { if ((e.target as HTMLElement).closest('a, button')) return; goto(noteUrl(nestedReply)); }}
                        role="link"
                        tabindex="0"
                        on:keydown|self={(e) => e.key === 'Enter' && goto(noteUrl(nestedReply))}
                      >
                        <div class="flex space-x-2">
                          <a
                            href="/user/{nip19.npubEncode(
                              nestedReply.author?.hexpubkey || nestedReply.pubkey
                            )}"
                            class="flex-shrink-0"
                            on:click|stopPropagation
                          >
                            <Avatar
                              pubkey={nestedReply.author?.hexpubkey || nestedReply.pubkey}
                              size={24}
                            />
                          </a>
                          <div class="flex-1 min-w-0">
                            <div class="flex items-center justify-between mb-0.5">
                              <div class="flex items-center space-x-2 min-w-0">
                                <a
                                  href="/user/{nip19.npubEncode(
                                    nestedReply.author?.hexpubkey || nestedReply.pubkey
                                  )}"
                                  class="font-medium text-sm transition-colors username-link truncate min-w-0"
                                  style="color: var(--color-text-primary)"
                                  on:click|stopPropagation
                                >
                                  <CustomName
                                    pubkey={nestedReply.author?.hexpubkey || nestedReply.pubkey}
                                  />
                                </a>
                                <span class="text-xs flex-shrink-0" style="color: var(--color-caption)">·</span>
                                <span class="text-xs whitespace-nowrap flex-shrink-0" style="color: var(--color-caption)">
                                  {nestedReply.created_at
                                    ? formatTimeAgo(nestedReply.created_at)
                                    : ''}
                                </span>
                              </div>
                              <span on:click|stopPropagation>
                                <PostActionsMenu event={nestedReply} />
                              </span>
                            </div>
                            <div
                              class="text-sm leading-relaxed"
                              style="color: var(--color-text-primary)"
                            >
                              {#if nestedReply.kind === 1068}
                                <PollDisplay event={nestedReply} />
                              {:else}
                                <NoteContent content={nestedReply.content} showNostrEmbeds={false} />
                              {/if}
                            </div>
                            <!-- Nested reply actions -->
                            <div class="mt-1.5" on:click|stopPropagation>
                              <NoteActionBar event={nestedReply} variant="compact" />
                            </div>
                          </div>
                        </div>
                      </article>
                    </div>
                  {/if}
                {/each}

                <!-- Show more nested replies link -->
                {#if getNestedReplies(reply.id).length > 2}
                  <a
                    href="{noteUrl(reply)}"
                    class="ml-8 pl-3 py-2 block text-xs text-primary hover:opacity-80"
                  >
                    Show {getNestedReplies(reply.id).length - 2} more {getNestedReplies(reply.id)
                      .length -
                      2 ===
                    1
                      ? 'reply'
                      : 'replies'}
                  </a>
                {/if}
              </div>
            {/if}
          {/each}
        </div>
      {/if}

      <!-- Reply Input -->
      {#if $userPublickey}
        <div class="mt-4 p-3 rounded-lg" style="background-color: var(--color-bg-secondary)">
          <div class="flex gap-3 items-start">
            <div class="flex-shrink-0">
              <Avatar pubkey={$userPublickey} size={32} />
            </div>
            <div class="flex-1 min-w-0 -mt-3">
              <ReplyComposer
                parentEvent={event}
                placeholder="Write a reply..."
                submitLabel="Reply"
                onPosted={handleReplyPosted}
              />
            </div>
          </div>
        </div>
      {:else}
        <div
          class="mt-4 p-3 rounded-lg text-sm"
          style="background-color: var(--color-bg-secondary); color: var(--color-caption)"
        >
          <a href="/login" class="text-primary hover:underline font-medium">Log in</a> to reply
        </div>
      {/if}
    </div>
  {/if}
</div>


<style>
  /* Thread page styles */

  /* Username hover - orange color */
  .username-link:hover {
    color: var(--color-primary) !important;
  }
</style>
