<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { ndk, userPublickey, normalizeRelayUrl } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import ImageIcon from 'phosphor-svelte/lib/Image';
  import VideoIcon from 'phosphor-svelte/lib/Video';
  import CustomAvatar from './CustomAvatar.svelte';
  import ProfileLink from './ProfileLink.svelte';
  import { nip19 } from 'nostr-tools';
  import NoteContent from './NoteContent.svelte';
  import { addClientTagToEvent } from '$lib/nip89';
  import type { NDKEvent as NDKEventType } from '@nostr-dev-kit/ndk';
  import { get } from 'svelte/store';
  import { searchProfiles } from '$lib/profileSearchService';
  import { clearQuotedNote } from '$lib/postComposerStore';
  import { publishQueue, publishQueueState } from '$lib/publishQueue';

  // Clear stuck posts from the publish queue
  async function clearPendingQueue() {
    try {
      await publishQueue.clearQueue();
      console.log('[PostComposer] Cleared publish queue');
    } catch (err) {
      console.error('[PostComposer] Failed to clear queue:', err);
    }
  }

  type FilterMode = 'global' | 'following' | 'replies' | 'members' | 'garden';
  type RelaySelection = 'all' | 'garden' | 'pantry' | 'garden-pantry';

  export let activeTab: FilterMode = 'global';
  export let variant: 'inline' | 'modal' = 'inline';
  export let selectedRelay: RelaySelection | undefined = undefined;
  export let initialQuotedNote: { nevent: string; event: NDKEventType } | null = null;

  const dispatch = createEventDispatcher<{ close: void }>();

  let isComposerOpen = variant === 'modal';
  let content = '';
  let posting = false;
  let success = false;
  let successQueued = false; // True when post was queued for retry
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

  $: if (variant === 'modal') {
    isComposerOpen = true;
  }

  function focusComposer() {
    setTimeout(() => {
      if (composerEl) {
        syncComposerContent(content);
        composerEl.focus();
      }
    }, 50);
  }

  // Listen for quote-note events from NoteRepost component
  function handleQuoteNote(e: CustomEvent) {
    quotedNote = e.detail;
    if (variant === 'inline') {
      openComposer();
    }
  }

  onMount(() => {
    if (variant === 'inline') {
      window.addEventListener('quote-note', handleQuoteNote as EventListener);
    }

    // Preload mention profiles in background
    if ($userPublickey) {
      loadMentionFollowList();
    }

    if (variant === 'modal') {
      // Set initial quoted note if provided (from store via PostModal)
      if (initialQuotedNote) {
        quotedNote = initialQuotedNote;
      }
      focusComposer();
    }
  });

  onDestroy(() => {
    if (variant === 'inline') {
      window.removeEventListener('quote-note', handleQuoteNote as EventListener);
    }
    if (mentionSearchTimeout) {
      clearTimeout(mentionSearchTimeout);
    }
  });

  function openComposer() {
    isComposerOpen = true;
    focusComposer();
  }

  function resetComposerState() {
    content = '';
    lastRenderedContent = '';
    error = '';
    successQueued = false;
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

  function closeComposer() {
    if (posting) return;

    resetComposerState();

    if (variant === 'modal') {
      // Clear the quoted note store when closing modal
      clearQuotedNote();
      dispatch('close');
      return;
    }

    isComposerOpen = false;
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
      console.error('Upload error:', err);
      error = err?.message || 'Upload failed. Please try again.';
      throw err;
    }
  }

  async function handleImageUpload(e: Event) {
    const target = e.target as HTMLInputElement;
    const files = target.files;
    if (!files || files.length === 0) return;

    uploadingImage = true;
    error = '';

    try {
      for (const file of Array.from(files)) {
        if (file.size > 5 * 1024 * 1024) {
          error = 'Image must be less than 5MB';
          continue;
        }

        const body = new FormData();
        body.append('file[]', file);

        const result = await uploadToNostrBuild(body);

        if (result && result.data && result.data[0]?.url) {
          uploadedImages = [...uploadedImages, result.data[0].url];
        } else {
          const errorMsg = result?.message || result?.error || 'Unknown error';
          console.error('Upload failed - response:', result);
          error = `Failed to upload image${errorMsg !== 'Unknown error' ? `: ${errorMsg}` : ''}`;
        }
      }
    } catch (err: any) {
      console.error('Error uploading image:', err);
      const errorMsg =
        err?.message || err?.response?.message || err?.response?.error || 'Unknown error';
      error = `Failed to upload image${errorMsg !== 'Unknown error' ? `: ${errorMsg}` : '. Please try again.'}`;
    } finally {
      uploadingImage = false;
      if (imageInputEl) {
        imageInputEl.value = '';
      }
    }
  }

  async function handleVideoUpload(e: Event) {
    const target = e.target as HTMLInputElement;
    const files = target.files;
    if (!files || files.length === 0) return;

    uploadingVideo = true;
    error = '';

    try {
      for (const file of Array.from(files)) {
        if (file.size > 50 * 1024 * 1024) {
          error = 'Video must be less than 50MB';
          continue;
        }

        // Validate video duration
        let videoDuration = 0;
        try {
          const video = document.createElement('video');
          video.preload = 'metadata';

          await new Promise<void>((resolve, reject) => {
            video.onloadedmetadata = () => {
              videoDuration = video.duration;
              resolve();
            };
            video.onerror = () => reject(new Error('Failed to load video metadata'));
            video.src = URL.createObjectURL(file);
          });

          if (videoDuration > 0 && videoDuration > 60) {
            error = 'Video must be less than 60 seconds';
            continue;
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
          const errorMsg = result?.message || result?.error || 'Unknown error';
          console.error('Upload failed - response:', result);
          error = `Failed to upload video${errorMsg !== 'Unknown error' ? `: ${errorMsg}` : ''}`;
        }
      }
    } catch (err: any) {
      console.error('Error uploading video:', err);
      const errorMsg =
        err?.message || err?.response?.message || err?.response?.error || 'Unknown error';
      error = `Failed to upload video${errorMsg !== 'Unknown error' ? `: ${errorMsg}` : '. Please try again.'}`;
    } finally {
      uploadingVideo = false;
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
    console.log('[PostComposer] postToFeed called');
    console.log('[PostComposer] content:', content);
    console.log('[PostComposer] quotedNote:', quotedNote);
    console.log('[PostComposer] uploadedImages:', uploadedImages);
    console.log('[PostComposer] uploadedVideos:', uploadedVideos);

    if (
      !content.trim() &&
      !quotedNote &&
      uploadedImages.length === 0 &&
      uploadedVideos.length === 0
    ) {
      console.log('[PostComposer] No content to post');
      error = 'Please enter some content';
      return;
    }

    if (!$userPublickey) {
      console.log('[PostComposer] No user public key');
      error = 'Please sign in to post';
      return;
    }

    console.log('[PostComposer] Starting post process...');
    posting = true;
    error = '';

    try {
      if (composerEl) {
        content = htmlToPlainText(composerEl);
        lastRenderedContent = content;
        console.log('[PostComposer] Extracted content from composer:', content);
      }

      // Ensure NIP-46 signer is ready if using remote signer
      console.log('[PostComposer] Checking auth manager...');
      const { getAuthManager } = await import('$lib/authManager');
      const authManager = getAuthManager();
      if (authManager) {
        console.log('[PostComposer] Ensuring NIP-46 signer ready...');
        await authManager.ensureNip46SignerReady();
        console.log('[PostComposer] Signer ready');
      }

      console.log('[PostComposer] Creating NDKEvent...');
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
        const mediaUrlsText = mediaUrls.join('\n');
        postContent = postContent ? `${postContent}\n\n${mediaUrlsText}` : mediaUrlsText;
      }

      if (quotedNote) {
        postContent = postContent
          ? `${postContent}\n\nnostr:${quotedNote.nevent}`
          : `nostr:${quotedNote.nevent}`;
      }

      postContent = replacePlainMentions(postContent);
      const mentions = parseMentions(postContent);

      event.content = postContent;
      event.tags = [['t', 'zapcooking']];

      for (const pubkey of mentions.values()) {
        if (!event.tags.some((t) => t[0] === 'p' && t[1] === pubkey)) {
          event.tags.push(['p', pubkey]);
        }
      }

      if (quotedNote) {
        const quotedPubkey = quotedNote.event.pubkey;
        event.tags.push(['q', quotedNote.event.id]);
        if (!event.tags.some((t) => t[0] === 'p' && t[1] === quotedPubkey)) {
          event.tags.push(['p', quotedPubkey]);
        }
      }

      addClientTagToEvent(event);

      // Determine which relays to publish to
      // Priority: explicit selectedRelay prop (from modal) > activeTab (from feed context)
      const relayMode =
        selectedRelay ||
        (activeTab === 'garden' ? 'garden' : activeTab === 'members' ? 'pantry' : 'all');

      console.log(`[PostComposer] Publishing with relay mode: ${relayMode}`);
      console.log('[PostComposer] Event content:', event.content);
      console.log('[PostComposer] Event tags:', event.tags);

      // Use the resilient publish queue with automatic retry
      console.log('[PostComposer] Calling publishQueue.publishWithRetry...');
      const result = await publishQueue.publishWithRetry(event, relayMode);
      console.log('[PostComposer] Publish result:', result);

      if (result.success) {
        // Published successfully on first attempt
        success = true;
        successQueued = false;
        resetComposerState();

        const closeDelay = variant === 'modal' ? 1500 : 2500;
        setTimeout(() => {
          success = false;
          if (variant === 'modal') {
            dispatch('close');
          } else {
            isComposerOpen = false;
          }
        }, closeDelay);
      } else if (result.queued) {
        // Failed initial publish, but queued for background retry
        // Show optimistic success - the post will be published when connection improves
        success = true;
        successQueued = true;
        resetComposerState();

        // Log for debugging
        console.log('[PostComposer] Post queued for background retry:', result.error);

        const closeDelay = variant === 'modal' ? 2000 : 3000; // Slightly longer to read the message
        setTimeout(() => {
          success = false;
          successQueued = false;
          if (variant === 'modal') {
            dispatch('close');
          } else {
            isComposerOpen = false;
          }
        }, closeDelay);
      } else {
        error = result.error || 'Failed to publish';
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

    for (const profile of mentionProfileCache.values()) {
      const nameMatch = profile.name.toLowerCase().includes(queryLower);
      const nip05Match = profile.nip05?.toLowerCase().includes(queryLower);

      if (nameMatch || nip05Match) {
        matches.push(profile);
        seenPubkeys.add(profile.pubkey);
      }
    }

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

  function parseMentions(text: string): Map<string, string> {
    const mentions = new Map<string, string>();
    const mentionRegex =
      /nostr:(npub1[023456789acdefghjklmnpqrstuvwxyz]{58}|nprofile1[023456789acdefghjklmnpqrstuvwxyz]+)|@npub1[023456789acdefghjklmnpqrstuvwxyz]{58}/g;
    let match;

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
  }

  $: if (composerEl && content !== lastRenderedContent) {
    syncComposerContent(content);
  }
</script>

{#if $userPublickey !== '' || variant === 'modal'}
  <div
    class={`bg-input rounded-xl transition-all ${variant === 'inline' ? 'mb-4' : 'flex-1 flex flex-col'}`}
    class:overflow-hidden={!isComposerOpen}
    class:overflow-visible={isComposerOpen}
    style="border: 1px solid var(--color-input-border)"
  >
    {#if variant === 'inline' && !isComposerOpen}
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
    {:else if $userPublickey === ''}
      <div class="p-4">
        <p class="text-sm text-caption">Sign in to post.</p>
        <a href="/login" class="text-sm underline hover:opacity-80">Sign in</a>
      </div>
    {:else}
      <div class={`p-3 ${variant === 'modal' ? 'flex-1 flex flex-col' : ''}`}>
        <div class={`flex gap-3 ${variant === 'modal' ? 'flex-1' : ''}`}>
          <CustomAvatar pubkey={$userPublickey} size={36} />
          <div class={`flex-1 ${variant === 'modal' ? 'flex flex-col' : ''}`}>
            <div class={`relative ${variant === 'modal' ? 'flex-1' : ''}`}>
              <div
                bind:this={composerEl}
                class={`composer-input w-full min-h-[120px] sm:min-h-[100px] overflow-y-auto p-2 border-0 focus:outline-none focus:ring-0 bg-transparent ${variant === 'modal' ? 'flex-1' : 'max-h-[50vh]'}`}
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
              {#if successQueued}
                <p class="text-amber-600 text-xs mb-2">
                  Post queued — will publish when connection improves
                </p>
              {:else}
                <p class="text-green-600 text-xs mb-2">Posted!</p>
              {/if}
            {/if}

            {#if quotedNote}
              <div class="quoted-note-embed mb-3">
                <div class="quoted-note-header">
                  <CustomAvatar pubkey={quotedNote.event.pubkey} size={16} />
                  <span class="quoted-note-author">
                    <ProfileLink
                      nostrString={'nostr:' + nip19.npubEncode(quotedNote.event.pubkey)}
                    />
                  </span>
                  <button
                    type="button"
                    on:click={() => (quotedNote = null)}
                    class="ml-auto text-caption hover:opacity-80 p-0.5 hover:bg-input rounded transition-colors"
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

                <div class="quoted-note-content">
                  <NoteContent content={quotedNote.event.content || ''} />
                </div>
              </div>
            {/if}

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
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

            {#if activeTab === 'members' || selectedRelay === 'pantry'}
              <div
                class="mb-2 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800"
              >
                <p class="text-xs font-medium text-blue-700 dark:text-blue-300">
                  🏪 The Pantry — If you're seeing this, you're early.
                </p>
              </div>
            {:else if activeTab === 'garden' || selectedRelay === 'garden'}
              <div
                class="mb-2 px-3 py-1.5 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
              >
                <p class="text-xs font-medium text-green-700 dark:text-green-300">
                  🌱 Posting to: <span class="font-semibold">garden.zap.cooking</span>
                </p>
              </div>
            {:else if selectedRelay === 'garden-pantry'}
              <div
                class="mb-2 px-3 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800"
              >
                <p class="text-xs font-medium text-purple-700 dark:text-purple-300">
                  🌱🏪 Posting to Garden + Pantry
                </p>
              </div>
            {:else if selectedRelay === 'all'}
              <div
                class="mb-2 px-3 py-1.5 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800"
              >
                <p class="text-xs font-medium text-orange-700 dark:text-orange-300">
                  📡 Posting to: <span class="font-semibold">All connected relays</span>
                </p>
              </div>
            {/if}

            <div
              class="flex items-center justify-between pt-2 border-t"
              style="border-color: var(--color-input-border)"
            >
              <div class="flex items-center gap-3">
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
                {#if $publishQueueState.pending > 0}
                  <span
                    class="text-xs text-amber-600 flex items-center gap-1"
                    title="Posts queued for retry"
                  >
                    <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle
                        class="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        stroke-width="4"
                      ></circle>
                      <path
                        class="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    {$publishQueueState.pending} pending
                  </span>
                  <button
                    on:click={clearPendingQueue}
                    class="text-xs text-red-500 hover:text-red-600 underline"
                    title="Clear stuck posts from queue"
                  >
                    clear
                  </button>
                {/if}
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

<style>
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

  /* Custom scrollbar for composer */
  .composer-input::-webkit-scrollbar {
    width: 6px;
  }

  .composer-input::-webkit-scrollbar-track {
    background: transparent;
  }

  .composer-input::-webkit-scrollbar-thumb {
    background: var(--color-input-border);
    border-radius: 3px;
  }

  .composer-input::-webkit-scrollbar-thumb:hover {
    background: var(--color-caption);
  }

  .composer-input[contenteditable='true']:empty:before {
    content: attr(data-placeholder);
    color: var(--color-caption);
    pointer-events: none;
  }

  :global(.mention-pill) {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.1rem 0.45rem;
    border-radius: 0.5rem;
    background: rgba(247, 147, 26, 0.2);
    color: #f7931a;
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

  /* Quoted note embed - orange bracket style matching feed */
  .quoted-note-embed {
    padding: 0.5rem 0.75rem;
    background: var(--color-bg-secondary);
    border-left: 3px solid var(--color-primary, #f97316);
    border-radius: 0.375rem;
    overflow: hidden;
    max-width: 100%;
  }

  .quoted-note-header {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-bottom: 0.25rem;
  }

  .quoted-note-author {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text-secondary);
  }

  .quoted-note-author :global(a) {
    color: var(--color-text-secondary);
    text-decoration: none;
  }

  .quoted-note-author :global(a:hover) {
    text-decoration: underline;
  }

  .quoted-note-content {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    line-height: 1.4;
    overflow-wrap: anywhere;
    word-break: break-word;
    display: -webkit-box;
    -webkit-line-clamp: 5;
    line-clamp: 5;
    -webkit-box-orient: vertical;
    overflow: hidden;
    max-height: 7em;
  }

  .quoted-note-content :global(p) {
    margin: 0;
  }

  .quoted-note-content :global(a) {
    color: var(--color-primary, #f97316);
  }

  /* Hide images and videos in quoted note preview - they cause overflow */
  .quoted-note-content :global(img),
  .quoted-note-content :global(video),
  .quoted-note-content :global(.video-preview),
  .quoted-note-content :global(.my-1.relative),
  .quoted-note-content :global(div[style*='aspect-ratio']) {
    display: none !important;
  }

  /* Ensure all text breaks properly */
  .quoted-note-content :global(*) {
    overflow-wrap: anywhere;
    word-break: break-word;
  }
</style>
