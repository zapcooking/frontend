<script context="module" lang="ts">
  // Portal action to move element to target
  export function portal(node: HTMLElement, target: HTMLElement) {
    target.appendChild(node);

    return {
      destroy() {
        if (node.parentNode === target) {
          target.removeChild(node);
        }
      }
    };
  }
</script>

<script lang="ts">
  import { blur, scale } from 'svelte/transition';
  import CloseIcon from 'phosphor-svelte/lib/XCircle';
  import { onMount, onDestroy, tick } from 'svelte';

  export let open = false;
  export let cleanup: (() => void) | null = null;
  export let noHeader = false;
  export let allowOverflow = false;
  export let compact = false;

  // Portal target - render at document body level. Initialized
  // synchronously when document is available so the dialog can mount
  // on the same tick the parent flips `open` to true; otherwise the
  // initial-focus pass below would race the dialog's bind:this.
  let portalTarget: HTMLElement | null =
    typeof document !== 'undefined' ? document.body : null;
  let dialogEl: HTMLDialogElement | null = null;
  let previousActiveElement: HTMLElement | null = null;
  let lastOpen = false;
  let pendingInitialFocus = false;

  onMount(() => {
    // Re-set in case the component was script-initialized before
    // document was ready (e.g., SSR rehydrate). No-op when already set.
    if (!portalTarget && typeof document !== 'undefined') {
      portalTarget = document.body;
    }
  });

  // Find focusable descendants of the dialog. Disabled and explicitly
  // aria-hidden="true" elements are excluded; visibility is checked via
  // getClientRects() so we don't drop position:fixed children
  // (offsetParent is null for those). Order matches DOM order.
  function getFocusable(): HTMLElement[] {
    if (!dialogEl) return [];
    const selector =
      'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(dialogEl.querySelectorAll<HTMLElement>(selector)).filter((el) => {
      if (el.getAttribute('aria-hidden') === 'true') return false;
      return el.getClientRects().length > 0 || el === document.activeElement;
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') {
      close();
      return;
    }
    if (e.key === 'Tab') {
      const focusable = getFocusable();
      if (focusable.length === 0) {
        // Nothing focusable inside — keep focus on the dialog itself.
        e.preventDefault();
        dialogEl?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !dialogEl?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialogEl?.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // Open/close lifecycle: manage focus capture+restore + keydown listener.
  // Actual initial focus runs in the second reactive block below, gated
  // on dialogEl being bound — bind:this fires after the {#if} renders
  // the dialog, which can trail this block by a tick on first open.
  $: if (typeof window !== 'undefined' && open !== lastOpen) {
    lastOpen = open;
    if (open) {
      previousActiveElement = (document.activeElement as HTMLElement) || null;
      window.addEventListener('keydown', handleKeydown);
      pendingInitialFocus = true;
    } else {
      window.removeEventListener('keydown', handleKeydown);
      pendingInitialFocus = false;
      // Return focus to whatever opened the modal.
      if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
        previousActiveElement.focus();
      }
      previousActiveElement = null;
    }
  }

  // Run the initial focus pass once the dialog is actually in the DOM.
  // This handles the case where `open` is already true on mount AND
  // the case where `open` flips true after the dialog has long been
  // bound — the pendingInitialFocus flag carries the intent across
  // the gap.
  $: if (pendingInitialFocus && dialogEl) {
    pendingInitialFocus = false;
    tick().then(() => {
      const focusable = getFocusable();
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        dialogEl?.focus();
      }
    });
  }

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', handleKeydown);
    }
  });

  // if some variables need to be erased when it's closed, we can do that here.
  function close() {
    if (cleanup !== null) cleanup();
    // for good measure
    open = false;
  }
</script>

{#if open && portalTarget}
  <!-- Portal to body - render modal at document level -->
  <div use:portal={portalTarget}>
    <div
      on:click|self={close}
      role="presentation"
      transition:blur={{ duration: 250 }}
      class="fixed top-0 left-0 z-50 w-full h-full backdrop-brightness-50 backdrop-blur"
    >
      <dialog
        bind:this={dialogEl}
        tabindex="-1"
        transition:scale={{ duration: 250 }}
        aria-labelledby="title"
        aria-modal="true"
        class="absolute m-0 top-1/2 left-1/2 px-4 md:px-8 pt-6 pb-8 rounded-3xl w-[calc(100%-2rem)] md:w-[calc(100vw-4em)] max-w-xl min-h-[50vh] md:min-h-0 max-h-[85vh] md:max-h-[90vh] -translate-x-1/2 -translate-y-1/2 flex flex-col"
        class:compact-padding={compact}
        class:overflow-y-auto={!allowOverflow}
        class:overflow-visible={allowOverflow}
        style="background-color: var(--color-bg-secondary);"
        open
      >
        <div
          class="flex flex-col flex-1 {compact ? 'gap-2' : 'gap-6'}"
        >
          {#if !noHeader}
            <div class="flex justify-between">
              <h2
                class="self-center text-lg font-semibold"
                style="color: var(--color-text-primary)"
              >
                <slot id="title" name="title" />
              </h2>
              <button
                class="self-center cursor-pointer"
                style="color: var(--color-text-primary)"
                on:click={close}
              >
                <CloseIcon size={24} />
              </button>
            </div>
          {/if}
          <slot />
        </div>
      </dialog>
    </div>
  </div>
  <style>
    html {
      overflow: hidden;
      touch-action: none;
    }
    :global(.compact-padding) {
      padding: 1rem 1rem 1.25rem;
    }
    @media (min-width: 768px) {
      :global(.compact-padding) {
        padding-left: 1.5rem;
        padding-right: 1.5rem;
      }
    }
  </style>
{/if}
