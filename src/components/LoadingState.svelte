<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let type: 'spinner' | 'skeleton' | 'dots' | 'pulse' = 'spinner';
  export let size: 'sm' | 'md' | 'lg' = 'md';
  export let text: string = 'Loading...';
  export let showText: boolean = true;
  export let fullScreen: boolean = false;
  export let allowCancel: boolean = false;

  const dispatch = createEventDispatcher();

  function cancel() {
    dispatch('cancel');
  }

  // Size configurations
  $: sizeConfig = {
    sm: { spinner: 38, text: 'text-sm', container: 'py-2' },
    md: { spinner: 60, text: 'text-base', container: 'py-4' },
    lg: { spinner: 80, text: 'text-lg', container: 'py-8' }
  };

  $: currentSize = sizeConfig[size];
</script>

<div
  class="loading-state"
  class:full-screen={fullScreen}
  class:py-2={size === 'sm'}
  class:py-4={size === 'md'}
  class:py-8={size === 'lg'}
>
  <div class="loading-content">
    {#if type === 'spinner'}
      <div class="spinner" style="width: {currentSize.spinner}px; height: {currentSize.spinner}px;">
        <img src="/pan-animated.svg" alt="Loading" class="dark:hidden" />
        <img src="/pan-animated-dark.svg" alt="Loading" class="hidden dark:block" />
      </div>
      {:else if type === 'dots'}
      <div class="dots">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
    {:else if type === 'pulse'}
      <div class="pulse">
        <div class="pulse-circle"></div>
      </div>
    {/if}

    {#if showText && text}
      <p class="loading-text {currentSize.text}">{text}</p>
    {/if}

    {#if allowCancel}
      <button
        class="cancel-button"
        on:click={cancel}
      >
        Cancel
      </button>
    {/if}
  </div>
</div>

<style scoped lang="postcss">
  @reference "../app.css";

  .loading-state {
    @apply flex items-center justify-center;
  }

  .loading-state.full-screen {
    @apply fixed inset-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm z-50;
  }

  .loading-content {
    @apply flex flex-col items-center gap-3;
  }

  .spinner {
    @apply text-blue-600 dark:text-blue-400;
  }

  .spinner svg {
    @apply animate-spin;
  }

  .dots {
    @apply flex gap-1;
  }

  .dot {
    @apply w-2 h-2 bg-blue-600 dark:bg-blue-400 rounded-full animate-bounce;
  }

  .dot:nth-child(2) {
    animation-delay: 0.1s;
  }

  .dot:nth-child(3) {
    animation-delay: 0.2s;
  }

  .pulse {
    @apply relative;
  }

  .pulse-circle {
    @apply w-8 h-8 bg-blue-600 dark:bg-blue-400 rounded-full animate-pulse;
  }

  .loading-text {
    @apply text-gray-600 dark:text-gray-400 text-center;
  }

  .cancel-button {
    @apply px-3 py-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors;
  }

  /* Disable animations for users who prefer reduced motion */
  @media (prefers-reduced-motion: reduce) {
    .spinner svg,
    .dot,
    .pulse-circle {
      animation: none;
    }

    .spinner svg {
      @apply opacity-50;
    }
  }
</style>
