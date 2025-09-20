<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';

  let isOnline = true;
  let showIndicator = false;

  function handleOnline() {
    isOnline = true;
    showIndicator = false;
    console.log('🌐 Connection restored');
  }

  function handleOffline() {
    isOnline = false;
    showIndicator = true;
    console.log('📴 Connection lost');
  }

  onMount(() => {
    if (browser) {
      isOnline = navigator.onLine;
      
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      
      // Show indicator briefly when coming back online
      if (!isOnline) {
        showIndicator = true;
      }
    }
  });

  onDestroy(() => {
    if (browser) {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    }
  });

  // Auto-hide indicator after 3 seconds when coming back online
  $: if (isOnline && showIndicator) {
    setTimeout(() => {
      showIndicator = false;
    }, 3000);
  }
</script>

{#if showIndicator}
  <div class="offline-indicator" class:offline={!isOnline} class:online={isOnline}>
    <div class="indicator-content">
      {#if isOnline}
        <span class="indicator-icon">🌐</span>
        <span class="indicator-text">Connection restored!</span>
      {:else}
        <span class="indicator-icon">📴</span>
        <span class="indicator-text">You're offline. Some features may not work.</span>
      {/if}
    </div>
  </div>
{/if}

<style>
  .offline-indicator {
    @apply fixed top-4 right-4 z-50 max-w-sm;
    @apply transition-all duration-300 ease-in-out;
    @apply transform translate-x-0;
  }

  .offline-indicator.offline {
    @apply bg-red-500 text-white;
    @apply shadow-lg;
  }

  .offline-indicator.online {
    @apply bg-green-500 text-white;
    @apply shadow-lg;
  }

  .indicator-content {
    @apply flex items-center gap-2 px-4 py-2 rounded-lg;
    @apply text-sm font-medium;
  }

  .indicator-icon {
    @apply text-lg;
  }

  .indicator-text {
    @apply flex-1;
  }

  /* Animation for showing/hiding */
  .offline-indicator {
    animation: slideIn 0.3s ease-out;
  }

  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  /* Mobile responsiveness */
  @media (max-width: 640px) {
    .offline-indicator {
      @apply top-2 right-2 left-2 max-w-none;
    }
  }
</style>
