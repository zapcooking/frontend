<script lang="ts">
  /**
   * "Ask Cheffy about this photo" entry point (Phase 2).
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
  /** Extra classes on the button itself (e.g. padding to grow the tap target). */
  export let buttonClass = '';
  export let size = 18;
  export let variant: 'inline' | 'floating' = 'inline';

  let open = false;
  let imageUrls: string[] = [];

  $: imageUrls = extractImageUrls(event?.content || '');
</script>

{#if imageUrls.length > 0}
  <div class={wrapClass}>
    <button
      type="button"
      class="cheffy-trigger {buttonClass}"
      class:floating={variant === 'floating'}
      title="Ask Cheffy about this photo"
      aria-label="Ask Cheffy about this photo"
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

  .cheffy-trigger.floating {
    width: 48px;
    height: 48px;
    border: 2px solid color-mix(in srgb, var(--color-primary) 72%, white 28%);
    border-radius: 50%;
    background: color-mix(in srgb, var(--color-bg-primary) 86%, var(--color-primary) 14%);
    box-shadow:
      0 9px 24px rgba(0, 0, 0, 0.38),
      0 0 0 3px color-mix(in srgb, var(--color-primary) 16%, transparent);
    color: var(--color-primary);
    transition:
      transform 0.16s ease-out,
      background-color 0.16s ease-out,
      box-shadow 0.16s ease-out;
  }

  .cheffy-trigger.floating:hover {
    transform: translateY(-2px) scale(1.04);
    background: color-mix(in srgb, var(--color-bg-primary) 76%, var(--color-primary) 24%);
    box-shadow:
      0 11px 28px rgba(0, 0, 0, 0.42),
      0 0 0 4px color-mix(in srgb, var(--color-primary) 22%, transparent);
  }

  .cheffy-trigger.floating:focus-visible {
    outline: 3px solid var(--color-primary);
    outline-offset: 3px;
  }

  @media (max-width: 640px) {
    .cheffy-trigger.floating {
      width: 44px;
      height: 44px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .cheffy-trigger.floating {
      transition: none;
    }
  }
</style>
