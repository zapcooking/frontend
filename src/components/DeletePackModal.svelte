<script lang="ts">
  /**
   * Recipe Pack deletion confirmation modal.
   *
   * Self-contained: owns the destructive confirm step, dispatches
   * publishPackDeletion, and emits a `deleted` event on success so
   * the page can redirect / refresh state. Mount-and-forget.
   *
   * UX notes:
   * - Destructive action, so we use a red secondary button styling on
   *   "Delete pack" and require an explicit click on the confirm button
   *   (no enter-key shortcut, no auto-focus).
   * - We're honest in the copy that NIP-09 is a request relays may
   *   honor — we can't promise instant disappearance everywhere. Most
   *   modern relays + clients respect it; some don't.
   * - Optimistic UX: as soon as publish resolves we dispatch `deleted`.
   *   Non-compliant relay caches will still serve the event for a bit;
   *   the redirect target lists the user's other packs so the user
   *   doesn't sit on a "pack still exists" view.
   */
  import { createEventDispatcher } from 'svelte';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import Modal from './Modal.svelte';
  import Button from './Button.svelte';
  import { publishPackDeletion } from '$lib/recipePack';
  import { showToast } from '$lib/toast';

  export let open = false;
  /** The Recipe Pack event being deleted. We re-check authorship inside
   *  publishPackDeletion as a defense-in-depth guard. */
  export let packEvent: NDKEvent | null = null;
  /** Title to show in the confirmation copy — defaults to "this pack"
   *  if the caller doesn't have a title to pass. */
  export let packTitle: string = '';

  const dispatch = createEventDispatcher();

  let isSubmitting = false;
  let error = '';

  // Reset error every time the modal reopens so a prior failure doesn't
  // shadow a fresh attempt.
  $: if (open) error = '';

  async function handleConfirm() {
    if (!packEvent || isSubmitting) return;
    isSubmitting = true;
    error = '';
    try {
      const { queued } = await publishPackDeletion(packEvent);
      // publishWithRetry can resolve in a queued-for-retry state when
      // no relay has confirmed yet (signer race, relay flake). Surface
      // honest copy + a different downstream signal so the page can
      // skip a redirect that would land the user on /packs while the
      // pack is still visible there.
      if (queued) {
        showToast(
          'info',
          'Deletion request queued. It will publish as soon as relays are reachable.'
        );
      } else {
        showToast('success', 'Deletion request published.');
      }
      dispatch('deleted', { queued });
      open = false;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to delete pack.';
      error = msg;
      showToast('error', msg);
    } finally {
      isSubmitting = false;
    }
  }

  function handleClose() {
    if (isSubmitting) return;
    open = false;
  }
</script>

<Modal cleanup={handleClose} bind:open compact={true}>
  <h1 slot="title">Delete Recipe Pack?</h1>

  <div class="flex flex-col gap-3">
    <p class="text-sm" style="color: var(--color-text-primary)">
      This will publish a NIP-09 deletion request for
      {#if packTitle}
        <span class="font-semibold">{packTitle}</span>
      {:else}
        this pack
      {/if}.
    </p>

    <p class="text-xs text-caption">
      Most relays and clients honor deletion requests and will stop showing
      the pack within a few minutes. A small number of older relays may
      keep serving cached copies — there's no way to fully recall a
      published Nostr event.
    </p>

    {#if error}
      <p class="text-sm text-red-500">{error}</p>
    {/if}

    <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
      <Button on:click={handleClose} primary={false} disabled={isSubmitting}>Cancel</Button>
      <button
        type="button"
        on:click={handleConfirm}
        disabled={isSubmitting || !packEvent}
        class="px-4 py-2.5 rounded-full font-semibold text-white whitespace-nowrap transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        style="background-color: #dc2626;"
      >
        {isSubmitting ? 'Deleting…' : 'Delete pack'}
      </button>
    </div>
  </div>
</Modal>
