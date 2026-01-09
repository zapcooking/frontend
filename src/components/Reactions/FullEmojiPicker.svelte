<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { fade } from 'svelte/transition';

  export let open = false;
  export let anchorEl: HTMLElement | null = null;

  const dispatch = createEventDispatcher<{
    select: { emoji: string };
    close: void;
  }>();

  let pickerElement: HTMLElement | null = null;
  let pickerLoaded = false;
  let containerEl: HTMLElement;
  let pickerStyle = '';

  onMount(async () => {
    if (browser) {
      // Dynamically import emoji-picker-element only on client
      await import('emoji-picker-element');
      pickerLoaded = true;
    }
  });

  function updatePosition() {
    if (anchorEl && containerEl) {
      const rect = anchorEl.getBoundingClientRect();
      const pickerWidth = 352; // emoji-picker-element default width
      const pickerHeight = containerEl.offsetHeight || 400;
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;

      // Check if there's room below the button, otherwise position above
      const spaceBelow = viewportHeight - rect.bottom - 8;
      const showAbove = spaceBelow < pickerHeight && rect.top > pickerHeight;

      // Ensure picker doesn't go off-screen horizontally
      let left = rect.left;
      if (left + pickerWidth > viewportWidth - 8) {
        left = viewportWidth - pickerWidth - 8;
      }
      if (left < 8) {
        left = 8;
      }

      if (showAbove) {
        pickerStyle = `left: ${left}px; bottom: ${viewportHeight - rect.top + 8}px; top: auto;`;
      } else {
        pickerStyle = `left: ${left}px; top: ${rect.bottom + 8}px; bottom: auto;`;
      }
    }
  }

  // Update position when picker opens and elements are ready
  $: if (open && browser && anchorEl && containerEl) {
    updatePosition();
  }

  function handleEmojiClick(event: any) {
    const emoji = event.detail?.unicode;
    if (emoji) {
      dispatch('select', { emoji });
    }
  }

  function handleBackdropClick(e: MouseEvent | TouchEvent) {
    if (e.target === e.currentTarget) {
      e.preventDefault();
      dispatch('close');
    }
  }

  function handleBackdropTouch(e: TouchEvent) {
    // Delegate to the main backdrop handler to avoid duplicated logic
    handleBackdropClick(e);
  }

  // Set up emoji click listener once when picker is loaded
  $: if (pickerElement && pickerLoaded && open) {
    const handleClick = (event: any) => {
      const emoji = event.detail?.unicode;
      if (emoji) {
        dispatch('select', { emoji });
      }
    };
    pickerElement.addEventListener('emoji-click', handleClick);

    // Cleanup function is handled by portal destroy
  }

  // Portal action to move element to body
  function portal(node: HTMLElement) {
    document.body.appendChild(node);

    return {
      destroy() {
        // Use requestAnimationFrame to ensure cleanup happens after any pending transitions
        requestAnimationFrame(() => {
          if (node.parentNode) {
            node.parentNode.removeChild(node);
          }
        });
      }
    };
  }
</script>

{#if open}
  <div use:portal>
    <!-- Fixed backdrop with subtle darkening for visibility -->
    <div
      class="fixed inset-0 z-[1000] bg-black/10"
      role="button"
      tabindex="-1"
      on:click={handleBackdropClick}
      on:touchstart={handleBackdropTouch}
      on:keydown={(e) => e.key === 'Escape' && dispatch('close')}
      transition:fade={{ duration: 100 }}
    >
    </div>

    <!-- Picker positioned to anchor -->
    {#if pickerLoaded}
      <div
        bind:this={containerEl}
        class="fixed z-[1001] rounded-2xl shadow-xl overflow-hidden pointer-events-auto"
        style="{pickerStyle} border: 1px solid var(--color-input-border);"
      >
        <emoji-picker bind:this={pickerElement}></emoji-picker>
      </div>
    {/if}
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
