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
	import { createEventDispatcher, onDestroy } from 'svelte';
	import MentionDropdown from '../MentionDropdown.svelte';
	import { MentionComposerController, type MentionState } from '$lib/mentionComposer';
	import { clickOutside } from '$lib/clickOutside';
	import GifIcon from 'phosphor-svelte/lib/Gif';
	import ImageIcon from 'phosphor-svelte/lib/Image';
	import VideoIcon from 'phosphor-svelte/lib/Video';
	import GifPicker from '../GifPicker.svelte';
	import ChartBarHorizontalIcon from 'phosphor-svelte/lib/ChartBarHorizontal';
	import PollCreator from '../PollCreator.svelte';
	import { buildPollTags, type PollConfig } from '$lib/polls';
	import { uploadImage, uploadVideo } from '$lib/mediaUpload';
	import { postComment as postCommentLib } from '$lib/comments/postComment';
	import { showToast } from '$lib/toast';

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
	export let placeholder = 'Write a comment...';

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

	onDestroy(() => {
		// Clears any pending mention-search timeout so it can't fire after
		// unmount and trigger state updates on a destroyed component.
		mentionCtrl.destroy();
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

			clearState();
			onPosted?.(posted);
		} catch (error) {
			// Technical details to console; human-friendly message to the user.
			console.error('[ReplyComposer] post failed:', error);
			showToast('error', "Couldn't post comment — please try again.");
		} finally {
			posting = false;
		}
	}

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
			on:paste={(e) => mentionCtrl.handlePaste(e)}
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

	<div class="reply-composer-actions">
		<div
			class="media-menu"
			use:clickOutside
			on:click_outside={() => (showMediaMenu = false)}
		>
			<button
				type="button"
				class="btn-media"
				class:opacity-50={uploadingImage || uploadingVideo || posting}
				title="Upload photo or video"
				aria-label="Upload photo or video"
				aria-haspopup="menu"
				aria-expanded={showMediaMenu}
				disabled={posting || uploadingImage || uploadingVideo}
				on:click={() => (showMediaMenu = !showMediaMenu)}
			>
				<ImageIcon size={compact ? 16 : 18} />
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
			disabled={posting || uploadingImage || uploadingVideo}
			class:opacity-50={uploadingImage || uploadingVideo}
		>
			<GifIcon size={compact ? 16 : 18} />
		</button>
		<button
			type="button"
			on:click={() => (showPollCreator = true)}
			class="btn-gif"
			title="Create poll"
			aria-label="Create poll"
			disabled={posting || uploadingImage || uploadingVideo}
			class:opacity-50={posting || uploadingImage || uploadingVideo}
		>
			<ChartBarHorizontalIcon size={compact ? 16 : 18} class={pollConfig ? 'text-primary' : ''} />
		</button>

		{#if uploadingImage}
			<span class="text-xs text-caption">Uploading image...</span>
		{:else if uploadingVideo}
			<span class="text-xs text-caption">Uploading video...</span>
		{/if}
		{#if pollConfig}
			<span class="text-xs text-orange-600 flex items-center gap-1">
				<ChartBarHorizontalIcon size={12} />
				Poll ({pollConfig.options.length})
				<button type="button" on:click={() => (pollConfig = null)} class="hover:text-orange-800"
					>×</button
				>
			</span>
		{/if}

		<slot name="submit" submit={handleSubmit} disabled={isDisabled} {posting}>
			<!-- Default submit button: callers can override via `slot="submit"`. -->
			<button type="button" class="btn-post" on:click={handleSubmit} disabled={isDisabled}>
				{posting ? 'Posting...' : submitLabel}
			</button>
		</slot>

		{#if showCancel}
			<button type="button" class="btn-cancel" on:click={handleCancel}>Cancel</button>
		{/if}
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
		padding: 0.5rem 0.75rem;
		font-size: 1rem;
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

	.reply-composer-actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.btn-post {
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		font-weight: 500;
		color: white;
		background: var(--color-primary);
		border-radius: 0.5rem;
	}

	.reply-composer--compact .btn-post {
		padding: 0.375rem 0.75rem;
		font-size: 0.75rem;
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

	.reply-composer--compact .btn-cancel {
		padding: 0.375rem 0.75rem;
		font-size: 0.75rem;
	}

	.btn-cancel:hover {
		opacity: 0.8;
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
