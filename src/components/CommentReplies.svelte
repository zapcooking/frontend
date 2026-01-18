<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import CustomAvatar from './CustomAvatar.svelte';
  import CustomName from './CustomName.svelte';
  import { nip19 } from 'nostr-tools';
  import { format as formatDate } from 'timeago.js';
  import Button from './Button.svelte';
  import { addClientTagToEvent } from '$lib/nip89';
  import { buildNip22CommentTags } from '$lib/tagUtils';
  import CommentLikes from './CommentLikes.svelte';
  import NoteContent from './NoteContent.svelte';
  import { get } from 'svelte/store';
  import { searchProfiles } from '$lib/profileSearchService';

  export let parentComment: NDKEvent;

  let showReplies = false;
  let replies: NDKEvent[] = [];
  let loading = false;
  let replyText = '';
  let postingReply = false;
  let replyCount = 0;
  let errorMessage = '';
  let successMessage = '';
  let replyComposerEl: HTMLDivElement;
  let lastRenderedReply = '';
  let replySubscription: any = null;

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

  // Load replies for this comment
  async function loadReplies() {
    if (loading) return;

    loading = true;
    replies = [];
    replyCount = 0;

    // Close previous subscription if exists
    if (replySubscription) {
      replySubscription.stop();
    }

    try {
      // Use subscribe collection for more reliable reply loading
      replySubscription = $ndk.subscribe(
        {
          kinds: [1, 1111],
          '#e': [parentComment.id] // Replies that reference this comment
        },
        { closeOnEose: true }
      );

      replySubscription.on('event', (ev) => {
        loading = false;
        replies.push(ev);
        replies = replies;
      });

      replySubscription.on('eose', () => {
        loading = false;
      });
    } catch (error) {
      console.error('Error loading replies:', error);
      loading = false;
    }
  }

  // Post a new reply
  async function postReply() {
    if (!replyText.trim() || postingReply || !$ndk.signer) return;

    postingReply = true;
    errorMessage = '';
    successMessage = '';

    try {
      if (replyComposerEl) {
        replyText = htmlToPlainText(replyComposerEl);
        lastRenderedReply = replyText;
      }

      const replyEvent = new NDKEvent($ndk);

      // Check if this is a reply to a recipe comment
      // If the parent comment is kind 1111 or has an 'a' tag referencing kind 30023, use kind 1111
      const aTag = parentComment.getMatchingTags('a')[0];
      const ATag = parentComment.getMatchingTags('A')[0];
      const isRecipeReply =
        parentComment.kind === 1111 ||
        (aTag && aTag[1]?.startsWith('30023:')) ||
        (ATag && ATag[1]?.startsWith('30023:'));
      replyEvent.kind = isRecipeReply ? 1111 : 1;

      const replyContent = replacePlainMentions(replyText.trim());
      replyEvent.content = replyContent;

      // Reconstruct a minimal event object for the parent comment
      const parentEventObj = {
        id: parentComment.id,
        pubkey: parentComment.pubkey,
        kind: parentComment.kind,
        tags: parentComment.tags
      };

      // For recipe replies, we need to get the root event info from the parent's tags
      if (isRecipeReply) {
        // Get root event info from parent comment's tags
        const rootATag =
          parentComment.getMatchingTags('A')[0] || parentComment.getMatchingTags('a')[0];

        if (rootATag) {
          // Parse the address tag to extract root event info.
          // Format is kind:pubkey:d, where d may itself contain colons.
          const addressParts = rootATag[1].split(':');
          const kind = addressParts[0];
          const pubkey = addressParts[1];
          const dTag = addressParts.slice(2).join(':');
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
          replyEvent.tags = buildNip22CommentTags(rootEventObj, parentEventObj);
        } else {
          // Fallback: treat parent as if it's the root
          replyEvent.tags = buildNip22CommentTags(parentEventObj, parentEventObj);
        }
      } else {
        // For non-recipe replies, use simplified tag structure
        replyEvent.tags = [
          ['e', parentComment.id, '', 'reply'],
          ['p', parentComment.pubkey]
        ];
      }

      // Parse and add @ mention tags (p tags)
      const mentions = parseMentions(replyContent);
      for (const pubkey of mentions.values()) {
        // Avoid duplicate p tags
        if (!replyEvent.tags.some((t) => t[0] === 'p' && t[1] === pubkey)) {
          replyEvent.tags.push(['p', pubkey]);
        }
      }

      // Add NIP-89 client tag
      addClientTagToEvent(replyEvent);

      await replyEvent.publish();

      // Clear the form and show success
      replyText = '';
      lastRenderedReply = '';
      if (replyComposerEl) {
        replyComposerEl.innerHTML = '';
      }
      showMentionSuggestions = false;
      mentionSuggestions = [];
      mentionQuery = '';
      successMessage = 'Reply posted successfully!';

      // Reload replies to show the new one
      await loadReplies();

      // Clear success message after a delay
      setTimeout(() => {
        successMessage = '';
      }, 3000);
    } catch (error) {
      console.error('Error posting reply:', error);
      errorMessage = 'Failed to post reply. Please try again.';
    } finally {
      postingReply = false;
    }
  }

  // Toggle replies visibility
  function toggleReplies() {
    showReplies = !showReplies;
    if (showReplies && replies.length === 0) {
      loadReplies();
    }
    // Preload mention profiles when opening replies
    if (showReplies && $userPublickey) {
      loadMentionFollowList();
    }
  }

  onDestroy(() => {
    if (mentionSearchTimeout) {
      clearTimeout(mentionSearchTimeout);
    }
    if (replySubscription) {
      replySubscription.stop();
    }
  });

  $: if (replyComposerEl && replyText !== lastRenderedReply) {
    syncComposerContent(replyText);
  }
</script>

<div class="comment-replies" data-comment-id={parentComment.id}>
  <!-- Reply Button -->
  <button
    on:click={toggleReplies}
    class="text-sm text-caption hover:text-primary font-medium cursor-pointer transition duration-300 print:hidden"
  >
    {showReplies ? 'Hide replies' : 'Reply'}
    {replyCount > 0 ? `(${replyCount})` : ''}
  </button>

  <!-- Replies Section -->
  {#if showReplies}
    <div class="mt-3 space-y-3">
      <!-- Authentication Status -->
      {#if !$ndk.signer}
        <div class="text-xs text-amber-600 bg-amber-50 p-2 rounded">
          <strong>Please log in</strong> to reply to comments.
        </div>
      {/if}

      <!-- Error/Success Messages -->
      {#if errorMessage}
        <div class="text-xs text-red-600 bg-red-50 p-2 rounded print:hidden">
          {errorMessage}
        </div>
      {/if}

      {#if successMessage}
        <div class="text-xs text-green-600 bg-green-50 p-2 rounded print:hidden">
          {successMessage}
        </div>
      {/if}

      <!-- Reply Form -->
      <div class="space-y-1 print:hidden">
        <div class="relative">
          <div
            bind:this={replyComposerEl}
            class="reply-input w-full px-4 py-3 text-sm input rounded-xl transition duration-200"
            class:opacity-50={!$ndk.signer || postingReply}
            class:cursor-not-allowed={!$ndk.signer || postingReply}
            contenteditable={$ndk.signer && !postingReply}
            role="textbox"
            aria-multiline="true"
            aria-disabled={!$ndk.signer || postingReply}
            data-placeholder={$ndk.signer ? 'Add a reply...' : 'Log in to reply...'}
            on:input={handleReplyInput}
            on:keydown={handleReplyKeydown}
            on:beforeinput={handleBeforeInput}
            on:paste={handlePaste}
          ></div>

          <!-- Mention suggestions dropdown -->
          {#if showMentionSuggestions && mentionSuggestions.length > 0}
            <div
              class="absolute z-50 mt-1 w-full max-w-md bg-input rounded-lg shadow-lg border overflow-hidden"
              style="border-color: var(--color-input-border); max-height: 200px; overflow-y: auto;"
            >
              {#each mentionSuggestions as suggestion, index}
                <button
                  type="button"
                  on:click={() => insertMention(suggestion)}
                  on:mousedown|preventDefault={() => insertMention(suggestion)}
                  class="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent-gray transition-colors text-left"
                  class:bg-accent-gray={index === selectedMentionIndex}
                >
                  <CustomAvatar pubkey={suggestion.pubkey} size={24} />
                  <span class="text-sm" style="color: var(--color-text-primary)"
                    >{suggestion.name}</span
                  >
                </button>
              {/each}
            </div>
          {/if}
        </div>
        <div class="flex justify-end">
          <Button
            on:click={postReply}
            disabled={!replyText.trim() || postingReply || !$ndk.signer}
            class="px-4 py-2 text-sm"
          >
            {postingReply ? 'Posting...' : $ndk.signer ? 'Post Reply' : 'Log in to reply'}
          </Button>
        </div>
      </div>

      <!-- Replies List -->
      <div class="replies-list">
        {#if loading}
          <div class="py-2 text-sm text-caption">Loading replies...</div>
        {:else if replies.length === 0}
          <div class="text-center py-2 text-xs text-caption">No replies yet</div>
        {:else}
          {#each replies as reply}
            <div class="reply-row">
              <div class="reply-avatar">
                <CustomAvatar className="flex-shrink-0" pubkey={reply.pubkey} size={24} />
              </div>
              <div class="reply-content">
                <div class="reply-header">
                  <span class="reply-author">
                    <CustomName pubkey={reply.pubkey} />
                  </span>
                  <span class="reply-time">
                    {formatDate(new Date((reply.created_at || 0) * 1000))}
                  </span>
                </div>
                <div class="reply-body">
                  <NoteContent content={reply.content} />
                </div>
                <!-- Reply Actions -->
                <div class="flex items-center gap-2">
                  <CommentLikes event={reply} />
                </div>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  /* Replies list container */
  .replies-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  /* Reply row - 2 column flex layout */
  .reply-row {
    display: flex;
    gap: 0.5rem;
  }

  /* Avatar gutter - fixed width, never shrinks */
  .reply-avatar {
    flex: 0 0 auto;
    width: 24px;
  }

  /* Content column - takes remaining width, CAN shrink */
  .reply-content {
    flex: 1 1 0%;
    min-width: 0; /* Critical: allows content to shrink below intrinsic width */
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  /* Name + Time header - wraps naturally on mobile */
  .reply-header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.125rem 0.5rem;
    margin-bottom: 0.25rem;
  }

  .reply-author {
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .reply-time {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  /* Reply body text */
  .reply-body {
    font-size: 0.875rem;
    line-height: 1.625;
    margin-bottom: 0.5rem;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .reply-input {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .reply-input:empty:before {
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
</style>
