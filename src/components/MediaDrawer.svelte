<script lang="ts">
  import ImageIcon from 'phosphor-svelte/lib/Image';
  import VideoIcon from 'phosphor-svelte/lib/Video';
  import CopyIcon from 'phosphor-svelte/lib/Copy';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import type { MediaAttachment } from '$lib/composerMedia';

  /**
   * Read-only accounting for attachments the editor doesn't show: one
   * collapsed line ("3 attachments, added to the end of your post")
   * expanding to one row per URL. The order shown is the thumbnails'
   * order — reordering belongs to the thumbnails, so this drawer never
   * mutates the array. Two places to change one array is two places to
   * keep in step and a race when both are open.
   */
  export let media: MediaAttachment[] = [];

  let open = false;

  $: count = media.length;

  // Copy feedback is per row and brief: which URL landed should be
  // readable at a glance, then the row goes back to offering the copy.
  let copiedIndex: number | null = null;
  let copyTimeout: ReturnType<typeof setTimeout> | null = null;

  async function copyUrl(url: string, index: number) {
    try {
      await navigator.clipboard.writeText(url);
      copiedIndex = index;
      if (copyTimeout) clearTimeout(copyTimeout);
      copyTimeout = setTimeout(() => (copiedIndex = null), 800);
    } catch (error) {
      console.error('Failed to copy attachment URL:', error);
    }
  }
</script>

<div class="media-drawer">
  <button
    type="button"
    class="media-drawer-toggle"
    aria-expanded={open}
    on:click={() => (open = !open)}
  >
    <span class="media-drawer-label">
      {count} attachment{count === 1 ? '' : 's'}, added to the end of your post
    </span>
    <svg
      class="media-drawer-chevron"
      class:open
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6" />
    </svg>
  </button>
  {#if open}
    <ul class="media-drawer-list">
      {#each media as m, i (i)}
        <li class="media-drawer-row">
          <span class="media-drawer-index">{i + 1}</span>
          {#if m.isVideo}
            <VideoIcon size={12} class="media-drawer-kind" aria-label="Video" />
          {:else}
            <ImageIcon size={12} class="media-drawer-kind" aria-label="Image" />
          {/if}
          <span class="media-drawer-url" title={m.url}>{m.url}</span>
          {#if m.alt?.trim()}
            <span class="media-drawer-alt" title={m.alt}>ALT</span>
          {/if}
          <button
            type="button"
            class="media-drawer-copy"
            class:copied={copiedIndex === i}
            on:click={() => copyUrl(m.url, i)}
            title={copiedIndex === i ? 'Copied' : 'Copy URL'}
            aria-label={copiedIndex === i ? 'URL copied' : `Copy attachment ${i + 1} URL`}
          >
            {#if copiedIndex === i}
              <CheckIcon size={12} weight="bold" />
            {:else}
              <CopyIcon size={12} />
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .media-drawer {
    font-size: 0.75rem;
    color: var(--color-caption);
  }

  .media-drawer-toggle {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    width: 100%;
    padding: 0.125rem 0;
    color: inherit;
    font-size: inherit;
    text-align: left;
    cursor: pointer;
  }

  .media-drawer-toggle:hover {
    color: var(--color-text-secondary);
  }

  .media-drawer-label {
    flex: 1;
    min-width: 0;
  }

  .media-drawer-chevron {
    width: 0.875rem;
    height: 0.875rem;
    flex-shrink: 0;
    transition: transform 0.15s ease;
  }

  .media-drawer-chevron.open {
    transform: rotate(180deg);
  }

  .media-drawer-list {
    margin: 0.25rem 0 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .media-drawer-row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-width: 0;
  }

  .media-drawer-index {
    flex-shrink: 0;
    width: 0.875rem;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  /* The icon components render their <svg> in a child component, so the
     scoped selector never matches — scope it to the row and go global. */
  .media-drawer-row :global(.media-drawer-kind) {
    flex-shrink: 0;
    color: var(--color-caption);
  }

  .media-drawer-url {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .media-drawer-alt {
    flex-shrink: 0;
    padding: 0 0.375rem;
    border-radius: 0.25rem;
    background: var(--color-action);
    color: var(--color-on-action);
    font-size: 0.5625rem;
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  .media-drawer-copy {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.125rem;
    border-radius: 0.25rem;
    color: var(--color-caption);
    cursor: pointer;
  }

  .media-drawer-copy:hover {
    color: var(--color-text-secondary);
  }

  .media-drawer-copy.copied {
    color: var(--color-primary, #f97316);
  }
</style>
