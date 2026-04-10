<script lang="ts">
  import { notifications, visibleNotifications, unreadCount } from '$lib/notificationStore';
  import { buildDisplayItems, type NotificationDisplayItem } from '$lib/groupedNotifications';
  import { formatContentForPanel } from '$lib/notificationUtils';
  import { formatCompactTime } from '$lib/utils';
  import { goto } from '$app/navigation';
  import { nip19 } from 'nostr-tools';
  import Avatar from './Avatar.svelte';
  import AvatarStack from './notifications/AvatarStack.svelte';
  import CustomName from './CustomName.svelte';
  import { onMount } from 'svelte';
  import HeartIcon from 'phosphor-svelte/lib/Heart';
  import ChatCircleIcon from 'phosphor-svelte/lib/ChatCircle';
  import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwise';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import AtIcon from 'phosphor-svelte/lib/At';

  export let onClose: () => void;

  const MAX_PREVIEW = 8;

  // Group and slice for compact display
  $: displayItems = buildDisplayItems($visibleNotifications).slice(0, MAX_PREVIEW);

  // Snapshot unread IDs at mount time, then mark only those read after a short delay
  let unreadSnapshot: string[] = [];
  onMount(() => {
    unreadSnapshot = $visibleNotifications.filter((n) => !n.read).map((n) => n.id);
    if (unreadSnapshot.length > 0) {
      setTimeout(() => {
        for (const id of unreadSnapshot) {
          notifications.markAsRead(id);
        }
      }, 500);
    }
  });

  function getItemType(item: NotificationDisplayItem): string {
    if (item.kind === 'single') return item.notification.type;
    if (item.kind === 'grouped-reactions') return 'reaction';
    return 'zap';
  }

  function getLeadPubkey(item: NotificationDisplayItem): string {
    if (item.kind === 'single') return item.notification.fromPubkey;
    return item.notifications[0].fromPubkey;
  }

  function getMessage(item: NotificationDisplayItem): string {
    const type = getItemType(item);
    if (item.kind !== 'single') {
      const count = item.notifications.length;
      if (type === 'reaction') return `and ${count - 1} others reacted to your post`;
      if (type === 'zap') {
        const total = (item as Extract<NotificationDisplayItem, { kind: 'grouped-zaps' }>).totalAmount;
        return `and ${count - 1} others zapped ${total.toLocaleString()} sats`;
      }
    }
    const n = (item as Extract<NotificationDisplayItem, { kind: 'single' }>).notification;
    switch (n.type) {
      case 'reaction':
        return `reacted ${n.emoji || '❤️'}`;
      case 'zap': {
        const label = `zapped you ${n.amount?.toLocaleString() || ''} sats`;
        return n.content ? `${label}: ${formatContentForPanel(n.content).slice(0, 40)}` : label;
      }
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

  function getTimestamp(item: NotificationDisplayItem): number {
    return item.kind === 'single' ? item.notification.createdAt : item.latestTimestamp;
  }

  function isRead(item: NotificationDisplayItem): boolean {
    return item.kind === 'single' ? item.notification.read : item.read;
  }

  function getContent(item: NotificationDisplayItem): string | undefined {
    if (item.kind !== 'single') return undefined;
    const n = item.notification;
    if (n.type === 'comment' || n.type === 'mention') return n.content;
    return undefined;
  }

  function navigateToNote(eventId: string) {
    const raw = String(eventId).trim();
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

  function handleItemClick(item: NotificationDisplayItem) {
    onClose();
    if (item.kind === 'single') {
      notifications.markAsRead(item.notification.id);
      const eventId = item.notification.eventId;
      if (eventId) navigateToNote(eventId);
    } else {
      for (const n of item.notifications) {
        notifications.markAsRead(n.id);
      }
      if (item.targetEventId) navigateToNote(item.targetEventId);
    }
  }

  function getItemKey(item: NotificationDisplayItem): string {
    return item.kind === 'single' ? item.notification.id : item.key;
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
    {#if $visibleNotifications.length === 0}
      <div class="px-4 py-8 text-center text-caption">
        <span class="text-3xl">🔔</span>
        <p class="mt-2">No notifications yet</p>
      </div>
    {:else}
      {#each displayItems as item (getItemKey(item))}
        {@const type = getItemType(item)}
        {@const leadPubkey = getLeadPubkey(item)}
        {@const content = getContent(item)}
        <button
          on:click={() => handleItemClick(item)}
          class="w-full flex items-start gap-2.5 px-4 py-3 hover:bg-accent-gray transition-colors cursor-pointer text-left"
        >
          <div class="flex-shrink-0 w-5 mt-0.5">
            {#if type === 'reaction'}
              <HeartIcon size={16} weight="fill" color="#ef4444" />
            {:else if type === 'comment'}
              <ChatCircleIcon size={16} weight="fill" color="#3b82f6" />
            {:else if type === 'repost'}
              <ArrowsClockwiseIcon size={16} weight="bold" color="#22c55e" />
            {:else if type === 'zap'}
              <LightningIcon size={16} weight="fill" color="#f59e0b" />
            {:else if type === 'mention'}
              <AtIcon size={16} weight="bold" color="#a855f7" />
            {/if}
          </div>

          <div class="flex-shrink-0">
            {#if item.kind !== 'single' && item.notifications.length >= 2}
              <AvatarStack pubkeys={item.notifications.map(n => n.fromPubkey).slice(0, 3)} size={24} />
            {:else}
              <Avatar pubkey={leadPubkey} size={32} />
            {/if}
          </div>

          <div class="flex-1 min-w-0">
            <p class="text-sm" style="color: var(--color-text-primary)">
              <span class="font-semibold">
                <CustomName pubkey={leadPubkey} />
              </span>
              {' '}{getMessage(item)}
            </p>
            {#if content}
              <p class="text-xs truncate mt-0.5" style="color: var(--color-text-secondary)">
                {formatContentForPanel(content)}
              </p>
            {/if}
            <p class="text-xs mt-0.5" style="color: var(--color-text-secondary)">
              {formatCompactTime(getTimestamp(item))}
            </p>
          </div>

          {#if !isRead(item)}
            <span class="w-2 h-2 bg-orange-500 rounded-full flex-shrink-0 mt-2"></span>
          {/if}
        </button>
      {/each}
    {/if}
  </div>

  <!-- Footer -->
  {#if $visibleNotifications.length > 0}
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
