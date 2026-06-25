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
	import GifPicker from '../GifPicker.svelte';
	import ChartBarHorizontalIcon from 'phosphor-svelte/lib/ChartBarHorizontal';
	import PollCreator from '../PollCreator.svelte';
	import { buildPollTags, type PollConfig } from '$lib/polls';
	import { uploadImage, uploadVideo } from '$lib/mediaUpload';
	import { postComment as postCommentLib } from '$lib/comments/postComment';
	import { showToast } from '$lib/toast';
	import { timerSettings, saveTimerSettings, loadTimerSettings } from '$lib/timerSettings';
	import NoteContent from '../NoteContent.svelte';

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
	let uploadedImages: string[] = [];
	let uploadedVideos: string[] = [];
	let uploadingImage = false;
	let uploadingVideo = false;
	let uploadError = '';
	let imageInputEl: HTMLInputElement;
	let videoInputEl: HTMLInputElement;
	let showMediaMenu = false;

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
				uploadedImages = [...uploadedImages, url];
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
			mentionCtrl.handlePaste(e);
			return;
		}
		e.preventDefault();
		uploadingImage = true;
		uploadError = '';
		try {
			for (const file of imageFiles) {
				const url = await uploadImage($ndk, file);
				uploadedImages = [...uploadedImages, url];
			}
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
				uploadedVideos = [...uploadedVideos, url];
			}
		} catch (err: unknown) {
			uploadError = (err as Error)?.message || 'Failed to upload video.';
		} finally {
			uploadingVideo = false;
			if (videoInputEl) videoInputEl.value = '';
		}
	}

	function removeImage(index: number) {
		uploadedImages = uploadedImages.filter((_, i) => i !== index);
	}

	function removeVideo(index: number) {
		uploadedVideos = uploadedVideos.filter((_, i) => i !== index);
	}

	function clearState() {
		composerText = '';
		lastRendered = '';
		uploadedImages = [];
		uploadedVideos = [];
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
		if (
			(!composerText.trim() &&
				uploadedImages.length === 0 &&
				uploadedVideos.length === 0 &&
				!pollConfig) ||
			posting
		) {
			return;
		}

		posting = true;
		try {
			if (composerEl) {
				composerText = mentionCtrl.extractText();
				lastRendered = composerText;
			}

			let content = mentionCtrl.replacePlainMentions(composerText.trim());
			const mediaUrls = [...uploadedImages, ...uploadedVideos];
			clearState();
			if (mediaUrls.length > 0) {
				const mediaText = mediaUrls.join('\n');
				content = content ? `${content}\n\n${mediaText}` : mediaText;
			}

			const extraTags: string[][] = [];
			const mentions = mentionCtrl.parseMentions(content);
			for (const pubkey of mentions.values()) {
				extraTags.push(['p', pubkey]);
			}
			if (pollConfig) {
				extraTags.push(...buildPollTags(pollConfig));
			}

			const { event: posted } = await postCommentLib($ndk, {
				parentEvent,
				replyTo,
				content,
				extraTags,
				contentKind: pollConfig ? 1068 : undefined,
				signingStrategy: 'explicit-with-timeout'
			});

			onPosted?.(posted);
		} catch (error) {
			// Technical details to console; human-friendly message to the user.
			console.error('[ReplyComposer] post failed:', error);
			showToast('error', "Couldn't post comment — please try again.");
		} finally {
			posting = false;
		}
	}

	let showPreview = false;

	$: previewContent = (() => {
		const resolved = mentionCtrl.replacePlainMentions(composerText);
		let preview = resolved.trim();
		const media = [...uploadedImages, ...uploadedVideos];
		if (media.length) preview = preview ? `${preview}\n\n${media.join('\n')}` : media.join('\n');
		return preview;
	})();

	$: isDisabled =
		(!composerText.trim() &&
			uploadedImages.length === 0 &&
			uploadedVideos.length === 0 &&
			!pollConfig) ||
		posting ||
		uploadingImage ||
		uploadingVideo;
</script>

<div class="reply-composer" class:reply-composer--compact={compact}>
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

	{#if uploadedImages.length > 0}
		<div class="flex flex-wrap gap-2">
			{#each uploadedImages as imageUrl, index}
				<div class="relative group">
					<img
						src={imageUrl}
						alt="Upload preview"
						class="w-16 h-16 object-cover rounded-lg"
						class:w-20={!compact}
						class:h-20={!compact}
						style="border: 1px solid var(--color-input-border)"
					/>
					<button
						type="button"
						on:click={() => removeImage(index)}
						class="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-0.5 shadow-lg"
						class:p-1={!compact}
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
		<div class="flex flex-wrap gap-2">
			{#each uploadedVideos as videoUrl, index}
				<div class="relative group">
					<video
						src={videoUrl}
						class="w-24 h-16 object-cover rounded-lg"
						class:w-32={!compact}
						class:h-20={!compact}
						style="border: 1px solid var(--color-input-border)"
						preload="metadata"
						muted
					></video>
					<button
						type="button"
						on:click={() => removeVideo(index)}
						class="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-0.5 shadow-lg"
						class:p-1={!compact}
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
					<span class="text-xs text-caption">Uploading image...</span>
				{:else if uploadingVideo}
					<span class="text-xs text-caption">Uploading video...</span>
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
		uploadedImages = [...uploadedImages, e.detail.url];
	}}
/>

<PollCreator
	bind:open={showPollCreator}
	on:create={(e) => {
		pollConfig = e.detail;
	}}
/>

<style>
	.reply-composer {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.75rem;
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
</style>
