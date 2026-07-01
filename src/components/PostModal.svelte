<script lang="ts">
  import Modal from './Modal.svelte';
  import PostComposer from './PostComposer.svelte';
  import CloseIcon from 'phosphor-svelte/lib/XCircle';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import { quotedNoteStore, clearQuotedNote } from '$lib/postComposerStore';

  export let open = false;

  type RelaySelection = 'all' | 'pantry';
  let selectedRelay: RelaySelection = 'all';

  let composer: PostComposer;
  let minimized = false;
  let isPosting = false;
  let minimizedPreview = '';

  const DRAFT_KEY = 'zapcooking_note_draft';

  // Opening the composer (from anywhere) always supersedes a minimized draft
  $: if (open) minimized = false;

  function handleClose() {
    open = false;
    minimized = false;
    clearQuotedNote();
  }

  // Backdrop click / Escape close the Modal directly. Route them through the
  // composer's requestClose() so the draft is flushed and the
  // minimize-vs-close (and quote-clear) logic runs, instead of `open` silently
  // flipping to false and bypassing it. Falls back to a plain close if the
  // composer isn't mounted.
  function handleBackdropClose() {
    if (composer) {
      composer.requestClose();
    } else {
      handleClose();
    }
  }

  // Composer asked to minimize (desktop close with unsaved content). The draft
  // is already flushed to localStorage; we just hide the modal and show a pill.
  // Keep the quoted note so it's restored on reopen.
  function handleMinimize(e: CustomEvent<{ preview: string }>) {
    minimizedPreview = e.detail.preview;
    open = false;
    minimized = true;
  }

  function restoreMinimized() {
    minimized = false;
    open = true;
  }

  function discardMinimized() {
    if (!confirm('Discard this draft? This cannot be undone.')) return;
    minimized = false;
    minimizedPreview = '';
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch (_) {}
    clearQuotedNote();
  }
</script>

<Modal bind:open allowOverflow={false} noHeader={true} wide={!isPosting} maxWidth={isPosting ? '22rem' : null} autoHeight={isPosting} cleanup={handleBackdropClose} locked={isPosting} fullScreenMobile={true}>
  <div class="composer-modal-body flex flex-col gap-4 flex-1 min-h-0 overflow-hidden">
    <!-- Header: relay selector + contextual hint on left, X on right -->
    {#if !isPosting}
    <div class="composer-modal-header flex items-start justify-between gap-2">
      <div class="flex items-center flex-wrap gap-x-2 gap-y-1">
        <label for="relay-select" class="composer-modal-label text-xs text-caption whitespace-nowrap">Post to:</label>
        <select
          id="relay-select"
          bind:value={selectedRelay}
          class="composer-modal-select px-2 py-1 text-xs rounded-lg border transition-colors"
          style="
            background: var(--color-input-bg);
            border-color: var(--color-input-border);
            color: var(--color-text-primary);
          "
        >
          <option value="all">All relays</option>
          <option value="pantry">🏪 Pantry only</option>
        </select>
        {#if selectedRelay === 'pantry'}
          <span class="composer-modal-hint text-[11px] text-caption"><span class="mr-1">🏪</span>If you're seeing this, you're early.</span>
        {:else}
          <span class="composer-modal-hint text-[11px] text-caption"><span class="mr-1">📡</span>All connected relays</span>
        {/if}
      </div>

      <button
        class="composer-modal-close cursor-pointer hover:opacity-80 transition-opacity flex-shrink-0"
        style="color: var(--color-text-primary)"
        on:click={() => composer?.requestClose()}
        aria-label="Close"
      >
        <CloseIcon size={24} />
      </button>
    </div>
    {/if}

    <PostComposer
      bind:this={composer}
      variant="modal"
      {selectedRelay}
      initialQuotedNote={$quotedNoteStore}
      on:close={handleClose}
      on:minimize={handleMinimize}
      on:posting={(e) => (isPosting = e.detail)}
    />
  </div>
</Modal>

{#if minimized && !open}
  <!-- Desktop-only minimized draft drawer (Gmail-style). Docks flush to the
       bottom edge on the left, clear of the bottom-right FAB and the bottom
       nav. Click to reopen. -->
  <div
    class="hidden md:block fixed z-50"
    style="bottom: calc(var(--bottom-nav-height, 0px) + env(safe-area-inset-bottom, 0px)); right: calc(1.25rem + 56px + 0.75rem);"
  >
    <div
      class="flex items-center gap-2 pl-3 pr-2 py-2.5 rounded-t-xl cursor-pointer"
      style="background: var(--color-input-bg); border: 1px solid var(--color-input-border); border-bottom: none; box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.35);"
      on:click={restoreMinimized}
      on:keydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          restoreMinimized();
        }
      }}
      role="button"
      tabindex="0"
      aria-label="Restore draft"
    >
      <PencilSimpleIcon size={14} class="text-caption flex-shrink-0" />
      <span class="text-sm truncate max-w-[200px]" style="color: var(--color-text-primary)">
        {minimizedPreview || 'New note'}
      </span>
      <button
        type="button"
        on:click|stopPropagation={discardMinimized}
        class="ml-1 p-0.5 text-caption hover:text-primary flex-shrink-0"
        aria-label="Discard draft"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  </div>
{/if}

<style>
  select:focus {
    outline: none;
    border-color: #f59e0b;
    box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.35);
  }

  select option {
    background: var(--color-input-bg);
    color: var(--color-text-primary);
  }

  /* ===== Prototype: mobile composer framed like the wallet =====
     On mobile/tablet (< lg, matching the bottom nav's visibility), inset
     the composer into the region between the header and bottom nav and
     drop the overlay below the nav strips so both stay visible/tappable,
     exactly like the wallet panel. */
  @media (max-width: 1023.98px) {
    /* Overlay backdrop below the nav strips (header z-30, bottom nav z-40).
       Non-nested :has(): match the backdrop by its child dialog that
       contains a descendant .composer-modal-body. */
    :global(div:has(> dialog .composer-modal-body)) {
      z-index: 20 !important;
    }

    :global(dialog:has(.composer-modal-body)) {
      top: var(--header-h) !important;
      bottom: auto !important;
      left: 0 !important;
      right: auto !important;
      width: 100dvw !important;
      max-width: 100dvw !important;
      height: calc(100dvh - var(--header-h) - var(--bottom-nav-height, 0px)) !important;
      max-height: calc(100dvh - var(--header-h) - var(--bottom-nav-height, 0px)) !important;
      min-height: 0 !important;
      --tw-translate-x: 0px !important;
      --tw-translate-y: 0px !important;
      transform: translate(0px, 0px) !important;
      border-radius: 0 !important;
      margin: 0 !important;
    }

    /* Bump header visual elements for touch. */
    .composer-modal-label {
      font-size: 0.875rem;
    }
    .composer-modal-select {
      font-size: 0.875rem;
      padding: 0.375rem 0.625rem;
    }
    .composer-modal-hint {
      font-size: 0.8125rem;
    }
    .composer-modal-close :global(svg) {
      width: 28px;
      height: 28px;
    }
  }
</style>
