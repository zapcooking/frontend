<script lang="ts">
  import { notifications, unreadCount, subscribeToNotifications, unsubscribeFromNotifications } from '$lib/notificationStore';
  import { ndk, userPublickey } from '$lib/nostr';
  import { onMount, onDestroy } from 'svelte';
  import BellIcon from 'phosphor-svelte/lib/Bell';
  import { clickOutside } from '$lib/clickOutside';
  import NotificationPanel from './NotificationPanel.svelte';
  
  let showPanel = false;
  
  onMount(() => {
    if ($userPublickey) {
      subscribeToNotifications($ndk, $userPublickey);
    }
  });
  
  onDestroy(() => {
    unsubscribeFromNotifications();
  });
  
  // Resubscribe when user changes
  $: if ($userPublickey && $ndk) {
    // Ensure any existing subscription is cleaned up before creating a new one
    unsubscribeFromNotifications();
    subscribeToNotifications($ndk, $userPublickey);
  }
</script>

<div class="relative" use:clickOutside on:click_outside={() => showPanel = false}>
  <button
    on:click={() => showPanel = !showPanel}
    class="relative p-2 rounded-full hover:bg-accent-gray transition-colors cursor-pointer"
    aria-label="Notifications"
  >
    <BellIcon size={24} weight={$unreadCount > 0 ? 'fill' : 'regular'} />

    {#if $unreadCount > 0}
      <span class="absolute top-0 right-0 w-2.5 h-2.5 bg-red-500 rounded-full"></span>
    {/if}
  </button>

  {#if showPanel}
    <div
      class="absolute right-0 mt-2 w-80 sm:w-96 bg-input rounded-xl shadow-lg border z-50 overflow-hidden"
      style="border-color: var(--color-input-border)"
    >
      <NotificationPanel onClose={() => showPanel = false} />
    </div>
  {/if}
</div>


