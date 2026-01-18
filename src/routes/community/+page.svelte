<script lang="ts">
  import FoodstrFeedOptimized from '../../components/FoodstrFeedOptimized.svelte';
  import PullToRefresh from '../../components/PullToRefresh.svelte';
  import { ndk, userPublickey, normalizeRelayUrl } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import ImageIcon from 'phosphor-svelte/lib/Image';
  import VideoIcon from 'phosphor-svelte/lib/Video';
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
  import { searchProfiles } from '$lib/profileSearchService';

  // Pull-to-refresh refs
  let pullToRefreshEl: PullToRefresh;
  let feedComponent: FoodstrFeedOptimized;

  async function handleRefresh() {
    try {
      if (feedComponent) {
        await feedComponent.refresh();
      }
    } finally {
      // Always complete the pull-to-refresh, even if refresh throws
      pullToRefreshEl?.complete();
    }
  }

  export const data: PageData = {} as PageData;

  // Tab state - use local state for immediate reactivity
  type FilterMode = 'global' | 'following' | 'replies' | 'members' | 'garden';

  // Local state for immediate UI updates
  let activeTab: FilterMode = 'following';

  // Check if user has active membership (for Members tab)
  let hasActiveMembership = false;
  let checkingMembership = false;

  // Tab initialization is now in the onMount with quote listener

  // Key to force component recreation
  let feedKey = 0;

  async function setTab(tab: FilterMode) {
    if (tab === activeTab) return;

    activeTab = tab;
    feedKey++; // This forces component recreation with new filterMode

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
  let composerEl: HTMLDivElement;
  let lastRenderedContent = '';
  let uploadedImages: string[] = [];
  let uploadedVideos: string[] = [];
  let uploadingImage = false;
  let uploadingVideo = false;
  let imageInputEl: HTMLInputElement;
  let videoInputEl: HTMLInputElement;
  let quotedNote: { nevent: string; event: NDKEventType } | null = null;

  // @ mention autocomplete state
  let mentionQuery = '';
  let showMentionSuggestions = false;
  let mentionSuggestions: {
    name: string;
    npub: string;
    picture?: string;
    pubkey: string;
    nip05?: string;
  }[] = [];
  let selectedMentionIndex = 0;
  let mentionProfileCache: Map<
    string,
    { name: string; npub: string; picture?: string; pubkey: string; nip05?: string }
  > = new Map();
  let mentionFollowListLoaded = false;
  let mentionSearchTimeout: ReturnType<typeof setTimeout>;
  let mentionSearching = false;

  // Listen for quote-note events from NoteRepost component
  function handleQuoteNote(e: CustomEvent) {
    quotedNote = e.detail;
    openComposer();
  }

  // Check membership status
  async function checkMembership() {
    if (!$userPublickey || checkingMembership) return;

    checkingMembership = true;
    try {
      const res = await fetch('/api/membership/check-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pubkey: $userPublickey })
      });

      if (res.ok) {
        const data = await res.json();
        hasActiveMembership = data.isActive === true;
      }
    } catch (err) {
      console.error('Failed to check membership:', err);
    } finally {
      checkingMembership = false;
    }
  }

  onMount(() => {
    const tab = $page.url.searchParams.get('tab');
    if (
      tab === 'following' ||
      tab === 'replies' ||
      tab === 'global' ||
      tab === 'members' ||
      tab === 'garden'
    ) {
      activeTab = tab;
    }

    // Check membership status if user is logged in
    if ($userPublickey) {
      checkMembership();
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
  });

  function openComposer() {
    isComposerOpen = true;
    setTimeout(() => {
      if (composerEl) {
        syncComposerContent(content);
        composerEl.focus();
      }
    }, 50);
  }

  function closeComposer() {
    if (!posting) {
      isComposerOpen = false;
      content = '';
      lastRenderedContent = '';
      error = '';
      showMentionSuggestions = false;
      mentionSuggestions = [];
      mentionQuery = '';
      uploadedImages = [];
      uploadedVideos = [];
      quotedNote = null;
      if (composerEl) {
        composerEl.innerHTML = '';
      }
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

    try {
      const response = await fetch(url, {
        body,
        method: 'POST',
        headers: {
          Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}`
        }
      });

      // Check if response is ok
      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { message: errorText || `HTTP ${response.status}: ${response.statusText}` };
        }
        throw new Error(
          errorData.message || errorData.error || `Upload failed with status ${response.status}`
        );
      }

      const result = await response.json();
      return result;
    } catch (err: any) {
      // If it's already an Error with a message, re-throw it
      if (err instanceof Error) {
        throw err;
      }
      // Otherwise wrap it
      throw new Error(err?.message || 'Failed to upload file');
    }
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

  async function handleVideoUpload(event: Event) {
    const target = event.target as HTMLInputElement;
    if (!target.files || target.files.length === 0) return;

    uploadingVideo = true;
    error = '';

    try {
      const file = target.files[0];

      // Validate file type
      if (!file.type.startsWith('video/')) {
        error = 'Please upload a video file';
        uploadingVideo = false;
        return;
      }

      // Validate file size - minimum 1KB (very small files are likely invalid)
      const minSize = 1024; // 1KB
      if (file.size < minSize) {
        error = `Video file is too small (${file.size} bytes). File appears to be invalid.`;
        uploadingVideo = false;
        return;
      }

      // Validate file size (max 20MB for videos - nostr.build API limit)
      const maxSize = 20 * 1024 * 1024; // 20MB
      if (file.size > maxSize) {
        error = `Video must be less than 20MB (current size: ${(file.size / 1024 / 1024).toFixed(2)}MB). Please compress your video or use a shorter recording.`;
        uploadingVideo = false;
        return;
      }

      // Get video metadata to check duration and bitrate
      let videoDuration = 0;
      try {
        const videoUrl = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.preload = 'metadata';
        await new Promise((resolve, reject) => {
          video.onloadedmetadata = () => {
            videoDuration = video.duration;
            URL.revokeObjectURL(videoUrl);
            resolve(null);
          };
          video.onerror = () => {
            URL.revokeObjectURL(videoUrl);
            reject(new Error('Could not read video metadata'));
          };
          video.src = videoUrl;
        });

        // Calculate approximate bitrate (bits per second)
        if (videoDuration > 0) {
          const bitrate = (file.size * 8) / videoDuration; // bits per second
          const bitrateMbps = bitrate / (1024 * 1024);
          console.log(
            `Video metadata - duration: ${videoDuration.toFixed(1)}s, bitrate: ${bitrateMbps.toFixed(2)} Mbps, size: ${(file.size / 1024 / 1024).toFixed(2)}MB`
          );

          // Warn if bitrate is suspiciously low (< 0.1 Mbps) - might indicate compression issues
          if (bitrateMbps < 0.1 && videoDuration > 5) {
            console.warn(
              `Video has very low bitrate (${bitrateMbps.toFixed(3)} Mbps), might cause upload issues`
            );
          }
        }
      } catch (metaError) {
        console.warn('Could not read video metadata:', metaError);
      }

      console.log(
        `Uploading video: ${file.name}, size: ${(file.size / 1024 / 1024).toFixed(2)}MB, type: ${file.type}, duration: ${videoDuration > 0 ? videoDuration.toFixed(1) + 's' : 'unknown'}`
      );

      const body = new FormData();
      body.append('file[]', file);

      const result = await uploadToNostrBuild(body);

      if (result && result.data && result.data[0]?.url) {
        uploadedVideos = [...uploadedVideos, result.data[0].url];
      } else {
        // Extract error message from response if available
        const errorMsg = result?.message || result?.error || 'Unknown error';
        console.error('Upload failed - response:', result);
        error = `Failed to upload video${errorMsg !== 'Unknown error' ? `: ${errorMsg}` : ''}`;
      }
    } catch (err: any) {
      console.error('Error uploading video:', err);
      // Extract error message from the error object
      const errorMsg =
        err?.message || err?.response?.message || err?.response?.error || 'Unknown error';
      error = `Failed to upload video${errorMsg !== 'Unknown error' ? `: ${errorMsg}` : '. Please try again.'}`;
    } finally {
      uploadingVideo = false;
      // Reset input so same file can be selected again
      if (videoInputEl) {
        videoInputEl.value = '';
      }
    }
  }

  function removeImage(index: number) {
    uploadedImages = uploadedImages.filter((_, i) => i !== index);
  }

  function removeVideo(index: number) {
    uploadedVideos = uploadedVideos.filter((_, i) => i !== index);
  }

  async function postToFeed() {
    if (
      !content.trim() &&
      !quotedNote &&
      uploadedImages.length === 0 &&
      uploadedVideos.length === 0
    ) {
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
      if (composerEl) {
        content = htmlToPlainText(composerEl);
        lastRenderedContent = content;
      }

      // Ensure NIP-46 signer is ready if using remote signer
      const { getAuthManager } = await import('$lib/authManager');
      const authManager = getAuthManager();
      if (authManager) {
        await authManager.ensureNip46SignerReady();
      }

      const event = new NDKEvent($ndk);
      event.kind = 1;

      // Build content with text, image URLs, and video URLs
      let postContent = content.trim();
      const mediaUrls: string[] = [];

      if (uploadedImages.length > 0) {
        mediaUrls.push(...uploadedImages);
      }

      if (uploadedVideos.length > 0) {
        mediaUrls.push(...uploadedVideos);
      }

      if (mediaUrls.length > 0) {
        // Add media URLs to content (one per line for better display)
        const mediaUrlsText = mediaUrls.join('\n');
        postContent = postContent ? `${postContent}\n\n${mediaUrlsText}` : mediaUrlsText;
      }

      // Add quoted note reference if quoting
      if (quotedNote) {
        postContent = postContent
          ? `${postContent}\n\nnostr:${quotedNote.nevent}`
          : `nostr:${quotedNote.nevent}`;
      }

      postContent = replacePlainMentions(postContent);
      const mentions = parseMentions(postContent);

      event.content = postContent;
      event.tags = [['t', 'zapcooking']];

      // Parse and add @ mention tags (p tags)
      for (const pubkey of mentions.values()) {
        // Avoid duplicate p tags
        if (!event.tags.some((t) => t[0] === 'p' && t[1] === pubkey)) {
          event.tags.push(['p', pubkey]);
        }
      }

      // Add quote tags if quoting
      if (quotedNote) {
        const quotedPubkey = quotedNote.event.pubkey;
        event.tags.push(['q', quotedNote.event.id]);
        // Only add p tag if not already mentioned
        if (!event.tags.some((t) => t[0] === 'p' && t[1] === quotedPubkey)) {
          event.tags.push(['p', quotedPubkey]);
        }
      }

      // Add NIP-89 client tag
      addClientTagToEvent(event);

      // Publish with timeout
      // If in garden or members mode, publish to specific relay ONLY
      // For global/following/replies, publish to regular relays
      let publishPromise: Promise<boolean>;
      if (activeTab === 'garden') {
        // For garden mode, publish ONLY to the garden relay using NDKRelaySet
        // This ensures the post only goes to garden.zap.cooking
        const { NDKRelaySet } = await import('@nostr-dev-kit/ndk');
        const gardenRelayUrl = 'wss://garden.zap.cooking';

        console.log('[Garden] Publishing to garden relay only:', gardenRelayUrl);

        // Create a relay set with ONLY the garden relay
        // Use true for third param to allow temporary connection if not in pool
        const gardenRelaySet = NDKRelaySet.fromRelayUrls([gardenRelayUrl], $ndk, true);

        // Publish to the relay set - this ensures ONLY garden relay receives the event
        publishPromise = event.publish(gardenRelaySet).then((publishedRelays) => {
          console.log('[Garden] Publish result:', publishedRelays.size, 'relays confirmed');
          // Verify garden relay received the event
          const gardenRelayPublished = Array.from(publishedRelays).some(
            (relay) => normalizeRelayUrl(relay.url) === normalizeRelayUrl(gardenRelayUrl)
          );
          if (!gardenRelayPublished) {
            throw new Error('Failed to publish to garden relay. Please try again.');
          }
          return true;
        });
      } else if (activeTab === 'members') {
        // For members mode, publish ONLY to the members relay using NDKRelaySet
        const { NDKRelaySet } = await import('@nostr-dev-kit/ndk');
        const membersRelayUrl = 'wss://members.zap.cooking';

        // Create a relay set with ONLY the members relay
        const membersRelaySet = NDKRelaySet.fromRelayUrls([membersRelayUrl], $ndk, true);

        // Publish to the relay set - this ensures ONLY members relay receives the event
        publishPromise = event.publish(membersRelaySet).then((publishedRelays) => {
          // Verify members relay received the event
          const membersRelayPublished = Array.from(publishedRelays).some(
            (relay) => relay.url === membersRelayUrl || relay.url === membersRelayUrl + '/'
          );
          if (!membersRelayPublished) {
            throw new Error('Failed to publish to members relay');
          }
          return true;
        });
      } else {
        publishPromise = event.publish().then(() => true);
      }

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('Publishing timeout - signer may not be responding')),
          30000
        );
      });

      const publishedEvent = await Promise.race([publishPromise, timeoutPromise]);

      if (publishedEvent) {
        success = true;
        content = '';
        lastRenderedContent = '';
        if (composerEl) {
          composerEl.innerHTML = '';
        }
        showMentionSuggestions = false;
        mentionSuggestions = [];
        mentionQuery = '';
        uploadedImages = [];
        uploadedVideos = [];
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
      const followPubkeys = contactEvent.tags.filter((t) => t[0] === 'p' && t[1]).map((t) => t[1]);

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
    const matches: {
      name: string;
      npub: string;
      picture?: string;
      pubkey: string;
      nip05?: string;
    }[] = [];
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

    const shouldSearchPrimal = query.length >= 2;
    const shouldSearchNdk = query.length >= 1 && $ndk;

    if (shouldSearchPrimal || shouldSearchNdk) {
      mentionSearching = true;

      try {
        if (shouldSearchPrimal) {
          const primalResults = await searchProfiles(query, 25);
          for (const profile of primalResults) {
            if (seenPubkeys.has(profile.pubkey)) continue;

            const name =
              profile.displayName || profile.name || profile.nip05?.split('@')[0] || 'Unknown';
            const profileData = {
              name,
              npub: profile.npub || nip19.npubEncode(profile.pubkey),
              picture: profile.picture,
              pubkey: profile.pubkey,
              nip05: profile.nip05
            };

            matches.push(profileData);
            seenPubkeys.add(profile.pubkey);
            mentionProfileCache.set(profile.pubkey, profileData);
          }
        }

        if (shouldSearchNdk && $ndk) {
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
        }
      } catch (e) {
        console.debug('Network search failed:', e);
      } finally {
        mentionSearching = false;
      }
    }

    // Sort: prioritize exact matches, then by name
    matches.sort((a, b) => {
      const aExact =
        a.name.toLowerCase().startsWith(queryLower) ||
        a.nip05?.toLowerCase().startsWith(queryLower);
      const bExact =
        b.name.toLowerCase().startsWith(queryLower) ||
        b.nip05?.toLowerCase().startsWith(queryLower);
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      return a.name.localeCompare(b.name);
    });

    mentionSuggestions = matches.slice(0, 10);
    selectedMentionIndex = 0;
  }

  function syncComposerContent(value: string) {
    if (!composerEl) return;
    const html = renderTextWithMentions(value);
    if (composerEl.innerHTML !== html) {
      composerEl.innerHTML = html;
    }
    lastRenderedContent = value;
  }

  function escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function formatNpubShort(npub: string): string {
    if (npub.length <= 16) return npub;
    return `${npub.slice(0, 10)}...${npub.slice(-6)}`;
  }

  function getDisplayNameForMention(mention: string): string {
    const identifier = mention.replace('nostr:', '');
    try {
      const decoded = nip19.decode(identifier);
      if (decoded.type === 'npub') {
        const profile = mentionProfileCache.get(decoded.data);
        if (profile?.name) return profile.name;
        return formatNpubShort(identifier);
      }
      if (decoded.type === 'nprofile') {
        const profile = mentionProfileCache.get(decoded.data.pubkey);
        if (profile?.name) return profile.name;
        return formatNpubShort(nip19.npubEncode(decoded.data.pubkey));
      }
    } catch {}
    return formatNpubShort(identifier);
  }

  function renderTextWithMentions(text: string): string {
    if (!text) return '';
    const mentionRegex =
      /nostr:(npub1[023456789acdefghjklmnpqrstuvwxyz]{58}|nprofile1[023456789acdefghjklmnpqrstuvwxyz]+)|@npub1[023456789acdefghjklmnpqrstuvwxyz]{58}/g;
    let html = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = mentionRegex.exec(text)) !== null) {
      const beforeText = text.substring(lastIndex, match.index);
      if (beforeText) {
        html += escapeHtml(beforeText).replace(/\n/g, '<br>');
      }

      const rawMention = match[0];
      const mention = rawMention.startsWith('@') ? `nostr:${rawMention.slice(1)}` : rawMention;
      const displayName = getDisplayNameForMention(mention);
      html += `<span class="mention-pill" contenteditable="false" data-mention="${mention}">@${escapeHtml(displayName)}</span>`;

      lastIndex = match.index + rawMention.length;
    }

    if (lastIndex < text.length) {
      html += escapeHtml(text.substring(lastIndex)).replace(/\n/g, '<br>');
    }

    return html;
  }

  function replacePlainMentions(text: string): string {
    let output = text;
    output = output.replace(
      /@npub1[023456789acdefghjklmnpqrstuvwxyz]{58}/g,
      (match) => `nostr:${match.slice(1)}`
    );
    for (const profile of mentionProfileCache.values()) {
      if (!profile.name) continue;
      const mentionText = `@${profile.name}`;
      const mentionRegex = new RegExp(`${escapeRegex(mentionText)}(?=\\s|$|[.,!?;:])`, 'gi');
      if (mentionRegex.test(output)) {
        output = output.replace(mentionRegex, `nostr:${profile.npub}`);
      }
    }
    return output;
  }

  function htmlToPlainText(element: Node): string {
    let text = '';
    let isFirstChild = true;

    element.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const content = (node.textContent || '').replace(/\u200B/g, '');
        text += content;
        if (content) {
          isFirstChild = false;
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;

        if (el.dataset.mention) {
          text += el.dataset.mention;
          isFirstChild = false;
        } else if (el.tagName === 'BR') {
          text += '\n';
        } else if (el.tagName === 'DIV') {
          if (!isFirstChild) {
            text += '\n';
          }

          const hasOnlyBr = el.childNodes.length === 1 && el.firstChild?.nodeName === 'BR';
          if (!hasOnlyBr) {
            text += htmlToPlainText(node);
          }
          isFirstChild = false;
        } else if (el.tagName === 'SPAN') {
          const spanContent = htmlToPlainText(node);
          text += spanContent;
          if (spanContent) {
            isFirstChild = false;
          }
        } else {
          const childContent = htmlToPlainText(node);
          text += childContent;
          if (childContent) {
            isFirstChild = false;
          }
        }
      }
    });

    return text;
  }

  function getTextBeforeCursor(element: HTMLDivElement): string {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return '';

    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(element);
    preCaretRange.setEnd(range.startContainer, range.startOffset);

    const tempDiv = document.createElement('div');
    tempDiv.appendChild(preCaretRange.cloneContents());

    return htmlToPlainText(tempDiv);
  }

  function updateContentFromComposer() {
    if (!composerEl) return;
    const newText = htmlToPlainText(composerEl);
    lastRenderedContent = newText;
    content = newText;
  }

  function handleBeforeInput(event: InputEvent) {
    if (
      event.isComposing ||
      event.inputType === 'historyUndo' ||
      event.inputType === 'historyRedo'
    ) {
      return;
    }

    const selection = window.getSelection();
    if (!selection || !composerEl) return;
    const range = selection.getRangeAt(0);
    let node: Node | null = range.startContainer;

    while (node && node !== composerEl) {
      if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.mention) {
        event.preventDefault();

        if (event.inputType === 'insertText' || event.inputType === 'insertCompositionText') {
          const newRange = document.createRange();
          newRange.setStartAfter(node);
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
        }
        return;
      }
      node = node.parentNode;
    }
  }

  function handlePaste(event: ClipboardEvent) {
    event.preventDefault();
    const plainText = event.clipboardData?.getData('text/plain');
    if (!plainText) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);

    range.deleteContents();
    const textNode = document.createTextNode(plainText);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    handleContentInput();
  }

  // Handle composer input for @ mentions
  function handleContentInput() {
    updateContentFromComposer();
    if (!composerEl) return;

    const converted = convertRawMentionsToPills();
    if (converted) {
      updateContentFromComposer();
    }

    const textBeforeCursor = getTextBeforeCursor(composerEl);
    const mentionMatch = textBeforeCursor.match(/@([^\s@]*)$/);

    if (mentionMatch) {
      mentionQuery = mentionMatch[1] || '';
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

  function deleteCharsBeforeCursor(count: number) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    let remaining = count;
    let currentNode: Node | null = range.startContainer;
    let currentOffset = range.startOffset;

    if (currentNode.nodeType === Node.ELEMENT_NODE) {
      const walker = document.createTreeWalker(currentNode, NodeFilter.SHOW_TEXT, null);
      let lastText: Text | null = null;
      while (walker.nextNode()) {
        lastText = walker.currentNode as Text;
      }
      if (lastText) {
        currentNode = lastText;
        currentOffset = lastText.length;
      }
    }

    while (remaining > 0 && currentNode) {
      if (currentNode.nodeType === Node.TEXT_NODE) {
        const textNode = currentNode as Text;
        const deleteCount = Math.min(remaining, currentOffset);
        if (deleteCount > 0) {
          textNode.deleteData(currentOffset - deleteCount, deleteCount);
          remaining -= deleteCount;
          currentOffset -= deleteCount;
        }

        if (remaining > 0) {
          let prev: Node | null = textNode.previousSibling;
          while (prev && prev.nodeType !== Node.TEXT_NODE) {
            prev = prev.previousSibling;
          }
          if (prev) {
            currentNode = prev;
            currentOffset = (prev as Text).length;
          } else {
            break;
          }
        }
      } else {
        break;
      }
    }
  }

  function createMentionPill(mention: string, displayName: string): HTMLSpanElement {
    const pill = document.createElement('span');
    pill.contentEditable = 'false';
    pill.dataset.mention = mention;
    pill.className = 'mention-pill';
    pill.textContent = `@${displayName}`;
    return pill;
  }

  function insertMentionNode(mention: string, displayName: string, addTrailingSpace = false) {
    if (!composerEl) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);

    const pill = createMentionPill(mention, displayName);
    const newRange = document.createRange();
    newRange.setStart(range.startContainer, range.startOffset);
    newRange.collapse(true);
    newRange.insertNode(pill);

    if (addTrailingSpace) {
      const spacer = document.createTextNode(' ');
      pill.after(spacer);
      newRange.setStartAfter(spacer);
    } else {
      newRange.setStartAfter(pill);
    }

    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);
  }

  function convertRawMentionsToPills(): boolean {
    if (!composerEl) return false;

    const rawText = composerEl.textContent || '';
    if (!rawText.includes('npub1')) return false;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;

    const range = selection.getRangeAt(0);
    const marker = document.createElement('span');
    marker.dataset.mentionCaret = 'true';
    marker.textContent = '\u200B';
    range.insertNode(marker);

    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(composerEl, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.dataset.mention || parent.dataset.mentionCaret) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    while (walker.nextNode()) {
      textNodes.push(walker.currentNode as Text);
    }

    let converted = false;
    for (const textNode of textNodes) {
      const text = textNode.nodeValue;
      if (!text || !text.includes('npub1')) continue;

      const mentionRegex =
        /@npub1[023456789acdefghjklmnpqrstuvwxyz]{58}|nostr:(npub1[023456789acdefghjklmnpqrstuvwxyz]{58}|nprofile1[023456789acdefghjklmnpqrstuvwxyz]+)/g;
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      let hasMatch = false;
      const fragment = document.createDocumentFragment();

      while ((match = mentionRegex.exec(text)) !== null) {
        hasMatch = true;
        const before = text.slice(lastIndex, match.index);
        if (before) {
          fragment.appendChild(document.createTextNode(before));
        }

        const rawMention = match[0];
        const mention = rawMention.startsWith('@') ? `nostr:${rawMention.slice(1)}` : rawMention;
        const displayName = getDisplayNameForMention(mention);
        fragment.appendChild(createMentionPill(mention, displayName));

        lastIndex = match.index + rawMention.length;
      }

      if (!hasMatch) continue;
      converted = true;

      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      }

      textNode.parentNode?.replaceChild(fragment, textNode);
    }

    const caretMarker = composerEl.querySelector('[data-mention-caret]');
    if (caretMarker) {
      const newRange = document.createRange();
      newRange.setStartAfter(caretMarker);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);
      caretMarker.remove();
    }

    return converted;
  }

  // Insert mention pill into composer
  function insertMention(user: { name: string; npub: string; pubkey: string }) {
    if (!composerEl) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const textBeforeCursor = getTextBeforeCursor(composerEl);
    const mentionMatch = textBeforeCursor.match(/@([^\s@]*)$/);

    if (mentionMatch?.[0]) {
      deleteCharsBeforeCursor(mentionMatch[0].length);
    }

    const mention = `nostr:${user.npub}`;
    insertMentionNode(mention, user.name, true);

    mentionProfileCache.set(user.pubkey, user);
    updateContentFromComposer();
    showMentionSuggestions = false;
    mentionSuggestions = [];
  }

  // Handle keyboard navigation in mention suggestions and pill deletion
  function handleKeydown(event: KeyboardEvent) {
    const selection = window.getSelection();
    if (selection && selection.rangeCount) {
      const range = selection.getRangeAt(0);

      if (event.key === 'Delete' && range.collapsed) {
        const { startContainer, startOffset } = range;
        if (startContainer.nodeType === Node.TEXT_NODE) {
          const textNode = startContainer as Text;
          if (startOffset === textNode.length) {
            const nextSibling = startContainer.nextSibling;
            if (
              nextSibling &&
              nextSibling.nodeType === Node.ELEMENT_NODE &&
              (nextSibling as HTMLElement).dataset.mention
            ) {
              event.preventDefault();
              nextSibling.remove();
              updateContentFromComposer();
              return;
            }
          }
        }
      }

      if (event.key === 'Backspace') {
        if (!range.collapsed) {
          const container = range.commonAncestorContainer;
          let mentionElement: HTMLElement | null = null;

          if (container.nodeType === Node.ELEMENT_NODE) {
            const el = container as HTMLElement;
            if (el.dataset.mention) {
              mentionElement = el;
            }
          } else if (container.parentElement?.dataset.mention) {
            mentionElement = container.parentElement;
          }

          if (mentionElement) {
            event.preventDefault();
            mentionElement.remove();
            updateContentFromComposer();
            return;
          }
        }

        if (range.collapsed) {
          const { startContainer, startOffset } = range;
          if (startContainer.nodeType === Node.TEXT_NODE && startOffset === 0) {
            const prevSibling = startContainer.previousSibling;
            if (
              prevSibling &&
              prevSibling.nodeType === Node.ELEMENT_NODE &&
              (prevSibling as HTMLElement).dataset.mention
            ) {
              event.preventDefault();
              prevSibling.remove();
              updateContentFromComposer();
              return;
            }
          }
        }
      }
    }

    if (showMentionSuggestions && mentionSuggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedMentionIndex = (selectedMentionIndex + 1) % mentionSuggestions.length;
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedMentionIndex =
          selectedMentionIndex === 0 ? mentionSuggestions.length - 1 : selectedMentionIndex - 1;
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

  // Parse nostr: mentions from content and return pubkeys
  function parseMentions(text: string): Map<string, string> {
    const mentions = new Map<string, string>();
    const mentionRegex =
      /nostr:(npub1[023456789acdefghjklmnpqrstuvwxyz]{58}|nprofile1[023456789acdefghjklmnpqrstuvwxyz]+)|@npub1[023456789acdefghjklmnpqrstuvwxyz]{58}/g;
    let match: RegExpExecArray | null;

    while ((match = mentionRegex.exec(text)) !== null) {
      const mention = match[1] || match[0].slice(1);
      try {
        const decoded = nip19.decode(mention);
        if (decoded.type === 'npub') {
          mentions.set(mention, decoded.data);
        } else if (decoded.type === 'nprofile') {
          mentions.set(mention, decoded.data.pubkey);
        }
      } catch {}
    }

    return mentions;
  }

  $: if (composerEl && content !== lastRenderedContent) {
    syncComposerContent(content);
  }
</script>

<svelte:head>
  <title>Community - zap.cooking</title>
  <meta
    name="description"
    content="Community - Share and discover delicious food content from the Nostr network"
  />
</svelte:head>

<PullToRefresh bind:this={pullToRefreshEl} on:refresh={handleRefresh}>
  <div class="container mx-auto px-4 max-w-2xl community-page">
    <!-- Orientation text for signed-out users -->
    {#if $userPublickey === ''}
      <div class="mb-4 pt-1">
        <p class="text-sm text-caption">Food. Friends. Freedom.</p>
        <p class="text-xs text-caption mt-0.5">
          People share meals, recipes, and food ideas here. <a
            href="/login"
            class="text-caption hover:opacity-80 underline">Sign in</a
          > to share your own and follow cooks you like.
        </p>
      </div>
    {/if}

    <!-- Inline Post Composer for logged-in users -->
    {#if $userPublickey !== ''}
      <div
        class="mb-4 bg-input rounded-xl transition-all"
        class:overflow-hidden={!isComposerOpen}
        class:overflow-visible={isComposerOpen}
        style="border: 1px solid var(--color-input-border)"
      >
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
                  <div
                    bind:this={composerEl}
                    class="composer-input w-full min-h-[80px] p-2 border-0 focus:outline-none focus:ring-0 bg-transparent"
                    style="color: var(--color-text-primary); font-size: 16px;"
                    contenteditable={!posting}
                    role="textbox"
                    aria-multiline="true"
                    data-placeholder="What are you eating, cooking, or loving?"
                    on:keydown={handleKeydown}
                    on:input={handleContentInput}
                    on:beforeinput={handleBeforeInput}
                    on:paste={handlePaste}
                  ></div>

                  <!-- Mention suggestions dropdown -->
                  {#if showMentionSuggestions}
                    <div class="mention-dropdown" style="border-color: var(--color-input-border);">
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

                {#if error}
                  <p class="text-red-500 text-xs mb-2">{error}</p>
                {/if}

                {#if success}
                  <p class="text-green-600 text-xs mb-2">Posted!</p>
                {/if}

                <!-- Quoted note preview -->
                {#if quotedNote}
                  <div
                    class="mb-3 rounded-xl overflow-hidden bg-input"
                    style="border: 1px solid var(--color-input-border)"
                  >
                    <!-- Header with remove button -->
                    <div
                      class="flex items-center justify-between px-3 py-2 bg-accent-gray"
                      style="border-bottom: 1px solid var(--color-input-border)"
                    >
                      <span class="text-xs font-medium text-caption">Quoting post</span>
                      <button
                        type="button"
                        on:click={() => (quotedNote = null)}
                        class="text-caption hover:opacity-80 p-1 hover:bg-input rounded transition-colors"
                        aria-label="Remove quote"
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </div>

                    <!-- Quoted note content -->
                    <div class="p-3">
                      <!-- Author info -->
                      <div class="flex items-center gap-2 mb-2">
                        <CustomAvatar pubkey={quotedNote.event.pubkey} size={24} />
                        <ProfileLink
                          nostrString={'nostr:' + nip19.npubEncode(quotedNote.event.pubkey)}
                        />
                      </div>

                      <!-- Note content with proper rendering -->
                      <div
                        class="text-sm max-h-32 overflow-hidden"
                        style="color: var(--color-text-primary)"
                      >
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
                          <svg
                            class="w-3 h-3"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </div>
                    {/each}
                  </div>
                {/if}

                <!-- Video previews -->
                {#if uploadedVideos.length > 0}
                  <div class="mb-2 flex flex-wrap gap-2">
                    {#each uploadedVideos as videoUrl, index}
                      <div class="relative group">
                        <video
                          src={videoUrl}
                          class="w-32 h-20 object-cover rounded-lg"
                          style="border: 1px solid var(--color-input-border)"
                          preload="metadata"
                          muted
                        />
                        <button
                          type="button"
                          on:click={() => removeVideo(index)}
                          class="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 shadow-lg transition-all opacity-90 hover:opacity-100"
                          disabled={posting}
                          aria-label="Remove video"
                        >
                          <svg
                            class="w-3 h-3"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </div>
                    {/each}
                  </div>
                {/if}

                <!-- Relay indicator for members/garden tabs -->
                {#if activeTab === 'members'}
                  <div
                    class="mb-2 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800"
                  >
                    <p class="text-xs font-medium text-blue-700 dark:text-blue-300">
                      📡 Posting to: <span class="font-semibold">members.zap.cooking</span>
                    </p>
                  </div>
                {:else if activeTab === 'garden'}
                  <div
                    class="mb-2 px-3 py-1.5 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
                  >
                    <p class="text-xs font-medium text-green-700 dark:text-green-300">
                      🌱 Posting to: <span class="font-semibold">garden.zap.cooking</span>
                    </p>
                  </div>
                {/if}

                <div
                  class="flex items-center justify-between pt-2 border-t"
                  style="border-color: var(--color-input-border)"
                >
                  <div class="flex items-center gap-3">
                    <!-- Image upload button -->
                    <label
                      class="cursor-pointer p-1.5 rounded-full hover:bg-accent-gray transition-colors"
                      class:opacity-50={posting || uploadingImage || uploadingVideo}
                      class:cursor-not-allowed={posting || uploadingImage || uploadingVideo}
                      aria-disabled={posting || uploadingImage}
                      title="Upload image"
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

                    <!-- Video upload button -->
                    <label
                      class="cursor-pointer p-1.5 rounded-full hover:bg-accent-gray transition-colors"
                      class:opacity-50={posting || uploadingVideo}
                      class:cursor-not-allowed={posting || uploadingVideo}
                      aria-disabled={posting || uploadingVideo}
                      title="Upload video"
                    >
                      <VideoIcon size={18} class="text-caption" />
                      <input
                        bind:this={videoInputEl}
                        type="file"
                        accept="video/*"
                        class="sr-only"
                        on:change={handleVideoUpload}
                        disabled={posting || uploadingVideo}
                      />
                    </label>

                    {#if uploadingImage}
                      <span class="text-xs text-caption">Uploading image...</span>
                    {:else if uploadingVideo}
                      <span class="text-xs text-caption">Uploading video...</span>
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
                      disabled={posting ||
                        uploadingImage ||
                        uploadingVideo ||
                        (!content.trim() &&
                          uploadedImages.length === 0 &&
                          uploadedVideos.length === 0 &&
                          !quotedNote)}
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

    <!-- Filter Tabs -->
    <div class="mb-4 border-b" style="border-color: var(--color-input-border)">
      <div class="flex gap-1">
        <button
          on:click={() => setTab('global')}
          class="px-4 py-2 text-sm font-medium transition-colors relative"
          style="color: {activeTab === 'global'
            ? 'var(--color-text-primary)'
            : 'var(--color-text-secondary)'}"
        >
          Global Food
          {#if activeTab === 'global'}
            <span
              class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
            ></span>
          {/if}
        </button>

        <button
          on:click={() => setTab('following')}
          class="px-4 py-2 text-sm font-medium transition-colors relative"
          style="color: {activeTab === 'following'
            ? 'var(--color-text-primary)'
            : 'var(--color-text-secondary)'}"
          disabled={!$userPublickey}
          class:opacity-50={!$userPublickey}
          class:cursor-not-allowed={!$userPublickey}
          class:cursor-pointer={$userPublickey}
        >
          Following
          {#if activeTab === 'following'}
            <span
              class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
            ></span>
          {/if}
        </button>

        <button
          on:click={() => setTab('replies')}
          class="px-4 py-2 text-sm font-medium transition-colors relative"
          style="color: {activeTab === 'replies'
            ? 'var(--color-text-primary)'
            : 'var(--color-text-secondary)'}"
        >
          Notes & Replies
          {#if activeTab === 'replies'}
            <span
              class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
            ></span>
          {/if}
        </button>

        <!-- Members tab hidden for now - keeping functionality intact -->
        <!-- {#if hasActiveMembership}
        <button
          on:click={() => setTab('members')}
          class="px-4 py-2 text-sm font-medium transition-colors relative"
          style="color: {activeTab === 'members' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'}"
        >
          Members
          {#if activeTab === 'members'}
            <span class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"></span>
          {/if}
        </button>
      {/if} -->

        <button
          on:click={() => setTab('garden')}
          class="px-4 py-2 text-sm font-medium transition-colors relative"
          style="color: {activeTab === 'garden'
            ? 'var(--color-text-primary)'
            : 'var(--color-text-secondary)'}"
        >
          The Garden
          {#if activeTab === 'garden'}
            <span
              class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
            ></span>
          {/if}
        </button>
      </div>
    </div>

    <!-- Show login prompt for Following/Replies tabs if not logged in -->
    {#if (activeTab === 'following' || activeTab === 'replies') && !$userPublickey}
      <div
        class="mb-4 p-4 bg-accent-gray rounded-lg"
        style="border: 1px solid var(--color-input-border)"
      >
        <p class="text-sm" style="color: var(--color-text-primary)">
          <a href="/login" class="font-medium underline hover:opacity-80">Log in</a> to see {activeTab ===
          'following'
            ? 'posts from people you follow'
            : 'replies from people you follow'}.
        </p>
      </div>
    {/if}

    <!-- Members tab and membership prompt hidden for now -->
    <!-- Show membership prompt for Members tab if not a member -->
    <!-- {#if activeTab === 'members' && $userPublickey && !hasActiveMembership && !checkingMembership}
    <div class="mb-4 p-4 bg-accent-gray rounded-lg" style="border: 1px solid var(--color-input-border)">
      <p class="text-sm" style="color: var(--color-text-primary)">
        <a href="/membership" class="font-medium underline hover:opacity-80">Become a member</a> to access exclusive content from the private member community.
      </p>
    </div>
  {/if} -->

    {#key feedKey}
      <FoodstrFeedOptimized bind:this={feedComponent} filterMode={activeTab} />
    {/key}
  </div>
</PullToRefresh>

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

  /* Mention dropdown - compact and scrollable */
  .mention-dropdown {
    position: absolute;
    z-index: 50;
    top: 100%;
    left: 0;
    margin-top: 0.25rem;
    width: 280px;
    max-width: calc(100vw - 2rem);
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
    border-radius: 0.5rem;
    box-shadow:
      0 4px 6px -1px rgb(0 0 0 / 0.1),
      0 2px 4px -1px rgb(0 0 0 / 0.06);
    overflow: hidden;
  }

  .mention-dropdown-content {
    max-height: 200px;
    overflow-y: auto;
    overflow-x: hidden;
  }

  /* Custom scrollbar for mention dropdown */
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

  .composer-input {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .composer-input[contenteditable='true']:empty:before {
    content: attr(data-placeholder);
    color: var(--color-caption);
    pointer-events: none;
  }

  .mention-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.1rem 0.45rem;
    border-radius: 0.5rem;
    background: rgba(236, 71, 0, 0.15);
    color: var(--color-primary);
    font-weight: 600;
    user-select: all;
    margin: 0 0.1rem;
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
