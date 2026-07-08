<script lang="ts">
  /**
   * "Ask Cheffy about this dish" entry point (Phase 2).
   *
   * Self-contained: owns image detection (renders nothing for imageless
   * notes), owns the modal, and takes the caller's wrapper class so the
   * two placements (NoteActionBar and FoodstrFeedOptimized's inline
   * action row) stay one-line drops with no empty-wrapper ghosts.
   */
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import CheffyIcon from './icons/CheffyIcon.svelte';
  import CheffyNoteReview from './CheffyNoteReview.svelte';
  import { extractImageUrls } from '$lib/imageUrls';

  export let event: NDKEvent;
  /** Hover/padding wrapper class from the host action row. */
  export let wrapClass = '';
  export let size = 18;

  let open = false;
  let imageUrls: string[] = [];

  $: imageUrls = extractImageUrls(event?.content || '');
</script>

{#if imageUrls.length > 0}
  <div class={wrapClass}>
    <button
      type="button"
      class="cheffy-trigger"
      title="Ask Cheffy about this dish"
      aria-label="Ask Cheffy about this dish"
      on:click|stopPropagation|preventDefault={() => (open = true)}
    >
      <CheffyIcon {size} expression="happy" />
    </button>
  </div>

  {#if open}
    <CheffyNoteReview bind:open {event} {imageUrls} />
  {/if}
{/if}

<style>
  .cheffy-trigger {
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--color-text-secondary);
  }
</style>
