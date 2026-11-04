<script lang="ts">
  /**
   * PlateItPrompt — "Made this? [Plate it]" near the end of a recipe, and
   * the composer it opens: the shared ReplyComposer in a modal, publishing
   * an ordinary top-level recipe comment plus the Plated marker tag, with
   * a photo required.
   *
   * Signed out, the tap goes through requireAuth: the login overlay opens
   * over the page and the composer opens once a session exists — the page
   * never unmounts, so nothing is lost. The composer keeps its draft
   * (keyed by the recipe) when the modal is closed without posting.
   *
   * Once the publish succeeds, PlatedStamp shows the photo stamped
   * "PLATED" for a moment; the toast stays the announcement.
   */
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import Button from '../Button.svelte';
  import Modal from '../Modal.svelte';
  import ReplyComposer from '../comments/ReplyComposer.svelte';
  import PlatedStamp from './PlatedStamp.svelte';
  import { requireAuth, signedIn } from '$lib/auth/requireAuth';
  import { showToast } from '$lib/toast';
  import { PLATED_MARKER_TAG } from '$lib/plated/plated';
  import { PLATED_COPY } from '$lib/plated/copy';
  import { platedStampPhoto } from '$lib/plated/stamp';

  /** The recipe being plated (the comment's root). */
  export let recipeEvent: NDKEvent;

  /** Called with the published plate, after the publish succeeded. */
  export let onPosted: ((event: NDKEvent) => void) | null = null;

  const markerTags = [[...PLATED_MARKER_TAG]];
  const promptId = `plate-prompt-${Math.random().toString(36).slice(2, 8)}`;

  let open = false;
  let opening = false;
  let posting = false;
  let composer: ReplyComposer;
  // The stamp for the latest plate; keyed by its id so a second plate
  // restarts it.
  let stamp: { id: string; photo: string } | null = null;

  async function plateIt() {
    // One pending sign-in at a time: a second tap while the overlay is up
    // must not queue a second open.
    if (opening) return;
    opening = true;
    try {
      if (!(await requireAuth({ kind: 'reply', reason: PLATED_COPY.signInReason }))) return;
      open = true;
    } finally {
      opening = false;
    }
  }

  // Fires only once the publish (or a background proof-of-work publish)
  // has succeeded.
  function handlePosted(posted: NDKEvent) {
    showToast('success', PLATED_COPY.success);
    const photo = platedStampPhoto(posted);
    stamp = photo ? { id: posted.id, photo } : null;
    onPosted?.(posted);
  }

  // Backdrop / Esc / close button: keep the draft for next time.
  function handleCleanupClose() {
    composer?.saveDraft?.();
    open = false;
  }
</script>

<section class="plate-prompt print:hidden" aria-labelledby={promptId}>
  <div class="plate-prompt-row">
    <h2 id={promptId} class="plate-prompt-question">{PLATED_COPY.promptQuestion}</h2>
    <Button
      variant="primary"
      aria-label={PLATED_COPY.promptButtonLabel}
      disabled={opening}
      on:click={plateIt}
      class="plate-it-btn"
    >
      <!-- Fork, plate, knife: decoration; the label carries the name. -->
      <svg
        class="plate-it-mark"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 56 28"
        width="44"
        height="22"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <g fill="currentColor">
          <rect x="4.2" y="4" width="1.5" height="8" rx=".75" />
          <rect x="7.2" y="4" width="1.5" height="8" rx=".75" />
          <rect x="10.2" y="4" width="1.5" height="8" rx=".75" />
          <path d="M4.2 11h7.5v1.2a3 3 0 0 1-2.6 3v8.1a1.15 1.15 0 0 1-2.3 0v-8.1a3 3 0 0 1-2.6-3z" />
          <path d="M45 4.2c2.8 1.7 4.3 4.8 4.3 8.8v2.2h-1.9v8.1a1.2 1.2 0 0 1-2.4 0z" />
        </g>
        <circle cx="28" cy="14" r="12" fill="currentColor" />
        <circle class="plate-it-rim" cx="28" cy="14" r="7.6" stroke-opacity=".55" stroke-width="1.3" />
      </svg>
      {PLATED_COPY.promptButton}
    </Button>
  </div>
  <p class="plate-prompt-helper">{PLATED_COPY.promptHelper}</p>
</section>

{#if stamp}
  {#key stamp.id}
    <PlatedStamp photo={stamp.photo} onDone={() => (stamp = null)} />
  {/key}
{/if}

{#if open && $signedIn}
  <Modal bind:open compact maxWidth="40rem" autoHeight cleanup={handleCleanupClose} locked={posting}>
    <span slot="title">{PLATED_COPY.composerTitle}</span>
    <p class="plate-composer-prompt">{PLATED_COPY.composerPrompt}</p>
    <ReplyComposer
      bind:this={composer}
      parentEvent={recipeEvent}
      draftKey={recipeEvent.id}
      placeholder={PLATED_COPY.composerPrompt}
      submitLabel={PLATED_COPY.composerSubmit}
      extraTags={markerTags}
      requireImage={true}
      requireImageMessage={PLATED_COPY.composerPhotoRequired}
      allowGif={false}
      allowPoll={false}
      showCancel={true}
      autoFocus={true}
      bind:posting
      on:cancel={() => (open = false)}
      on:close={() => (open = false)}
      onPosted={handlePosted}
    />
  </Modal>
{/if}

<style>
  .plate-prompt {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 1rem;
    border-radius: 1rem;
    background-color: var(--color-bg-secondary);
  }

  .plate-prompt-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .plate-prompt-question {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  /* The Button's own padding and gap are kept; the mark tilts on hover
     and presses with the button. No motion when reduced. */
  .plate-prompt :global(.plate-it-btn) {
    flex-shrink: 0;
  }

  .plate-it-mark {
    display: block;
    flex-shrink: 0;
    transition: transform 0.15s ease-out;
  }

  /* var() needs a style property; presentation attributes don't take it. */
  .plate-it-rim {
    stroke: var(--color-primary);
  }

  .plate-prompt :global(.plate-it-btn:hover:not(:disabled) .plate-it-mark) {
    transform: rotate(-6deg);
  }

  .plate-prompt :global(.plate-it-btn:active:not(:disabled) .plate-it-mark) {
    transform: scale(0.92);
  }

  @media (prefers-reduced-motion: reduce) {
    .plate-it-mark {
      transition: none;
    }
    .plate-prompt :global(.plate-it-btn:hover:not(:disabled) .plate-it-mark),
    .plate-prompt :global(.plate-it-btn:active:not(:disabled) .plate-it-mark) {
      transform: none;
    }
  }

  .plate-prompt-helper {
    font-size: 0.875rem;
    color: var(--color-caption);
  }

  .plate-composer-prompt {
    font-size: 0.9375rem;
    color: var(--color-text-secondary);
  }
</style>
