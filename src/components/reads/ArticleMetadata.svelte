<script lang="ts">
	import { ndk } from '$lib/nostr';
	import { NDKEvent } from '@nostr-dev-kit/ndk';
	import { Fetch } from 'hurdak';
	import XIcon from 'phosphor-svelte/lib/X';
	import ImageIcon from 'phosphor-svelte/lib/Image';
	import UploadIcon from 'phosphor-svelte/lib/UploadSimple';
	import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwise';

	export let title: string = '';
	export let subtitle: string = '';
	export let coverImage: string = '';
	export let tags: string[] = [];

	let fileInput: HTMLInputElement;
	let isUploading = false;
	let tagInput = '';
	let isDragging = false;
	let uploadError = '';

	// Upload to nostr.build
	async function uploadToNostrBuild(file: File): Promise<string | null> {
		// Check if NDK and signer are available
		if (!$ndk || !$ndk.signer) {
			console.error('Upload failed: Not signed in');
			throw new Error('Please sign in to upload images');
		}

		const body = new FormData();
		body.append('file[]', file);

		const url = 'https://nostr.build/api/v2/upload/files';
		const template = new NDKEvent($ndk);
		template.kind = 27235;
		template.created_at = Math.floor(Date.now() / 1000);
		template.content = '';
		template.tags = [
			['u', url],
			['method', 'POST']
		];

		try {
			await template.sign();
		} catch (error) {
			console.error('Failed to sign auth event:', error);
			throw new Error('Failed to authenticate upload');
		}

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
			const result = await Fetch.fetchJson(url, {
				body,
				method: 'POST',
				headers: {
					Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}`
				}
			});

			if (result && result.data && result.data[0]?.url) {
				return result.data[0].url;
			}
			console.error('Upload response missing URL:', result);
		} catch (error) {
			console.error('Upload request failed:', error);
			throw error;
		}
		return null;
	}

	// Handle cover image upload
	async function handleCoverUpload(files: FileList | File[]) {
		const file = Array.from(files).find((f) => f.type.startsWith('image/'));
		if (!file) return;

		isUploading = true;
		uploadError = '';
		try {
			const url = await uploadToNostrBuild(file);
			if (url) {
				coverImage = url;
			} else {
				uploadError = 'Upload failed. Please try again.';
			}
		} catch (error: unknown) {
			console.error('Cover upload failed:', error);
			if (error instanceof Error) {
				uploadError = error.message;
			} else {
				uploadError = 'Upload failed. Please try again.';
			}
		}
		isUploading = false;
	}

	function handleFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files?.length) {
			handleCoverUpload(target.files);
			target.value = '';
		}
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		isDragging = false;
		if (e.dataTransfer?.files) {
			handleCoverUpload(e.dataTransfer.files);
		}
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		isDragging = true;
	}

	function handleDragLeave() {
		isDragging = false;
	}

	function removeCover() {
		coverImage = '';
	}

	// Tag management
	function addTag() {
		const newTag = tagInput.trim().toLowerCase().replace(/[^a-z0-9-]/g, '').substring(0, 50);
		if (newTag && newTag.length > 0 && !tags.includes(newTag)) {
			// Limit to 20 tags
			if (tags.length < 20) {
				tags = [...tags, newTag];
			}
		}
		tagInput = '';
	}

	function removeTag(tag: string) {
		tags = tags.filter((t) => t !== tag);
	}

	function handleTagKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			addTag();
		} else if (e.key === 'Backspace' && tagInput === '' && tags.length > 0) {
			// Remove last tag on backspace if input is empty
			tags = tags.slice(0, -1);
		}
	}
</script>

<div class="article-metadata">
	<!-- Title -->
	<div class="field">
		<input
			type="text"
			bind:value={title}
			placeholder="Article title..."
			class="title-input"
		/>
	</div>

	<!-- Subtitle -->
	<div class="field">
		<textarea
			bind:value={subtitle}
			placeholder="Add a subtitle or summary (optional)..."
			class="subtitle-input"
			rows="2"
		/>
	</div>

	<!-- Cover Image -->
	<div class="field">
		<span class="field-label" id="cover-image-label">Cover Image</span>

		<input
			bind:this={fileInput}
			type="file"
			accept="image/*"
			class="hidden"
			on:change={handleFileSelect}
			aria-labelledby="cover-image-label"
		/>

		{#if coverImage}
			<div class="cover-preview">
				<img src={coverImage} alt="Cover" class="cover-image" />
				<button type="button" class="remove-cover" on:click={removeCover} aria-label="Remove cover">
					<XIcon size={16} weight="bold" />
				</button>
				<div class="cover-badge">
					<ImageIcon size={14} />
					Cover
				</div>
			</div>
		{:else}
			<button
				type="button"
				class="cover-upload-area"
				class:dragging={isDragging}
				on:click={() => fileInput.click()}
				on:drop={handleDrop}
				on:dragover={handleDragOver}
				on:dragleave={handleDragLeave}
			>
				{#if isUploading}
					<ArrowsClockwiseIcon size={24} class="animate-spin" />
					<span>Uploading...</span>
				{:else}
					<UploadIcon size={24} />
					<span>Add cover image</span>
					<span class="hint">Drag & drop or click to upload</span>
				{/if}
			</button>
			{#if uploadError}
				<p class="upload-error">{uploadError}</p>
			{/if}
		{/if}
	</div>

	<!-- Tags -->
	<div class="field">
		<span class="field-label" id="tags-label">Tags</span>
		<div class="tags-container" role="group" aria-labelledby="tags-label">
			{#each tags as tag}
				<span class="tag">
					#{tag}
					<button type="button" class="tag-remove" on:click={() => removeTag(tag)}>
						<XIcon size={12} />
					</button>
				</span>
			{/each}
			<input
				type="text"
				bind:value={tagInput}
				on:keydown={handleTagKeydown}
				on:blur={addTag}
				placeholder={tags.length === 0 ? 'Add tags...' : ''}
				class="tag-input"
			/>
		</div>
		<p class="field-hint">Press Enter or comma to add tags</p>
	</div>
</div>

<style>
	.article-metadata {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.field-label {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.field-hint {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		margin-top: 0.25rem;
	}

	.hidden {
		display: none;
	}

	.title-input {
		font-size: 1.75rem;
		font-weight: 700;
		padding: 0.5rem 0;
		border: none;
		background: transparent;
		color: var(--color-text-primary);
		width: 100%;
	}

	.title-input::placeholder {
		color: var(--color-text-secondary);
		opacity: 0.6;
	}

	.title-input:focus {
		outline: none;
	}

	.subtitle-input {
		font-size: 1.125rem;
		padding: 0.5rem 0;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		width: 100%;
		resize: none;
		line-height: 1.5;
	}

	.subtitle-input::placeholder {
		color: var(--color-text-secondary);
		opacity: 0.5;
	}

	.subtitle-input:focus {
		outline: none;
	}

	/* Cover image */
	.cover-preview {
		position: relative;
		border-radius: 0.75rem;
		overflow: hidden;
	}

	.cover-image {
		width: 100%;
		max-height: 200px;
		object-fit: cover;
	}

	.remove-cover {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		background: rgba(0, 0, 0, 0.6);
		color: white;
		padding: 0.5rem;
		border-radius: 9999px;
		transition: background 0.15s ease;
	}

	.remove-cover:hover {
		background: #dc2626;
	}

	.cover-badge {
		position: absolute;
		bottom: 0.75rem;
		left: 0.75rem;
		background: rgba(0, 0, 0, 0.6);
		color: white;
		font-size: 0.75rem;
		font-weight: 500;
		padding: 0.375rem 0.625rem;
		border-radius: 9999px;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.cover-upload-area {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 2rem;
		border: 2px dashed var(--color-input-border);
		border-radius: 0.75rem;
		background: var(--color-input-bg);
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.cover-upload-area:hover,
	.cover-upload-area.dragging {
		border-color: var(--color-primary);
		background: rgba(236, 71, 0, 0.05);
	}

	.cover-upload-area .hint {
		font-size: 0.75rem;
		opacity: 0.7;
	}

	.upload-error {
		font-size: 0.875rem;
		color: #dc2626;
		margin-top: 0.5rem;
	}

	/* Tags */
	.tags-container {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding: 0.625rem;
		border: 1px solid var(--color-input-border);
		border-radius: 0.5rem;
		background: var(--color-input-bg);
		min-height: 2.75rem;
	}

	.tag {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.5rem;
		background: var(--color-primary);
		color: white;
		font-size: 0.875rem;
		font-weight: 500;
		border-radius: 9999px;
	}

	.tag-remove {
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0.7;
		transition: opacity 0.15s ease;
	}

	.tag-remove:hover {
		opacity: 1;
	}

	.tag-input {
		flex: 1;
		min-width: 80px;
		border: none;
		background: transparent;
		color: var(--color-text-primary);
		font-size: 0.875rem;
		padding: 0.25rem;
	}

	.tag-input:focus {
		outline: none;
	}

	.tag-input::placeholder {
		color: var(--color-text-secondary);
	}

	/* Animation */
	:global(.animate-spin) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
</style>
