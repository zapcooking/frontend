<script lang="ts">
	/**
	 * ReplyComposer — shared contenteditable composer for Nostr comments and
	 * inline replies.
	 *
	 * Owns: contenteditable wiring, @-mention autocomplete + dropdown, image /
	 * video / GIF upload, poll creator integration, submit + cancel, calling
	 * `postComment` from $lib/comments/postComment.
	 *
	 * Does NOT own: the surrounding comment card, subscription, caller-level
	 * auth gating, reactions / likes / zaps, or deciding whether to render
	 * itself (caller controls visibility).
	 *
	 * Caller variations flow through props:
	 *   - Top-level composer (Comments/FeedComments): `parentEvent={root}`;
	 *     no replyTo. showCancel=false.
	 *   - Inline reply composer (Comment/FeedComment): `parentEvent={root}`
	 *     (passed down from container) + `replyTo={parentComment}`.
	 *     showCancel=true; compact=true.
	 */
	import { NDKEvent } from '@nostr-dev-kit/ndk';
	import { ndk, userPublickey } from '$lib/nostr';
	import { createEventDispatcher, onMount, onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import MentionDropdown from '../MentionDropdown.svelte';
	import { MentionComposerController, type MentionState } from '$lib/mentionComposer';
	import { clickOutside } from '$lib/clickOutside';
	import GifIcon from 'phosphor-svelte/lib/Gif';
	import ImageIcon from 'phosphor-svelte/lib/Image';
	import VideoIcon from 'phosphor-svelte/lib/Video';
	import ClockIcon from 'phosphor-svelte/lib/Clock';
	import PlusIcon from 'phosphor-svelte/lib/Plus';
	import CaretLeftIcon from 'phosphor-svelte/lib/CaretLeft';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRight';
	import GifPicker from '../GifPicker.svelte';
	import ChartBarHorizontalIcon from 'phosphor-svelte/lib/ChartBarHorizontal';
	import PollCreator from '../PollCreator.svelte';
	import { buildPollTags, type PollConfig } from '$lib/polls';
	import { uploadImage, uploadVideo } from '$lib/mediaUpload';
	import {
		composeNoteContent,
		imetaTagsForMedia,
		attachableUrlCandidates,
		removeBareUrlOccurrence,
		type MediaAttachment
	} from '$lib/composerMedia';
	import { isVideoUrl } from '$lib/feed/imeta';
	import { postComment as postCommentLib } from '$lib/comments/postComment';
	import AltTextEditorModal from '../AltTextEditorModal.svelte';
	import { showToast } from '$lib/toast';
	import { timerSettings, saveTimerSettings, loadTimerSettings } from '$lib/timerSettings';
	import NoteContent from '../NoteContent.svelte';
	import CustomName from '../CustomName.svelte';

	// Who this composer actually replies to: the specific comment (replyTo)
	// when set, otherwise the root/parent event. Surfaced in the UI so the
	// user can't accidentally reply to the wrong note (e.g. the thread root /
	// themselves) without noticing.
	$: replyTargetPubkey =
		(replyTo ?? parentEvent)?.author?.pubkey || (replyTo ?? parentEvent)?.pubkey || '';
	$: replyingToSelf = !!replyTargetPubkey && replyTargetPubkey === $userPublickey;

	/**
	 * Root event for NIP-22 / NIP-10 tag-building. Passed verbatim to
	 * `postComment({ parentEvent })`.
	 */
	export let parentEvent: NDKEvent;

	/**
	 * Optional parent comment for nested replies. When set, the composer is
	 * an inline reply to this comment rather than a top-level comment on
	 * `parentEvent`. Passed as `postComment({ replyTo })`.
	 */
	export let replyTo: NDKEvent | undefined = undefined;

	/** contenteditable placeholder. */
	export let placeholder = 'Write a reply...';

	/** Submit button label when idle. The pending state always reads "Posting...". */
	export let submitLabel = 'Post';

	/** Show a Cancel button next to Submit (inline-reply composers). */
	export let showCancel = false;

	/** Compact variant — smaller padding/font for inline-reply composers. */
	export let compact = false;

	/**
	 * Fired after a successful post with the published event. Used by callers
	 * that want optimistic add (`sub.addLocal(event)`) or a refresh hook.
	 */
	export let onPosted: ((event: NDKEvent) => void) | null = null;

	const dispatch = createEventDispatcher<{ cancel: void }>();

	// Composer state — local to this component.
	let composerEl: HTMLDivElement;
	let composerText = '';
	let lastRendered = '';
	let posting = false;
	let showGifPicker = false;
	let showPollCreator = false;
	let pollConfig: PollConfig | null = null;
	// Attachments are ordered slots on the draft, never text in the editor —
	// the same single-array model as the main composer ($lib/composerMedia).
	// The array order is the only ordering that exists.
	let media: MediaAttachment[] = [];
	let uploadingImage = false;
	let uploadingVideo = false;
	let uploadError = '';
	let imageInputEl: HTMLInputElement;
	let videoInputEl: HTMLInputElement;
	let showMediaMenu = false;

	// Per-image alt editor (shared modal)
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
	}

	// ── Reordering: two mechanisms, one array ─────────────────────
	// Drag and drop on the thumbnails (enabled only when there is more than
	// one), plus arrow steppers — HTML5 drag never fires on touch, so
	// without steppers a phone or a keyboard would have no reordering at
	// all. The alt editor is keyed by URL, so a reorder while it is open
	// cannot invalidate what it edits.
	let dragIndex: number | null = null;
	let dropIndex: number | null = null;

	function moveMedia(from: number | null, to: number) {
		if (from === null || from === to) return;
		if (from < 0 || to < 0 || from >= media.length || to >= media.length) return;
		const moved = media.splice(from, 1)[0];
		media.splice(to, 0, moved);
		media = media;
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
		// State drives the highlight on every cell, so clearing it here
		// clears all of them — a cancelled drag leaves no highlight.
		dragIndex = null;
		dropIndex = null;
	}

	// ── Thumbnail loading ─────────────────────────────────────────
	// A just-uploaded URL can 404 for a second or two while the host
	// finishes writing it. An <img> tries exactly once, so without a retry
	// the thumbnail is blank forever — and the URL is in the draft either
	// way. Retry a couple of times with a cache-busting query, then say the
	// cell failed.
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
	// Bare URLs alone on their line are offered, never auto-converted;
	// offers derive live from the text, so consuming or editing away an
	// occurrence retires its offer on its own. A dismissal expires when
	// its line does — a deliberate no is not a forever no (sidecar #356).
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

	$: pruneDismissedOffers(composerText);
	$: attachOffers = attachableUrlCandidates(composerText).filter(
		(url) => !dismissedOfferUrls.has(url)
	);

	function dismissAttachOffer(url: string) {
		const next = new Set(dismissedOfferUrls);
		next.add(url);
		dismissedOfferUrls = next;
	}

	function acceptAttachOffer(url: string) {
		const current = composerEl ? mentionCtrl.extractText() : composerText;
		const next = removeBareUrlOccurrence(current, url);
		if (next === current) return; // occurrence already consumed — stale offer
		composerText = next;
		if (composerEl) {
			mentionCtrl.syncContent(composerText);
			lastRendered = composerText;
		}
		// Every accepted occurrence adds a slot — attaching the same image
		// twice is allowed and the note carries its URL twice, exactly as
		// pasting it twice in the text era did. imeta stays one tag per
		// picture (deduped by URL at publish in $lib/composerMedia).
		media = [...media, { url, isVideo: isVideoUrl(url) }];
	}

	// Send countdown
	let showCountdown = false;
	let countdownStartedAt = 0;
	let countdownTotal = 0;
	let countdownFraction = 1;
	let countdownDisplayNum = 0;
	let rafHandle: number | null = null;
	let showCountdownSettings = false;

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
				handleSubmit();
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
		handleSubmit();
	}

	function handleSubmitClick() {
		const settings = get(timerSettings);
		if (settings.postCountdownEnabled && settings.postCountdownIncludesReplies) {
			startCountdown(settings.postCountdownSecs);
		} else {
			handleSubmit();
		}
	}

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
			composerText = text;
			lastRendered = text;
		}
	);

	$: mentionCtrl.setComposerEl(composerEl);

	$: if (composerEl && composerText !== lastRendered) {
		mentionCtrl.syncContent(composerText);
		lastRendered = composerText;
	}

	// Preload follow list when user is logged in (for mention autocomplete).
	$: if ($userPublickey) {
		mentionCtrl.preloadFollowList();
	}

	onMount(() => {
		loadTimerSettings();
	});

	onDestroy(() => {
		// Clears any pending mention-search timeout so it can't fire after
		// unmount and trigger state updates on a destroyed component.
		mentionCtrl.destroy();
		if (rafHandle !== null) cancelAnimationFrame(rafHandle);
		resetThumbState();
	});

	async function handleImageUpload(e: Event) {
		const target = e.target as HTMLInputElement;
		const files = target.files;
		if (!files || files.length === 0) return;
		uploadingImage = true;
		uploadError = '';
		try {
			for (const file of Array.from(files)) {
				const url = await uploadImage($ndk, file);
				media = [...media, { url, isVideo: false }];
			}
		} catch (err: unknown) {
			uploadError = (err as Error)?.message || 'Failed to upload image.';
		} finally {
			uploadingImage = false;
			if (imageInputEl) imageInputEl.value = '';
		}
	}

	async function handlePaste(e: ClipboardEvent) {
		const imageFiles = Array.from(e.clipboardData?.items ?? [])
			.filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
			.map((item) => item.getAsFile())
			.filter((f): f is File => f !== null);
		if (imageFiles.length === 0) {
			// Paste inserts text, always — bare URLs on URL-only lines
			// surface as "Attach this media" offers instead (same shared
			// rule as the main composer, never auto-converted).
			mentionCtrl.handlePaste(e);
			return;
		}
		e.preventDefault();
		uploadingImage = true;
		uploadError = '';
		try {
			const newUrls: string[] = [];
			for (const file of imageFiles) {
				newUrls.push(await uploadImage($ndk, file));
			}
			media = [...media, ...newUrls.map((url) => ({ url, isVideo: false }))];
		} catch (err: unknown) {
			uploadError = (err as Error)?.message || 'Failed to upload image.';
		} finally {
			uploadingImage = false;
		}
	}

	async function handleVideoUpload(e: Event) {
		const target = e.target as HTMLInputElement;
		const files = target.files;
		if (!files || files.length === 0) return;
		uploadingVideo = true;
		uploadError = '';
		try {
			for (const file of Array.from(files)) {
				const url = await uploadVideo($ndk, file);
				media = [...media, { url, isVideo: true }];
			}
		} catch (err: unknown) {
			uploadError = (err as Error)?.message || 'Failed to upload video.';
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
	}

	function clearState() {
		composerText = '';
		lastRendered = '';
		media = [];
		dragIndex = null;
		dropIndex = null;
		resetThumbState();
		pollConfig = null;
		uploadError = '';
		showPreview = false;
		if (composerEl) {
			composerEl.innerHTML = '';
		}
		mentionCtrl.resetMentionState();
	}

	function handleCancel() {
		clearState();
		dispatch('cancel');
	}

	async function handleSubmit() {
		if ((!composerText.trim() && media.length === 0 && !pollConfig) || posting) {
			return;
		}

		posting = true;
		// Declared outside the try so the catch can restore it; reassigned
		// below once the final text is extracted.
		let draftSnapshot: {
			text: string;
			media: MediaAttachment[];
			poll: PollConfig | null;
		} = {
			text: composerText,
			media: [...media],
			poll: pollConfig
		};
		try {
			if (composerEl) {
				composerText = mentionCtrl.extractText();
				lastRendered = composerText;
			}

			let content = mentionCtrl.replacePlainMentions(composerText.trim());
			const mediaSnapshot = [...media];
			const capturedPollConfig = pollConfig;
			// Snapshot what the member typed BEFORE clearing. The composer is
			// cleared optimistically so a successful post feels instant, but
			// the publish below can still fail — and without this the draft is
			// gone and the error toast's "please try again" has nothing to try
			// again with. Holds the pre-processing state (raw text, ordered
			// slots, poll config), not the built `content`, so a restore gives
			// back exactly what was typed rather than the mention-substituted
			// form.
			draftSnapshot = {
				text: composerText,
				media: [...media],
				poll: pollConfig
			};
			clearState();
			// Prose plus media URLs in draft order — the shared composition
			// the main composer and Preview both use.
			content = composeNoteContent(content, mediaSnapshot);

			const extraTags: string[][] = [];
			const mentions = mentionCtrl.parseMentions(content);
			for (const pubkey of mentions.values()) {
				extraTags.push(['p', pubkey]);
			}
			// NIP-92 imeta alt text per described attachment, in draft order
			// (shared builder — same wire format as the main composer). Read
			// from the snapshot — clearState() has already emptied the live
			// state by this point.
			extraTags.push(...imetaTagsForMedia(mediaSnapshot));
			if (capturedPollConfig) {
				extraTags.push(...buildPollTags(capturedPollConfig));
			}

			const { event: posted } = await postCommentLib($ndk, {
				parentEvent,
				replyTo,
				content,
				extraTags,
				contentKind: capturedPollConfig ? 1068 : undefined,
				signingStrategy: 'explicit-with-timeout'
			});

			onPosted?.(posted);
		} catch (error) {
			// Put the draft back. The optimistic clear above assumed success;
			// this is the branch where that assumption was wrong, and the
			// member should not lose what they wrote. Restoring composerText
			// while lastRendered is still '' (clearState reset both) is what
			// re-renders the contenteditable, via the reactive syncContent
			// block above.
			composerText = draftSnapshot.text;
			media = draftSnapshot.media;
			pollConfig = draftSnapshot.poll;
			// Technical details to console; human-friendly message to the user.
			console.error('[ReplyComposer] post failed:', error);
			showToast('error', "Couldn't post comment — please try again.");
		} finally {
			posting = false;
		}
	}

	let showPreview = false;

	$: previewContent = composeNoteContent(
		mentionCtrl.replacePlainMentions(composerText),
		media
	);

	$: isDisabled =
		(!composerText.trim() && media.length === 0 && !pollConfig) ||
		posting ||
		uploadingImage ||
		uploadingVideo;
</script>

<div class="reply-composer" class:reply-composer--compact={compact}>
	{#if replyTargetPubkey}
		<div class="rc-replying-to">
			<span class="rc-replying-to-label">Replying to</span>
			{#if replyingToSelf}
				<span>your own post</span>
			{:else}
				<CustomName pubkey={replyTargetPubkey} interactive={false} />
			{/if}
		</div>
	{/if}

	<!-- Write / Preview tab bar -->
	<div class="rc-tab-bar">
		<button
			type="button"
			class="rc-tab"
			class:rc-tab--active={!showPreview}
			on:click={() => (showPreview = false)}
		>Write</button>
		<button
			type="button"
			class="rc-tab"
			class:rc-tab--active={showPreview}
			on:click={() => (showPreview = true)}
		>Preview</button>
	</div>

	<!-- Write pane — kept in DOM so contenteditable state is preserved -->
	<div class:hidden={showPreview}>
		<div class="relative">
			<div
				bind:this={composerEl}
				class="reply-composer-input"
				contenteditable={!posting}
				role="textbox"
				tabindex="0"
				aria-multiline="true"
				aria-label={placeholder}
				data-placeholder={placeholder}
				on:input={() => mentionCtrl.handleInput()}
				on:keydown={(e) => mentionCtrl.handleKeydown(e)}
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
		<!-- Pasted-link offers, one accent pill per bare-URL occurrence —
			offered, never auto-converted (shared rule with the main
			composer). The URL is not repeated; the ✕ keeps it as text. -->
		<div class="rc-attach-offers" role="group" aria-label="Attach pasted links">
			{#each attachOffers as url, i (i)}
				<div class="rc-attach-offer-row">
					<button
						type="button"
						class="rc-attach-offer"
						on:click={() => acceptAttachOffer(url)}
						disabled={posting}
					>
						<PlusIcon size={14} weight="bold" />
						<span>Attach this media</span>
					</button>
					<button
						type="button"
						class="rc-attach-x"
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

	<!-- Preview pane -->
	{#if showPreview}
		<div class="reply-composer-input reply-composer-preview">
			{#if previewContent.trim()}
				<NoteContent content={previewContent} collapsible={false} showLinkPreviews={true} />
			{:else}
				<p class="text-caption italic text-sm">Nothing to preview yet.</p>
			{/if}
		</div>
	{/if}


	{#if uploadError}
		<p class="text-red-500 text-xs">{uploadError}</p>
	{/if}

	{#if media.length > 0}
		<!-- One ordered strip of attachment slots — same strip as the main
			composer: drag to reorder (pointer), arrow steppers beneath each
			cell (touch and keyboard both reach buttons). -->
		<div class="flex flex-wrap gap-2" role="list" data-testid="reply-media-strip">
			{#each media as m, index}
				<div
					class="relative group rc-media-thumb"
					role="listitem"
					aria-label={m.isVideo ? 'Video attachment' : m.alt?.trim() || 'Image attachment'}
					class:rc-media-thumb--dragging={dragIndex === index}
					class:rc-media-thumb--drop-target={dropIndex === index}
					class:rc-media-thumb--grabbable={media.length > 1 && !posting}
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
							class="w-16 h-16 object-cover rounded-lg"
							class:w-20={!compact}
							class:h-20={!compact}
							style="border: 1px solid var(--color-input-border)"
							preload="metadata"
							muted
						></video>
					{:else if thumbFailed[m.url]}
						<div
							class="w-16 h-16 rc-thumb-failed rounded-lg"
							class:w-20={!compact}
							class:h-20={!compact}
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
							class="w-16 h-16 object-cover rounded-lg"
							class:w-20={!compact}
							class:h-20={!compact}
							style="border: 1px solid var(--color-input-border)"
							on:error={() => handleThumbError(m.url)}
						/>
					{/if}
					<button
						type="button"
						on:click={() => removeMedia(index)}
						class="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-0.5 shadow-lg"
						class:p-1={!compact}
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
							class="rc-alt-toggle"
							class:has-alt={!!m.alt?.trim()}
							on:click={() => openAltEditor(m.url)}
							title={m.alt?.trim() ? 'Edit the image description' : 'Add a description'}
							aria-label={m.alt?.trim() ? 'Edit alt text' : 'Add alt text'}
						>
							{m.alt?.trim() ? '✓ ALT' : '+ ALT'}
						</button>
					{/if}
					{#if media.length > 1}
						<!-- The first and last cells omit the arrow that would do
							nothing rather than showing a disabled one. -->
						<div class="rc-thumb-steppers">
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

	<div class="rc-toolbar">
		<!-- Row 1: tools -->
		<div class="rc-tools-row">
			<div class="flex items-center gap-1">
				<div
					class="media-menu"
					use:clickOutside
					on:click_outside={() => (showMediaMenu = false)}
				>
					<button
						type="button"
						class="btn-media"
						class:opacity-50={uploadingImage || uploadingVideo || posting || showCountdown}
						title="Upload photo or video"
						aria-label="Upload photo or video"
						aria-haspopup="menu"
						aria-expanded={showMediaMenu}
						disabled={posting || uploadingImage || uploadingVideo || showCountdown}
						on:click={() => (showMediaMenu = !showMediaMenu)}
					>
						<ImageIcon size={20} />
					</button>
					{#if showMediaMenu}
						<div class="media-menu-panel" role="menu">
							<button
								type="button"
								class="media-menu-item"
								role="menuitem"
								on:click={openImagePicker}
							>
								<ImageIcon size={16} />
								<span>Photo</span>
							</button>
							<button
								type="button"
								class="media-menu-item"
								role="menuitem"
								on:click={openVideoPicker}
							>
								<VideoIcon size={16} />
								<span>Video</span>
							</button>
						</div>
					{/if}
					<input
						bind:this={imageInputEl}
						type="file"
						accept="image/*"
						class="sr-only"
						on:change={handleImageUpload}
						disabled={posting || uploadingImage || uploadingVideo}
					/>
					<input
						bind:this={videoInputEl}
						type="file"
						accept="video/*"
						class="sr-only"
						on:change={handleVideoUpload}
						disabled={posting || uploadingImage || uploadingVideo}
					/>
				</div>
				<button
					type="button"
					on:click={() => (showGifPicker = true)}
					class="btn-gif"
					title="Add GIF"
					aria-label="Add GIF"
					disabled={posting || uploadingImage || uploadingVideo || showCountdown}
					class:opacity-50={uploadingImage || uploadingVideo || showCountdown}
				>
					<GifIcon size={20} />
				</button>
				<button
					type="button"
					on:click={() => (showPollCreator = true)}
					class="btn-gif"
					title="Create poll"
					aria-label="Create poll"
					disabled={posting || uploadingImage || uploadingVideo || showCountdown}
					class:opacity-50={posting || uploadingImage || uploadingVideo || showCountdown}
				>
					<ChartBarHorizontalIcon size={20} class={pollConfig ? 'text-primary' : ''} />
				</button>
			</div>

			<!-- Right: status + clock settings -->
			<div class="flex items-center gap-2">
				{#if uploadingImage}
					<span class="text-xs text-caption">Uploading image…</span>
				{:else if uploadingVideo}
					<span class="text-xs text-caption">Uploading video…</span>
				{:else if showCountdown}
					<span class="text-xs text-caption">Sending in {countdownDisplayNum}s…</span>
				{/if}
				{#if pollConfig}
					<span class="text-xs text-orange-600 flex items-center gap-1">
						<ChartBarHorizontalIcon size={12} />
						Poll ({pollConfig.options.length})
						<button type="button" on:click={() => (pollConfig = null)} class="hover:text-orange-800">×</button>
					</span>
				{/if}

				<div class="countdown-settings-wrap" use:clickOutside on:click_outside={() => (showCountdownSettings = false)}>
					<button
						class="countdown-clock-btn"
						class:active={showCountdownSettings || ($timerSettings.postCountdownEnabled && $timerSettings.postCountdownIncludesReplies)}
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
								<div class="countdown-settings-row">
									<span class="countdown-settings-label">Include replies</span>
									<button
										class="countdown-toggle"
										class:active={$timerSettings.postCountdownIncludesReplies}
										on:click={() => { const s = get(timerSettings); saveTimerSettings({ ...s, postCountdownIncludesReplies: !s.postCountdownIncludesReplies }); }}
										aria-label="Toggle countdown for replies"
									>
										<span class="countdown-toggle-thumb"></span>
									</button>
								</div>
								{#if $timerSettings.postCountdownIncludesReplies}
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
							{/if}
						</div>
					{/if}
				</div>
			</div>
		</div>

		<!-- Row 2: cancel + submit -->
		<div class="rc-action-row">
			{#if showCountdown}
				<button class="rc-cancel rc-cancel--countdown" on:click={cancelCountdown} disabled={posting}>
					Cancel
				</button>
				<button
					class="rc-post rc-post--countdown"
					style="--fill: {(1 - countdownFraction) * 100}%"
					on:click={postNow}
					disabled={posting}
				>
					<span class="rc-post-fill" aria-hidden="true"></span>
					<span class="rc-post-label">{`${submitLabel} (${countdownDisplayNum}s)`}</span>
				</button>
			{:else}
				{#if showCancel}
					<button type="button" class="rc-cancel" on:click={handleCancel}>Cancel</button>
				{/if}
				<slot name="submit" submit={handleSubmitClick} disabled={isDisabled} {posting}>
					<!-- Default submit button: callers can override via `slot="submit"`. -->
					<button type="button" class="rc-post rc-post--solid" on:click={handleSubmitClick} disabled={isDisabled}>
						{posting ? 'Posting...' : submitLabel}
					</button>
				</slot>
			{/if}
		</div>
	</div>
</div>

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
	}}
/>

	<AltTextEditorModal
		url={altModalUrl}
		initialText={altModalInitial}
		bind:open={altModalOpen}
		on:save={saveAltEditor}
	/>

<style>
	.reply-composer {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	/* Makes the reply target explicit so you can't accidentally answer the
	   wrong note (e.g. the thread root / yourself). */
	.rc-replying-to {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-primary);
	}
	.rc-replying-to-label {
		color: var(--color-caption);
		font-weight: 400;
	}

	.reply-composer--compact {
		margin-top: 0.5rem;
	}

	.reply-composer-input {
		width: 100%;
		padding: 0.75rem 1rem;
		font-size: 1.0625rem;
		min-height: 72px;
		border-radius: 0.5rem;
		background: var(--color-input-bg);
		border: 1px solid var(--color-input-border);
		color: var(--color-text-primary);
		white-space: pre-wrap;
		word-break: break-word;
	}

	.reply-composer--compact .reply-composer-input {
		padding: 0.375rem 0.5rem;
		font-size: 0.875rem;
		min-height: 0;
	}

	.reply-composer-input:focus {
		outline: none;
		box-shadow: 0 0 0 2px var(--color-primary);
	}

	.reply-composer-input:empty:before {
		content: attr(data-placeholder);
		color: var(--color-caption);
		pointer-events: none;
	}

	.rc-toolbar {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.rc-tools-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.rc-action-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	/* Cancel pill — same shape in both states */
	.rc-cancel {
		flex-shrink: 0;
		padding: 0.5rem 0.875rem;
		border-radius: 9999px;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		background: var(--color-accent-gray);
		transition: opacity 0.15s;
	}

	.rc-cancel:hover:not(:disabled) { opacity: 0.8; }
	.rc-cancel:disabled { opacity: 0.5; cursor: not-allowed; }

	.rc-cancel--countdown {
		background: #ef4444;
		color: #fff;
	}

	/* Post pill — fills remaining space, same shape in both states */
	.rc-post {
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

	.reply-composer--compact .rc-post {
		padding: 0.375rem 1rem;
		font-size: 0.875rem;
	}

	.rc-post:disabled { opacity: 0.5; cursor: not-allowed; }

	.rc-post--solid {
		background-image: linear-gradient(to right, #f97316, #f59e0b);
	}

	.rc-post--solid:hover:not(:disabled) {
		background-image: linear-gradient(to right, #ea6c0a, #d97706);
	}

	.rc-post--countdown {
		background: var(--color-accent-gray);
	}

	.rc-post-fill {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background-image: linear-gradient(to right, #f97316, #f59e0b);
		width: var(--fill, 0%);
		pointer-events: none;
	}

	.rc-post-label {
		position: relative;
	}

	/* Clock settings popover */
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

	/* Write / Preview tabs */
	.rc-tab-bar {
		display: flex;
		border-bottom: 1px solid var(--color-input-border);
		margin-bottom: 0.25rem;
	}

	.rc-tab {
		padding: 0.25rem 0.75rem;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-caption);
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		transition: color 0.15s, border-color 0.15s;
	}

	.rc-tab--active {
		color: var(--color-primary);
		border-bottom-color: var(--color-primary);
	}

	.reply-composer-preview {
		overflow-y: auto;
	}

	.btn-gif,
	.btn-media {
		padding: 0.375rem;
		color: var(--color-caption);
		border-radius: 0.375rem;
		display: flex;
		align-items: center;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.btn-gif:hover,
	.btn-media:hover {
		opacity: 0.7;
	}

	.btn-gif:disabled,
	.btn-media:disabled {
		opacity: 0.4;
		cursor: not-allowed;
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

	/* ALT badge — same shape and size as the main composer's. */
	.rc-alt-toggle {
		position: absolute;
		top: 0.25rem;
		left: 0.25rem;
		z-index: 5;
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
	.rc-alt-toggle:hover {
		background: rgba(0, 0, 0, 0.85);
	}
	.rc-alt-toggle.has-alt {
		background: var(--color-primary, #f97316);
	}

	/* Attachment thumbnails: one ordered strip, same mechanics as the main
	   composer — drag for pointer, steppers beneath for touch and keyboard. */
	.rc-media-thumb--dragging {
		opacity: 0.45;
	}

	.rc-media-thumb--grabbable {
		cursor: grab;
	}

	.rc-media-thumb--grabbable:active {
		cursor: grabbing;
	}

	.rc-media-thumb--drop-target {
		outline: 2px dashed var(--color-primary, #f97316);
		outline-offset: 2px;
		border-radius: 0.5rem;
	}

	/* Failed thumbnail after retries: the URL stays in the reply and will be
	   appended at publish — the cell says so rather than going silently blank. */
	.rc-thumb-failed {
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

	.rc-thumb-steppers {
		display: flex;
		justify-content: center;
		gap: 0.125rem;
		margin-top: 0.125rem;
	}

	.rc-thumb-steppers button {
		display: flex;
		padding: 0.125rem;
		border-radius: 0.375rem;
		color: var(--color-caption);
		cursor: pointer;
	}

	.rc-thumb-steppers button:hover:not(:disabled) {
		background: var(--color-accent-gray);
		color: var(--color-text-primary);
	}

	/* ── Paste-to-attach offers ─────────────────────────────────── */
	.rc-attach-offers {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.rc-attach-offer-row {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	/* The offer wears the accent — an offer the user never notices is not
		an offer (sidecar's rule, in zap's tokens). */
	.rc-attach-offer {
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

	.rc-attach-offer:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-primary, #f97316) 18%, transparent);
	}

	.rc-attach-offer:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* The refusal is quiet on purpose; it never shrinks the offer. */
	.rc-attach-x {
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

	.rc-attach-x:hover:not(:disabled) {
		color: var(--color-text-primary);
		background: var(--color-accent-gray);
	}


</style>
