<script lang="ts">
  import Modal from './Modal.svelte';
  import PostComposer from './PostComposer.svelte';
  import CloseIcon from 'phosphor-svelte/lib/XCircle';
  import { quotedNoteStore, clearQuotedNote, noteDraftDocked } from '$lib/postComposerStore';

  export let open = false;

  type RelaySelection = 'all' | 'pantry';
  let selectedRelay: RelaySelection = 'all';

  let composer: PostComposer;
  let isPosting = false;

  // Opening the composer (from anywhere) supersedes a parked draft: the tab
  // leaves the DraftDock and the composer restores the draft itself.
  $: if (open) noteDraftDocked.set(null);

  function handleClose() {
    open = false;
    noteDraftDocked.set(null);
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

  // Composer asked to minimize (close with unsent content). The draft is
  // already flushed to localStorage; hide the modal and park the draft in
  // the DraftDock's tab strip.
  // Keep the quoted note so it's restored on reopen.
  function handleMinimize(e: CustomEvent<{ preview: string }>) {
    noteDraftDocked.set({ preview: e.detail.preview });
    open = false;
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
