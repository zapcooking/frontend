<script lang="ts">
  import { blur, scale } from 'svelte/transition';
  import CloseIcon from 'phosphor-svelte/lib/XCircle';
    import { has } from 'markdown-it/lib/common/utils';
  export let open = false;
  export let cleanup: (() => void) | null = null;

  // if some variables need to be erased when it's closed, we can do that here.
  function close() {
    if (cleanup !== null) cleanup();
    // for good measure
    open = false;
  }
</script>

{#if open}
  <div
    on:click|self={close}
    role="presentation"
    transition:blur={{ duration: 250 }}
    class="fixed top-0 left-0 z-30 w-full h-full backdrop-brightness-50 backdrop-blur"
  >
    <dialog
      transition:scale={{ duration: 250 }}
      aria-labelledby="title"
      aria-modal="true"
      class="absolute m-0 top-1/2 left-1/2 px-2 md:px-8 pt-6 pb-8 rounded-3xl w-full md:w-[calc(100vw - 4em)] max-w-xl max-sm:h-[100%] sm:h-[calc(100vw - 4em)] overflow-y-auto -translate-x-1/2 -translate-y-1/2"
      style="background-color: var(--color-bg-secondary); color: var(--color-text-primary);"
      open
    >
      <div class="flex flex-col gap-6">
        <div class="flex justify-between">
          <slot class="self-center" id="title" name="title" />
          <button class="self-center cursor-pointer" style="color: var(--color-text-primary)" on:click={close}>
            <CloseIcon size={24} />
          </button>
        </div>
        <slot />
      </div>
    </dialog>
  </div>
  <style>
    html {
      overflow: hidden;
      touch-action: none;
    }
  </style>
{/if}