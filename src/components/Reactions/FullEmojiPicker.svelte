<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { clickOutside } from '$lib/clickOutside';
  import { fade } from 'svelte/transition';

  export let open = false;

  const dispatch = createEventDispatcher<{
    select: { emoji: string };
    close: void;
  }>();

  let pickerElement: HTMLElement | null = null;
  let pickerLoaded = false;

  onMount(async () => {
    if (browser) {
      // Dynamically import emoji-picker-element only on client
      await import('emoji-picker-element');
      pickerLoaded = true;
    }
  });

  function handleEmojiClick(event: any) {
    const emoji = event.detail?.unicode;
    if (emoji) {
      dispatch('select', { emoji });
    }
  }

  function handleClickOutside() {
    dispatch('close');
  }

  $: if (pickerElement && pickerLoaded) {
    pickerElement.addEventListener('emoji-click', handleEmojiClick);
  }
</script>

{#if open && pickerLoaded}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    transition:fade={{ duration: 150 }}
  >
    <div
      class="bg-input rounded-2xl shadow-xl overflow-hidden"
      use:clickOutside
      on:click_outside={handleClickOutside}
    >
      <emoji-picker bind:this={pickerElement}></emoji-picker>
    </div>
  </div>
{/if}

<style>
  emoji-picker {
    --background: var(--color-input-bg);
    --border-color: var(--color-input-border);
    --category-emoji-size: 1.25rem;
    --emoji-size: 1.5rem;
    --input-border-color: var(--color-input-border);
    --input-font-color: var(--color-text-primary);
    --indicator-color: var(--color-primary);
    --outline-color: var(--color-primary);
  }
</style>
