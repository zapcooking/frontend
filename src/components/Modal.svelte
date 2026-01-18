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
  import { has } from 'markdown-it/lib/common/utils';
  import { onMount, onDestroy } from 'svelte';

  export let open = false;
  export let cleanup: (() => void) | null = null;
  export let noHeader = false;
  export let allowOverflow = false;

  // Portal target - render at document body level
  let portalTarget: HTMLElement;

  onMount(() => {
    portalTarget = document.body;
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
        transition:scale={{ duration: 250 }}
        aria-labelledby="title"
        aria-modal="true"
        class="absolute m-0 top-1/2 left-1/2 px-4 md:px-8 pt-6 pb-8 rounded-3xl w-[calc(100%-3rem)] md:w-[calc(100vw-4em)] max-w-xl max-h-[90vh] -translate-x-1/2 -translate-y-1/2"
        class:overflow-y-auto={!allowOverflow}
        class:overflow-visible={allowOverflow}
        style="background-color: var(--color-bg-secondary);"
        open
      >
        <div class="flex flex-col gap-6">
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
  </style>
{/if}
