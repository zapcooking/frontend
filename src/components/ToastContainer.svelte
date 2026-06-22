<script lang="ts">
  /**
   * Renders the global toast stream. Mount exactly once at the app root
   * (see src/routes/+layout.svelte). Subscribes to the `toasts` store in
   * $lib/toast and renders each message via the Toast component.
   *
   * Positioning: top-center, capped at the same width as the composer modal
   * (max-w-xl / 36rem). z-index 9999 sits above all modals and the fixed header.
   */
  import { toasts } from '$lib/toast';
  import Toast from './Toast.svelte';
</script>

<!--
  Container intentionally has no aria-live. Each <Toast> sets its own
  aria-live per variant (assertive for errors, polite for info/success);
  nested live regions produce inconsistent announcements across screen
  readers, so urgency lives on the individual toast, not the wrapper.
-->
<div class="toast-container">
  {#each $toasts as toast (toast.id)}
    <Toast {toast} />
  {/each}
</div>

<style>
  .toast-container {
    position: fixed;
    top: 1rem;
    left: 50%;
    transform: translateX(-50%);
    width: calc(100vw - 2rem);
    max-width: 36rem;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    pointer-events: none;
  }
</style>
