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

  // Portal target - render at document body level
  let portalTarget: HTMLElement;
  let dialogEl: HTMLDialogElement | null = null;
  let previousActiveElement: HTMLElement | null = null;
  let lastOpen = false;

  onMount(() => {
    portalTarget = document.body;
  });

  // Find focusable descendants of the dialog. Hidden, disabled, or
  // aria-hidden elements are excluded. Order matches DOM order.
  function getFocusable(): HTMLElement[] {
    if (!dialogEl) return [];
    const selector =
      'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(dialogEl.querySelectorAll<HTMLElement>(selector)).filter((el) => {
      if (el.hasAttribute('aria-hidden')) return false;
      // offsetParent is null for display:none subtrees; visibility:hidden also reports null.
      return el.offsetParent !== null || el === document.activeElement;
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
  $: if (typeof window !== 'undefined' && open !== lastOpen) {
    lastOpen = open;
    if (open) {
      previousActiveElement = (document.activeElement as HTMLElement) || null;
      window.addEventListener('keydown', handleKeydown);
      // Defer initial focus so the dialog has mounted and transitions started.
      tick().then(() => {
        const focusable = getFocusable();
        if (focusable.length > 0) {
          focusable[0].focus();
        } else {
          dialogEl?.focus();
        }
      });
    } else {
      window.removeEventListener('keydown', handleKeydown);
      // Return focus to whatever opened the modal.
      if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
        previousActiveElement.focus();
      }
      previousActiveElement = null;
    }
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
