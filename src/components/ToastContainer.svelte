<script lang="ts">
  /**
   * Renders the global toast stream. Mount exactly once at the app root
   * (see src/routes/+layout.svelte). Subscribes to the `toasts` store in
   * $lib/toast and renders each message via the Toast component.
   *
   * Positioning: bottom-right on desktop, above the BottomNav on mobile
   * (where bottom-right would overlap the 64px-tall bottom navigation).
   * z-index 9999 matches the highest convention in this codebase
   * (MobileSearchOverlay) and sits above all modals (~50-100).
   */
  import { toasts } from '$lib/toast';
  import Toast from './Toast.svelte';
</script>

<div class="toast-container" aria-live="polite">
  {#each $toasts as toast (toast.id)}
    <Toast {toast} />
  {/each}
</div>

<style>
  .toast-container {
    position: fixed;
    bottom: 1rem;
    right: 1rem;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    pointer-events: none; /* toasts re-enable pointer-events */
  }

  @media (max-width: 640px) {
    .toast-container {
      left: 1rem;
      right: 1rem;
      /* BottomNav is ~64px tall; clear it + leave breathing room. */
      bottom: calc(64px + 1rem);
    }
  }
</style>
