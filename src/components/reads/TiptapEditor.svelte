<script lang="ts">
	import { onMount, onDestroy, createEventDispatcher } from 'svelte';
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import Image from '@tiptap/extension-image';
	import Link from '@tiptap/extension-link';
	import Placeholder from '@tiptap/extension-placeholder';
	import CharacterCount from '@tiptap/extension-character-count';
	import { ndk } from '$lib/nostr';
	import { NDKEvent } from '@nostr-dev-kit/ndk';
	import { Fetch } from 'hurdak';
	import EditorToolbar from './EditorToolbar.svelte';

	export let content: string = '';
	export let placeholder: string = 'Start writing your article...';
	export let showToolbar: boolean = true;

	const dispatch = createEventDispatcher<{
		update: { html: string; wordCount: number };
	}>();

	let element: HTMLDivElement;
	let editor: Editor | null = null;
	let fileInput: HTMLInputElement;
	let videoFileInput: HTMLInputElement;
	let isUploading = false;
	let uploadError = '';
	let uploadType: 'image' | 'video' = 'image';

	// Word count from character count extension
	$: wordCount = editor?.storage.characterCount?.words() || 0;

	onMount(() => {
		editor = new Editor({
			element,
			extensions: [
				StarterKit.configure({
					heading: {
						levels: [1, 2, 3]
					}
				}),
				Image.configure({
					HTMLAttributes: {
						class: 'article-image'
					},
					allowBase64: false
				}),
				Link.configure({
					openOnClick: false,
					HTMLAttributes: {
						class: 'article-link'
					}
				}),
				Placeholder.configure({
					placeholder
				}),
				CharacterCount
			],
			content,
			onUpdate: ({ editor }) => {
				const html = editor.getHTML();
				const words = editor.storage.characterCount?.words() || 0;
				dispatch('update', { html, wordCount: words });
			},
			editorProps: {
				attributes: {
					class: 'prose prose-lg max-w-none focus:outline-none min-h-[400px]'
				},
				handleDrop: (view, event, slice, moved) => {
					// Handle image drops
					if (!moved && event.dataTransfer?.files?.length) {
						const images = Array.from(event.dataTransfer.files).filter((file) =>
							file.type.startsWith('image/')
						);
						if (images.length > 0) {
							event.preventDefault();
							handleImageFiles(images);
							return true;
						}
					}
					return false;
				},
				handlePaste: (view, event) => {
					// Handle image pastes
					const items = event.clipboardData?.items;
					if (items) {
						const images: File[] = [];
						for (const item of items) {
							if (item.type.startsWith('image/')) {
								const file = item.getAsFile();
								if (file) images.push(file);
							}
						}
						if (images.length > 0) {
							event.preventDefault();
							handleImageFiles(images);
							return true;
						}
					}
					return false;
				}
			}
		});

		// Update element binding for Svelte
		editor.on('transaction', () => {
			editor = editor;
		});
	});

	onDestroy(() => {
		editor?.destroy();
	});

	// Upload image to nostr.build
	async function uploadToNostrBuild(file: File): Promise<string | null> {
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

		await template.sign();

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
		} catch (error) {
			console.error('Upload failed:', error);
			throw error;
		}
		return null;
	}

	// Handle image file uploads
	async function handleImageFiles(files: File[]) {
		if (!editor || files.length === 0) return;

		isUploading = true;
		uploadType = 'image';
		uploadError = '';

		for (const file of files) {
			try {
				const imageUrl = await uploadToNostrBuild(file);
				if (imageUrl) {
					editor.chain().focus().setImage({ src: imageUrl }).run();
				}
			} catch (error) {
				console.error('Failed to upload image:', error);
				uploadError = 'Failed to upload image. Please try again.';
			}
		}

		isUploading = false;
	}

	// Handle video file uploads
	async function handleVideoFiles(files: File[]) {
		if (!editor || files.length === 0) return;

		isUploading = true;
		uploadType = 'video';
		uploadError = '';

		for (const file of files) {
			try {
				const videoUrl = await uploadToNostrBuild(file);
				if (videoUrl) {
					// Insert video as HTML since TipTap doesn't have native video support
					const videoHtml = `<video src="${videoUrl}" controls class="article-video" style="max-width: 100%; border-radius: 0.5rem; margin: 1rem 0;"></video>`;
					editor.chain().focus().insertContent(videoHtml).run();
				}
			} catch (error) {
				console.error('Failed to upload video:', error);
				uploadError = 'Failed to upload video. Please try again.';
			}
		}

		isUploading = false;
	}

	// Open file picker for image upload
	function openImagePicker() {
		fileInput?.click();
	}

	// Open file picker for video upload
	function openVideoPicker() {
		videoFileInput?.click();
	}

	// Handle image file input change
	function handleFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files?.length) {
			const images = Array.from(target.files).filter((file) => file.type.startsWith('image/'));
			handleImageFiles(images);
			// Reset input
			target.value = '';
		}
	}

	// Handle video file input change
	function handleVideoFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files?.length) {
			const videos = Array.from(target.files).filter((file) => file.type.startsWith('video/'));
			handleVideoFiles(videos);
			// Reset input
			target.value = '';
		}
	}

	// Expose method to set content externally
	export function setContent(newContent: string) {
		if (editor && newContent !== editor.getHTML()) {
			editor.commands.setContent(newContent);
		}
	}

	// Expose method to get current content
	export function getContent(): string {
		return editor?.getHTML() || '';
	}

	// Expose method to focus editor
	export function focus() {
		editor?.commands.focus();
	}

	// Expose editor instance for external toolbar
	export function getEditor(): Editor | null {
		return editor;
	}

	// Expose image upload trigger for external toolbar
	export function triggerImageUpload() {
		openImagePicker();
	}

	// Expose video upload trigger for external toolbar
	export function triggerVideoUpload() {
		openVideoPicker();
	}
</script>

<div class="tiptap-editor" class:no-toolbar={!showToolbar}>
	<!-- Hidden file input for image uploads -->
	<input
		bind:this={fileInput}
		type="file"
		accept="image/*"
		multiple
		class="hidden"
		on:change={handleFileSelect}
	/>
	
	<!-- Hidden file input for video uploads -->
	<input
		bind:this={videoFileInput}
		type="file"
		accept="video/*"
		class="hidden"
		on:change={handleVideoFileSelect}
	/>

	<!-- Toolbar (can be hidden if using external toolbar) -->
	{#if showToolbar}
		<div class="toolbar-wrapper">
			<EditorToolbar {editor} onImageUpload={openImagePicker} />
		</div>
	{/if}
	
	<!-- Upload status (always shown) -->
	{#if isUploading}
		<div class="upload-status">
			<span class="upload-spinner" />
			Uploading {uploadType}...
		</div>
	{/if}

	{#if uploadError}
		<div class="upload-error">
			{uploadError}
		</div>
	{/if}

	<!-- Editor content area -->
	<div class="editor-content" bind:this={element} />
</div>

<style>
	.tiptap-editor {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.tiptap-editor.no-toolbar {
		gap: 0;
	}

	.hidden {
		display: none;
	}

	.toolbar-wrapper {
		position: sticky;
		top: 0;
		z-index: 10;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem 0;
		background: var(--color-bg-primary);
		margin-bottom: 0.75rem;
		border-bottom: 1px solid var(--color-input-border);
	}

	.upload-status {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--color-primary);
		color: white;
		border-radius: 0.5rem;
		font-size: 0.875rem;
	}

	.upload-spinner {
		width: 1rem;
		height: 1rem;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.upload-error {
		padding: 0.5rem 0.75rem;
		background: #fee2e2;
		color: #dc2626;
		border-radius: 0.5rem;
		font-size: 0.875rem;
	}

	.editor-content {
		padding: 1.5rem;
		background: var(--color-input-bg);
		border: 1px solid var(--color-input-border);
		border-radius: 0.75rem;
		min-height: 400px;
	}

	/* Tiptap editor styles */
	.editor-content :global(.ProseMirror) {
		outline: none;
		min-height: 350px;
	}

	.editor-content :global(.ProseMirror p.is-editor-empty:first-child::before) {
		color: var(--color-text-secondary);
		content: attr(data-placeholder);
		float: left;
		height: 0;
		pointer-events: none;
	}

	/* Typography styles for editor content */
	.editor-content :global(h1) {
		font-size: 2rem;
		font-weight: 700;
		margin: 1.5rem 0 0.75rem;
		color: var(--color-text-primary);
		line-height: 1.2;
	}

	.editor-content :global(h2) {
		font-size: 1.5rem;
		font-weight: 600;
		margin: 1.25rem 0 0.625rem;
		color: var(--color-text-primary);
		line-height: 1.3;
	}

	.editor-content :global(h3) {
		font-size: 1.25rem;
		font-weight: 600;
		margin: 1rem 0 0.5rem;
		color: var(--color-text-primary);
		line-height: 1.4;
	}

	.editor-content :global(p) {
		margin: 0.75rem 0;
		line-height: 1.75;
		color: var(--color-text-primary);
	}

	.editor-content :global(ul),
	.editor-content :global(ol) {
		margin: 0.75rem 0;
		padding-left: 1.5rem;
	}

	.editor-content :global(li) {
		margin: 0.25rem 0;
		line-height: 1.75;
	}

	.editor-content :global(blockquote) {
		margin: 1rem 0;
		padding: 0.5rem 1rem;
		border-left: 4px solid var(--color-primary);
		background: var(--color-accent-gray);
		border-radius: 0 0.5rem 0.5rem 0;
		font-style: italic;
		color: var(--color-text-secondary);
	}

	.editor-content :global(pre) {
		margin: 1rem 0;
		padding: 1rem;
		background: #1e1e1e;
		border-radius: 0.5rem;
		overflow-x: auto;
	}

	.editor-content :global(code) {
		font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
		font-size: 0.875rem;
		color: #e5e5e5;
	}

	.editor-content :global(p code) {
		padding: 0.125rem 0.375rem;
		background: var(--color-accent-gray);
		border-radius: 0.25rem;
		color: var(--color-primary);
	}

	.editor-content :global(hr) {
		margin: 1.5rem 0;
		border: none;
		border-top: 2px solid var(--color-input-border);
	}

	.editor-content :global(.article-image) {
		max-width: 100%;
		height: auto;
		margin: 1rem 0;
		border-radius: 0.5rem;
	}

	.editor-content :global(.article-link) {
		color: var(--color-primary);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.editor-content :global(.article-link:hover) {
		opacity: 0.8;
	}

	.editor-content :global(video),
	.editor-content :global(.article-video) {
		max-width: 100%;
		height: auto;
		margin: 1rem 0;
		border-radius: 0.5rem;
	}

	.editor-content :global(strong) {
		font-weight: 600;
	}

	.editor-content :global(em) {
		font-style: italic;
	}

	.editor-content :global(s) {
		text-decoration: line-through;
	}
</style>
