<script lang="ts">
  /**
   * ReplyDraftDock — minimized reply editors (desktop).
   *
   * Mirrors PostModal's Gmail-style note-draft pill: when a reply box
   * closes with unsent words, its draft docks here. Tapping a pill routes
   * to the replied-to note's thread (where the draft auto-restores into
   * that note's reply box) and signals the thread page to open it.
   * Reply drafts live in their own store — never mixed with note drafts.
   */
  import { goto } from '$app/navigation';
  import { nip19 } from 'nostr-tools';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import ChatIcon from 'phosphor-svelte/lib/Chat';
  import { replyDraftsStore, deleteReplyDraft, replyDraftResumeTarget } from '$lib/replyDraftStore';

  function resume(targetId: string) {
    replyDraftResumeTarget.set(targetId);
    try {
      goto('/' + nip19.neventEncode({ id: targetId }));
    } catch {
      goto('/' + nip19.noteEncode(targetId));
    }
  }

  function discard(targetId: string) {
    if (!confirm('Discard this reply draft? This cannot be undone.')) return;
    deleteReplyDraft(targetId);
  }
</script>

{#if $replyDraftsStore.length > 0}
  <!-- Desktop-only, docked above the note composer's minimized pill. -->
  <div
    class="hidden md:flex flex-col gap-1 fixed z-50 w-64"
    style="bottom: calc(var(--bottom-nav-height, 0px) + env(safe-area-inset-bottom, 0px) + 3.5rem); right: calc(1.25rem + 56px + 0.75rem);"
  >
    {#each $replyDraftsStore as draft (draft.targetId)}
      <div
        class="flex items-center gap-2 pl-3 pr-2 py-2.5 rounded-xl cursor-pointer"
        style="background: var(--color-input-bg); border: 1px solid var(--color-input-border); box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.35);"
        on:click={() => resume(draft.targetId)}
        on:keydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            resume(draft.targetId);
          }
        }}
        role="button"
        tabindex="0"
        aria-label="Continue reply"
      >
        <ChatIcon size={14} class="text-caption flex-shrink-0" weight="fill" />
        <span class="text-sm truncate flex-1 min-w-0" style="color: var(--color-text-primary)">
          {draft.preview || 'Reply'}
        </span>
        <PencilSimpleIcon size={12} class="text-caption flex-shrink-0" />
        <button
          type="button"
          on:click|stopPropagation={() => discard(draft.targetId)}
          class="p-0.5 text-caption hover:text-primary flex-shrink-0"
          aria-label="Discard reply draft"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    {/each}
  </div>
{/if}
