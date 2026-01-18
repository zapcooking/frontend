<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import Button from './Button.svelte';
  import { addClientTagToEvent } from '$lib/nip89';
  import { buildNip22CommentTags } from '$lib/tagUtils';
  import Comment from './Comment.svelte';
  import { onDestroy } from 'svelte';
  import { createCommentFilter } from '$lib/commentFilters';
  import { nip19 } from 'nostr-tools';
  import { get } from 'svelte/store';
  import CustomAvatar from './CustomAvatar.svelte';
  import { searchProfiles } from '$lib/profileSearchService';

  export let event: NDKEvent;
  let events = [];
  let commentText = '';
  let commentComposerEl: HTMLDivElement;
  let lastRenderedComment = '';
  let processedEvents = new Set();
  let subscribed = false;
  let commentSubscription: any = null;

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

  // Create subscription once when ndk is ready
  $: if ($ndk && !subscribed) {
    subscribed = true;

    const filter = createCommentFilter(event);
    commentSubscription = $ndk.subscribe(filter, { closeOnEose: false });

    commentSubscription.on('event', (e) => {
      // Prevent adding the same event multiple times
      if (processedEvents.has(e.id)) return;
      processedEvents.add(e.id);

      events.push(e);
      events = events;
    });

    commentSubscription.on('eose', () => {
      // End of stored events
    });
  }

  onDestroy(() => {
    if (mentionSearchTimeout) {
      clearTimeout(mentionSearchTimeout);
    }
    if (commentSubscription) {
      commentSubscription.stop();
    }
  });

  // Dummy refresh function for Comment component - not needed since subscription stays open
  function refresh() {
    // No-op: the subscription will automatically receive new events
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
    if (!commentComposerEl) return;
    const html = renderTextWithMentions(value);
    if (commentComposerEl.innerHTML !== html) {
      commentComposerEl.innerHTML = html;
    }
    lastRenderedComment = value;
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
    if (!commentComposerEl) return;
    const newText = htmlToPlainText(commentComposerEl);
    lastRenderedComment = newText;
    commentText = newText;
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
    if (!selection || !commentComposerEl) return;
    const range = selection.getRangeAt(0);
    let node: Node | null = range.startContainer;

    while (node && node !== commentComposerEl) {
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

    handleCommentInput();
  }

  function handleCommentInput() {
    updateContentFromComposer();
    if (!commentComposerEl) return;

    const converted = convertRawMentionsToPills();
    if (converted) {
      updateContentFromComposer();
    }

    const textBeforeCursor = getTextBeforeCursor(commentComposerEl);
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
    if (!commentComposerEl) return;

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
    if (!commentComposerEl) return false;

    const rawText = commentComposerEl.textContent || '';
    if (!rawText.includes('npub1')) return false;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;

    const range = selection.getRangeAt(0);
    const marker = document.createElement('span');
    marker.dataset.mentionCaret = 'true';
    marker.textContent = '\u200B';
    range.insertNode(marker);

    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(commentComposerEl, NodeFilter.SHOW_TEXT, {
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

    const caretMarker = commentComposerEl.querySelector('[data-mention-caret]');
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
    if (!commentComposerEl) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const textBeforeCursor = getTextBeforeCursor(commentComposerEl);
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

  function handleCommentKeydown(event: KeyboardEvent) {
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

  async function postComment() {
    if (!commentText.trim()) {
      return;
    }

    if (commentComposerEl) {
      commentText = htmlToPlainText(commentComposerEl);
      lastRenderedComment = commentText;
    }
    if (!$ndk?.signer) {
      console.error('No signer available - user must be logged in');
      alert('Please log in to post comments');
      return;
    }

    const ev = new NDKEvent($ndk);
    // Recipe replies should be kind 1111, not kind 1
    const isRecipe = event.kind === 30023;
    ev.kind = isRecipe ? 1111 : 1;
    const commentContent = replacePlainMentions(commentText.trim());
    ev.content = commentContent;

    // Use shared utility to build NIP-22 or NIP-10 tags
    ev.tags = buildNip22CommentTags({
      kind: event.kind,
      pubkey: event.author?.pubkey || event.pubkey,
      id: event.id,
      tags: event.tags
    });

    // Parse and add @ mention tags (p tags)
    const mentions = parseMentions(commentContent);
    for (const pubkey of mentions.values()) {
      if (!ev.tags.some((t) => t[0] === 'p' && t[1] === pubkey)) {
        ev.tags.push(['p', pubkey]);
      }
    }
    // Add NIP-89 client tag
    addClientTagToEvent(ev);

    try {
      // Ensure created_at is set before signing
      if (!ev.created_at) {
        ev.created_at = Math.floor(Date.now() / 1000);
      }

      // Sign the event - NIP-07 extension should prompt user
      // Don't timeout signing - let the extension handle it naturally
      // Users may need time to approve in their extension
      await ev.sign();

      if (!ev.id) {
        throw new Error('Event was not signed - no ID generated');
      }

      // Publish the event with a reasonable timeout
      await Promise.race([
        ev.publish(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Publishing timeout after 30 seconds')), 30000)
        )
      ]);

      // Immediately add to local events array so it appears right away
      if (!processedEvents.has(ev.id)) {
        processedEvents.add(ev.id);
        events.push(ev);
        events = events; // Trigger reactivity
      }

      // Clear the comment text
      commentText = '';
      lastRenderedComment = '';
      if (commentComposerEl) {
        commentComposerEl.innerHTML = '';
      }
      showMentionSuggestions = false;
      mentionSuggestions = [];
      mentionQuery = '';
    } catch (error) {
      console.error('Error posting comment:', error);
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      const errorMsg = error instanceof Error ? error.message : String(error);
      alert('Error posting comment: ' + errorMsg);
    }
  }

  // Sort all comments chronologically (oldest first)
  $: sortedComments = [...events].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  $: if (commentComposerEl && commentText !== lastRenderedComment) {
    syncComposerContent(commentText);
  }
</script>

<div id="comments-section" class="space-y-6">
  <h2 class="text-2xl font-bold">Comments</h2>

  <!-- Comments List - flat with embedded parent quotes -->
  <div class="comments-list">
    {#if sortedComments.length === 0}
      <p class="text-caption">No comments yet. Be the first to comment!</p>
    {:else}
      {#each sortedComments as comment (comment.id)}
        <Comment event={comment} allReplies={events} {refresh} />
      {/each}
    {/if}
  </div>

  <!-- Add Comment Form -->
  <div class="space-y-3 pt-4 border-t">
    <h3 class="text-lg font-semibold">Add a comment</h3>
    {#if $ndk?.signer}
      <div class="relative">
        <div
          id="comment-input"
          bind:this={commentComposerEl}
          class="comment-composer-input w-full px-4 py-3 text-base input rounded-lg"
          contenteditable="true"
          role="textbox"
          aria-multiline="true"
          data-placeholder="Share your thoughts..."
          on:input={handleCommentInput}
          on:keydown={handleCommentKeydown}
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
      <Button
        on:click={(e) => {
          e.preventDefault?.();
          postComment();
        }}
        disabled={!commentText.trim()}
      >
        Post Comment
      </Button>
    {:else}
      <p class="text-sm text-caption">Sign in to comment.</p>
      <a href="/login" class="text-sm underline hover:opacity-80">Sign in</a>
    {/if}
  </div>
</div>

<style>
  .comments-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .comment-composer-input {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .comment-composer-input:empty:before {
    content: attr(data-placeholder);
    color: var(--color-caption);
    pointer-events: none;
  }

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
