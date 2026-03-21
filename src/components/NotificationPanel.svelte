<script lang="ts">
  import { notifications, unreadCount } from '$lib/notificationStore';
  import { formatCompactTime } from '$lib/utils';
  import { goto } from '$app/navigation';
  import { nip19 } from 'nostr-tools';
  import Avatar from './Avatar.svelte';
  import CustomName from './CustomName.svelte';
  import { onMount } from 'svelte';
  import HeartIcon from 'phosphor-svelte/lib/Heart';
  import ChatCircleIcon from 'phosphor-svelte/lib/ChatCircle';
  import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwise';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import AtIcon from 'phosphor-svelte/lib/At';

  export let onClose: () => void;

  const MAX_PREVIEW = 8;

  onMount(() => {
    if ($unreadCount > 0) {
      setTimeout(() => {
        notifications.markAllAsRead();
      }, 500);
    }
  });

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

  function handleNotificationClick(notification: any) {
    notifications.markAsRead(notification.id);
    onClose();
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
          class="w-full flex items-start gap-2.5 px-4 py-3 hover:bg-accent-gray transition-colors cursor-pointer text-left"
        >
          <div class="flex-shrink-0 w-5 mt-0.5">
            {#if notification.type === 'reaction'}
              <HeartIcon size={16} weight="fill" color="#ef4444" />
            {:else if notification.type === 'comment'}
              <ChatCircleIcon size={16} weight="fill" color="#3b82f6" />
            {:else if notification.type === 'repost'}
              <ArrowsClockwiseIcon size={16} weight="bold" color="#22c55e" />
            {:else if notification.type === 'zap'}
              <LightningIcon size={16} weight="fill" color="#f59e0b" />
            {:else if notification.type === 'mention'}
              <AtIcon size={16} weight="bold" color="#a855f7" />
            {/if}
          </div>

          <div class="flex-shrink-0">
            <Avatar pubkey={notification.fromPubkey} size={32} />
          </div>

          <div class="flex-1 min-w-0">
            <p class="text-sm" style="color: var(--color-text-primary)">
              <span class="font-semibold">
                <CustomName pubkey={notification.fromPubkey} />
              </span>
              {' '}{getMessage(notification)}
            </p>
            {#if notification.content}
              <p class="text-xs truncate mt-0.5" style="color: var(--color-text-secondary)">
                {notification.content}
              </p>
            {/if}
            <p class="text-xs mt-0.5" style="color: var(--color-text-secondary)">
              {formatCompactTime(notification.createdAt)}
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
