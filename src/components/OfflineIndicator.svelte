<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { isOnline as isOnlineStore, connectionStatus } from '$lib/connectionMonitor';
  import { cookbookSyncStatus, cookbookPendingOps, cookbookStore } from '$lib/stores/cookbookStore';
  import CloudIcon from 'phosphor-svelte/lib/Cloud';
  import CloudSlashIcon from 'phosphor-svelte/lib/CloudSlash';
  import CloudArrowUpIcon from 'phosphor-svelte/lib/CloudArrowUp';
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';
  import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwise';

  let showIndicator = false;
  let lastOnlineState = true;
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;

  // Subscribe to online status changes
  $: {
    if ($isOnlineStore !== lastOnlineState) {
      showIndicator = true;
      lastOnlineState = $isOnlineStore;
      
      // Clear any existing timeout
      if (hideTimeout) clearTimeout(hideTimeout);
      
      // Auto-hide indicator after 3 seconds when coming back online
      if ($isOnlineStore) {
        hideTimeout = setTimeout(() => {
          showIndicator = false;
        }, 3000);
      }
    }
  }

  // Show indicator when there are pending operations
  $: if ($cookbookPendingOps > 0 && !$isOnlineStore) {
    showIndicator = true;
  }

  function handleManualSync() {
    cookbookStore.syncNow();
  }

  onDestroy(() => {
    if (hideTimeout) clearTimeout(hideTimeout);
  });
</script>

{#if showIndicator || (!$isOnlineStore && $cookbookPendingOps > 0)}
  <div 
    class="offline-indicator" 
    class:offline={!$isOnlineStore} 
    class:online={$isOnlineStore}
    class:syncing={$cookbookSyncStatus === 'syncing'}
    class:pending={$cookbookSyncStatus === 'pending' && $isOnlineStore}
  >
    <div class="indicator-content">
      {#if $isOnlineStore}
        {#if $cookbookSyncStatus === 'syncing'}
          <ArrowsClockwiseIcon size={20} class="animate-spin" />
          <span class="indicator-text">Syncing changes...</span>
        {:else if $cookbookSyncStatus === 'pending'}
          <CloudArrowUpIcon size={20} />
          <span class="indicator-text">{$cookbookPendingOps} pending changes</span>
          <button 
            on:click={handleManualSync}
            class="sync-btn"
          >
            Sync Now
          </button>
        {:else}
          <CheckCircleIcon size={20} />
          <span class="indicator-text">Connected</span>
        {/if}
      {:else}
        <CloudSlashIcon size={20} />
        <span class="indicator-text">
          Offline
          {#if $cookbookPendingOps > 0}
            • {$cookbookPendingOps} pending
          {/if}
        </span>
      {/if}
    </div>
  </div>
{/if}

<style scoped lang="postcss">
  @reference "../app.css";
  .offline-indicator {
    @apply fixed top-4 right-4 z-50 max-w-sm;
    @apply transition-all duration-300 ease-in-out;
    @apply transform translate-x-0;
    @apply rounded-lg shadow-lg;
  }

  .offline-indicator.offline {
    @apply bg-red-500 text-white;
  }

  .offline-indicator.online {
    @apply bg-green-500 text-white;
  }

  .offline-indicator.syncing {
    @apply bg-blue-500 text-white;
  }

  .offline-indicator.pending {
    @apply bg-amber-500 text-white;
  }

  .indicator-content {
    @apply flex items-center gap-2 px-4 py-2;
    @apply text-sm font-medium;
  }

  .indicator-text {
    @apply flex-1;
  }

  .sync-btn {
    @apply px-2 py-1 bg-white/20 hover:bg-white/30 rounded text-xs font-semibold transition-colors;
    @apply cursor-pointer;
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
