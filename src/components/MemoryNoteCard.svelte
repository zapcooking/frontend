<script lang="ts">
  import { nip19 } from 'nostr-tools';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { goto } from '$app/navigation';
  import Avatar from './Avatar.svelte';
  import AuthorName from './AuthorName.svelte';
  import NoteContent from './NoteContent.svelte';
  import { openComposerWithQuote } from '$lib/postComposerStore';
  import { formatDate } from '$lib/utils';
  import QuotesIcon from 'phosphor-svelte/lib/Quotes';

  export let event: NDKEvent;
  export let yearsAgo: number;

  $: yearLabel = yearsAgo === 1 ? '1 year ago' : `${yearsAgo} years ago`;
  $: dateLabel = formatDate(event.created_at || 0);
  $: timeLabel = new Date((event.created_at || 0) * 1000).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit'
  });

  function noteUrl(id: string): string | null {
    try {
      return `/${nip19.noteEncode(id)}`;
    } catch {
      return null;
    }
  }

  // The thread's root when the memory is a reply, else the note itself —
  // the [nip19] page then renders the whole thread in the normal view.
  // Marker style first (e tag with "root"), then NIP-10 positional (first
  // e tag is the root for replies), then a lone parent tag. Mention-
  // marked e tags are excluded to mirror isReplyNote (memories.ts): a
  // top-level note that merely mentions another note opens itself, not
  // the mention.
  function rootNoteId(e: NDKEvent): string | null {
    const eTags = e.tags.filter(
      (t) => Array.isArray(t) && t[0] === 'e' && t[3]?.toLowerCase() !== 'mention'
    );
    const rootTag = eTags.find((t) => t[3] === 'root');
    if (rootTag) return rootTag[1] as string;
    if (eTags.length > 0) return eTags[0][1] as string;
    return null;
  }

  $: viewUrl = noteUrl(rootNoteId(event) ?? event.id);

  function share() {
    try {
      const nevent = nip19.neventEncode({ id: event.id, author: event.pubkey });
      openComposerWithQuote(nevent, event);
    } catch (error) {
      console.warn('[memories] Failed to open composer with quote:', error);
    }
  }

  function handleCardClick() {
    if (viewUrl) goto(viewUrl);
  }

  // Same guard NoteEmbed uses: let inner links and buttons (content links,
  // View, Share) keep their own behavior instead of double-navigating.
  function handleCardClickEvent(e: MouseEvent) {
    if (e.target instanceof Element && e.target.closest('a, button')) return;
    handleCardClick();
  }

  function handleCardKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardClick();
    }
  }
</script>

<div
  class="memory-note-card rounded-xl border p-4 cursor-pointer"
  role="link"
  tabindex="0"
  aria-label="Open this memory's note"
  on:click={handleCardClickEvent}
  on:keydown={handleCardKeydown}
>
  <div class="flex items-center gap-2 mb-2">
    <Avatar pubkey={event.pubkey} size={32} />
    <div class="min-w-0 flex-1">
      <AuthorName {event} />
      <p class="text-xs" style="color: var(--color-text-secondary);">
        {yearLabel} · {dateLabel}
      </p>
    </div>
  </div>

  <NoteContent content={event.content} className="text-sm" />

  <div class="flex items-center justify-between mt-3">
    <span class="text-xs" style="color: var(--color-text-secondary);">{timeLabel}</span>
    <div class="flex items-center gap-3">
      {#if viewUrl}
        <a
          href={viewUrl}
          class="text-xs font-medium hover:opacity-80 transition-opacity"
          style="color: var(--color-text-secondary);"
        >
          View
        </a>
      {/if}
      <button
        on:click={share}
        class="flex items-center gap-1 text-xs font-medium text-orange-500 hover:text-orange-600 transition-colors"
        aria-label="Share this memory as a quote"
      >
        <QuotesIcon size={14} />
        Share
      </button>
    </div>
  </div>
</div>

<style>
  .memory-note-card {
    background-color: var(--color-bg-primary);
    border-color: var(--color-input-border);
    transition: border-color 0.15s ease-out;
  }

  /* Clickability affordance — same amber hover treatment the wallet
     pills use. */
  .memory-note-card:hover,
  .memory-note-card:focus-visible {
    border-color: rgba(251, 191, 36, 0.5);
    outline: none;
  }
</style>
