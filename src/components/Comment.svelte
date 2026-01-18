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
  import NoteContent from './NoteContent.svelte';
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { decode } from '@gandlaf21/bolt11-decode';
  import { searchProfiles } from '$lib/profileSearchService';

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
    const replyTag = eTags.find((tag) => tag[3] === 'reply');
    if (replyTag) {
      // Check if this reply tag points to another comment (not the root recipe)
      const aTag = event.getMatchingTags('a')[0];
      // If it's a reply and there's another e tag, it might be a nested reply
      const parentEventTag = eTags.find((tag) => tag[3] !== 'reply' && tag[3] !== 'root');
      if (parentEventTag) return parentEventTag[1];

      // Check if the reply tag points to something we can find in allReplies
      if (allReplies.some((r) => r.id === replyTag[1])) {
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

    // Sort: prioritize exact matches
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
    if (!replyComposerEl) return;
    const html = renderTextWithMentions(value);
    if (replyComposerEl.innerHTML !== html) {
      replyComposerEl.innerHTML = html;
    }
    lastRenderedReply = value;
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
    if (!replyComposerEl) return;
    const newText = htmlToPlainText(replyComposerEl);
    lastRenderedReply = newText;
    replyText = newText;
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
    if (!selection || !replyComposerEl) return;
    const range = selection.getRangeAt(0);
    let node: Node | null = range.startContainer;

    while (node && node !== replyComposerEl) {
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

  function handleReplyKeydown(event: KeyboardEvent) {
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
      parentComment = allReplies.find((c) => c.id === parentId) || null;

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
    const isRecipeReply =
      event.kind === 1111 ||
      (aTag && aTag[1]?.startsWith('30023:')) ||
      (ATag && ATag[1]?.startsWith('30023:'));
    ev.kind = isRecipeReply ? 1111 : 1;

    if (replyComposerEl) {
      replyText = htmlToPlainText(replyComposerEl);
      lastRenderedReply = replyText;
    }

    const replyContent = replacePlainMentions(replyText.trim());
    ev.content = replyContent;

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
          tags: [
            ['d', dTag],
            ['relay', rootATag[2] || '']
          ]
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
      const rootETag = event.getMatchingTags('e').find((t) => t[3] === 'root');
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
    const mentions = parseMentions(replyContent);
    for (const pubkey of mentions.values()) {
      if (!ev.tags.some((t) => t[0] === 'p' && t[1] === pubkey)) {
        ev.tags.push(['p', pubkey]);
      }
    }

    addClientTagToEvent(ev);
    await ev.publish();
    replyText = '';
    lastRenderedReply = '';
    if (replyComposerEl) {
      replyComposerEl.innerHTML = '';
    }
    showMentionSuggestions = false;
    mentionSuggestions = [];
    mentionQuery = '';
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

  $: if (replyComposerEl && replyText !== lastRenderedReply) {
    syncComposerContent(replyText);
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
        <NoteContent content={event.content} />
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
        <button on:click={() => (showReplyBox = !showReplyBox)} class="action-btn action-btn-text">
          {showReplyBox ? 'Cancel' : 'Reply'}
        </button>
      </div>

      <!-- Inline Reply Box -->
      {#if showReplyBox}
        <div class="reply-form">
          <div class="relative">
            <div
              bind:this={replyComposerEl}
              class="reply-input"
              contenteditable={!postingReply}
              role="textbox"
              aria-multiline="true"
              data-placeholder="Add a reply..."
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
                lastRenderedReply = '';
                if (replyComposerEl) {
                  replyComposerEl.innerHTML = '';
                }
                showMentionSuggestions = false;
                mentionSuggestions = [];
                mentionQuery = '';
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

  .reply-input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    font-size: 1rem;
    border-radius: 0.5rem;
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
    color: var(--color-text-primary);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .reply-input:focus {
    outline: none;
    box-shadow: 0 0 0 2px var(--color-primary);
  }

  .reply-input:empty:before {
    content: attr(data-placeholder);
    color: var(--color-caption);
    pointer-events: none;
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
    background: var(--color-input-bg);
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
</style>
