<script lang="ts">
  /**
   * DraftDock — minimized drafts as Gmail-style tabs docked along the
   * bottom edge, on every viewport: reply drafts (per-note, from
   * replyDraftStore) and the parked top-level note draft (PostModal's
   * localStorage draft) each get their own tab.
   *
   * Tapping a tab restores the draft where it lives: a reply tab routes to
   * the replied-to note's thread and opens that reply box; the note tab
   * reopens the post composer, which restores its draft from localStorage.
   * The row keeps clear of the compose FAB (right) and tells the
   * back-to-top button (center) to lift above it while drafts are docked.
   */
  import { goto } from '$app/navigation';
  import { nip19 } from 'nostr-tools';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import ChatIcon from 'phosphor-svelte/lib/Chat';
  import {
    replyDraftsStore,
    deleteReplyDraft,
    replyDraftResumeTarget,
    draftDockVisible
  } from '$lib/replyDraftStore';
  import { postComposerOpen, noteDraftDocked, clearQuotedNote } from '$lib/postComposerStore';

  const NOTE_DRAFT_KEY = 'zapcooking_note_draft';

  // The note tab covers both park paths: the minimize event (store, with the
  // composer's polished preview) and a plain close, where the draft only
  // persists to localStorage. Never shown while the composer is open — that
  // is the draft's own surface.
  function storedNoteTab(): { preview: string } | null {
    try {
      const raw = localStorage.getItem(NOTE_DRAFT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const text = typeof parsed?.content === 'string' ? parsed.content.trim() : '';
      if (!text) return null;
      return { preview: text.length > 60 ? `${text.slice(0, 60).trimEnd()}…` : text };
    } catch {
      return null;
    }
  }
  $: noteTab = $noteDraftDocked ?? (!$postComposerOpen ? storedNoteTab() : null);
  $: tabCount = $replyDraftsStore.length + (noteTab ? 1 : 0);
  // The back-to-top button shares this bottom zone — it lifts above the
  // docked tabs while any draft waits.
  $: draftDockVisible.set(tabCount > 0);

  function resumeReply(targetId: string) {
    replyDraftResumeTarget.set(targetId);
    try {
      goto('/' + nip19.neventEncode({ id: targetId }));
    } catch {
      goto('/' + nip19.noteEncode(targetId));
    }
  }

  function openNoteDraft() {
    postComposerOpen.set(true);
  }

  function discardReply(targetId: string) {
    if (!confirm('Discard this reply draft? This cannot be undone.')) return;
    deleteReplyDraft(targetId);
  }

  function discardNoteDraft() {
    if (!confirm('Discard this note draft? This cannot be undone.')) return;
    try {
      localStorage.removeItem(NOTE_DRAFT_KEY);
    } catch {}
    noteDraftDocked.set(null);
    clearQuotedNote();
  }
</script>

{#if tabCount > 0}
  <!-- Tabs docked along the bottom edge, full width: they scroll UNDER the
       compose FAB (which sits a layer above) rather than being cropped
       short, and the centered back-to-top button lifts above the strip. -->
  <div
    class="fixed z-30 flex items-end gap-1 overflow-x-auto"
    style="left: 0.75rem; right: 0.75rem; bottom: calc(var(--bottom-nav-height, 56px) + env(safe-area-inset-bottom, 0px));"
  >
    {#each $replyDraftsStore as draft (draft.targetId)}
      <div
        class="flex items-center gap-1.5 pl-2.5 pr-1 py-2 rounded-t-xl cursor-pointer shrink-0 max-w-[11rem]"
        style="background: var(--color-input-bg); border: 1px solid var(--color-input-border); border-bottom: none; box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.25);"
        on:click={() => resumeReply(draft.targetId)}
        on:keydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            resumeReply(draft.targetId);
          }
        }}
        role="button"
        tabindex="0"
        aria-label="Continue reply draft"
      >
        <ChatIcon size={13} class="text-caption shrink-0" weight="fill" />
        <span class="text-xs truncate min-w-0" style="color: var(--color-text-primary)">
          {draft.preview || 'Reply'}
        </span>
        <button
          type="button"
          on:click|stopPropagation={() => discardReply(draft.targetId)}
          class="p-0.5 text-caption hover:text-primary shrink-0"
          aria-label="Discard reply draft"
        >
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    {/each}

    {#if noteTab}
      <div
        class="flex items-center gap-1.5 pl-2.5 pr-1 py-2 rounded-t-xl cursor-pointer shrink-0 max-w-[11rem]"
        style="background: var(--color-input-bg); border: 1px solid var(--color-input-border); border-bottom: none; box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.25);"
        on:click={openNoteDraft}
        on:keydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openNoteDraft();
          }
        }}
        role="button"
        tabindex="0"
        aria-label="Continue note draft"
      >
        <PencilSimpleIcon size={13} class="text-caption shrink-0" />
        <span class="text-xs truncate min-w-0" style="color: var(--color-text-primary)">
          {noteTab.preview || 'New note'}
        </span>
        <button
          type="button"
          on:click|stopPropagation={discardNoteDraft}
          class="p-0.5 text-caption hover:text-primary shrink-0"
          aria-label="Discard note draft"
        >
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    {/if}
  </div>
{/if}
