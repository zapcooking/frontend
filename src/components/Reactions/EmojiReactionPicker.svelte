<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { QUICK_EMOJIS } from '$lib/types/reactions';
  import { fade } from 'svelte/transition';
  import PlusIcon from 'phosphor-svelte/lib/Plus';

  export let anchorEl: HTMLElement | null = null;
  export let userReactions: Set<string> = new Set();

  const dispatch = createEventDispatcher<{
    select: { emoji: string };
    openFullPicker: void;
    close: void;
  }>();

  let pickerStyle = '';

  onMount(() => {
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      pickerStyle = `left: ${rect.left}px; top: ${rect.bottom + 8}px;`;
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
</script>

<!-- Fixed backdrop -->
<div
  class="fixed inset-0 z-[1000]"
  on:click={handleBackdropClick}
  role="button"
  tabindex="-1"
  on:keydown={(e) => e.key === 'Escape' && dispatch('close')}
  transition:fade={{ duration: 100 }}
>
  <!-- Picker positioned absolutely -->
  <div
    class="absolute bg-input border rounded-xl p-3 shadow-lg z-[1001]"
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
