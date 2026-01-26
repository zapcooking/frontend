<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { nip19 } from 'nostr-tools';
  import { ndk, userPublickey } from '$lib/nostr';
  import { mutedPubkeys } from '$lib/muteListStore';
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
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
  import { addClientTagToEvent } from '$lib/nip89';
  import { buildNip22CommentTags } from '$lib/tagUtils';
  import ClientAttribution from '../../components/ClientAttribution.svelte';
  import ThreadCommentActions from '../../components/ThreadCommentActions.svelte';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import type { PageData } from './$types';
  import { createCommentFilter } from '$lib/commentFilters';
  import PostActionsMenu from '../../components/PostActionsMenu.svelte';
  import { searchProfiles } from '$lib/profileSearchService';

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

  // Reply composer with mentions
  let replyComposerEl: HTMLDivElement;
  let lastRenderedReply = '';

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

        const parentNote = await $ndk.fetchEvent({ kinds: [1, 1111], ids: [parentId] });
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

    if (!event) return;

    const filter = createCommentFilter(event);
    const sub = $ndk.subscribe(filter, { closeOnEose: false });

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

    if (nip19Id.startsWith('nostr:')) {
      nip19Id = nip19Id.split('nostr:')[1];
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
          case 'nevent':
            eventId = (decoded as nip19.DecodedNevent).data.id;
            break;
          case 'note':
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
      })();
    }
  }

  function formatTimeAgo(timestamp: number): string {
    return formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true });
  }

  function openZapModal() {
    zapModal = true;
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

          for (const evt of events) {
            try {
              const profile = JSON.parse(evt.content);
              const name = profile.display_name || profile.name || '';
              if (name || profile.nip05) {
                mentionProfileCache.set(evt.pubkey, {
                  name: name || profile.nip05?.split('@')[0] || 'Unknown',
                  npub: nip19.npubEncode(evt.pubkey),
                  picture: profile.picture,
                  pubkey: evt.pubkey,
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

          for (const evt of searchResults) {
            if (seenPubkeys.has(evt.pubkey)) continue;

            try {
              const profile = JSON.parse(evt.content);
              const name = profile.display_name || profile.name || '';
              const nip05val = profile.nip05;

              const profileData = {
                name: name || nip05val?.split('@')[0] || profile.name || 'Unknown',
                npub: nip19.npubEncode(evt.pubkey),
                picture: profile.picture,
                pubkey: evt.pubkey,
                nip05: nip05val
              };
              matches.push(profileData);
              seenPubkeys.add(evt.pubkey);
              mentionProfileCache.set(evt.pubkey, profileData);
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

  function syncComposerContent(value: string) {
    if (!replyComposerEl) return;
    const html = renderTextWithMentions(value);
    if (replyComposerEl.innerHTML !== html) {
      replyComposerEl.innerHTML = html;
    }
    lastRenderedReply = value;
  }

  function updateContentFromComposer() {
    if (!replyComposerEl) return;
    const newText = htmlToPlainText(replyComposerEl);
    lastRenderedReply = newText;
    commentText = newText;
  }

  function handleBeforeInput(evt: InputEvent) {
    if (evt.isComposing || evt.inputType === 'historyUndo' || evt.inputType === 'historyRedo') {
      return;
    }

    const selection = window.getSelection();
    if (!selection || !replyComposerEl) return;
    const range = selection.getRangeAt(0);
    let node: Node | null = range.startContainer;

    while (node && node !== replyComposerEl) {
      if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.mention) {
        evt.preventDefault();

        if (evt.inputType === 'insertText' || evt.inputType === 'insertCompositionText') {
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

  function handlePaste(evt: ClipboardEvent) {
    evt.preventDefault();
    const plainText = evt.clipboardData?.getData('text/plain');
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

    handleReplyInput();
  }

  function handleReplyInput() {
    updateContentFromComposer();
    if (!replyComposerEl) return;

    const converted = convertRawMentionsToPills();
    if (converted) {
      updateContentFromComposer();
    }

    const textBeforeCursor = getTextBeforeCursor(replyComposerEl);
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
    if (!replyComposerEl) return;

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
    if (!replyComposerEl) return false;

    const rawText = replyComposerEl.textContent || '';
    if (!rawText.includes('npub1')) return false;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;

    const range = selection.getRangeAt(0);
    const marker = document.createElement('span');
    marker.dataset.mentionCaret = 'true';
    marker.textContent = '\u200B';
    range.insertNode(marker);

    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(replyComposerEl, NodeFilter.SHOW_TEXT, {
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

    const caretMarker = replyComposerEl.querySelector('[data-mention-caret]');
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
    if (!replyComposerEl) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const textBeforeCursor = getTextBeforeCursor(replyComposerEl);
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
    let match: RegExpExecArray | null;

    while ((match = mentionRegex.exec(text)) !== null) {
      const mentionVal = match[1] || match[0].slice(1);
      try {
        const decodedMention = nip19.decode(mentionVal);
        if (decodedMention.type === 'npub') {
          mentions.set(mentionVal, decodedMention.data);
        } else if (decodedMention.type === 'nprofile') {
          mentions.set(mentionVal, decodedMention.data.pubkey);
        }
      } catch {}
    }

    return mentions;
  }

  function handleReplyKeydown(evt: KeyboardEvent) {
    const selection = window.getSelection();
    if (selection && selection.rangeCount) {
      const range = selection.getRangeAt(0);

      if (evt.key === 'Delete' && range.collapsed) {
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
              evt.preventDefault();
              nextSibling.remove();
              updateContentFromComposer();
              return;
            }
          }
        }
      }

      if (evt.key === 'Backspace') {
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
            evt.preventDefault();
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
              evt.preventDefault();
              prevSibling.remove();
              updateContentFromComposer();
              return;
            }
          }
        }
      }
    }

    if (showMentionSuggestions && mentionSuggestions.length > 0) {
      if (evt.key === 'ArrowDown') {
        evt.preventDefault();
        selectedMentionIndex = (selectedMentionIndex + 1) % mentionSuggestions.length;
      } else if (evt.key === 'ArrowUp') {
        evt.preventDefault();
        selectedMentionIndex =
          selectedMentionIndex === 0 ? mentionSuggestions.length - 1 : selectedMentionIndex - 1;
      } else if (evt.key === 'Enter' || evt.key === 'Tab') {
        evt.preventDefault();
        insertMention(mentionSuggestions[selectedMentionIndex]);
      } else if (evt.key === 'Escape') {
        showMentionSuggestions = false;
        mentionSuggestions = [];
      }
      return;
    }
  }

  onDestroy(() => {
    if (mentionSearchTimeout) {
      clearTimeout(mentionSearchTimeout);
    }
  });

  // Sync composer content when commentText changes externally
  $: if (replyComposerEl && commentText !== lastRenderedReply) {
    syncComposerContent(commentText);
  }

  // Post a reply
  async function postReply() {
    if (!commentText.trim() || !event) return;

    try {
      if (replyComposerEl) {
        commentText = htmlToPlainText(replyComposerEl);
        lastRenderedReply = commentText;
      }

      const ev = new (await import('@nostr-dev-kit/ndk')).NDKEvent($ndk);

      // Check if replying to a recipe (kind 30023)
      // Recipe replies should be kind 1111, not kind 1
      const isRecipe = event.kind === 30023;
      ev.kind = isRecipe ? 1111 : 1;

      const replyContent = replacePlainMentions(commentText);
      ev.content = replyContent;

      // Use shared utility to build NIP-22 or NIP-10 tags
      ev.tags = buildNip22CommentTags({
        kind: event.kind,
        pubkey: event.pubkey,
        id: event.id,
        tags: event.tags
      });

      // Parse and add @ mention tags (p tags)
      const mentions = parseMentions(replyContent);
      for (const pubkey of mentions.values()) {
        if (!ev.tags.some((t) => t[0] === 'p' && t[1] === pubkey)) {
          ev.tags.push(['p', pubkey]);
        }
      }

      // Add NIP-89 client tag
      addClientTagToEvent(ev);

      await ev.publish();
      commentText = '';
      lastRenderedReply = '';
      if (replyComposerEl) {
        replyComposerEl.innerHTML = '';
      }
      showMentionSuggestions = false;
      mentionSuggestions = [];
      mentionQuery = '';
    } catch {
      // Failed to post reply
    }
  }

  // Filter to get only direct replies (not nested)
  $: directReplies = replies.filter((r) => {
    if (!event) return false;

    // For NIP-22 comments (kind 1111)
    if (r.kind === 1111) {
      const aTags = r.getMatchingTags('a');
      const eTags = r.getMatchingTags('e');
      const kTags = r.getMatchingTags('k');

      // Check if this comment's 'a' tag matches the root article address
      const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
      if (dTag) {
        const rootAddress = `${event.kind}:${event.pubkey}:${dTag}`;
        const matchesRoot = aTags.some((tag) => tag[1] === rootAddress);

        // Check if parent 'e' tag points to root event (top-level comment)
        // and 'k' tag shows parent is the root kind (30023)
        const isTopLevel =
          eTags.some((tag) => tag[1] === event.id) &&
          kTags.some((tag) => tag[1] === String(event.kind));

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
  <title>Note Thread - zap.cooking</title>
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
          <div class="relative">
            <!-- Thread line connecting to next note -->
            <div
              class="absolute left-5 top-12 bottom-0 w-0.5"
              style="background-color: var(--color-input-border)"
            ></div>

            <article class="py-3">
              <div class="flex space-x-3 -mx-2 px-2 py-2 rounded-lg">
                <div class="flex-shrink-0 z-10">
                  <a
                    href="/user/{nip19.npubEncode(
                      parentNote.author?.hexpubkey || parentNote.pubkey
                    )}"
                  >
                    <CustomAvatar
                      pubkey={parentNote.author?.hexpubkey || parentNote.pubkey}
                      size={40}
                    />
                  </a>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between mb-1">
                    <div class="flex items-center space-x-2">
                      <a
                        href="/user/{nip19.npubEncode(
                          parentNote.author?.hexpubkey || parentNote.pubkey
                        )}"
                        class="font-semibold text-sm transition-colors username-link"
                        style="color: var(--color-text-primary)"
                      >
                        <CustomName pubkey={parentNote.author?.hexpubkey || parentNote.pubkey} />
                      </a>
                      <span class="text-sm" style="color: var(--color-caption)">·</span>
                      <span class="text-sm" style="color: var(--color-caption)">
                        {parentNote.created_at ? formatTimeAgo(parentNote.created_at) : ''}
                      </span>
                    </div>
                    <PostActionsMenu event={parentNote} />
                  </div>
                  <a
                    href="/{nip19.noteEncode(parentNote.id)}"
                    class="block text-sm leading-relaxed hover:opacity-80"
                    style="color: var(--color-text-secondary)"
                  >
                    <NoteContent content={parentNote.content} />
                  </a>
                  <!-- Parent note actions -->
                  <div class="mt-2">
                    <ThreadCommentActions event={parentNote} compact={true} />
                  </div>
                </div>
              </div>
            </article>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Main Note -->
    <article class="py-4 border-b" style="border-color: var(--color-input-border)">
      <div class="flex space-x-3">
        <a
          href="/user/{nip19.npubEncode(event.author?.hexpubkey || event.pubkey)}"
          class="flex-shrink-0"
        >
          <CustomAvatar
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
                  class="font-semibold text-sm transition-colors username-link"
                  style="color: var(--color-text-primary)"
                >
                  <CustomName pubkey={event.author?.hexpubkey || event.pubkey} />
                </a>
                <span class="text-sm" style="color: var(--color-caption)">·</span>
                <span class="text-sm" style="color: var(--color-caption)">
                  {event.created_at ? formatTimeAgo(event.created_at) : 'Unknown time'}
                </span>
                <ClientAttribution tags={event.tags} enableEnrichment={true} />
              </div>
              <div class="text-sm leading-relaxed mb-3" style="color: var(--color-text-primary)">
                <NoteContent content={event.content} />
              </div>
              <div
                class="flex items-center space-x-4 text-sm"
                style="color: var(--color-text-secondary)"
              >
                <NoteTotalLikes {event} />
                <NoteTotalComments {event} />
                <button
                  class="cursor-pointer hover:bg-accent-gray rounded px-1 py-0.5 transition duration-200"
                  on:click={openZapModal}
                >
                  <NoteTotalZaps {event} />
                </button>
              </div>
            </div>
            <PostActionsMenu {event} />
          </div>
        </div>
      </div>
    </article>

    <!-- Replies Section -->
    <div class="mt-4">
      <div
        class="flex items-center gap-2 text-sm font-medium mb-3"
        style="color: var(--color-text-secondary)"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
        <span>Replies ({directReplies.length})</span>
      </div>

      <!-- Reply Input -->
      {#if $userPublickey}
        <div class="mb-4 p-3 rounded-lg" style="background-color: var(--color-bg-secondary)">
          <div class="flex gap-3">
            <CustomAvatar pubkey={$userPublickey} size={32} />
            <div class="flex-1">
              <div class="relative">
                <div
                  bind:this={replyComposerEl}
                  class="reply-composer-input w-full px-3 py-2 text-sm rounded-lg"
                  style="background-color: var(--color-bg-primary); border: 1px solid var(--color-input-border); color: var(--color-text-primary); min-height: 60px;"
                  contenteditable="true"
                  role="textbox"
                  aria-multiline="true"
                  data-placeholder="Write a reply..."
                  on:input={handleReplyInput}
                  on:keydown={handleReplyKeydown}
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
              {#if commentText.trim()}
                <div class="flex justify-end mt-2">
                  <Button on:click={postReply} class="text-sm px-4 py-1.5">Reply</Button>
                </div>
              {/if}
            </div>
          </div>
        </div>
      {:else}
        <div
          class="mb-4 p-3 rounded-lg text-sm"
          style="background-color: var(--color-bg-secondary); color: var(--color-caption)"
        >
          <a href="/login" class="text-primary hover:underline font-medium">Log in</a> to reply
        </div>
      {/if}

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
          No replies yet. Be the first to reply!
        </p>
      {:else}
        <div class="space-y-0">
          {#each directReplies as reply}
            {#if !$mutedPubkeys.has(reply.author?.hexpubkey || reply.pubkey)}
              <div>
                <article
                  class="py-3 border-b last:border-0"
                  style="border-color: var(--color-input-border)"
                >
                  <div class="flex space-x-3">
                    <a
                      href="/user/{nip19.npubEncode(reply.author?.hexpubkey || reply.pubkey)}"
                      class="flex-shrink-0"
                    >
                      <CustomAvatar pubkey={reply.author?.hexpubkey || reply.pubkey} size={32} />
                    </a>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center justify-between mb-1">
                        <div class="flex items-center space-x-2">
                          <a
                            href="/user/{nip19.npubEncode(reply.author?.hexpubkey || reply.pubkey)}"
                            class="font-medium text-sm transition-colors username-link"
                            style="color: var(--color-text-primary)"
                          >
                            <CustomName pubkey={reply.author?.hexpubkey || reply.pubkey} />
                          </a>
                          <span class="text-xs" style="color: var(--color-caption)">·</span>
                          <span class="text-xs" style="color: var(--color-caption)">
                            {reply.created_at ? formatTimeAgo(reply.created_at) : ''}
                          </span>
                        </div>
                        <PostActionsMenu event={reply} />
                      </div>
                      <div
                        class="text-sm leading-relaxed"
                        style="color: var(--color-text-secondary)"
                      >
                        <NoteContent content={reply.content} />
                      </div>
                      <!-- Reply actions -->
                      <div class="mt-2">
                        <ThreadCommentActions event={reply} compact={false} />
                      </div>
                    </div>
                  </div>
                </article>

                <!-- Nested Replies (1 level deep shown inline) -->
                {#each getNestedReplies(reply.id).slice(0, 2) as nestedReply}
                  {#if !$mutedPubkeys.has(nestedReply.author?.hexpubkey || nestedReply.pubkey)}
                    <div class="ml-8 pl-3">
                      <article class="py-2">
                        <div class="flex space-x-2">
                          <a
                            href="/user/{nip19.npubEncode(
                              nestedReply.author?.hexpubkey || nestedReply.pubkey
                            )}"
                            class="flex-shrink-0"
                          >
                            <CustomAvatar
                              pubkey={nestedReply.author?.hexpubkey || nestedReply.pubkey}
                              size={24}
                            />
                          </a>
                          <div class="flex-1 min-w-0">
                            <div class="flex items-center justify-between mb-0.5">
                              <div class="flex items-center space-x-2">
                                <a
                                  href="/user/{nip19.npubEncode(
                                    nestedReply.author?.hexpubkey || nestedReply.pubkey
                                  )}"
                                  class="font-medium text-xs transition-colors username-link"
                                  style="color: var(--color-text-primary)"
                                >
                                  <CustomName
                                    pubkey={nestedReply.author?.hexpubkey || nestedReply.pubkey}
                                  />
                                </a>
                                <span class="text-xs" style="color: var(--color-caption)">·</span>
                                <span class="text-xs" style="color: var(--color-caption)">
                                  {nestedReply.created_at
                                    ? formatTimeAgo(nestedReply.created_at)
                                    : ''}
                                </span>
                              </div>
                              <PostActionsMenu event={nestedReply} />
                            </div>
                            <div
                              class="text-xs leading-relaxed"
                              style="color: var(--color-text-secondary)"
                            >
                              <NoteContent content={nestedReply.content} />
                            </div>
                            <!-- Nested reply actions -->
                            <div class="mt-1.5">
                              <ThreadCommentActions event={nestedReply} compact={true} />
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
                    href="/{nip19.noteEncode(reply.id)}"
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
    </div>
  {/if}
</div>

<!-- Zap Modal -->
{#if zapModal && event}
  <ZapModal {event} on:close={() => (zapModal = false)} />
{/if}

<style>
  /* Thread page styles */

  /* Username hover - orange color */
  .username-link:hover {
    color: var(--color-primary) !important;
  }

  /* Reply composer input */
  .reply-composer-input {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .reply-composer-input:empty:before {
    content: attr(data-placeholder);
    color: var(--color-caption);
    pointer-events: none;
  }

  .reply-composer-input:focus {
    outline: none;
    box-shadow: 0 0 0 2px var(--color-primary);
  }

  /* Mention dropdown */
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
    cursor: pointer;
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
</style>
