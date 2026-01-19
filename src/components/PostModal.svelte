<script lang="ts">
  import Modal from './Modal.svelte';
  import PostComposer from './PostComposer.svelte';

  export let open = false;

  type RelaySelection = 'all' | 'garden' | 'pantry' | 'garden-pantry';
  let selectedRelay: RelaySelection = 'all';
</script>

<Modal bind:open allowOverflow={true}>
  <svelte:fragment slot="title">
    <div class="flex items-center justify-end gap-4 w-full">
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
    </div>
  </svelte:fragment>

  <PostComposer variant="modal" {selectedRelay} on:close={() => (open = false)} />
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
