<script context="module" lang="ts">
	// Portal the node to document.body so the dropdown's positioning is
	// document-relative (otherwise a transform on a containing modal
	// would scope it to the modal box).
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				if (node.parentNode === document.body) {
					document.body.removeChild(node);
				}
			}
		};
	}
</script>

<script lang="ts">
	import { createEventDispatcher, onMount, tick } from 'svelte';
	import CustomAvatar from './CustomAvatar.svelte';
	import type { MentionSuggestion } from '$lib/mentionComposer';

	export let show = false;
	export let suggestions: MentionSuggestion[] = [];
	export let selectedIndex = 0;
	export let searching = false;
	export let query = '';

	const dispatch = createEventDispatcher<{ select: MentionSuggestion }>();

	let fixedTop = 0;
	let fixedLeft = 0;
	let fixedMaxHeight = 240;
	let dropdownEl: HTMLDivElement;

	const GAP = 4;
	const MARGIN = 8;
	const DEFAULT_WIDTH = 280;

	function computePosition() {
		if (!show || !dropdownEl) return;
		const sel = window.getSelection();
		if (!sel || !sel.rangeCount) return;

		let caretRect: DOMRect | { top: number; bottom: number; left: number; height: number } =
			sel.getRangeAt(0).getBoundingClientRect();
		if (caretRect.height === 0) {
			const parentRect = (
				sel.anchorNode?.parentElement as HTMLElement | undefined
			)?.getBoundingClientRect();
			if (!parentRect) return;
			caretRect = parentRect;
		}

		const vv = window.visualViewport;
		const vpTop = vv?.offsetTop ?? 0;
		const vpLeft = vv?.offsetLeft ?? 0;
		const vpHeight = vv?.height ?? window.innerHeight;
		const vpWidth = vv?.width ?? window.innerWidth;
		const vpBottom = vpTop + vpHeight;
		const vpRight = vpLeft + vpWidth;

		const anchorBottom = caretRect.bottom;
		const anchorLeft = caretRect.left;

		const width = dropdownEl.offsetWidth || DEFAULT_WIDTH;

		const spaceBelow = vpBottom - anchorBottom - GAP - MARGIN;
		const layoutTop = anchorBottom + GAP;
		const available = Math.max(120, spaceBelow);

		let layoutLeft = anchorLeft;
		if (layoutLeft + width > vpRight - MARGIN) {
			layoutLeft = vpRight - width - MARGIN;
		}
		if (layoutLeft < vpLeft + MARGIN) {
			layoutLeft = vpLeft + MARGIN;
		}

		// Document-relative coords. iOS Safari with the keyboard open
		// scrolls the page (window.scrollY > 0) and treats position:fixed
		// like position:absolute, so standardizing on absolute + scrollY
		// offset gives consistent positioning on every platform. scrollY
		// is 0 on desktop / Android / emulated mobile.
		fixedTop = layoutTop + window.scrollY;
		fixedLeft = layoutLeft + window.scrollX;
		fixedMaxHeight = available;
	}

	async function schedulePosition() {
		await tick();
		computePosition();
	}

	// Recompute when dropdown opens or its size changes (new suggestions,
	// searching indicator, etc.) — each of these can grow/shrink the
	// dropdown and change whether "below" still fits.
	$: if (show) {
		void suggestions;
		void searching;
		void query;
		schedulePosition();
	}

	onMount(() => {
		const handler = () => {
			if (show) computePosition();
		};
		window.addEventListener('resize', handler);
		window.visualViewport?.addEventListener('resize', handler);
		window.visualViewport?.addEventListener('scroll', handler);
		return () => {
			window.removeEventListener('resize', handler);
			window.visualViewport?.removeEventListener('resize', handler);
			window.visualViewport?.removeEventListener('scroll', handler);
		};
	});
</script>

{#if show}
	<div
		bind:this={dropdownEl}
		use:portal
		class="mention-dropdown"
		style="border-color: var(--color-input-border); top: {fixedTop}px; left: {fixedLeft}px; max-height: {fixedMaxHeight}px;"
	>
		{#if suggestions.length > 0}
			<div
				class="mention-dropdown-content"
				style="max-height: {Math.max(80, fixedMaxHeight - 8)}px;"
			>
				{#each suggestions as suggestion, index}
					<button
						type="button"
						on:click={() => dispatch('select', suggestion)}
						on:mousedown|preventDefault={() => dispatch('select', suggestion)}
						class="mention-option"
						class:mention-selected={index === selectedIndex}
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
		{:else if searching}
			<div class="mention-empty">Searching...</div>
		{:else if query.length > 0}
			<div class="mention-empty">No users found</div>
		{/if}
	</div>
{/if}

<style>
	/* PR #143 fix #3: z-index 50 -> 1000 */
	.mention-dropdown {
		position: absolute;
		z-index: 1000;
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
