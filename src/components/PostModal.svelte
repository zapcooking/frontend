<script lang="ts">
  import Modal from './Modal.svelte';
  import PostComposer from './PostComposer.svelte';
  import CloseIcon from 'phosphor-svelte/lib/XCircle';
  import { quotedNoteStore, clearQuotedNote } from '$lib/postComposerStore';

  export let open = false;

  type RelaySelection = 'all' | 'garden' | 'pantry' | 'garden-pantry';
  let selectedRelay: RelaySelection = 'all';

  function handleClose() {
    open = false;
    clearQuotedNote();
  }
</script>

<Modal bind:open allowOverflow={true} noHeader={true}>
  <div class="flex flex-col gap-4 flex-1">
    <!-- Header: relay selector on left, X on right -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <label for="relay-select" class="text-sm text-caption whitespace-nowrap">Post to:</label>
        <select
          id="relay-select"
          bind:value={selectedRelay}
          class="px-3 py-1.5 text-sm rounded-lg border transition-colors"
          style="
            background: var(--color-input-bg);
            border-color: var(--color-input-border);
            color: var(--color-text-primary);
          "
        >
          <option value="all">All relays</option>
          <option value="garden">🌱 Garden only</option>
          <option value="pantry">🏪 Pantry only</option>
          <option value="garden-pantry">🌱🏪 Garden + Pantry</option>
        </select>
      </div>

      <button
        class="cursor-pointer hover:opacity-80 transition-opacity"
        style="color: var(--color-text-primary)"
        on:click={handleClose}
        aria-label="Close"
      >
        <CloseIcon size={24} />
      </button>
    </div>

    <PostComposer
      variant="modal"
      {selectedRelay}
      initialQuotedNote={$quotedNoteStore}
      on:close={handleClose}
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
</style>
