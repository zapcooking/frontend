<script lang="ts">
  import { notifications, unreadCount } from '$lib/notificationStore';
  import { goto } from '$app/navigation';
  import { formatDistanceToNow } from 'date-fns';
  import { nip19 } from 'nostr-tools';
  import CustomAvatar from '../../components/CustomAvatar.svelte';
  import CustomName from '../../components/CustomName.svelte';
  import { userPublickey } from '$lib/nostr';
  import { onMount } from 'svelte';
  
  onMount(() => {
    if (!$userPublickey) {
      goto('/login');
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
    if (notification.eventId) {
      const nevent = nip19.noteEncode(notification.eventId);
      goto(`/${nevent}`);
    }
  }
</script>

<svelte:head>
  <title>Notifications | Zap Cooking</title>
</svelte:head>

<div class="max-w-2xl mx-auto px-4 py-8">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-bold">Notifications</h1>
    {#if $unreadCount > 0}
      <button 
        on:click={() => notifications.markAllAsRead()}
        class="text-sm text-orange-500 hover:text-orange-600 cursor-pointer"
      >
        Mark all as read
      </button>
    {/if}
  </div>
  
  {#if $notifications.length === 0}
    <div class="text-center py-12 text-gray-500">
      <span class="text-5xl">🔔</span>
      <p class="mt-4 text-lg">No notifications yet</p>
      <p class="mt-2">When someone reacts, zaps, or replies to you, it will show up here.</p>
    </div>
  {:else}
    <div class="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
      {#each $notifications as notification (notification.id)}
        <button
          on:click={() => handleNotificationClick(notification)}
          class="w-full flex items-start gap-4 p-4 hover:bg-gray-50 transition-colors cursor-pointer text-left
            {notification.read ? 'opacity-60' : ''}"
        >
          <div class="relative flex-shrink-0">
            <CustomAvatar pubkey={notification.fromPubkey} size={48} />
            <span class="absolute -bottom-1 -right-1 text-lg">
              {getIcon(notification.type)}
            </span>
          </div>
          
          <div class="flex-1 min-w-0">
            <p class="text-gray-900">
              <span class="font-semibold">
                <CustomName pubkey={notification.fromPubkey} />
              </span>
              {' '}{getMessage(notification)}
            </p>
            {#if notification.content}
              <p class="text-gray-500 mt-1 line-clamp-2">
                "{notification.content}"
              </p>
            {/if}
            <p class="text-sm text-gray-400 mt-2">
              {formatTime(notification.createdAt)}
            </p>
          </div>
          
          {#if !notification.read}
            <span class="w-3 h-3 bg-orange-500 rounded-full flex-shrink-0 mt-2"></span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

