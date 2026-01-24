<script lang="ts">
  import { notifications, unreadCount } from '$lib/notificationStore';
  import { goto } from '$app/navigation';
  import { formatDistanceToNow } from 'date-fns';
  import { nip19 } from 'nostr-tools';
  import CustomAvatar from './CustomAvatar.svelte';
  import CustomName from './CustomName.svelte';
  import { onMount } from 'svelte';
  
  export let onClose: () => void;
  
  const MAX_PREVIEW = 8;
  
  // Auto-mark all as read when panel is opened
  onMount(() => {
    if ($unreadCount > 0) {
      // Small delay to let user see unread indicators briefly
      setTimeout(() => {
        notifications.markAllAsRead();
      }, 500);
    }
  });
  
  function getIcon(type: string): string {
    switch (type) {
      case 'reaction': return '❤️';
      case 'zap': return '⚡';
      case 'comment': return '💬';
      case 'mention': return '📣';
      case 'repost': return '🔁';
      default: return '🔔';
    }
  }
  
  function getMessage(notification: any): string {
    switch (notification.type) {
      case 'reaction':
        return `reacted ${notification.emoji || '❤️'}`;
      case 'zap':
        return `zapped you ${notification.amount?.toLocaleString() || ''} sats`;
      case 'comment':
        return 'replied to your post';
      case 'mention':
        return 'mentioned you';
      case 'repost':
        return 'reposted your note';
      default:
        return 'interacted with you';
    }
  }
  
  function formatTime(timestamp: number): string {
    return formatDistanceToNow(timestamp * 1000, { addSuffix: true });
  }
  
  function handleNotificationClick(notification: any) {
    notifications.markAsRead(notification.id);
    onClose();
    // Navigate to the event if we have an eventId
    if (notification.eventId) {
      const raw = String(notification.eventId).trim();
      if (!raw) return;
      if (raw.startsWith('note1') || raw.startsWith('nevent1')) {
        goto(`/${raw}`);
        return;
      }
      try {
        const noteId = nip19.noteEncode(raw);
        goto(`/${noteId}`);
      } catch (e) {
        console.warn('[NotificationPanel] Invalid eventId for navigation:', raw, e);
      }
    }
  }
  
  function viewAll() {
    onClose();
    goto('/notifications');
  }
</script>

<div class="flex flex-col max-h-[480px]">
  <!-- Header -->
  <div class="flex items-center justify-between px-4 py-3 border-b" style="border-color: var(--color-input-border)">
    <h3 class="font-semibold" style="color: var(--color-text-primary)">Notifications</h3>
  </div>

  <!-- Notification List -->
  <div class="overflow-y-auto flex-1">
    {#if $notifications.length === 0}
      <div class="px-4 py-8 text-center text-caption">
        <span class="text-3xl">🔔</span>
        <p class="mt-2">No notifications yet</p>
      </div>
    {:else}
      {#each $notifications.slice(0, MAX_PREVIEW) as notification (notification.id)}
        <button
          on:click={() => handleNotificationClick(notification)}
          class="w-full flex items-start gap-3 px-4 py-3 hover:bg-accent-gray transition-colors cursor-pointer text-left"
        >
          <div class="relative flex-shrink-0">
            <CustomAvatar pubkey={notification.fromPubkey} size={40} />
            <span class="absolute -bottom-1 -right-1 text-sm">
              {getIcon(notification.type)}
            </span>
          </div>

          <div class="flex-1 min-w-0">
            <p class="text-sm" style="color: var(--color-text-primary)">
              <span class="font-semibold">
                <CustomName pubkey={notification.fromPubkey} />
              </span>
              {' '}{getMessage(notification)}
            </p>
            {#if notification.content}
              <p class="text-sm truncate mt-0.5" style="color: var(--color-text-secondary)">
                "{notification.content}"
              </p>
            {/if}
            <p class="text-xs mt-1" style="color: var(--color-text-secondary)">
              {formatTime(notification.createdAt)}
            </p>
          </div>

          {#if !notification.read}
            <span class="w-2 h-2 bg-orange-500 rounded-full flex-shrink-0 mt-2"></span>
          {/if}
        </button>
      {/each}
    {/if}
  </div>

  <!-- Footer -->
  {#if $notifications.length > 0}
    <div class="border-t" style="border-color: var(--color-input-border)">
      <button
        on:click={viewAll}
        class="w-full px-4 py-3 text-sm text-center text-orange-500 hover:bg-accent-gray font-medium cursor-pointer"
      >
        See all notifications
      </button>
    </div>
  {/if}
</div>

