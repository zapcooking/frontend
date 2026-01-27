<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { blur, fly } from 'svelte/transition';
	import { portal } from '../Modal.svelte';
	import { goto } from '$app/navigation';
	import { nip19 } from 'nostr-tools';
	import { NDKEvent } from '@nostr-dev-kit/ndk';
	import { ndk } from '$lib/nostr';
	import { addClientTagToEvent } from '$lib/nip89';
	import TurndownService from 'turndown';
	import DOMPurify from 'dompurify';
	import XIcon from 'phosphor-svelte/lib/X';
	import FloppyDiskIcon from 'phosphor-svelte/lib/FloppyDisk';
	import CloudCheckIcon from 'phosphor-svelte/lib/CloudCheck';
	import WarningIcon from 'phosphor-svelte/lib/Warning';
	import EyeIcon from 'phosphor-svelte/lib/Eye';
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
	import ClockIcon from 'phosphor-svelte/lib/Clock';
	import FolderIcon from 'phosphor-svelte/lib/Folder';
	import TiptapEditor from './TiptapEditor.svelte';
	import ArticleMetadata from './ArticleMetadata.svelte';
	import EditorToolbar from './EditorToolbar.svelte';
	import type { Editor } from '@tiptap/core';
	import {
		longformEditorOpen,
		currentDraft,
		currentDraftId,
		saveDraft,
		draftStatus,
		closeEditor,
		drafts,
		deleteDraft
	} from './articleDraftStore';
	import {
		type ArticleDraft,
		type DraftStatus,
		AUTOSAVE_INTERVAL_MS,
		ARTICLE_TAG,
		getWordCount,
		getReadingTime,
		createEmptyDraft
	} from '$lib/articleEditor';

	// Local state for editing
	let localDraft: ArticleDraft = createEmptyDraft();
	let hasUnsavedChanges = false;
	let showPreview = false;
	let showCloseConfirm = false;
	let autosaveTimer: ReturnType<typeof setInterval> | null = null;
	let portalTarget: HTMLElement;
	let tiptapEditor: TiptapEditor;
	let lastSavedState: string = '';
	let initializedForDraftId: string | null = null; // Track which draft we've initialized
	let editorInstance: Editor | null = null;
	
	// Publishing state
	let isPublishing = false;
	let publishError: string | null = null;
	
	// Save status fade-out
	let saveStatusFaded = false;
	let saveStatusTimeout: ReturnType<typeof setTimeout> | null = null;
	
	// Initialize turndown for HTML to Markdown conversion
	const turndownService = new TurndownService({
		headingStyle: 'atx',
		hr: '---',
		bulletListMarker: '-',
		codeBlockStyle: 'fenced'
	});

	// Get editor instance reactively after component mounts
	$: if (tiptapEditor && !showPreview) {
		// Small delay to ensure editor is initialized
		setTimeout(() => {
			editorInstance = tiptapEditor?.getEditor() || null;
		}, 100);
	}

	// Computed values
	$: wordCount = getWordCount(localDraft.content);
	$: readingTime = getReadingTime(wordCount);
	$: statusText = getStatusText($draftStatus);
	$: canPublish = localDraft.title.trim().length > 0 && wordCount > 50;
	
	// Fade out save status after 2 seconds when saved
	$: if ($draftStatus === 'saved') {
		// Clear any existing timeout
		if (saveStatusTimeout) {
			clearTimeout(saveStatusTimeout);
		}
		// Reset fade state
		saveStatusFaded = false;
		// Fade out after 2 seconds
		saveStatusTimeout = setTimeout(() => {
			saveStatusFaded = true;
		}, 2000);
	} else {
		// Reset fade state when status changes away from saved
		saveStatusFaded = false;
		if (saveStatusTimeout) {
			clearTimeout(saveStatusTimeout);
			saveStatusTimeout = null;
		}
	}

	// Track changes by comparing to last saved state
	$: currentState = JSON.stringify({
		title: localDraft.title,
		subtitle: localDraft.subtitle,
		content: localDraft.content,
		coverImage: localDraft.coverImage,
		tags: localDraft.tags
	});
	
	$: if (currentState !== lastSavedState && lastSavedState !== '') {
		hasUnsavedChanges = true;
		draftStatus.set('unsaved');
	}

	function getStatusText(status: DraftStatus): string {
		switch (status) {
			case 'saving':
				return 'Saving...';
			case 'saved':
				return 'Saved';
			case 'error':
				return 'Error saving';
			default:
				return 'Unsaved changes';
		}
	}

	// Initialize draft when modal opens - only once per draft
	$: if ($longformEditorOpen && $currentDraft && initializedForDraftId !== $currentDraft.id) {
		localDraft = { ...$currentDraft };
		initializedForDraftId = $currentDraft.id;
		lastSavedState = JSON.stringify({
			title: localDraft.title,
			subtitle: localDraft.subtitle,
			content: localDraft.content,
			coverImage: localDraft.coverImage,
			tags: localDraft.tags
		});
		hasUnsavedChanges = false;
	}
	
	// Reset initialization flag when modal closes
	$: if (!$longformEditorOpen) {
		initializedForDraftId = null;
	}

	// Handle editor content updates
	function handleEditorUpdate(e: CustomEvent<{ html: string; wordCount: number }>) {
		localDraft.content = e.detail.html;
	}

	// Manual save
	function handleSave() {
		saveDraft(localDraft);
		lastSavedState = currentState;
		hasUnsavedChanges = false;
	}

	// Auto-save functionality
	function setupAutosave() {
		if (autosaveTimer) clearInterval(autosaveTimer);

		autosaveTimer = setInterval(() => {
			if (hasUnsavedChanges && $longformEditorOpen) {
				saveDraft(localDraft);
				lastSavedState = currentState;
				hasUnsavedChanges = false;
			}
		}, AUTOSAVE_INTERVAL_MS);
	}

	// Close handling
	function handleClose() {
		if (hasUnsavedChanges) {
			showCloseConfirm = true;
		} else {
			doClose();
		}
	}

	function doClose() {
		showCloseConfirm = false;
		closeEditor();
	}

	function confirmClose() {
		// Save before closing
		saveDraft(localDraft);
		doClose();
	}

	function discardAndClose() {
		doClose();
	}

	// Toggle preview mode
	function togglePreview() {
		showPreview = !showPreview;
	}

	// Convert HTML content to Markdown for NIP-23
	function htmlToMarkdown(html: string): string {
		if (!html) return '';
		return turndownService.turndown(html);
	}
	
	// Generate a URL-friendly identifier from the title
	// Note: In NIP-23, reusing the same identifier updates the article (by design)
	function generateIdentifier(title: string): string {
		if (!title || !title.trim()) {
			// Fallback to timestamp if title is empty
			return `article-${Date.now()}`;
		}
		
		let identifier = title
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9\s-]/g, '') // Remove special characters
			.replace(/\s+/g, '-') // Replace spaces with hyphens
			.replace(/-+/g, '-') // Remove multiple consecutive hyphens
			.replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
			.substring(0, 80); // Limit length (NIP-23 recommends max 100 chars)
		
		// Ensure identifier is not empty
		if (!identifier) {
			identifier = `article-${Date.now()}`;
		}
		
		return identifier;
	}
	
	// Publish handler - creates a NIP-23 kind 30023 event
	async function handlePublish() {
		if (!$ndk || !$ndk.signer) {
			publishError = 'Please sign in to publish';
			return;
		}
		
		// Validate required fields
		if (!localDraft.title.trim()) {
			publishError = 'Please add a title';
			return;
		}
		
		if (wordCount < 50) {
			publishError = 'Article must be at least 50 words';
			return;
		}
		
		isPublishing = true;
		publishError = null;
		
		try {
			// Convert HTML content to Markdown
			const markdownContent = htmlToMarkdown(localDraft.content);
			
			if (!markdownContent.trim()) {
				publishError = 'Article content cannot be empty';
				return;
			}
			
			// Generate identifier from title
			const identifier = generateIdentifier(localDraft.title);
			
			// Validate identifier is not empty (shouldn't happen, but safety check)
			if (!identifier || identifier.trim().length === 0) {
				publishError = 'Failed to generate article identifier. Please add a title.';
				return;
			}
			
			// Create the NIP-23 longform event
			const event = new NDKEvent($ndk);
			event.kind = 30023;
			event.content = markdownContent;
			
			// Required tags - sanitize title/subtitle to prevent tag injection
			const sanitizedTitle = localDraft.title.trim().substring(0, 200); // Limit length
			event.tags.push(['d', identifier]);
			event.tags.push(['title', sanitizedTitle]);
			
			// Optional tags
			if (localDraft.subtitle.trim()) {
				const sanitizedSubtitle = localDraft.subtitle.trim().substring(0, 300);
				event.tags.push(['summary', sanitizedSubtitle]);
			}
			
			if (localDraft.coverImage && localDraft.coverImage.trim()) {
				// Basic URL validation
				try {
					new URL(localDraft.coverImage);
					event.tags.push(['image', localDraft.coverImage]);
				} catch {
					console.warn('Invalid cover image URL, skipping');
				}
			}
			
			// Add published_at timestamp
			event.tags.push(['published_at', Math.floor(Date.now() / 1000).toString()]);
			
			// Add the zapreads tag to identify this as an article (not a recipe)
			event.tags.push(['t', ARTICLE_TAG]);
			
			// Add user-defined tags (sanitize and limit)
			const uniqueTags = [...new Set(localDraft.tags)]; // Remove duplicates
			uniqueTags.slice(0, 20).forEach((tag) => { // Limit to 20 tags
				const sanitizedTag = tag.trim().toLowerCase().replace(/[^a-z0-9-]/g, '').substring(0, 50);
				if (sanitizedTag && sanitizedTag.length > 0) {
					event.tags.push(['t', sanitizedTag]);
				}
			});
			
			// Add NIP-89 client tag
			addClientTagToEvent(event);
			
			// Publish to relays with timeout
			const publishPromise = event.publish();
			const timeoutPromise = new Promise((_, reject) => 
				setTimeout(() => reject(new Error('Publish timeout - please try again')), 30000)
			);
			
			await Promise.race([publishPromise, timeoutPromise]);
			
			// Generate naddr for the published article
			const naddr = nip19.naddrEncode({
				identifier: identifier,
				pubkey: event.author.pubkey,
				kind: 30023
			});
			
			// Delete the draft since it's now published
			if ($currentDraftId) {
				deleteDraft($currentDraftId);
			}
			
			// Close the editor
			closeEditor();
			
			// Navigate to the published article
			goto(`/reads/${naddr}`);
			
		} catch (error) {
			console.error('Error publishing article:', error);
			if (error instanceof Error) {
				publishError = error.message;
			} else if (typeof error === 'string') {
				publishError = error;
			} else {
				publishError = 'Failed to publish article. Please check your connection and try again.';
			}
		} finally {
			isPublishing = false;
		}
	}

	// Go to drafts page
	function goToDrafts() {
		// Save current draft before navigating
		if (hasUnsavedChanges) {
			saveDraft(localDraft);
		}
		closeEditor();
		goto('/drafts');
	}

	// Draft count for display
	$: draftCount = $drafts.length;

	// Handle keyboard shortcuts
	function handleKeydown(e: KeyboardEvent) {
		// Ctrl/Cmd + S to save
		if ((e.ctrlKey || e.metaKey) && e.key === 's') {
			e.preventDefault();
			handleSave();
		}
		// Escape to close (with confirmation if unsaved)
		if (e.key === 'Escape' && !showCloseConfirm) {
			handleClose();
		}
	}

	onMount(() => {
		portalTarget = document.body;
		setupAutosave();

		// Add keyboard listener
		if (browser) {
			window.addEventListener('keydown', handleKeydown);
		}
	});

	onDestroy(() => {
		if (autosaveTimer) {
			clearInterval(autosaveTimer);
			autosaveTimer = null;
		}
		if (saveStatusTimeout) {
			clearTimeout(saveStatusTimeout);
			saveStatusTimeout = null;
		}
		if (browser) {
			window.removeEventListener('keydown', handleKeydown);
		}
		// Clear any pending state
		publishError = null;
		isPublishing = false;
	});
</script>

{#if $longformEditorOpen && portalTarget}
	<div use:portal={portalTarget}>
		<!-- Backdrop -->
		<div
			transition:blur={{ duration: 200 }}
			class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
			role="presentation"
		/>

		<!-- Modal -->
		<div
			transition:fly={{ y: 20, duration: 250 }}
			class="fixed inset-0 z-50 flex flex-col"
			style="background: var(--color-bg-primary);"
			role="dialog"
			aria-modal="true"
			aria-label="Article Editor"
		>
			<!-- Top Bar -->
			<header class="editor-header">
				<div class="header-left">
					<button type="button" class="close-btn" on:click={handleClose} aria-label="Close editor">
						<XIcon size={20} />
					</button>

					<button type="button" class="drafts-btn" on:click={goToDrafts} title="My Drafts">
						<FolderIcon size={18} />
						<span>Drafts</span>
						{#if draftCount > 0}
							<span class="draft-count">{draftCount}</span>
						{/if}
					</button>
				</div>

				<div class="header-center">
					<div class="stats">
						<span class="stat">
							{wordCount} words
						</span>
						<span class="stat-divider">·</span>
						<span class="stat reading-time">
							<ClockIcon size={14} />
							{readingTime} min
						</span>
					</div>
				</div>

				<div class="header-right">
					<button
						type="button"
						class="preview-btn"
						class:active={showPreview}
						on:click={togglePreview}
					>
						{#if showPreview}
							<PencilSimpleIcon size={18} />
							<span>Edit</span>
						{:else}
							<EyeIcon size={18} />
							<span>Preview</span>
						{/if}
					</button>

					<button 
						type="button" 
						class="save-btn" 
						class:error={$draftStatus === 'error'} 
						class:faded={saveStatusFaded && $draftStatus === 'saved'}
						on:click={handleSave} 
						disabled={isPublishing || $draftStatus === 'saving'}
					>
						{#if $draftStatus === 'saving'}
							<span class="status-spinner" />
							<span>Saving...</span>
						{:else if $draftStatus === 'saved'}
							<CloudCheckIcon size={18} />
							<span>Saved</span>
						{:else if $draftStatus === 'error'}
							<WarningIcon size={18} />
							<span>Error</span>
						{:else}
							<FloppyDiskIcon size={18} />
							<span>Save</span>
						{/if}
					</button>

					<button 
						type="button" 
						class="publish-btn" 
						disabled={!canPublish || isPublishing} 
						on:click={handlePublish}
					>
						{#if isPublishing}
							<span class="publish-spinner" />
							Publishing...
						{:else}
							Publish
						{/if}
					</button>
				</div>
			</header>
			
			<!-- Publish error message -->
			{#if publishError}
				<div class="publish-error">
					<WarningIcon size={16} />
					<span>{publishError}</span>
					<button type="button" on:click={() => publishError = null} aria-label="Dismiss error">
						<XIcon size={14} />
					</button>
				</div>
			{/if}

			<!-- Fixed Editor Toolbar (only in edit mode) -->
			{#if !showPreview && editorInstance}
				<div class="fixed-toolbar">
					<div class="fixed-toolbar-inner">
						<EditorToolbar 
							editor={editorInstance} 
							onImageUpload={() => tiptapEditor?.triggerImageUpload()}
							onVideoUpload={() => tiptapEditor?.triggerVideoUpload()}
						/>
					</div>
				</div>
			{/if}

			<!-- Main Content -->
			<main class="editor-main" class:has-toolbar={!showPreview && editorInstance}>
				{#if showPreview}
					<!-- Preview Mode -->
					<div class="preview-container">
						<article class="preview-content">
							{#if localDraft.coverImage}
								<img src={localDraft.coverImage} alt="Cover" class="preview-cover" />
							{/if}

							<h1 class="preview-title">
								{localDraft.title || 'Untitled'}
							</h1>

							{#if localDraft.subtitle}
								<p class="preview-subtitle">{localDraft.subtitle}</p>
							{/if}

							{#if localDraft.tags.length > 0}
								<div class="preview-tags">
									{#each localDraft.tags as tag}
										<span class="preview-tag">#{tag}</span>
									{/each}
								</div>
							{/if}

							<div class="preview-body prose">
								{@html browser ? DOMPurify.sanitize(localDraft.content) : localDraft.content}
							</div>
						</article>
					</div>
				{:else}
					<!-- Edit Mode -->
					<div class="editor-container">
						<!-- Metadata Section -->
						<div class="metadata-section">
							<ArticleMetadata
								bind:title={localDraft.title}
								bind:subtitle={localDraft.subtitle}
								bind:coverImage={localDraft.coverImage}
								bind:tags={localDraft.tags}
							/>
						</div>

						<!-- Editor Section -->
						<div class="editor-section">
							<TiptapEditor
								bind:this={tiptapEditor}
								content={localDraft.content}
								showToolbar={false}
								on:update={handleEditorUpdate}
							/>
						</div>
					</div>
				{/if}
			</main>
		</div>

		<!-- Close Confirmation Dialog -->
		{#if showCloseConfirm}
			<div
				class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
				role="presentation"
				on:click|self={() => (showCloseConfirm = false)}
			>
				<div
					class="confirm-dialog"
					role="alertdialog"
					aria-modal="true"
					aria-labelledby="confirm-title"
				>
					<h3 id="confirm-title" class="confirm-title">Unsaved Changes</h3>
					<p class="confirm-text">
						You have unsaved changes. Would you like to save before closing?
					</p>
					<div class="confirm-actions">
						<button type="button" class="confirm-btn discard" on:click={discardAndClose}>
							Discard
						</button>
						<button type="button" class="confirm-btn cancel" on:click={() => (showCloseConfirm = false)}>
							Cancel
						</button>
						<button type="button" class="confirm-btn save" on:click={confirmClose}>
							Save & Close
						</button>
					</div>
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	/* Header */
	.editor-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--color-input-border);
		background: var(--color-bg-secondary);
		flex-shrink: 0;
	}

	.header-left,
	.header-center,
	.header-right {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.header-center {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		pointer-events: none; /* Allow clicks to pass through to elements behind */
	}

	.header-center .stats {
		pointer-events: auto; /* Re-enable for stats */
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 9999px;
		color: var(--color-text-secondary);
		transition: all 0.15s ease;
	}

	.close-btn:hover {
		background: var(--color-accent-gray);
		color: var(--color-text-primary);
	}

	.drafts-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.75rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text-secondary);
		transition: all 0.15s ease;
	}

	.drafts-btn:hover {
		background: var(--color-accent-gray);
		color: var(--color-text-primary);
	}

	.draft-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.25rem;
		height: 1.25rem;
		padding: 0 0.375rem;
		background: var(--color-primary);
		color: white;
		font-size: 0.75rem;
		font-weight: 600;
		border-radius: 9999px;
	}


	.status-spinner {
		width: 0.875rem;
		height: 0.875rem;
		border: 2px solid var(--color-input-border);
		border-top-color: currentColor;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		flex-shrink: 0;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.stats {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.stat {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.stat-divider {
		opacity: 0.5;
	}

	.preview-btn,
	.save-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.875rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text-secondary);
		transition: all 0.15s ease;
	}

	.preview-btn:hover,
	.save-btn:hover:not(:disabled) {
		background: var(--color-accent-gray);
		color: var(--color-text-primary);
	}

	.preview-btn.active {
		background: var(--color-primary);
		color: white;
	}

	.save-btn.error {
		color: #dc2626;
	}

	.save-btn.faded {
		opacity: 0.3;
		transform: scale(0.95);
	}

	.save-btn:disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}

	.publish-btn {
		padding: 0.5rem 1rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 600;
		background: linear-gradient(135deg, #f97316, #f59e0b);
		color: white;
		transition: all 0.15s ease;
	}

	.publish-btn:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(249, 115, 22, 0.4);
	}

	.publish-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.publish-spinner {
		display: inline-block;
		width: 0.875rem;
		height: 0.875rem;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		margin-right: 0.375rem;
	}

	.publish-error {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		background: #fef2f2;
		border-bottom: 1px solid #fecaca;
		color: #dc2626;
		font-size: 0.875rem;
	}

	.publish-error button {
		margin-left: auto;
		padding: 0.25rem;
		border-radius: 0.25rem;
		color: #dc2626;
		transition: background 0.15s ease;
	}

	.publish-error button:hover {
		background: rgba(220, 38, 38, 0.1);
	}

	/* Fixed Toolbar - sticky so it stays accessible when scrolling */
	.fixed-toolbar {
		position: sticky;
		top: 0;
		z-index: 10;
		flex-shrink: 0;
		background: var(--color-bg-secondary);
		border-bottom: 1px solid var(--color-input-border);
		padding: 0.5rem 1rem;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
	}

	.fixed-toolbar-inner {
		max-width: 800px;
		margin: 0 auto;
	}

	/* Main Content */
	.editor-main {
		flex: 1;
		overflow-y: auto;
	}

	.editor-container {
		max-width: 800px;
		margin: 0 auto;
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.metadata-section {
		padding-bottom: 1.5rem;
		border-bottom: 1px solid var(--color-input-border);
	}

	.editor-section {
		min-height: 400px;
	}

	/* Preview */
	.preview-container {
		max-width: 700px;
		margin: 0 auto;
		padding: 2rem 1.5rem;
	}

	.preview-content {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.preview-cover {
		width: 100%;
		max-height: 400px;
		object-fit: cover;
		border-radius: 0.75rem;
	}

	.preview-title {
		font-size: 2.5rem;
		font-weight: 700;
		line-height: 1.2;
		color: var(--color-text-primary);
	}

	.preview-subtitle {
		font-size: 1.25rem;
		color: var(--color-text-secondary);
		line-height: 1.5;
	}

	.preview-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.preview-tag {
		padding: 0.25rem 0.625rem;
		background: var(--color-accent-gray);
		color: var(--color-primary);
		font-size: 0.875rem;
		font-weight: 500;
		border-radius: 9999px;
	}

	.preview-body {
		font-size: 1.125rem;
		line-height: 1.8;
		color: var(--color-text-primary);
	}

	.preview-body :global(h1),
	.preview-body :global(h2),
	.preview-body :global(h3) {
		margin-top: 2rem;
		margin-bottom: 1rem;
		color: var(--color-text-primary);
	}

	.preview-body :global(p) {
		margin: 1rem 0;
	}

	.preview-body :global(img) {
		max-width: 100%;
		border-radius: 0.5rem;
		margin: 1.5rem 0;
	}

	.preview-body :global(blockquote) {
		margin: 1.5rem 0;
		padding: 1rem 1.5rem;
		border-left: 4px solid var(--color-primary);
		background: var(--color-accent-gray);
		border-radius: 0 0.5rem 0.5rem 0;
		font-style: italic;
	}

	.preview-body :global(ul),
	.preview-body :global(ol) {
		margin: 1rem 0;
		padding-left: 1.5rem;
	}

	.preview-body :global(a) {
		color: var(--color-primary);
		text-decoration: underline;
	}

	/* Confirm Dialog */
	.confirm-dialog {
		background: var(--color-bg-secondary);
		border-radius: 1rem;
		padding: 1.5rem;
		max-width: 400px;
		width: calc(100% - 2rem);
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
	}

	.confirm-title {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin-bottom: 0.75rem;
	}

	.confirm-text {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		margin-bottom: 1.5rem;
		line-height: 1.5;
	}

	.confirm-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
	}

	.confirm-btn {
		padding: 0.5rem 1rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
		transition: all 0.15s ease;
	}

	.confirm-btn.discard {
		color: #dc2626;
	}

	.confirm-btn.discard:hover {
		background: #fee2e2;
	}

	.confirm-btn.cancel {
		color: var(--color-text-secondary);
	}

	.confirm-btn.cancel:hover {
		background: var(--color-accent-gray);
	}

	.confirm-btn.save {
		background: var(--color-primary);
		color: white;
	}

	.confirm-btn.save:hover {
		opacity: 0.9;
	}

	/* Mobile Responsive */
	@media (max-width: 768px) {
		.editor-header {
			padding: 0.5rem 0.75rem;
			gap: 0.5rem;
			position: relative;
		}

		/* Show only word count centered on mobile */
		.header-center {
			position: absolute;
			left: 50%;
			transform: translateX(-50%);
		}

		.stat-divider,
		.reading-time {
			display: none;
		}

		.header-left {
			gap: 0.5rem;
			flex: 0 0 auto;
		}

		.header-right {
			gap: 0.5rem;
			flex: 0 0 auto;
			margin-left: auto;
		}

		/* Compact drafts button - hide "Drafts" text on mobile */
		.drafts-btn {
			padding: 0.375rem 0.5rem;
			font-size: 0.8125rem;
		}

		.drafts-btn span:first-of-type {
			display: none; /* Hide "Drafts" text, keep icon and count */
		}

		/* Compact stats for mobile with even padding */
		.stats {
			font-size: 0.8125rem;
			gap: 0.375rem;
			padding: 0 0.75rem; /* More padding on both sides for better separation */
		}

		.stat {
			gap: 0.125rem;
		}

		.stat :global(svg) {
			width: 12px;
			height: 12px;
		}


		.preview-btn span,
		.save-btn span {
			display: none;
		}

		.save-btn.faded {
			opacity: 0.3;
		}

		.preview-btn,
		.save-btn {
			padding: 0.5rem;
		}

		.publish-btn {
			padding: 0.5rem 0.75rem;
			font-size: 0.8125rem;
		}

		.editor-container,
		.preview-container {
			padding: 1rem;
		}

		.preview-title {
			font-size: 1.75rem;
		}
	}
</style>
