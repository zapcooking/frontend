<script lang="ts">
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { extractImageUrls } from '$lib/imageUrls';
  import CheffyNoteReviewTrigger from './CheffyNoteReviewTrigger.svelte';

  export let event: NDKEvent;

  $: hasImages = extractImageUrls(event?.content || '').length > 0;
</script>

<div class="cheffy-media-review" class:has-images={hasImages}>
  <slot />
  {#if hasImages}
    <div class="cheffy-media-trigger">
      <CheffyNoteReviewTrigger {event} size={30} variant="floating" />
    </div>
  {/if}
</div>

<style>
  .cheffy-media-review {
    position: relative;
    width: 100%;
  }

  .cheffy-media-review.has-images {
    margin-bottom: 1.25rem;
  }

  .cheffy-media-trigger {
    position: absolute;
    right: 0.75rem;
    bottom: -1.25rem;
    z-index: 20;
  }
</style>
