<script lang="ts">
  import type { authorLabel } from '$lib/profileStore';

  /**
   * A profile name as $lib/profileStore's authorLabel() decides it: a
   * skeleton while the profile resolves, otherwise the text. Shared by
   * AuthorName, CustomName and ProfileLink so the placeholder looks and
   * behaves the same everywhere. The default slot receives `text`, for
   * callers that wrap it in their own markup.
   */
  export let label: ReturnType<typeof authorLabel>;
</script>

{#if label.kind === 'skeleton'}
  <span class="author-skeleton skeleton-bg" aria-busy="true" aria-label="Loading author"></span>
{:else}
  <slot text={label.text}>{label.text}</slot>
{/if}

<style>
  /* Neutral stand-in while the profile resolves: about a name's width,
     the text's height, so rows don't jump when the name lands. */
  .author-skeleton {
    display: inline-block;
    width: 6em;
    max-width: 100%;
    height: 0.9em;
    border-radius: 0.25em;
    vertical-align: middle;
    animation: author-skeleton-pulse 1.5s ease-in-out infinite;
  }
  @keyframes author-skeleton-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.45;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .author-skeleton {
      animation: none;
    }
  }
</style>
