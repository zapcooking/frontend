<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { ndk, userPublickey, normalizeRelayUrl } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import ImageIcon from 'phosphor-svelte/lib/Image';
  import VideoIcon from 'phosphor-svelte/lib/Video';
  import GifIcon from 'phosphor-svelte/lib/Gif';
  import ChartBarHorizontalIcon from 'phosphor-svelte/lib/ChartBarHorizontal';
  import GifPicker from './GifPicker.svelte';
  import PollCreator from './PollCreator.svelte';
  import { buildPollTags, buildZapPollTags, type PollConfig, type ZapPollConfig } from '$lib/polls';
  import CustomAvatar from './CustomAvatar.svelte';
  import ProfileLink from './ProfileLink.svelte';
  import { nip19 } from 'nostr-tools';
  import NoteContent from './NoteContent.svelte';
  import { addClientTagToEvent } from '$lib/nip89';
  import { buildHashtagTags, MAX_HASHTAGS } from '$lib/hashtags';
  import {
    SUGGESTED_HASHTAGS,
    isHashtagSelected,
    suggestedTagCount,
    atHashtagCap,
    overHashtagCap,
    toggleHashtag
  } from '$lib/hashtagPills';
  import type { NDKEvent as NDKEventType } from '@nostr-dev-kit/ndk';
  import { clearQuotedNote } from '$lib/postComposerStore';
  import { publishQueue, publishQueueState } from '$lib/publishQueue';
  import MentionDropdown from './MentionDropdown.svelte';
  import { MentionComposerController, type MentionState } from '$lib/mentionComposer';
  import { uploadImage, uploadVideo } from '$lib/mediaUpload';
  import {
    composeNoteContent,
    imetaTagsForMedia,
    attachableUrlCandidates,
    removeBareUrlOccurrence,
    stripAttachmentUrlLines,
    type MediaAttachment
  } from '$lib/composerMedia';
  import { isVideoUrl } from '$lib/feed/imeta';
  import AltTextEditorModal from './AltTextEditorModal.svelte';
  import MediaDrawer from './MediaDrawer.svelte';
  import CaretLeftIcon from 'phosphor-svelte/lib/CaretLeft';
  import CaretRightIcon from 'phosphor-svelte/lib/CaretRight';
  import PlusIcon from 'phosphor-svelte/lib/Plus';
  import { clickOutside } from '$lib/clickOutside';
  import { showToast } from '$lib/toast';
  import { addPendingOp, removePendingOp } from '$lib/stores/pendingOps';
  import { timerSettings, loadTimerSettings, saveTimerSettings } from '$lib/timerSettings';
  import { get } from 'svelte/store';
  import ClockIcon from 'phosphor-svelte/lib/Clock';

  // Clear stuck posts from the publish queue
  async function clearPendingQueue() {
    try {
      await publishQueue.clearQueue();
      console.log('[PostComposer] Cleared publish queue');
    } catch (err) {
      console.error('[PostComposer] Failed to clear queue:', err);
    }
  }

  type FilterMode = 'global' | 'following' | 'replies' | 'members';
  type RelaySelection = 'all' | 'pantry';

  export let activeTab: FilterMode = 'global';
  export let variant: 'inline' | 'modal' = 'inline';
  export let selectedRelay: RelaySelection | undefined = undefined;
  export let initialQuotedNote: { nevent: string; event: NDKEventType } | null = null;

  const dispatch = createEventDispatcher<{ close: void; minimize: { preview: string }; posting: boolean }>();

  // Exposed so the wrapping modal's X button routes through the same
  // close/minimize logic as the composer's own Cancel button.
  export function requestClose() {
    closeComposer();
  }

  let isComposerOpen = variant === 'modal';
  let content = '';
  let posting = false;
  let success = false;
  let error = '';

  // Send countdown
  let showCountdown = false;
  let countdownStartedAt = 0;
  let countdownTotal = 0;
  let countdownFraction = 1;
  let countdownDisplayNum = 0;
  let rafHandle: number | null = null;
  let showCountdownSettings = false;
  let composerEl: HTMLDivElement;
  let lastRenderedContent = '';

  // Attachments are ordered slots on the draft, never text in the editor.
  // The array order is the only ordering that exists — the wire content, the
  // imeta tags, the thumbnails and the drawer all read it ($lib/composerMedia).
  let media: MediaAttachment[] = [];

  // Per-image alt editor: badge on the thumbnail opens the
  // shared modal (with the Cook+ AI generator). The modal is keyed by URL,
  // so a reorder while it is open cannot invalidate what it edits.
  let altModalOpen = false;
  let altModalUrl = '';
  let altModalInitial = '';

  function openAltEditor(url: string) {
    altModalUrl = url;
    altModalInitial = media.find((m) => m.url === url)?.alt ?? '';
    altModalOpen = true;
  }

  function saveAltEditor(e: CustomEvent<{ text: string }>) {
    const url = altModalUrl;
    if (!url) return;
    media = media.map((m) => (m.url === url ? { ...m, alt: e.detail.text || undefined } : m));
    scheduleDraftSave();
  }

  // ── Thumbnail loading ─────────────────────────────────────────
  // A just-uploaded URL can 404 for a second or two while the host finishes
  // writing it. An <img> tries exactly once, so without a retry the
  // thumbnail is blank forever — and the URL is in the draft either way,
  // so a silently failed thumbnail is a note about to ship a link nobody
  // checked. Retry a couple of times with a cache-busting query, then say
  // the cell failed.
  const THUMB_RETRIES = 2;
  let thumbRetries: Record<string, number> = {};
  let thumbFailed: Record<string, boolean> = {};
  const thumbRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function thumbSrc(url: string): string {
    const attempt = thumbRetries[url] ?? 0;
    if (!attempt) return url;
    return `${url}${url.includes('?') ? '&' : '?'}zc-retry=${attempt}`;
  }

  function handleThumbError(url: string) {
    const attempt = (thumbRetries[url] ?? 0) + 1; // the retry that just failed
    if (attempt > THUMB_RETRIES) {
      thumbFailed = { ...thumbFailed, [url]: true };
      return;
    }
    const timer = setTimeout(() => {
      thumbRetryTimers.delete(url);
      thumbRetries = { ...thumbRetries, [url]: attempt };
    }, 700 * attempt);
    thumbRetryTimers.set(url, timer);
  }

  function forgetThumb(url: string) {
    const timer = thumbRetryTimers.get(url);
    if (timer) clearTimeout(timer);
    thumbRetryTimers.delete(url);
    if (url in thumbRetries) {
      const next = { ...thumbRetries };
      delete next[url];
      thumbRetries = next;
    }
    if (url in thumbFailed) {
      const next = { ...thumbFailed };
      delete next[url];
      thumbFailed = next;
    }
  }

  function resetThumbState() {
    for (const timer of thumbRetryTimers.values()) clearTimeout(timer);
    thumbRetryTimers.clear();
    thumbRetries = {};
    thumbFailed = {};
  }

  // ── Paste-to-attach offers ────────────────────────────────────
  // Bare URLs alone on their line in the text are OFFERED as attachment
  // slots, never auto-converted. Offers derive live from the editor text,
  // so consuming (or editing away) an occurrence retires its offer by
  // itself. A URL inside a sentence is authored prose and gets no offer.
  //
  // A dismissal expires when its line does: a URL with no live candidate
  // line clears its refusal, so pasting it afresh later asks again — a
  // deliberate no is not a forever no (sidecar #356).
  let dismissedOfferUrls = new Set<string>();

  function pruneDismissedOffers(text: string) {
    const live = new Set(attachableUrlCandidates(text));
    let changed = false;
    for (const url of dismissedOfferUrls) {
      if (!live.has(url)) {
        dismissedOfferUrls.delete(url);
        changed = true;
      }
    }
    if (changed) dismissedOfferUrls = dismissedOfferUrls;
  }

  $: pruneDismissedOffers(content);
  $: attachOffers = attachableUrlCandidates(content).filter((url) => !dismissedOfferUrls.has(url));

  function dismissAttachOffer(url: string) {
    const next = new Set(dismissedOfferUrls);
    next.add(url);
    dismissedOfferUrls = next;
  }

  function acceptAttachOffer(url: string) {
    // Read the live DOM first: the last keystroke may not have flowed into
    // `content` yet, and a fast double-tap can outpace the reactive update.
    const current = composerEl ? mentionCtrl.extractText() : content;
    const next = removeBareUrlOccurrence(current, url);
    if (next === current) return; // occurrence already consumed — stale offer
    content = next;
    if (composerEl) {
      mentionCtrl.syncContent(content);
      lastRenderedContent = content;
    }
    // Every accepted occurrence adds a slot — attaching the same image
    // twice is allowed and the note carries its URL twice, exactly as
    // pasting it twice in the text era did. imeta stays one tag per
    // picture ($lib/composerMedia dedupes by URL at publish).
    media = [...media, { url, isVideo: isVideoUrl(url) }];
    scheduleDraftSave();
  }

  // ── Reordering: two mechanisms, one array ─────────────────────
  // Drag and drop on the thumbnails (enabled only when there is more than
  // one), plus arrow steppers — HTML5 drag never fires on touch, so without
  // steppers a phone or a keyboard would have no reordering at all.
  let dragIndex: number | null = null;
  let dropIndex: number | null = null;

  function moveMedia(from: number | null, to: number) {
    if (from === null || from === to) return;
    if (from < 0 || to < 0 || from >= media.length || to >= media.length) return;
    const moved = media.splice(from, 1)[0];
    media.splice(to, 0, moved);
    media = media;
    scheduleDraftSave();
  }

  function handleThumbDragStart(e: DragEvent, index: number) {
    if (media.length < 2) return;
    dragIndex = index;
    // Firefox refuses to start a drag without payload data.
    e.dataTransfer?.setData('text/plain', String(index));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  function handleThumbDragOver(e: DragEvent, index: number) {
    if (dragIndex === null) return;
    e.preventDefault(); // without it the drop never fires
    dropIndex = index;
  }

  function handleThumbDrop(e: DragEvent, index: number) {
    e.preventDefault();
    moveMedia(dragIndex, index);
  }

  function handleThumbDragEnd() {
    // State drives the highlight on every cell, so clearing it here clears
    // all of them — a cancelled drag must not leave a highlight behind.
    dragIndex = null;
    dropIndex = null;
  }

  let uploadingImage = false;
  let uploadImageIndex = 0;
  let uploadImageTotal = 0;
  let uploadingVideo = false;
  let imageInputEl: HTMLInputElement;
  let videoInputEl: HTMLInputElement;
  let showMediaMenu = false;

  function openImagePicker() {
    showMediaMenu = false;
    imageInputEl?.click();
  }

  function openVideoPicker() {
    showMediaMenu = false;
    videoInputEl?.click();
  }

  // Close the media menu if posting / upload starts while it's open.
  $: if (showMediaMenu && (posting || uploadingImage || uploadingVideo)) {
    showMediaMenu = false;
  }
  let quotedNote: { nevent: string; event: NDKEventType } | null = null;
  let showGifPicker = false;
  let showPollCreator = false;
  let pollConfig: PollConfig | null = null;
  let zapPollConfig: ZapPollConfig | null = null;

  const DRAFT_KEY = 'zapcooking_note_draft';
  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  let draftSaved = false;
  let showPreview = false;
  let isMinimized = false;
  let previewContent = '';
  let minimizedLabel = '';

  // Mention autocomplete (shared controller)
  let mentionState: MentionState = {
    mentionQuery: '',
    showMentionSuggestions: false,
    mentionSuggestions: [],
    selectedMentionIndex: 0,
    mentionSearching: false
  };

  const mentionCtrl = new MentionComposerController(
    (state) => {
      mentionState = state;
    },
    (text) => {
      content = text;
      lastRenderedContent = text;
    }
  );

  $: mentionCtrl.setComposerEl(composerEl);

  $: if (composerEl && content !== lastRenderedContent) {
    mentionCtrl.syncContent(content);
    lastRenderedContent = content;
  }

  $: if (variant === 'modal') {
    isComposerOpen = true;
  }

  $: previewContent = computePreviewContent(content, media, quotedNote);

  // Hashtag suggestion pills. The body is the single source of truth: a pill
  // is selected when its tag is in `content`, typed or tapped, and the counter
  // counts `content` exactly as the feed's cap does ($lib/hashtags).
  $: tagCount = suggestedTagCount(content);
  $: tagsAtCap = atHashtagCap(content);
  $: tagsOverCap = overHashtagCap(content);

  function handlePillTap(tag: string) {
    if (posting) return;
    // Read the live DOM first: the last keystroke may not have flowed into
    // `content` yet if the input handler has not run.
    const current = composerEl ? mentionCtrl.extractText() : content;
    const next = toggleHashtag(current, tag);
    if (next === current) return;
    content = next;
    // The reactive sync re-renders the editor from `content`, which drops the
    // caret. Put it back at the end, after the tag line.
    setTimeout(() => {
      if (!composerEl) return;
      mentionCtrl.syncContent(content);
      lastRenderedContent = content;
      composerEl.focus();
      const range = document.createRange();
      range.selectNodeContents(composerEl);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      scheduleDraftSave();
    }, 0);
  }

  $: if (composerEl && (content || media.length)) {
    scheduleDraftSave();
  }

  function focusComposer() {
    setTimeout(() => {
      if (composerEl) {
        mentionCtrl.syncContent(content);
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
      mentionCtrl.preloadFollowList();
    }

    // Restore saved draft — set content directly so the reactive
    // $: if (composerEl && content !== lastRenderedContent) fires when composerEl binds
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as {
          content?: string;
          media?: MediaAttachment[];
          images?: string[];
          imageAlts?: Record<string, string>;
          videos?: string[];
          savedAt?: number;
        };
        let restored: MediaAttachment[] = [];
        if (Array.isArray(draft.media)) {
          restored = draft.media.filter((m): m is MediaAttachment => !!m && typeof m.url === 'string');
        } else {
          // Draft saved before attachments became ordered slots: parallel
          // image/video arrays plus a url-keyed alt map. Images first, then
          // videos — the order those drafts always published in.
          const alts = draft.imageAlts || {};
          restored = [
            ...(draft.images || []).map((url) => ({ url, alt: alts[url], isVideo: false })),
            ...(draft.videos || []).map((url) => ({ url, isVideo: true }))
          ];
        }
        if (draft.content || restored.length) {
          if (draft.content) {
            // Older drafts may carry an attachment URL alone on its own line
            // in the text; strip those or publishing appends them twice. A
            // URL written inside a sentence is authored prose and survives.
            content = stripAttachmentUrlLines(draft.content, restored.map((m) => m.url));
          }
          if (restored.length) media = restored;
          draftSaved = true;
        }
      }
    } catch (_) {}

    loadTimerSettings();

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
    // Cancel any pending debounced draft save so it can't fire after unmount
    if (draftTimer) clearTimeout(draftTimer);
    if (rafHandle !== null) cancelAnimationFrame(rafHandle);
    resetThumbState();
    mentionCtrl.destroy();
  });

  function openComposer() {
    isMinimized = false;
    isComposerOpen = true;
    focusComposer();
  }

  function resetComposerState() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
    content = '';
    lastRenderedContent = '';
    error = '';
    showPreview = false;
    draftSaved = false;
    isMinimized = false;
    mentionCtrl.resetMentionState();
    media = [];
    resetThumbState();
    dragIndex = null;
    dropIndex = null;
    quotedNote = null;
    pollConfig = null;
    zapPollConfig = null;
    if (composerEl) {
      composerEl.innerHTML = '';
    }
  }

  function closeComposer() {
    if (posting) return;

    // Persist the latest content before we tear anything down
    flushDraftSave();

    const hasContent = !!(content.trim() || media.length);
    const isDesktop =
      typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;

    if (variant === 'modal') {
      // Desktop with content → minimize to the bottom drawer (handled by PostModal,
      // which survives the modal unmount). Otherwise fully close — the autosaved
      // draft is restored on next open.
      if (hasContent && isDesktop) {
        dispatch('minimize', { preview: toPreviewLabel(content) || 'Media note' });
      } else {
        dispatch('close');
      }
      return;
    }

    // Inline: minimize to floating pill on desktop; on mobile just collapse
    // (in-memory content is preserved, no pill needed).
    if (hasContent) {
      isMinimized = isDesktop;
      isComposerOpen = false;
      return;
    }

    resetComposerState();
    isComposerOpen = false;
  }

  async function handleImageUpload(e: Event) {
    const target = e.target as HTMLInputElement;
    const files = target.files;
    if (!files || files.length === 0) return;

    uploadingImage = true;
    uploadImageTotal = files.length;
    uploadImageIndex = 0;
    error = '';

    try {
      for (const file of Array.from(files)) {
        uploadImageIndex += 1;
        const url = await uploadImage($ndk, file);
        media = [...media, { url, isVideo: false }];
      }
    } catch (err: any) {
      console.error('Error uploading image:', err);
      error = err?.message || 'Failed to upload image. Please try again.';
    } finally {
      uploadingImage = false;
      uploadImageIndex = 0;
      uploadImageTotal = 0;
      if (imageInputEl) imageInputEl.value = '';
    }
  }

  async function handlePaste(e: ClipboardEvent) {
    const imageFiles = Array.from(e.clipboardData?.items ?? [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);
    if (imageFiles.length === 0) {
      // Paste inserts text, always — conversion to an attachment slot never
      // happens automatically. Bare URLs on URL-only lines surface as
      // "Attach this media" offers below the text field instead.
      mentionCtrl.handlePaste(e);
      return;
    }
    e.preventDefault();
    uploadingImage = true;
    error = '';
    try {
      const newUrls: string[] = [];
      for (const file of imageFiles) {
        newUrls.push(await uploadImage($ndk, file));
      }
      media = [...media, ...newUrls.map((url) => ({ url, isVideo: false }))];
    } catch (err: any) {
      error = err?.message || 'Failed to upload image. Please try again.';
    } finally {
      uploadingImage = false;
      uploadImageIndex = 0;
      uploadImageTotal = 0;
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
        const url = await uploadVideo($ndk, file);
        media = [...media, { url, isVideo: true }];
      }
    } catch (err: any) {
      console.error('Error uploading video:', err);
      error = err?.message || 'Failed to upload video. Please try again.';
    } finally {
      uploadingVideo = false;
      if (videoInputEl) videoInputEl.value = '';
    }
  }

  // Removing an attachment is a splice, with no text to clean up.
  function removeMedia(index: number) {
    const removed = media[index];
    if (removed) forgetThumb(removed.url);
    media = media.filter((_, i) => i !== index);
    scheduleDraftSave();
  }

  // ── Send countdown ────────────────────────────────────────────

  function startCountdown(secs: number) {
    countdownTotal = secs;
    countdownStartedAt = Date.now();
    countdownFraction = 1;
    countdownDisplayNum = secs;
    showCountdown = true;
    showCountdownSettings = false;

    function tick() {
      const elapsed = (Date.now() - countdownStartedAt) / 1000;
      const remaining = Math.max(0, countdownTotal - elapsed);
      countdownFraction = remaining / countdownTotal;
      countdownDisplayNum = Math.ceil(remaining);
      if (remaining <= 0) {
        showCountdown = false;
        postToFeed();
        return;
      }
      rafHandle = requestAnimationFrame(tick);
    }
    rafHandle = requestAnimationFrame(tick);
  }

  function cancelCountdown() {
    if (rafHandle !== null) { cancelAnimationFrame(rafHandle); rafHandle = null; }
    showCountdown = false;
  }

  function postNow() {
    if (rafHandle !== null) { cancelAnimationFrame(rafHandle); rafHandle = null; }
    showCountdown = false;
    postToFeed();
  }

  function handlePostClick() {
    const settings = get(timerSettings);
    if (settings.postCountdownEnabled) {
      startCountdown(settings.postCountdownSecs);
    } else {
      postToFeed();
    }
  }

  // ─────────────────────────────────────────────────────────────

  async function postToFeed() {
    console.log('[PostComposer] postToFeed called');
    console.log('[PostComposer] content:', content);
    console.log('[PostComposer] quotedNote:', quotedNote);
    console.log('[PostComposer] media:', media);

    if (
      !content.trim() &&
      !quotedNote &&
      media.length === 0 &&
      !pollConfig &&
      !zapPollConfig
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
    dispatch('posting', true);
    error = '';
    let opId: string | null = null;

    try {
      if (composerEl) {
        content = mentionCtrl.extractText();
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
      event.kind = zapPollConfig ? 6969 : pollConfig ? 1068 : 1;

      // The note on the wire is the shared composition — prose, then the
      // media URLs in draft order — never text the editor holds.
      let postContent = composeNoteContent(content, media);

      if (quotedNote) {
        postContent = postContent
          ? `${postContent}\n\nnostr:${quotedNote.nevent}`
          : `nostr:${quotedNote.nevent}`;
      }

      postContent = mentionCtrl.replacePlainMentions(postContent);
      const mentions = mentionCtrl.parseMentions(postContent);

      event.content = postContent;
      event.tags = [];

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

      // Hashtags typed in the body become `t` tags. Without these, every
      // relay-side `#t` filter (web's own and the iOS/Android OnlyFood feeds)
      // misses the note — see $lib/hashtags.
      event.tags.push(...buildHashtagTags(postContent));

      // NIP-92 imeta tags carry per-attachment alt text for screen readers
      // (same wire format Amethyst and Gossip read), one tag per described
      // attachment in draft order — no empty metadata.
      event.tags.push(...imetaTagsForMedia(media));

      addClientTagToEvent(event);

      if (zapPollConfig) {
        // Zap polls need a p tag with creator's pubkey for Lightning routing
        if ($userPublickey) {
          const relay = $ndk.explicitRelayUrls?.[0] || '';
          event.tags.push(relay ? ['p', $userPublickey, relay] : ['p', $userPublickey]);
        }
        event.tags.push(...buildZapPollTags(zapPollConfig));
      } else if (pollConfig) {
        event.tags.push(...buildPollTags(pollConfig));
      }

      // Determine which relays to publish to
      // Priority: explicit selectedRelay prop (from modal) > activeTab (from feed context)
      const relayMode = selectedRelay || (activeTab === 'members' ? 'pantry' : 'all');

      console.log(`[PostComposer] Publishing with relay mode: ${relayMode}`);
      console.log('[PostComposer] Event content:', event.content);
      console.log('[PostComposer] Event tags:', event.tags);

      // For modal: close immediately so the user can keep browsing; publish runs
      // in the background and surfaces result via toast + pending indicator.
      if (variant === 'modal') {
        opId = addPendingOp('Posting...');
        resetComposerState();
        dispatch('close');
      }

      // Use the resilient publish queue with automatic retry
      console.log('[PostComposer] Calling publishQueue.publishWithRetry...');
      const result = await publishQueue.publishWithRetry(event, relayMode);
      console.log('[PostComposer] Publish result:', result);

      if (result.success) {
        const noteLink = event.id ? `/${nip19.noteEncode(event.id)}` : null;
        showToast('success', 'Note published', 12000, noteLink ? { label: 'View', href: noteLink } : undefined);
        if (variant !== 'modal') {
          resetComposerState();
          isComposerOpen = false;
        }
      } else if (result.queued) {
        showToast('info', 'Note queued — will publish when connection improves', 5000);
        console.log('[PostComposer] Post queued for background retry:', result.error);
        if (variant !== 'modal') {
          resetComposerState();
          isComposerOpen = false;
        }
      } else {
        if (variant === 'modal') {
          showToast('error', result.error || 'Failed to publish');
        } else {
          error = result.error || 'Failed to publish';
        }
      }
    } catch (err) {
      console.error('Error posting to feed:', err);
      const errMsg = err instanceof Error ? err.message : 'Failed to post. Please try again.';
      if (variant === 'modal') {
        showToast('error', errMsg);
      } else {
        error = errMsg;
      }
    } finally {
      if (opId) removePendingOp(opId);
      posting = false;
      dispatch('posting', false);
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    // Let controller handle mention-related keys first
    if (mentionCtrl.handleKeydown(event)) return;

    // No additional non-mention keydown logic in PostComposer
  }

  function saveDraftNow() {
    try {
      const text = composerEl ? mentionCtrl.extractText() : content;
      if (!text.trim() && media.length === 0) {
        localStorage.removeItem(DRAFT_KEY);
        draftSaved = false;
        return;
      }
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          content: text,
          media,
          savedAt: Date.now()
        })
      );
      draftSaved = true;
    } catch (_) {}
  }

  function scheduleDraftSave() {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraftNow, 300);
  }

  // Flush any pending debounced save immediately (called before closing)
  function flushDraftSave() {
    if (draftTimer) {
      clearTimeout(draftTimer);
      draftTimer = null;
    }
    saveDraftNow();
  }

  // Human-readable label for the minimized draft tab — strip image URLs,
  // links, and raw nostr refs so the tab shows meaningful text, not a URL.
  function toPreviewLabel(raw: string): string {
    return raw
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/nostr:\S+/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  $: minimizedLabel = toPreviewLabel(content) || 'Media note';

  function restoreFromMinimized() {
    isMinimized = false;
    openComposer();
  }

  function discardAndFullyClose() {
    if (!confirm('Discard this draft? This cannot be undone.')) return;
    isMinimized = false;
    resetComposerState();
    isComposerOpen = false;
  }

  function computePreviewContent(text: string, slots: MediaAttachment[], quote: typeof quotedNote): string {
    // Preview renders the note that will go out — the same composeNoteContent
    // call postToFeed uses — never just the text the editor was showing.
    let preview = composeNoteContent(mentionCtrl.replacePlainMentions(text), slots);
    if (quote) {
      preview = preview ? `${preview}\n\nnostr:${quote.nevent}` : `nostr:${quote.nevent}`;
    }
    return preview;
  }
</script>

{#if $userPublickey !== '' || variant === 'modal'}
  <div
    class={`rounded-xl relative ${variant === 'inline' ? 'mb-4' : 'flex-1 flex flex-col composer-modal'} ${posting ? '' : 'bg-input transition-all'}`}
    class:overflow-hidden={!isComposerOpen}
    class:overflow-visible={isComposerOpen}
    style={posting ? '' : 'border: 1px solid var(--color-input-border)'}
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
    {:else if posting}
      <div class="posting-indicator">
        <svg class="posting-spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
        <span>Posting…</span>
      </div>
    {:else}
      <div class={`${variant === 'modal' ? 'flex-1 flex flex-col min-h-0' : 'p-3'}`}>
        <!-- Scrollable content area -->
        <div class={variant === 'modal' ? 'composer-scroll-area flex-1 overflow-y-auto min-h-0 p-3' : ''}>
          <div class={variant === 'modal' ? 'min-w-0' : 'flex gap-3'}>
            {#if variant === 'inline'}
              <CustomAvatar pubkey={$userPublickey} size={36} />
            {/if}
            <div class="flex-1 min-w-0">
              <!-- Write / Preview tab bar. In the modal the avatar sits
                   inline here so the write area can span the full width
                   below it instead of being indented past the avatar. -->
              <div class="flex items-center gap-2 border-b mb-1" style="border-color: var(--color-input-border)">
                {#if variant === 'modal'}
                  <CustomAvatar pubkey={$userPublickey} size={32} />
                {/if}
                <button
                  type="button"
                  on:click={() => (showPreview = false)}
                  class="composer-tab px-3 py-1.5 text-xs font-medium transition-colors -mb-px border-b-2 {!showPreview ? 'text-primary border-primary' : 'text-caption border-transparent'}"
                >Write</button>
                <button
                  type="button"
                  on:click={() => (showPreview = true)}
                  class="composer-tab px-3 py-1.5 text-xs font-medium transition-colors -mb-px border-b-2 {showPreview ? 'text-primary border-primary' : 'text-caption border-transparent'}"
                >Preview</button>
              </div>

              <!-- Write pane (hidden when preview active, DOM kept for content preservation) -->
              <div class:hidden={showPreview}>
                <div class="relative">
                  <div
                    bind:this={composerEl}
                    class={`composer-input w-full overflow-y-auto p-2 border-0 focus:outline-none focus:ring-0 bg-transparent ${variant === 'modal' ? 'min-h-[200px] max-h-[45vh]' : 'min-h-[120px] sm:min-h-[100px] max-h-[40vh]'}`}
                    style="color: var(--color-text-primary); touch-action: auto; user-select: text; -webkit-user-select: text;"
                    contenteditable={!posting}
                    role="textbox"
                    aria-multiline="true"
                    data-placeholder="What are you eating, cooking, or loving?"
                    on:keydown={handleKeydown}
                    on:input={() => mentionCtrl.handleInput()}
                    on:beforeinput={(e) => mentionCtrl.handleBeforeInput(e)}
                    on:paste={handlePaste}
                  ></div>

                  <MentionDropdown
                    show={mentionState.showMentionSuggestions}
                    suggestions={mentionState.mentionSuggestions}
                    selectedIndex={mentionState.selectedMentionIndex}
                    searching={mentionState.mentionSearching}
                    query={mentionState.mentionQuery}
                    on:select={(e) => mentionCtrl.insertMention(e.detail)}
                  />
                </div>
              </div>

              {#if !showPreview && attachOffers.length > 0}
                <!-- Pasted-link offers, under the text field and above the
                     attachments strip: one accent pill per bare-URL
                     occurrence, offered (never auto-converted). The URL is
                     not repeated — it is right above, in the text. The ✕ is
                     the quiet refusal ("Keep it as text"); the accent
                     belongs to the offer, not to its refusal. -->
                <div class="attach-offers" data-testid="attach-offers" role="group" aria-label="Attach pasted links">
                  {#each attachOffers as url, i (i)}
                    <div class="attach-offer-row">
                      <button
                        type="button"
                        class="attach-offer"
                        on:click={() => acceptAttachOffer(url)}
                        disabled={posting}
                      >
                        <PlusIcon size={14} weight="bold" />
                        <span>Attach this media</span>
                      </button>
                      <button
                        type="button"
                        class="attach-x"
                        title="Keep it as text"
                        aria-label="Keep it as text"
                        on:click={() => dismissAttachOffer(url)}
                        disabled={posting}
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

              <!-- Preview pane — matches Write pane padding/font so toggling feels seamless -->
              {#if showPreview}
                <div class={`composer-input overflow-y-auto p-2 ${variant === 'modal' ? 'min-h-[200px] max-h-[45vh]' : 'min-h-[120px] sm:min-h-[100px] max-h-[40vh]'}`} style="color: var(--color-text-primary);">
                  {#if previewContent.trim()}
                    <NoteContent content={previewContent} collapsible={false} showLinkPreviews={true} />
                  {:else}
                    <p class="text-caption italic">Nothing to preview yet — start writing in the Write tab.</p>
                  {/if}
                </div>
              {/if}

              {#if !showPreview}
                <!-- Hashtag suggestion pills. Tap to add the tag to the body,
                     tap again to remove it. Nothing is added automatically. -->
                <div class="tag-pills" data-testid="tag-suggestions">
                  <div class="tag-pills-row" role="group" aria-label="Suggested hashtags">
                    {#each SUGGESTED_HASHTAGS as tag (tag)}
                      {@const selected = isHashtagSelected(content, tag)}
                      {@const blocked = !selected && tagsAtCap}
                      <button
                        type="button"
                        class="tag-pill"
                        class:selected
                        aria-pressed={selected}
                        disabled={blocked}
                        title={blocked ? `${MAX_HASHTAGS} tags is the limit for the food feed` : selected ? `Remove #${tag}` : `Add #${tag}`}
                        on:click={() => handlePillTap(tag)}
                      >#{tag}</button>
                    {/each}
                  </div>
                  <span class="tag-pills-count" class:over={tagsOverCap} aria-live="polite">
                    {tagCount}/{MAX_HASHTAGS} tags{#if tagsOverCap} · over the food feed limit{/if}
                  </span>
                </div>
              {/if}

              {#if error}
                <p class="text-red-500 text-xs mb-2">{error}</p>
              {/if}

              {#if !showPreview && quotedNote}
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

              {#if !showPreview && media.length > 0}
                <!-- One ordered strip of attachment slots. Drag to reorder
                     (pointer); the arrow steppers beneath each cell cover
                     touch and keyboard, which HTML5 drag never reaches. -->
                <div class="mb-2 flex flex-wrap gap-2" role="list" data-testid="composer-media-strip">
                  {#each media as m, index}
                    <div
                      class="relative group media-thumb"
                      role="listitem"
                      aria-label={m.isVideo ? 'Video attachment' : m.alt?.trim() || 'Image attachment'}
                      class:media-thumb--dragging={dragIndex === index}
                      class:media-thumb--drop-target={dropIndex === index}
                      class:media-thumb--grabbable={media.length > 1 && !posting}
                      draggable={media.length > 1 && !posting}
                      on:dragstart={(e) => handleThumbDragStart(e, index)}
                      on:dragover={(e) => handleThumbDragOver(e, index)}
                      on:dragleave={() => { if (dropIndex === index) dropIndex = null; }}
                      on:drop={(e) => handleThumbDrop(e, index)}
                      on:dragend={handleThumbDragEnd}
                    >
                      {#if m.isVideo}
                        <video
                          src={m.url}
                          draggable="false"
                          class="composer-img-preview object-cover rounded-lg"
                          style="border: 1px solid var(--color-input-border)"
                          preload="metadata"
                          muted
                        ></video>
                      {:else if thumbFailed[m.url]}
                        <div
                          class="composer-img-preview thumb-failed rounded-lg"
                          style="border: 1px solid var(--color-input-border)"
                          role="img"
                          aria-label="Preview unavailable — the image will still be attached"
                        >
                          <span>Preview unavailable</span>
                        </div>
                      {:else}
                        <img
                          src={thumbSrc(m.url)}
                          draggable="false"
                          alt={m.alt?.trim() || 'Upload preview'}
                          class="composer-img-preview object-cover rounded-lg"
                          style="border: 1px solid var(--color-input-border)"
                          on:error={() => handleThumbError(m.url)}
                        />
                      {/if}
                      <button
                        type="button"
                        on:click={() => removeMedia(index)}
                        class="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 shadow-lg transition-all opacity-90 hover:opacity-100"
                        disabled={posting}
                        aria-label={m.isVideo ? 'Remove video' : 'Remove image'}
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
                      {#if !m.isVideo}
                        <button
                          type="button"
                          class="alt-toggle"
                          class:has-alt={!!m.alt?.trim()}
                          on:click={() => openAltEditor(m.url)}
                          title={m.alt?.trim() ? 'Edit the image description' : 'Add a description'}
                          aria-label={m.alt?.trim()
                            ? 'Edit alt text'
                            : 'Add alt text'}
                          disabled={posting}
                        >
                          {m.alt?.trim() ? '✓ ALT' : '+ ALT'}
                        </button>
                      {/if}
                      {#if media.length > 1}
                        <!-- The first and last cells omit the arrow that would
                             do nothing rather than showing a disabled one. -->
                        <div class="thumb-steppers">
                          {#if index > 0}
                            <button
                              type="button"
                              on:click={() => moveMedia(index, index - 1)}
                              title="Move earlier"
                              aria-label="Move attachment earlier"
                              disabled={posting}
                            >
                              <CaretLeftIcon size={14} />
                            </button>
                          {/if}
                          {#if index < media.length - 1}
                            <button
                              type="button"
                              on:click={() => moveMedia(index, index + 1)}
                              title="Move later"
                              aria-label="Move attachment later"
                              disabled={posting}
                            >
                              <CaretRightIcon size={14} />
                            </button>
                          {/if}
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}

              {#if pollConfig || zapPollConfig}
                <div class="mb-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800">
                  <ChartBarHorizontalIcon size={14} class="text-orange-600 dark:text-orange-400" />
                  <span class="text-xs font-medium text-orange-700 dark:text-orange-300">
                    {#if zapPollConfig}
                      Zap Poll: {zapPollConfig.options.length} options (min {zapPollConfig.valueMinimum} sats)
                    {:else if pollConfig}
                      Poll: {pollConfig.options.length} options
                    {/if}
                  </span>
                  <button
                    type="button"
                    on:click={() => { pollConfig = null; zapPollConfig = null; }}
                    class="ml-auto text-orange-500 hover:text-orange-700 p-0.5"
                    aria-label="Remove poll"
                  >
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              {/if}

            </div>
          </div>
        </div>

        <!-- Action bar — pinned at bottom in modal, inline otherwise -->
        <div class="composer-footer {variant === 'modal' ? 'px-3 pb-3' : ''}">
          {#if uploadingImage}
            <div class="w-full h-1 rounded-full bg-input-border overflow-hidden -mt-1 mb-1">
              {#if uploadImageTotal > 1}
                <div
                  class="h-full rounded-full bg-orange-500 transition-all duration-500"
                  style="width: {(uploadImageIndex / uploadImageTotal) * 100}%"
                ></div>
              {:else}
                <div class="h-full rounded-full bg-orange-500 upload-sweep"></div>
              {/if}
            </div>
          {/if}

          <!-- Pinned accounting line for attachments, visible even when the
               thumbnail strip has scrolled out of view. Read-only: order
               changes belong to the thumbnails. -->
          {#if media.length > 0}
            <MediaDrawer media={media} />
          {/if}

          <!-- Row 1: tools + status -->
          <div class="composer-tools-row">
            <div class="flex items-center gap-1">
              <!-- Media upload -->
              <div class="media-menu" use:clickOutside on:click_outside={() => (showMediaMenu = false)}>
                <button
                  type="button"
                  class="tool-btn"
                  class:opacity-50={posting || uploadingImage || uploadingVideo || showCountdown}
                  disabled={posting || uploadingImage || uploadingVideo || showCountdown}
                  aria-haspopup="menu"
                  aria-expanded={showMediaMenu}
                  aria-label="Upload photo or video"
                  title="Upload photo or video"
                  on:click={() => (showMediaMenu = !showMediaMenu)}
                >
                  <ImageIcon size={20} class="text-caption" />
                </button>
                {#if showMediaMenu}
                  <div class="media-menu-panel" role="menu">
                    <button type="button" class="media-menu-item" role="menuitem" on:click={openImagePicker}>
                      <ImageIcon size={16} /><span>Photo</span>
                    </button>
                    <button type="button" class="media-menu-item" role="menuitem" on:click={openVideoPicker}>
                      <VideoIcon size={16} /><span>Video</span>
                    </button>
                  </div>
                {/if}
                <input bind:this={imageInputEl} type="file" accept="image/*" multiple class="sr-only" on:change={handleImageUpload} disabled={posting || uploadingImage || uploadingVideo} />
                <input bind:this={videoInputEl} type="file" accept="video/*" class="sr-only" on:change={handleVideoUpload} disabled={posting || uploadingImage || uploadingVideo} />
              </div>

              <button on:click={() => (showGifPicker = true)} class="tool-btn" class:opacity-50={posting || showCountdown} disabled={posting || showCountdown} title="Add GIF">
                <GifIcon size={20} class="text-caption" />
              </button>

              <button on:click={() => (showPollCreator = true)} class="tool-btn" class:opacity-50={posting || showCountdown} disabled={posting || showCountdown} title="Create poll">
                <ChartBarHorizontalIcon size={20} class={pollConfig || zapPollConfig ? 'text-primary' : 'text-caption'} />
              </button>
            </div>

            <!-- Right: status indicators -->
            <div class="flex items-center gap-2 text-xs text-caption">
              {#if uploadingImage}
                <span class="flex items-center gap-1">
                  <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  {uploadImageTotal > 1 ? `Uploading image ${uploadImageIndex} of ${uploadImageTotal}…` : 'Uploading image…'}
                </span>
              {:else if uploadingVideo}
                <span>Uploading video…</span>
              {:else if showCountdown}
                <span>Sending in {countdownDisplayNum}s…</span>
              {:else if draftSaved && !posting && !success}
                <span class="flex items-center gap-0.5">
                  <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
                  Saved
                </span>
              {/if}
              {#if $publishQueueState.pending > 0}
                <span class="text-amber-600 flex items-center gap-1">
                  <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  {$publishQueueState.pending} pending
                </span>
                <button on:click={clearPendingQueue} class="text-red-500 hover:text-red-600 underline">clear</button>
              {/if}

              <!-- Clock settings always in tools row -->
              <div class="countdown-settings-wrap" use:clickOutside on:click_outside={() => (showCountdownSettings = false)}>
                <button
                  class="countdown-clock-btn"
                  class:active={showCountdownSettings}
                  aria-label="Send countdown settings"
                  on:click|stopPropagation={() => (showCountdownSettings = !showCountdownSettings)}
                >
                  <ClockIcon size={20} />
                </button>
                {#if showCountdownSettings}
                  <div class="countdown-settings-popover">
                    <div class="countdown-settings-row">
                      <span class="countdown-settings-label">Send countdown</span>
                      <button
                        class="countdown-toggle"
                        class:active={$timerSettings.postCountdownEnabled}
                        on:click={() => { const s = get(timerSettings); saveTimerSettings({ ...s, postCountdownEnabled: !s.postCountdownEnabled }); }}
                        aria-label="Toggle send countdown"
                      >
                        <span class="countdown-toggle-thumb"></span>
                      </button>
                    </div>
                    {#if $timerSettings.postCountdownEnabled}
                      <div class="countdown-secs-row">
                        {#each [5, 10, 15, 30] as secs}
                          <button
                            class="countdown-secs-btn"
                            class:active={$timerSettings.postCountdownSecs === secs}
                            on:click={() => { const s = get(timerSettings); saveTimerSettings({ ...s, postCountdownSecs: secs }); }}
                          >{secs}s</button>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            </div>
          </div>

          <!-- Row 2: cancel + post — same layout in both states -->
          <div class="composer-action-row">
            <!-- Cancel / X — same pill in both states -->
            {#if showCountdown}
              <button class="action-cancel action-cancel--countdown" on:click={cancelCountdown} disabled={posting}>
                Cancel
              </button>
            {:else}
              <button class="action-cancel" on:click={closeComposer} disabled={posting}>
                Cancel
              </button>
            {/if}

            <!-- Post button — same size/shape in both states -->
            {#if showCountdown}
              <button
                class="action-post action-post--countdown"
                style="--fill: {(1 - countdownFraction) * 100}%"
                on:click={postNow}
                disabled={posting}
              >
                <span class="action-post-fill" aria-hidden="true"></span>
                <span class="action-post-label">{posting ? 'Posting…' : `Post Now (${countdownDisplayNum}s)`}</span>
              </button>
            {:else}
              <button
                class="action-post action-post--solid"
                on:click={handlePostClick}
                disabled={posting || uploadingImage || uploadingVideo ||
                  (!content.trim() && media.length === 0 && !quotedNote && !pollConfig && !zapPollConfig)}
              >
                {posting ? 'Posting…' : 'Post'}
              </button>
            {/if}

          </div>

          {#if variant === 'inline' && (activeTab === 'members' || selectedRelay === 'pantry')}
            <p class="pt-1 text-[11px] text-caption"><span class="mr-1">🏪</span>Posting to the Pantry — if you're seeing this, you're early.</p>
          {/if}
        </div>
      </div>
    {/if}


  </div>
{/if}

{#if isMinimized && variant === 'inline'}
  <!-- Desktop-only minimized draft drawer. Docks flush to the bottom edge on
       the left, clear of the bottom-right FAB and the bottom nav. -->
  <div
    class="hidden md:block fixed z-50"
    style="bottom: calc(var(--bottom-nav-height, 0px) + env(safe-area-inset-bottom, 0px)); right: calc(1.25rem + 56px + 0.75rem);"
  >
    <div
      class="flex items-center gap-2 pl-3 pr-2 py-2.5 rounded-t-xl cursor-pointer"
      style="background: var(--color-input-bg); border: 1px solid var(--color-input-border); border-bottom: none; box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.35);"
      on:click={restoreFromMinimized}
      on:keydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          restoreFromMinimized();
        }
      }}
      role="button"
      tabindex="0"
      aria-label="Restore draft"
    >
      <PencilSimpleIcon size={14} class="text-caption flex-shrink-0" />
      <span class="text-sm truncate max-w-[200px]" style="color: var(--color-text-primary)">
        {minimizedLabel}
      </span>
      <button
        type="button"
        on:click|stopPropagation={discardAndFullyClose}
        class="ml-1 p-0.5 text-caption hover:text-primary flex-shrink-0"
        aria-label="Discard draft"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  </div>
{/if}

<GifPicker
  bind:open={showGifPicker}
  on:select={(e) => {
    media = [...media, { url: e.detail.url, isVideo: false }];
  }}
/>

<PollCreator
  bind:open={showPollCreator}
  on:create={(e) => {
    pollConfig = e.detail;
    zapPollConfig = null;
  }}
  on:createZapPoll={(e) => {
    zapPollConfig = e.detail;
    pollConfig = null;
  }}
/>

{#if altModalUrl}
  <AltTextEditorModal
    url={altModalUrl}
    initialText={altModalInitial}
    bind:open={altModalOpen}
    on:save={saveAltEditor}
  />
{/if}

<style>
  .composer-input {
    white-space: pre-wrap;
    word-break: break-word;
    /* 16px on mobile avoids iOS focus-zoom; slightly smaller on desktop reads better */
    font-size: 16px;
  }

  /* Suppress the global branded focus-visible outline on the writing area —
     the blinking caret already signals focus, and the box reads as an
     unwanted border around the field. */
  .composer-input:focus,
  .composer-input:focus-visible {
    outline: none;
  }

  @media (min-width: 768px) {
    .composer-input {
      font-size: 15px;
    }
  }

  /* Scrollable content area for modal variant */
  .composer-scroll-area {
    scrollbar-width: thin;
    scrollbar-color: var(--color-input-border) transparent;
  }

  .composer-scroll-area::-webkit-scrollbar {
    width: 6px;
  }

  .composer-scroll-area::-webkit-scrollbar-track {
    background: transparent;
  }

  .composer-scroll-area::-webkit-scrollbar-thumb {
    background: var(--color-input-border);
    border-radius: 3px;
  }

  /* Constrain image preview size so they don't dominate the scroll area */
  .composer-img-preview {
    width: 5rem;
    height: 5rem;
    max-height: 200px;
  }

  /* ALT badge on the upload thumbnail (top-left). */
  .alt-toggle {
    position: absolute;
    top: 0.375rem;
    left: 0.375rem;
    padding: 2px 7px;
    border: none;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    line-height: 1.4;
    cursor: pointer;
    transition: background-color 0.15s ease-out;
  }
  .alt-toggle:hover {
    background: rgba(0, 0, 0, 0.85);
  }
  .alt-toggle.has-alt {
    background: var(--color-primary, #f97316);
  }

  /* Attachment thumbnails: cells size to the 5rem preview; the steppers row
     beneath stays narrower than the cell so it never widens it. */
  .media-thumb {
    width: 5rem;
  }

  .media-thumb--dragging {
    opacity: 0.45;
  }

  .media-thumb--grabbable {
    cursor: grab;
  }

  .media-thumb--grabbable:active {
    cursor: grabbing;
  }

  .media-thumb--drop-target {
    outline: 2px dashed var(--color-primary, #f97316);
    outline-offset: 2px;
    border-radius: 0.5rem;
  }

  .thumb-steppers {
    display: flex;
    justify-content: center;
    gap: 0.125rem;
    margin-top: 0.125rem;
  }

  .thumb-steppers button {
    display: flex;
    padding: 0.125rem;
    border-radius: 0.375rem;
    color: var(--color-caption);
    cursor: pointer;
  }

  .thumb-steppers button:hover:not(:disabled) {
    background: var(--color-accent-gray);
    color: var(--color-text-primary);
  }

  /* Failed thumbnail after retries: the URL stays in the draft and will be
     appended at publish — the cell says so rather than going silently blank. */
  .thumb-failed {
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 0.25rem;
    background: var(--color-accent-gray);
    font-size: 0.5625rem;
    line-height: 1.2;
    color: var(--color-caption);
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

  .media-menu {
    position: relative;
    display: inline-flex;
  }

  .media-menu-panel {
    position: absolute;
    bottom: calc(100% + 0.375rem);
    left: 0;
    z-index: 45;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    border-radius: 0.6rem;
    min-width: 140px;
    padding: 0.3rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    box-shadow: 0 8px 20px rgba(15, 23, 42, 0.2);
  }

  .media-menu-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    border-radius: 0.4rem;
    color: var(--color-text-primary);
    font-size: 0.8125rem;
    font-weight: 500;
    text-align: left;
    transition: background 0.15s ease;
  }

  .media-menu-item:hover {
    background: var(--color-accent-gray);
  }

  /* ── Paste-to-attach offers ─────────────────────────────────── */
  .attach-offers {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin: 0.25rem 0 0.5rem;
  }

  .attach-offer-row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  /* The offer wears the accent — primary text on a primary hairline with a
     faint tint — because an offer the user never notices is not an offer. */
  .attach-offer {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.3rem 0.875rem;
    border-radius: 9999px;
    border: 1px solid var(--color-primary, #f97316);
    color: var(--color-primary, #f97316);
    background: color-mix(in srgb, var(--color-primary, #f97316) 10%, transparent);
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.15s;
  }

  .attach-offer:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-primary, #f97316) 18%, transparent);
  }

  .attach-offer:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* The refusal is quiet on purpose, and does not shrink the offer to fit:
     the row has room for both, and the pill keeps its label whole. */
  .attach-x {
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    border: none;
    background: none;
    color: var(--color-caption);
    cursor: pointer;
  }

  .attach-x:hover:not(:disabled) {
    color: var(--color-text-primary);
    background: var(--color-accent-gray);
  }

  /* ── Post button group ──────────────────────────────────────── */
  .countdown-clock-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 9999px;
    color: var(--color-text-secondary);
    transition: color 0.15s, background 0.15s;
  }

  .countdown-clock-btn:hover,
  .countdown-clock-btn.active {
    color: var(--color-text-primary);
    background: var(--color-accent-gray);
  }

  .countdown-settings-wrap {
    position: relative;
  }

  .countdown-settings-popover {
    position: absolute;
    bottom: calc(100% + 0.5rem);
    right: 0;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    border-radius: 0.75rem;
    padding: 0.75rem;
    min-width: 220px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .countdown-settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .countdown-settings-label {
    font-size: 0.8125rem;
    color: var(--color-text-primary);
    white-space: nowrap;
  }

  .countdown-toggle {
    position: relative;
    width: 36px;
    height: 20px;
    border-radius: 9999px;
    background: var(--color-input-border);
    transition: background 0.2s;
    flex-shrink: 0;
  }

  .countdown-toggle.active {
    background: #ef4444;
  }

  .countdown-toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 9999px;
    background: #fff;
    transition: transform 0.2s;
  }

  .countdown-toggle.active .countdown-toggle-thumb {
    transform: translateX(16px);
  }

  .countdown-secs-row {
    display: flex;
    gap: 0.25rem;
  }

  .countdown-secs-btn {
    padding: 0.2rem 0.5rem;
    border-radius: 0.375rem;
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    background: var(--color-accent-gray);
    transition: background 0.15s, color 0.15s;
  }

  .countdown-secs-btn:hover {
    color: var(--color-text-primary);
  }

  .countdown-secs-btn.active {
    background: #ef4444;
    color: #fff;
  }

  /* ── Countdown overlay ──────────────────────────────────────── */

  /* ── Posting indicator ──────────────────────────────────────── */
  .posting-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.625rem;
    flex: 1;
    min-height: 4rem;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--color-text-secondary);
  }

  .posting-spinner {
    width: 1.25rem;
    height: 1.25rem;
    animation: spin 0.8s linear infinite;
    color: var(--color-text-secondary);
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Composer footer ────────────────────────────────────────── */
  .composer-footer {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--color-input-border);
  }

  @keyframes upload-sweep {
    0% { width: 0%; margin-left: 0%; }
    50% { width: 60%; margin-left: 20%; }
    100% { width: 0%; margin-left: 100%; }
  }

  .upload-sweep {
    animation: upload-sweep 1.4s ease-in-out infinite;
  }

  .composer-tools-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .tool-btn {
    padding: 0.375rem;
    border-radius: 9999px;
    transition: background 0.15s;
  }

  .tool-btn:hover:not(:disabled) {
    background: var(--color-accent-gray);
  }

  /* Hashtag suggestion pills: one horizontal row that scrolls, never wraps.
     A partially visible pill at the right edge is the scroll affordance, so
     there is no fade or arrow. The counter sits outside the scroller. */
  .tag-pills {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.5rem 0.5rem;
    min-width: 0;
  }

  .tag-pills-row {
    display: flex;
    flex: 1 1 auto;
    flex-wrap: nowrap;
    gap: 0.375rem;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    padding-bottom: 2px; /* room for the focus ring */
    scrollbar-width: none;
    -ms-overflow-style: none;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
  }

  .tag-pills-row::-webkit-scrollbar {
    display: none;
  }

  .tag-pill {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    border: 1px solid var(--color-input-border);
    background: transparent;
    color: var(--color-caption);
    font-size: 0.75rem;
    line-height: 1.25;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background-color 140ms ease,
      border-color 140ms ease,
      color 140ms ease;
  }

  .tag-pill:hover:not(:disabled) {
    color: var(--color-text-primary);
    border-color: color-mix(in srgb, var(--color-primary) 40%, var(--color-input-border));
  }

  .tag-pill.selected {
    color: var(--color-primary);
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  }

  .tag-pill:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .tag-pills-count {
    flex-shrink: 0;
    margin-left: auto;
    font-size: 0.6875rem;
    color: var(--color-caption);
    white-space: nowrap;
  }

  .tag-pills-count.over {
    color: #ef4444;
  }

  .composer-action-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  /* Cancel — same pill shape in both states */
  .action-cancel {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 1rem;
    border-radius: 9999px;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-text-secondary);
    background: var(--color-accent-gray);
    transition: opacity 0.15s;
  }

  .action-cancel:hover:not(:disabled) { opacity: 0.8; }
  .action-cancel:disabled { opacity: 0.5; cursor: not-allowed; }

  .action-cancel--countdown {
    background: #ef4444;
    color: #fff;
  }

  /* Post — same pill shape in both states, fills remaining space */
  .action-post {
    flex: 1;
    position: relative;
    overflow: hidden;
    border-radius: 9999px;
    padding: 0.5rem 1.25rem;
    font-size: 0.9375rem;
    font-weight: 600;
    color: #fff;
    text-align: center;
    white-space: nowrap;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .action-post:disabled { opacity: 0.5; cursor: not-allowed; }

  .action-post--solid {
    background-image: linear-gradient(to right, #f97316, #f59e0b);
  }

  .action-post--solid:hover:not(:disabled) {
    background-image: linear-gradient(to right, #ea6c0a, #d97706);
  }

  .action-post--countdown {
    background: var(--color-accent-gray);
  }

  .action-post-fill {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background-image: linear-gradient(to right, #f97316, #f59e0b);
    width: var(--fill, 0%);
    pointer-events: none;
  }

  .action-post-label {
    position: relative;
  }

  /* Upsize the fullscreen mobile composer for touch — bigger text, tabs,
     tool icons, and action buttons. Scoped to the modal variant (which is
     the fullscreen mobile sheet) at phone widths only. */
  @media (max-width: 767.98px) {
    .composer-modal .composer-input {
      font-size: 18px;
      line-height: 1.55;
    }
    .composer-modal .composer-tab {
      font-size: 0.9375rem;
      padding: 0.5rem 0.875rem;
    }
    .composer-modal .tool-btn {
      padding: 0.5rem;
    }
    .composer-modal .tool-btn :global(svg),
    .composer-modal .countdown-clock-btn :global(svg) {
      width: 26px;
      height: 26px;
    }
    .composer-modal .action-cancel,
    .composer-modal .action-post {
      padding: 0.75rem 1.5rem;
      font-size: 1.0625rem;
    }
  }
</style>
