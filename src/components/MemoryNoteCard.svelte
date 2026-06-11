<script lang="ts">
  import { nip19 } from 'nostr-tools';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
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

  $: viewUrl = noteUrl(event.id);

  function share() {
    try {
      const nevent = nip19.neventEncode({ id: event.id, author: event.pubkey });
      openComposerWithQuote(nevent, event);
    } catch (error) {
      console.warn('[memories] Failed to open composer with quote:', error);
    }
  }
</script>

<article class="memory-note-card rounded-xl border p-4">
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
</article>

<style>
  .memory-note-card {
    background-color: var(--color-bg-primary);
    border-color: var(--color-input-border);
  }
</style>
