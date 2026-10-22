<script lang="ts">
  /**
   * The membership pitch behind Fresh's preview cards: opened when a reader
   * who isn't a member (or is signed out) opens the full topic feed or
   * archive view from a card or a chip. Shown whatever
   * PUBLIC_MEMBERSHIP_ENABLED says: that flag gates only the unsolicited
   * promo bar and discovery modal, not what a reader asked for. Nothing is
   * requested from the relay for it.
   */
  import CloseIcon from 'phosphor-svelte/lib/X';
  import { loginOverlayOpen } from '$lib/stores/loginOverlay';
  import Modal from './Modal.svelte';

  export let open = false;
  /** What the reader opened. */
  export let what: 'topic' | 'day' | 'archive' = 'topic';
  /** The topic's name (for 'topic'). */
  export let name = '';
  export let signedIn = false;

  $: title =
    what === 'topic'
      ? name
        ? `${name} is a members' topic feed`
        : 'Topic feeds are for members'
      : 'The archive is for members';
  $: body =
    what === 'topic'
      ? 'Members follow every topic — Sourdough, Kimchi, Coffee and 40 more — back through the full history of the Fresh feed. The spotlights in the feed are a taste of each.'
      : what === 'day'
        ? 'Members see everything the community cooked on this date in past years, and can browse the archive month by month. The memory cards in the feed are a taste of it.'
        : 'Members browse the Fresh archive month by month, back to the beginning. The memory cards in the feed are a taste of it.';

  function signIn() {
    open = false;
    loginOverlayOpen.set(true);
  }
</script>

<Modal bind:open compact noHeader autoHeight>
  <div class="pitch">
    <div class="flex items-start justify-between gap-3">
      <!-- id="title": Modal's dialog is aria-labelledby="title". -->
      <h2 id="title" class="text-lg font-semibold" style="color: var(--color-text-primary)">
        {title}
      </h2>
      <button
        type="button"
        class="flex items-center justify-center min-w-[44px] min-h-[44px] -mr-2 -mt-2 flex-shrink-0"
        style="color: var(--color-text-primary)"
        aria-label="Close"
        on:click={() => (open = false)}
      >
        <CloseIcon size={24} />
      </button>
    </div>
    <p class="text-sm mt-2" style="color: var(--color-text-secondary)">{body}</p>
    <div class="flex flex-wrap items-center gap-3 mt-4">
      <a
        href="/membership"
        class="inline-block px-4 py-2 rounded-full text-sm font-medium bg-primary text-white"
        on:click={() => (open = false)}
      >
        {signedIn ? 'Become a member' : 'Learn about membership'}
      </a>
      {#if !signedIn}
        <button type="button" class="text-sm font-medium text-primary" on:click={signIn}>
          Already a member? Sign in
        </button>
      {/if}
    </div>
  </div>
</Modal>

<style>
  .pitch {
    padding-bottom: 0.25rem;
  }
</style>
