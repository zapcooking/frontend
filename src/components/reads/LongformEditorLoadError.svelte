<script lang="ts">
  import Modal from '../Modal.svelte';
  import Button from '../Button.svelte';
  import WarningIcon from 'phosphor-svelte/lib/Warning';

  /** Rejection from the failed editor chunk import, if any. */
  export let error: unknown = null;
  export let onRetry: () => void;
  export let onClose: () => void;

  let detail = '';
  $: detail = error instanceof Error ? error.message : error ? String(error) : '';
</script>

<Modal open={true} cleanup={onClose} compact noHeader autoHeight>
  <div class="flex flex-col gap-4">
    <div class="flex items-start gap-3">
      <WarningIcon size={24} weight="fill" class="flex-shrink-0 text-red-500" />
      <div class="flex flex-col gap-1 min-w-0">
        <h2 id="title" class="text-lg font-semibold" style="color: var(--color-text-primary)">
          Couldn't load the editor
        </h2>
        <p class="text-sm" style="color: var(--color-text-secondary)">
          The article editor didn't download. Check your connection and try again. Your draft is
          saved and will open once the editor loads. If this keeps happening, reload the page.
        </p>
        {#if detail}
          <p
            class="text-xs font-mono break-all mt-1"
            style="color: var(--color-text-secondary); opacity: 0.8"
          >
            {detail}
          </p>
        {/if}
      </div>
    </div>
    <div class="flex flex-col sm:flex-row sm:justify-end gap-2">
      <Button on:click={onRetry} class="w-full sm:w-auto">Retry</Button>
      <Button on:click={onClose} primary={false} class="w-full sm:w-auto">Close</Button>
    </div>
  </div>
</Modal>
