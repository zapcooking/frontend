<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { QUICK_EMOJIS } from '$lib/types/reactions';
  import { fade } from 'svelte/transition';
  import PlusIcon from 'phosphor-svelte/lib/Plus';
  import { browser } from '$app/environment';

  export let anchorEl: HTMLElement | null = null;
  export let userReactions: Set<string> = new Set();

  const dispatch = createEventDispatcher<{
    select: { emoji: string };
    openFullPicker: void;
    close: void;
  }>();

  let pickerStyle = '';
  let pickerEl: HTMLElement;
  let rafId: number;

  function updatePosition() {
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      const pickerWidth = 280;
      const pickerHeight = pickerEl?.offsetHeight || 280;
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
    
    // Continue updating position via RAF to track during transforms/animations
    rafId = requestAnimationFrame(updatePosition);
  }

  onMount(() => {
    if (browser) {
      // Start the RAF loop to continuously track the anchor position
      updatePosition();
    }
  });

  onDestroy(() => {
    if (browser) {
      // Clean up RAF
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    }
  });

  function handleEmojiClick(emoji: string) {
    dispatch('select', { emoji });
  }

  function handleOpenFullPicker() {
    dispatch('openFullPicker');
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      dispatch('close');
    }
  }

  // Portal action to move element to body
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    
    return {
      destroy() {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      }
    };
  }
</script>

<!-- Portal wrapper - renders at body level to escape transform context -->
<div use:portal>
  <!-- Fixed backdrop -->
  <div
    class="fixed inset-0 z-[1000]"
    on:click={handleBackdropClick}
    on:keydown={(e) => e.key === 'Escape' && dispatch('close')}
    transition:fade={{ duration: 100 }}
  >
  </div>
  
  <!-- Picker positioned fixed to follow scroll - separate from backdrop for proper stacking -->
  <div
    bind:this={pickerEl}
    class="fixed bg-input border rounded-xl p-3 shadow-lg z-[1001] pointer-events-auto"
    style="{pickerStyle} min-width: 280px; border-color: var(--color-input-border);"
  >
    <!-- 4-column grid -->
    <div class="grid grid-cols-4 gap-2">
      {#each QUICK_EMOJIS as emoji}
        <button
          type="button"
          class="flex items-center justify-center text-2xl rounded-lg border border-transparent transition-all duration-200 cursor-pointer aspect-square p-3 hover:scale-110 {userReactions.has(emoji) ? 'bg-primary text-white' : 'bg-accent-gray hover:border-primary'}"
          on:click={() => handleEmojiClick(emoji)}
          title={userReactions.has(emoji) ? 'Remove reaction' : 'React with ' + emoji}
          aria-label={userReactions.has(emoji) ? 'Remove reaction ' + emoji : 'React with ' + emoji}
        >
          {emoji}
        </button>
      {/each}
    </div>

    <!-- More emojis button -->
    <div class="border-t mt-3 pt-3" style="border-color: var(--color-input-border);">
      <button
        type="button"
        class="w-full flex items-center justify-center gap-2 py-2 rounded-lg transition-colors cursor-pointer hover:bg-accent-gray text-caption text-sm"
        on:click={handleOpenFullPicker}
      >
        <PlusIcon size={16} weight="bold" />
        More emojis
      </button>
    </div>
  </div>
</div>
