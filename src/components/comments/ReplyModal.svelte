<script lang="ts">
	/**
	 * ReplyModal — the note-thread reply composer, opened in a modal.
	 *
	 * The thread page used to park a full composer below the reply list, so
	 * "who am I answering" was whatever the scroll position suggested. The
	 * modal makes the target explicit: the note being answered is quoted at
	 * the top, and the composer's own "Replying to" line sits under it.
	 *
	 * Tag-building follows postComment's contract: `parentEvent` is the
	 * thread root (root-scope source), `replyTo` the specific note being
	 * answered (parent-scope source). Callers wire per-row Reply buttons
	 * by passing that row as `replyTo`; a top-level reply passes none.
	 */
	import { createEventDispatcher } from 'svelte';
	import type { NDKEvent } from '@nostr-dev-kit/ndk';
	import { nip19 } from 'nostr-tools';
	import Modal from '../Modal.svelte';
	import ReplyComposer from './ReplyComposer.svelte';
	import Avatar from '../Avatar.svelte';
	import CustomName from '../CustomName.svelte';
	import NoteContent from '../NoteContent.svelte';
	import { formatTimeAgo } from '$lib/freshFeed/posts';

	export let open = false;
	/** Thread root — the root-scope source for NIP-10/NIP-22 tag-building. */
	export let parentEvent: NDKEvent;
	/** The specific note being answered, when not a top-level reply. */
	export let replyTo: NDKEvent | undefined = undefined;
	export let onPosted: ((event: NDKEvent) => void) | null = null;

	const dispatch = createEventDispatcher<{ posted: NDKEvent; cancel: void }>();

	// The note quoted for context: what you're actually answering.
	$: target = replyTo ?? parentEvent;
	$: targetPubkey = target?.author?.hexpubkey || target?.pubkey || '';

	function handlePosted(posted: NDKEvent) {
		dispatch('posted', posted);
		onPosted?.(posted);
		open = false;
	}

	function handleCancel() {
		dispatch('cancel');
		open = false;
	}
</script>

{#if open}
	<Modal bind:open noHeader floatingClose compact maxWidth="40rem" autoHeight>
		<!-- Modal always points aria-labelledby="title" at an element with
		     that id; noHeader removes the built-in one, so provide a
		     screen-reader-only replacement rather than an unnamed dialog. -->
		<span id="title" class="sr-only">Reply to note</span>

		<!-- Extra top padding clears the wallet-style floating close (8px
		     inset, 44px target); the quote starts below it at full width. -->
		<div class="reply-quote">
			<div class="reply-quote-header">
				<a
					href="/user/{nip19.npubEncode(targetPubkey)}"
					class="flex-shrink-0"
					aria-label="View author profile"
				>
					<Avatar pubkey={targetPubkey} size={28} />
				</a>
				<a
					href="/user/{nip19.npubEncode(targetPubkey)}"
					class="font-semibold text-sm username-link truncate"
					style="color: var(--color-text-primary)"
				>
					<CustomName pubkey={targetPubkey} interactive={false} />
				</a>
				<span class="text-xs flex-shrink-0" style="color: var(--color-caption)">
					{target?.created_at ? formatTimeAgo(target.created_at) : ''}
				</span>
			</div>
			<div class="reply-quote-body">
				<NoteContent content={target?.content || ''} showNostrEmbeds={false} />
			</div>
		</div>

		<ReplyComposer
			{parentEvent}
			{replyTo}
			placeholder="Write a reply..."
			submitLabel="Reply"
			showCancel={true}
			autoFocus={true}
			on:cancel={handleCancel}
			onPosted={handlePosted}
		/>
	</Modal>
{/if}

<style>
	.reply-quote {
		/* Clears the wallet-style floating close (8px inset + 44px target),
		   so the quote starts below it instead of colliding with the X. */
		margin-top: 2.5rem;
		border: 1px solid var(--color-input-border);
		border-radius: 0.625rem;
		padding: 0.625rem 0.75rem;
		background: var(--color-card-sunken);
	}
	.reply-quote-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		margin-bottom: 0.375rem;
	}
	.reply-quote-body {
		font-size: 0.875rem;
		line-height: 1.45;
		color: var(--color-text-secondary);
		overflow-wrap: break-word;
		/* No height cap here: capping it clipped the quoted media entirely
		   (images render below the text, so an 8rem box scrolled them out
		   of view). NoteContent's own collapse handles long text; media is
		   height-capped below. */
	}
	/* Quoted media renders at its NATURAL aspect ratio, capped by height —
	   full-width crops (the carousel's default 100%-width 4:3 cover box)
	   turn a photo into an unidentifiable letterbox strip. The wrap
	   shrink-wraps the capped-height image, so width follows the ratio,
	   like every other client's reply quote. */
	.reply-quote-body :global(.single-media-wrap) {
		display: inline-block;
		max-width: 100%;
		overflow: hidden;
	}
	.reply-quote-body :global(.single-media-button) {
		width: auto;
		height: 9rem;
		aspect-ratio: auto;
	}
	.reply-quote-body :global(.single-media-image) {
		width: auto;
		height: 100%;
		object-fit: contain;
	}
	.reply-quote-body :global(.gallery-bleed .media-carousel) {
		display: inline-flex;
		width: auto;
		max-width: 100%;
		gap: 0.375rem;
	}
	.reply-quote-body :global(.media-tile) {
		flex: 0 0 auto;
		width: auto;
		height: 9rem;
		aspect-ratio: auto;
	}
	.reply-quote-body :global(.tile-button img) {
		width: auto;
		height: 100%;
		object-fit: contain;
	}
	/* Both tiles are visible in the quote's natural layout, so the "1 / 2"
	   carousel position capsule is noise here. */
	.reply-quote-body :global(.count-badge) {
		display: none;
	}
	.reply-quote-body :global(video) {
		max-height: 9rem;
		max-width: 100%;
	}
	/* The Modal wrapper's own gap plus the composer's built-in margin
	   stacked to a 2.25rem hole between the quote and "Replying to". The
	   Modal's compact gap (0.5rem) is the spacing; kill the margin. */
	.reply-quote + :global(.reply-composer) {
		margin-top: 0;
	}
	/* The modal composer gets a taller editor than the inline ones — this
	   is the member's primary typing surface, not a sidebar box. Scoped by
	   the adjacent quote card so inline composers elsewhere are untouched. */
	.reply-quote + :global(.reply-composer) :global(.reply-composer-input) {
		min-height: 8rem;
	}
	.username-link:hover {
		color: var(--color-primary) !important;
	}
</style>
