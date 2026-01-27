<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { Editor } from '@tiptap/core';
	import TextBIcon from 'phosphor-svelte/lib/TextB';
	import TextItalicIcon from 'phosphor-svelte/lib/TextItalic';
	import TextStrikethroughIcon from 'phosphor-svelte/lib/TextStrikethrough';
	import ListBulletsIcon from 'phosphor-svelte/lib/ListBullets';
	import ListNumbersIcon from 'phosphor-svelte/lib/ListNumbers';
	import QuotesIcon from 'phosphor-svelte/lib/Quotes';
	import CodeIcon from 'phosphor-svelte/lib/Code';
	import LinkIcon from 'phosphor-svelte/lib/Link';
	import ImageIcon from 'phosphor-svelte/lib/Image';
	import MinusIcon from 'phosphor-svelte/lib/Minus';
	import TextHOneIcon from 'phosphor-svelte/lib/TextHOne';
	import TextHTwoIcon from 'phosphor-svelte/lib/TextHTwo';
	import TextHThreeIcon from 'phosphor-svelte/lib/TextHThree';
	import TextHIcon from 'phosphor-svelte/lib/TextH';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
	import VideoIcon from 'phosphor-svelte/lib/VideoCamera';
	import ArrowUUpLeftIcon from 'phosphor-svelte/lib/ArrowUUpLeft';
	import ArrowUUpRightIcon from 'phosphor-svelte/lib/ArrowUUpRight';

	export let editor: Editor | null = null;
	export let onImageUpload: () => void = () => {};
	export let onVideoUpload: () => void = () => {};

	let showLinkInput = false;
	let linkUrl = '';
	let linkInputRef: HTMLInputElement;
	let toolbarRef: HTMLDivElement;
	
	// Dropdown states
	let showHeadingDropdown = false;
	let showListDropdown = false;
	let showMediaDropdown = false;
	
	// Track editor updates for undo/redo reactivity
	let editorUpdateKey = 0;

	// Close dropdowns when clicking outside
	function handleClickOutside(e: MouseEvent) {
		if (toolbarRef && !toolbarRef.contains(e.target as Node)) {
			showHeadingDropdown = false;
			showListDropdown = false;
			showMediaDropdown = false;
		}
	}

	// Set up editor update listeners
	let updateHandler: (() => void) | null = null;
	
	$: if (editor && !updateHandler) {
		updateHandler = () => {
			editorUpdateKey++;
		};
		
		editor.on('update', updateHandler);
		editor.on('selectionUpdate', updateHandler);
		editor.on('transaction', updateHandler);
	}

	onMount(() => {
		document.addEventListener('click', handleClickOutside);
	});

	onDestroy(() => {
		document.removeEventListener('click', handleClickOutside);
		if (editor && updateHandler) {
			editor.off('update', updateHandler);
			editor.off('selectionUpdate', updateHandler);
			editor.off('transaction', updateHandler);
		}
	});

	function closeAllDropdowns() {
		showHeadingDropdown = false;
		showListDropdown = false;
	}

	function toggleHeadingDropdown() {
		showListDropdown = false;
		showMediaDropdown = false;
		showHeadingDropdown = !showHeadingDropdown;
	}

	function toggleListDropdown() {
		showHeadingDropdown = false;
		showMediaDropdown = false;
		showListDropdown = !showListDropdown;
	}

	function toggleMediaDropdown() {
		showHeadingDropdown = false;
		showListDropdown = false;
		showMediaDropdown = !showMediaDropdown;
	}

	function handleImageSelect() {
		showMediaDropdown = false;
		onImageUpload();
	}

	function handleVideoSelect() {
		showMediaDropdown = false;
		onVideoUpload();
	}

	// Undo/Redo toggle
	function handleUndoRedo() {
		if (!editor) return;
		
		// Prioritize undo if available, otherwise redo
		if (editor.can().undo()) {
			editor.chain().focus().undo().run();
		} else if (editor.can().redo()) {
			editor.chain().focus().redo().run();
		}
		
		// Force reactivity update after a brief delay to allow editor state to update
		setTimeout(() => {
			editorUpdateKey++;
		}, 10);
	}

	// Check if undo/redo is available - reactive to editor updates
	$: editorUpdateKey; // Force reactivity
	$: canUndo = editor?.can().undo() ?? false;
	$: canRedo = editor?.can().redo() ?? false;

	function toggleHeading(level: 1 | 2 | 3) {
		if (!editor) return;
		editor.chain().focus().toggleHeading({ level }).run();
		showHeadingDropdown = false;
	}

	function toggleBold() {
		if (!editor) return;
		editor.chain().focus().toggleBold().run();
	}

	function toggleItalic() {
		if (!editor) return;
		editor.chain().focus().toggleItalic().run();
	}

	function toggleStrike() {
		if (!editor) return;
		editor.chain().focus().toggleStrike().run();
	}

	function toggleBulletList() {
		if (!editor) return;
		editor.chain().focus().toggleBulletList().run();
		showListDropdown = false;
	}

	function toggleOrderedList() {
		if (!editor) return;
		editor.chain().focus().toggleOrderedList().run();
		showListDropdown = false;
	}

	function toggleBlockquote() {
		if (!editor) return;
		editor.chain().focus().toggleBlockquote().run();
	}

	function toggleCodeBlock() {
		if (!editor) return;
		editor.chain().focus().toggleCodeBlock().run();
	}

	function insertHorizontalRule() {
		if (!editor) return;
		editor.chain().focus().setHorizontalRule().run();
	}

	function openLinkInput() {
		if (!editor) return;
		
		// Get existing link if cursor is on one
		const previousUrl = editor.getAttributes('link').href;
		linkUrl = previousUrl || '';
		showLinkInput = true;
		
		// Focus input after it renders
		setTimeout(() => linkInputRef?.focus(), 50);
	}

	function setLink() {
		if (!editor) return;
		
		if (linkUrl === '') {
			editor.chain().focus().extendMarkRange('link').unsetLink().run();
		} else {
			// Ensure URL has protocol
			let url = linkUrl;
			if (!/^https?:\/\//i.test(url)) {
				url = 'https://' + url;
			}
			editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
		}
		
		showLinkInput = false;
		linkUrl = '';
	}

	function cancelLink() {
		showLinkInput = false;
		linkUrl = '';
		editor?.chain().focus().run();
	}

	function handleLinkKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			setLink();
		} else if (e.key === 'Escape') {
			cancelLink();
		}
	}

	// Check if format is active
	$: isActive = (type: string, attrs?: Record<string, unknown>) => {
		if (!editor) return false;
		return editor.isActive(type, attrs);
	};
</script>

<div class="editor-toolbar" bind:this={toolbarRef}>
	<!-- Headings Dropdown -->
	<div class="toolbar-group">
		<div class="dropdown-wrapper">
			<button
				type="button"
				class="toolbar-btn dropdown-trigger"
				class:active={isActive('heading', { level: 1 }) || isActive('heading', { level: 2 }) || isActive('heading', { level: 3 })}
				on:click={toggleHeadingDropdown}
				title="Headings"
			>
				<TextHIcon size={18} />
				<CaretDownIcon size={12} class="caret" />
			</button>
			{#if showHeadingDropdown}
				<div class="dropdown-menu">
					<button
						type="button"
						class="dropdown-item"
						class:active={isActive('heading', { level: 1 })}
						on:click={() => toggleHeading(1)}
					>
						<TextHOneIcon size={18} />
						<span>Heading 1</span>
					</button>
					<button
						type="button"
						class="dropdown-item"
						class:active={isActive('heading', { level: 2 })}
						on:click={() => toggleHeading(2)}
					>
						<TextHTwoIcon size={18} />
						<span>Heading 2</span>
					</button>
					<button
						type="button"
						class="dropdown-item"
						class:active={isActive('heading', { level: 3 })}
						on:click={() => toggleHeading(3)}
					>
						<TextHThreeIcon size={18} />
						<span>Heading 3</span>
					</button>
				</div>
			{/if}
		</div>
	</div>

	<div class="toolbar-divider" />

	<!-- Text formatting -->
	<div class="toolbar-group">
		<button
			type="button"
			class="toolbar-btn"
			class:active={isActive('bold')}
			on:click={toggleBold}
			title="Bold (Ctrl+B)"
		>
			<TextBIcon size={18} />
		</button>
		<button
			type="button"
			class="toolbar-btn"
			class:active={isActive('italic')}
			on:click={toggleItalic}
			title="Italic (Ctrl+I)"
		>
			<TextItalicIcon size={18} />
		</button>
		<button
			type="button"
			class="toolbar-btn"
			class:active={isActive('strike')}
			on:click={toggleStrike}
			title="Strikethrough"
		>
			<TextStrikethroughIcon size={18} />
		</button>
	</div>

	<div class="toolbar-divider" />

	<!-- Lists Dropdown -->
	<div class="toolbar-group">
		<div class="dropdown-wrapper">
			<button
				type="button"
				class="toolbar-btn dropdown-trigger"
				class:active={isActive('bulletList') || isActive('orderedList')}
				on:click={toggleListDropdown}
				title="Lists"
			>
				<ListBulletsIcon size={18} />
				<CaretDownIcon size={12} class="caret" />
			</button>
			{#if showListDropdown}
				<div class="dropdown-menu">
					<button
						type="button"
						class="dropdown-item"
						class:active={isActive('bulletList')}
						on:click={toggleBulletList}
					>
						<ListBulletsIcon size={18} />
						<span>Bullet List</span>
					</button>
					<button
						type="button"
						class="dropdown-item"
						class:active={isActive('orderedList')}
						on:click={toggleOrderedList}
					>
						<ListNumbersIcon size={18} />
						<span>Numbered List</span>
					</button>
				</div>
			{/if}
		</div>
	</div>

	<div class="toolbar-divider" />

	<!-- Blocks -->
	<div class="toolbar-group">
		<button
			type="button"
			class="toolbar-btn"
			class:active={isActive('blockquote')}
			on:click={toggleBlockquote}
			title="Quote"
		>
			<QuotesIcon size={18} />
		</button>
		<button
			type="button"
			class="toolbar-btn"
			class:active={isActive('codeBlock')}
			on:click={toggleCodeBlock}
			title="Code Block"
		>
			<CodeIcon size={18} />
		</button>
		<button
			type="button"
			class="toolbar-btn"
			on:click={insertHorizontalRule}
			title="Horizontal Divider"
		>
			<MinusIcon size={18} />
		</button>
	</div>

	<div class="toolbar-divider" />

	<!-- Link -->
	<div class="toolbar-group">
		<div class="relative">
			<button
				type="button"
				class="toolbar-btn"
				class:active={isActive('link')}
				on:click={openLinkInput}
				title="Add Link (Ctrl+K)"
			>
				<LinkIcon size={18} />
			</button>
			
			{#if showLinkInput}
				<div class="link-input-popover">
					<input
						bind:this={linkInputRef}
						bind:value={linkUrl}
						type="url"
						placeholder="Enter URL..."
						class="link-input"
						on:keydown={handleLinkKeydown}
					/>
					<button type="button" class="link-btn save" on:click={setLink}>
						Save
					</button>
					<button type="button" class="link-btn cancel" on:click={cancelLink}>
						Cancel
					</button>
				</div>
			{/if}
		</div>
		
		<!-- Media Dropdown (Photo/Video) -->
		<div class="dropdown-wrapper">
			<button
				type="button"
				class="toolbar-btn dropdown-trigger"
				on:click={toggleMediaDropdown}
				title="Insert Media"
			>
				<ImageIcon size={18} />
				<CaretDownIcon size={12} class="caret" />
			</button>
			{#if showMediaDropdown}
				<div class="dropdown-menu dropdown-menu-right">
					<button
						type="button"
						class="dropdown-item"
						on:click={handleImageSelect}
					>
						<ImageIcon size={18} />
						<span>Photo</span>
					</button>
					<button
						type="button"
						class="dropdown-item"
						on:click={handleVideoSelect}
					>
						<VideoIcon size={18} />
						<span>Video</span>
					</button>
				</div>
			{/if}
		</div>

		<!-- Undo/Redo Toggle -->
		<div class="toolbar-group">
			<button
				type="button"
				class="toolbar-btn toolbar-btn-compact"
				on:click={handleUndoRedo}
				disabled={!canUndo && !canRedo}
				title={canUndo ? 'Undo (Ctrl+Z)' : canRedo ? 'Redo (Ctrl+Shift+Z)' : 'Undo/Redo'}
			>
				{#if canUndo}
					<ArrowUUpLeftIcon size={16} />
				{:else if canRedo}
					<ArrowUUpRightIcon size={16} />
				{:else}
					<ArrowUUpLeftIcon size={16} />
				{/if}
			</button>
		</div>
	</div>
</div>

<style>
	.editor-toolbar {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.5rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-input-border);
		border-radius: 0.75rem;
		flex-wrap: wrap;
	}

	.toolbar-group {
		display: flex;
		align-items: center;
		gap: 0.125rem;
	}

	.toolbar-divider {
		width: 1px;
		height: 1.5rem;
		background: var(--color-input-border);
		margin: 0 0.25rem;
	}

	.toolbar-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 0.5rem;
		color: var(--color-text-secondary);
		transition: all 0.15s ease;
	}

	.toolbar-btn:hover {
		background: var(--color-accent-gray);
		color: var(--color-text-primary);
	}

	.toolbar-btn.active {
		background: var(--color-primary);
		color: white;
	}

	.toolbar-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.toolbar-btn-compact {
		width: 1.75rem;
		height: 1.75rem;
	}

	.relative {
		position: relative;
	}

	/* Dropdown styles */
	.dropdown-wrapper {
		position: relative;
	}

	.dropdown-trigger {
		gap: 0.125rem;
		padding-right: 0.25rem;
	}

	.dropdown-trigger :global(.caret) {
		opacity: 0.5;
	}

	.dropdown-menu {
		position: absolute;
		top: 100%;
		left: 0;
		margin-top: 0.25rem;
		padding: 0.25rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-input-border);
		border-radius: 0.5rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		z-index: 100;
		min-width: 140px;
	}

	.dropdown-menu-right {
		left: auto;
		right: 0;
	}

	.dropdown-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.625rem;
		border-radius: 0.375rem;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		transition: all 0.15s ease;
	}

	.dropdown-item:hover {
		background: var(--color-accent-gray);
		color: var(--color-text-primary);
	}

	.dropdown-item.active {
		background: var(--color-primary);
		color: white;
	}

	.link-input-popover {
		position: absolute;
		top: 100%;
		left: 0;
		margin-top: 0.5rem;
		padding: 0.5rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-input-border);
		border-radius: 0.5rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		z-index: 100;
		display: flex;
		gap: 0.5rem;
		align-items: center;
		white-space: nowrap;
	}

	.link-input {
		padding: 0.375rem 0.5rem;
		border: 1px solid var(--color-input-border);
		border-radius: 0.375rem;
		background: var(--color-input-bg);
		color: var(--color-text-primary);
		font-size: 0.875rem;
		width: 200px;
	}

	.link-input:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.link-btn {
		padding: 0.375rem 0.75rem;
		border-radius: 0.375rem;
		font-size: 0.75rem;
		font-weight: 500;
		transition: all 0.15s ease;
	}

	.link-btn.save {
		background: var(--color-primary);
		color: white;
	}

	.link-btn.save:hover {
		opacity: 0.9;
	}

	.link-btn.cancel {
		color: var(--color-text-secondary);
	}

	.link-btn.cancel:hover {
		background: var(--color-accent-gray);
	}

	@media (max-width: 640px) {
		.editor-toolbar {
			gap: 0.125rem;
			padding: 0.375rem;
		}

		.toolbar-btn {
			width: 1.75rem;
			height: 1.75rem;
		}

		.toolbar-divider {
			margin: 0 0.125rem;
		}

		.dropdown-menu {
			min-width: 130px;
		}

		.dropdown-item {
			padding: 0.375rem 0.5rem;
			font-size: 0.8125rem;
		}

		.link-input-popover {
			left: -100px;
			flex-wrap: wrap;
		}

		.link-input {
			width: 150px;
		}
	}
</style>
