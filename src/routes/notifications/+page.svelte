<script lang="ts">
  import { notifications, unreadCount } from '$lib/notificationStore';
  import { goto } from '$app/navigation';
  import { formatDistanceToNow } from 'date-fns';
  import { nip19 } from 'nostr-tools';
  import CustomAvatar from '../../components/CustomAvatar.svelte';
  import CustomName from '../../components/CustomName.svelte';
  import { userPublickey } from '$lib/nostr';
  import { onMount } from 'svelte';
  
  type TabType = 'all' | 'zaps' | 'replies' | 'mentions';
  
  let activeTab: TabType = 'all';
  
  const tabs: { id: TabType; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'zaps', label: 'Zaps' },
    { id: 'replies', label: 'Replies' },
    { id: 'mentions', label: 'Mentions' }
  ];
  
  $: filteredNotifications = $notifications.filter(n => {
    if (activeTab === 'all') return true;
    if (activeTab === 'zaps') return n.type === 'zap';
    if (activeTab === 'replies') return n.type === 'comment';
    if (activeTab === 'mentions') return n.type === 'mention';
    return true;
  });
  
  onMount(() => {
    if (!$userPublickey) {
      goto('/login');
      return;
    }
    
    // Auto-mark all notifications as read when viewing the page
    if ($unreadCount > 0) {
      // Small delay to let user see the unread state briefly before clearing
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
  </div>
  
  <!-- Tabs -->
  <div class="mb-6 border-b" style="border-color: var(--color-input-border)">
    <div class="flex gap-1">
      {#each tabs as tab}
        <button
          on:click={() => activeTab = tab.id}
          class="px-4 py-2 text-sm font-medium transition-colors relative cursor-pointer"
          style="color: {activeTab === tab.id ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'}"
        >
          {tab.label}
          {#if activeTab === tab.id}
            <span class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"></span>
          {/if}
        </button>
      {/each}
    </div>
  </div>
  
  {#if $notifications.length === 0}
    <div class="text-center py-12 text-caption">
      <span class="text-5xl">🔔</span>
      <p class="mt-4 text-lg">No notifications yet</p>
      <p class="mt-2">When someone reacts, zaps, or replies to you, it will show up here.</p>
    </div>
  {:else if filteredNotifications.length === 0}
    <div class="text-center py-12 text-caption">
      <span class="text-5xl">🔔</span>
      <p class="mt-4 text-lg">No {activeTab === 'all' ? '' : activeTab} notifications</p>
    </div>
  {:else}
    <div class="rounded-xl divide-y" style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);">
      {#each filteredNotifications as notification (notification.id)}
        <button
          on:click={() => handleNotificationClick(notification)}
          class="w-full flex items-start gap-4 p-4 transition-colors cursor-pointer text-left hover:opacity-80
            {notification.read ? 'opacity-60' : ''}"
          style="border-color: var(--color-input-border);"
        >
          <div class="relative flex-shrink-0">
            <CustomAvatar pubkey={notification.fromPubkey} size={48} />
            <span class="absolute -bottom-1 -right-1 text-lg">
              {getIcon(notification.type)}
            </span>
          </div>
          
          <div class="flex-1 min-w-0">
            <p style="color: var(--color-text-primary);">
              <span class="font-semibold">
                <CustomName pubkey={notification.fromPubkey} />
              </span>
              {' '}{getMessage(notification)}
            </p>
            {#if notification.content}
              <p class="mt-1 line-clamp-2" style="color: var(--color-text-secondary);">
                "{notification.content}"
              </p>
            {/if}
            <p class="text-sm mt-2" style="color: var(--color-caption);">
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

