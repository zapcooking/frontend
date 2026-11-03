<script lang="ts">
  /**
   * The body of a Plated comment in the recipe thread: the photo first and
   * large (stable 4:3 box, so nothing shifts as it loads), then the cook's
   * note. No note → no text block. If the photo fails to load, `fail` fires
   * and CommentCard falls back to the normal comment body.
   */
  import { createEventDispatcher } from 'svelte';
  import NoteContent from '../NoteContent.svelte';
  import MediaLightbox from '../MediaLightbox.svelte';
  import { optimizeImageUrl } from '$lib/imageOptimizer';
  import type { PlatedCard } from '$lib/plated/plated';
  import { PLATED_COPY, platedThumbAlt } from '$lib/plated/copy';

  export let plate: PlatedCard;
  export let recipeTitle = '';

  const dispatch = createEventDispatcher<{ fail: void }>();

  let viewing = false;
  $: alt = platedThumbAlt(recipeTitle, plate.alt);
</script>

<div class="plated-body">
  <button
    type="button"
    class="plated-photo"
    aria-label={`${PLATED_COPY.cardOpenPhoto}: ${alt}`}
    on:click={() => (viewing = true)}
  >
    <img
      src={optimizeImageUrl(plate.image, { width: 1120 })}
      {alt}
      width="560"
      height="420"
      loading="lazy"
      decoding="async"
      on:error={() => dispatch('fail')}
    />
  </button>
  {#if plate.note}
    <div class="plated-note">
      <NoteContent content={plate.note} />
    </div>
  {/if}
</div>

{#if viewing}
  <MediaLightbox images={[{ url: plate.image, alt: plate.alt ?? '' }]} onClose={() => (viewing = false)} />
{/if}

<style>
  .plated-body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .plated-photo {
    display: block;
    width: 100%;
    max-width: 560px;
    aspect-ratio: 4 / 3;
    border-radius: 0.875rem;
    overflow: hidden;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    padding: 0;
    cursor: zoom-in;
  }

  .plated-photo:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }

  .plated-photo img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
