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
   */
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import Button from '../Button.svelte';
  import Modal from '../Modal.svelte';
  import ReplyComposer from '../comments/ReplyComposer.svelte';
  import { requireAuth, signedIn } from '$lib/auth/requireAuth';
  import { showToast } from '$lib/toast';
  import { PLATED_MARKER_TAG } from '$lib/plated/plated';
  import { PLATED_COPY } from '$lib/plated/copy';

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
    >
      {PLATED_COPY.promptButton}
    </Button>
  </div>
  <p class="plate-prompt-helper">{PLATED_COPY.promptHelper}</p>
</section>

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

  .plate-prompt-helper {
    font-size: 0.875rem;
    color: var(--color-caption);
  }

  .plate-composer-prompt {
    font-size: 0.9375rem;
    color: var(--color-text-secondary);
  }
</style>
