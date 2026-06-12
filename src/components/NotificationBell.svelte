<script lang="ts">
  /**
   * Header notifications bell + dropdown (desktop). Sits beside the
   * user avatar so notifications are one click away instead of buried
   * in the left side nav. The dropdown previews the most recent
   * activity with All / Replies / Zaps / DMs tabs; rows navigate to
   * the relevant note / conversation, and a footer link opens the
   * full notifications page.
   *
   * Mobile keeps the bottom-nav bell — this component is only
   * rendered at sm+ in Header.
   */
  import { goto } from '$app/navigation';
  import { get } from 'svelte/store';
  import { nip19 } from 'nostr-tools';
  import BellIcon from 'phosphor-svelte/lib/Bell';
  import EnvelopeSimpleIcon from 'phosphor-svelte/lib/EnvelopeSimple';
  import { clickOutside } from '$lib/clickOutside';
  import {
    notifications,
    visibleNotifications,
    type Notification
  } from '$lib/notificationStore';
  import {
    sortedConversations,
    messagesLoading,
    initMessageSubscription
  } from '$lib/stores/messages';
  import { ndk, userPublickey } from '$lib/nostr';
  import { browser } from '$app/environment';
  import { formatCompactTime } from '$lib/utils';
  import Avatar from './Avatar.svelte';
  import CustomName from './CustomName.svelte';

  type Tab = 'all' | 'replies' | 'zaps' | 'dms';

  // Most-recent rows shown per tab; the full history lives on
  // /notifications and /messages.
  const MAX_PREVIEW = 20;

  let open = false;
  let activeTab: Tab = 'all';

  // Neither backing store can be trusted for durable read-state: the
  // notification store only persists its most recent 100 items (mark-
  // all-read doesn't stick for anything beyond the cap, so a reload
  // resurrects the badge), and the messages store counts every message
  // its subscription decrypts — history included — as unread. The bell
  // therefore keeps its own per-account "seen watermark": everything
  // older than the moment you last closed the panel counts as seen, no
  // matter what the stores claim after a reload.
  //
  // DMs start from "now" on first use (history shouldn't flood in);
  // notifications start from 0 so a first-time user still sees their
  // real unread backlog.
  $: dmLastSeenKey = `zc_bell_dm_last_seen_${$userPublickey || 'anon'}`;
  $: notifLastSeenKey = `zc_bell_notif_last_seen_${$userPublickey || 'anon'}`;
  let dmLastSeen = 0;
  let notifLastSeen = 0;
  $: if (browser && $userPublickey) {
    const storedDm = localStorage.getItem(dmLastSeenKey);
    if (storedDm) {
      dmLastSeen = parseInt(storedDm, 10) || 0;
    } else {
      dmLastSeen = Math.floor(Date.now() / 1000);
      localStorage.setItem(dmLastSeenKey, String(dmLastSeen));
    }
    notifLastSeen = parseInt(localStorage.getItem(notifLastSeenKey) || '0', 10) || 0;
  }

  function markAllSeen() {
    const now = Math.floor(Date.now() / 1000);
    dmLastSeen = now;
    notifLastSeen = now;
    if (browser && $userPublickey) {
      localStorage.setItem(dmLastSeenKey, String(now));
      localStorage.setItem(notifLastSeenKey, String(now));
    }
  }

  // A DM row is one conversation (its latest message), not one event —
  // mirrors how /messages presents them. "New" is judged against the
  // bell's own dmLastSeen timestamp, not the store's session-relative
  // unreadCount.
  interface DmRow {
    pubkey: string;
    preview: string;
    timestamp: number;
  }

  $: dmRows = $sortedConversations.map((convo): DmRow => {
    const last = convo.messages[convo.messages.length - 1];
    return {
      pubkey: convo.pubkey,
      preview: last?.content ?? '',
      timestamp: convo.lastMessageAt
    };
  });

  // Unread = newer than the watermark, full stop. The per-item read
  // flags are deliberately NOT consulted: the store only persists its
  // 100 most recent items, so flags beyond the cap are lost on reload
  // and would make the badge/counts disagree with the row styling.
  // One timestamp drives badge, tab counts and row dots, so they can
  // never contradict each other.
  function isUnread(n: Notification, watermark: number): boolean {
    return n.createdAt > watermark;
  }

  $: sortedNotifs = [...$visibleNotifications].sort((a, b) => b.createdAt - a.createdAt);
  $: repliesUnread = sortedNotifs.filter(
    (n) => isUnread(n, notifLastSeen) && (n.type === 'comment' || n.type === 'mention')
  ).length;
  $: zapsUnread = sortedNotifs.filter(
    (n) => isUnread(n, notifLastSeen) && n.type === 'zap'
  ).length;
  $: notifsUnread = sortedNotifs.filter((n) => isUnread(n, notifLastSeen)).length;
  $: dmNewCount = dmRows.filter((dm) => dm.timestamp > dmLastSeen).length;
  $: totalUnread = notifsUnread + dmNewCount;

  type Row = { kind: 'notification'; notification: Notification } | ({ kind: 'dm' } & DmRow);

  function rowTimestamp(row: Row): number {
    return row.kind === 'notification' ? row.notification.createdAt : row.timestamp;
  }

  $: rows = ((): Row[] => {
    let list: Row[];
    if (activeTab === 'dms') {
      list = dmRows.map((dm) => ({ kind: 'dm' as const, ...dm }));
    } else if (activeTab === 'zaps') {
      list = sortedNotifs
        .filter((n) => n.type === 'zap')
        .map((n) => ({ kind: 'notification' as const, notification: n }));
    } else if (activeTab === 'replies') {
      list = sortedNotifs
        .filter((n) => n.type === 'comment' || n.type === 'mention')
        .map((n) => ({ kind: 'notification' as const, notification: n }));
    } else {
      list = [
        ...sortedNotifs.map((n) => ({ kind: 'notification' as const, notification: n })),
        ...dmRows.map((dm) => ({ kind: 'dm' as const, ...dm }))
      ].sort((a, b) => rowTimestamp(b) - rowTimestamp(a));
    }
    return list.slice(0, MAX_PREVIEW);
  })();

  function toggle() {
    if (open) {
      close();
      return;
    }
    open = true;
    activeTab = 'all';
    // The DM store only fills once its subscription runs (otherwise
    // it starts on the /messages page). Kick it off on first open —
    // it's idempotent — so the DMs tab populates. Deliberately NOT on
    // mount: decrypting gift wraps can prompt some signers, and that
    // should follow a user gesture.
    const ndkInstance = get(ndk);
    const pubkey = get(userPublickey);
    if (ndkInstance && pubkey) {
      initMessageSubscription(ndkInstance, pubkey).catch((e) =>
        console.debug('[NotificationBell] Message subscription init failed:', e)
      );
    }
  }

  // Counts and unread styling stay frozen while the panel is open —
  // everything clears on CLOSE, so numbers never vanish under the
  // user's cursor mid-read. markAllAsRead keeps the store / the
  // notifications page in sync for items within its persistence cap;
  // the watermark covers the rest.
  function close() {
    if (!open) return;
    open = false;
    notifications.markAllAsRead();
    markAllSeen();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (open && e.key === 'Escape') close();
  }

  function actionText(n: Notification): string {
    switch (n.type) {
      case 'zap':
        return n.amount ? `zapped you ${n.amount.toLocaleString()} sats` : 'zapped you';
      case 'comment':
        return 'replied to your post';
      case 'mention':
        return 'mentioned you';
      case 'reaction':
        return n.emoji && n.emoji !== '+' ? `reacted ${n.emoji}` : 'reacted to your post';
      case 'repost':
        return 'reposted your note';
      default:
        return 'interacted with you';
    }
  }

  async function openNotification(n: Notification) {
    notifications.markAsRead(n.id);
    close();

    const eventIdToView =
      n.eventId || (['mention', 'comment'].includes(n.type) ? n.id : null);
    if (!eventIdToView) return;

    // Same routing as the notifications page: recipes (kind 30023) go
    // to their recipe page, everything else to the note view.
    if (['reaction', 'zap', 'repost'].includes(n.type)) {
      try {
        const ndkInstance = get(ndk);
        if (ndkInstance) {
          const event = await ndkInstance.fetchEvent({ ids: [eventIdToView] });
          if (event && event.kind === 30023) {
            const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
            if (dTag) {
              goto(
                `/recipe/${nip19.naddrEncode({ kind: 30023, pubkey: event.pubkey, identifier: dTag })}`
              );
              return;
            }
          }
        }
      } catch (e) {
        console.debug('[NotificationBell] Could not fetch event for routing:', e);
      }
    }

    const raw = String(eventIdToView).trim();
    if (raw.startsWith('note1') || raw.startsWith('nevent1')) {
      goto(`/${raw}`);
      return;
    }
    try {
      goto(`/${nip19.noteEncode(raw)}`);
    } catch (e) {
      console.warn('[NotificationBell] Invalid eventId for note view:', raw, e);
    }
  }

  function openDm() {
    close();
    goto('/messages');
  }

  function openAll() {
    close();
    goto('/notifications');
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="relative" use:clickOutside on:click_outside={close}>
  <button
    type="button"
    class="bell-btn"
    class:is-open={open}
    on:click|stopPropagation={toggle}
    aria-label="Notifications"
    aria-haspopup="menu"
    aria-expanded={open}
  >
    <BellIcon size={18} weight={totalUnread > 0 ? 'fill' : 'bold'} />
    {#if totalUnread > 0}
      <span class="bell-badge">{totalUnread > 99 ? '99+' : totalUnread}</span>
    {/if}
  </button>

  {#if open}
    <div class="notif-panel" role="menu" aria-label="Recent notifications">
      <div class="notif-panel-header">
        <span class="notif-panel-title">Notifications</span>
      </div>

      <div class="notif-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          class="notif-tab"
          class:active={activeTab === 'all'}
          aria-selected={activeTab === 'all'}
          on:click={() => (activeTab = 'all')}
        >
          All
        </button>
        <button
          type="button"
          role="tab"
          class="notif-tab"
          class:active={activeTab === 'replies'}
          aria-selected={activeTab === 'replies'}
          on:click={() => (activeTab = 'replies')}
        >
          Replies{#if repliesUnread > 0}<span class="notif-tab-count">{repliesUnread}</span>{/if}
        </button>
        <button
          type="button"
          role="tab"
          class="notif-tab"
          class:active={activeTab === 'zaps'}
          aria-selected={activeTab === 'zaps'}
          on:click={() => (activeTab = 'zaps')}
        >
          Zaps{#if zapsUnread > 0}<span class="notif-tab-count">{zapsUnread}</span>{/if}
        </button>
        <button
          type="button"
          role="tab"
          class="notif-tab"
          class:active={activeTab === 'dms'}
          aria-selected={activeTab === 'dms'}
          on:click={() => (activeTab = 'dms')}
        >
          DMs{#if dmNewCount > 0}<span class="notif-tab-count">{dmNewCount}</span>{/if}
        </button>
      </div>

      <div class="notif-list">
        {#if rows.length === 0}
          {#if activeTab === 'dms' && $messagesLoading}
            <p class="notif-empty">Loading messages…</p>
          {:else}
            <p class="notif-empty">Nothing here yet</p>
          {/if}
        {:else}
          {#each rows as row (row.kind === 'notification' ? row.notification.id : `dm-${row.pubkey}`)}
            {#if row.kind === 'notification'}
              <button
                type="button"
                class="notif-row"
                class:unread={isUnread(row.notification, notifLastSeen)}
                on:click={() => openNotification(row.notification)}
              >
                <Avatar pubkey={row.notification.fromPubkey} size={32} />
                <span class="notif-row-body">
                  <span class="notif-row-top">
                    <strong class="notif-row-name">
                      <CustomName pubkey={row.notification.fromPubkey} />
                    </strong>
                    <span class="notif-row-time"
                      >{formatCompactTime(row.notification.createdAt)}</span
                    >
                  </span>
                  <span class="notif-row-action" class:zap={row.notification.type === 'zap'}>
                    {actionText(row.notification)}
                  </span>
                  {#if row.notification.content}
                    <span class="notif-row-preview">{row.notification.content}</span>
                  {/if}
                </span>
                {#if isUnread(row.notification, notifLastSeen)}
                  <span class="notif-dot" aria-hidden="true"></span>
                {/if}
              </button>
            {:else}
              <button
                type="button"
                class="notif-row"
                class:unread={row.timestamp > dmLastSeen}
                on:click={openDm}
              >
                <Avatar pubkey={row.pubkey} size={32} />
                <span class="notif-row-body">
                  <span class="notif-row-top">
                    <strong class="notif-row-name"><CustomName pubkey={row.pubkey} /></strong>
                    <span class="notif-row-time">{formatCompactTime(row.timestamp)}</span>
                  </span>
                  <span class="notif-row-action">sent you a message</span>
                  {#if row.preview}
                    <span class="notif-row-preview">{row.preview}</span>
                  {/if}
                </span>
                {#if row.timestamp > dmLastSeen}
                  <span class="notif-dot" aria-hidden="true"></span>
                {/if}
              </button>
            {/if}
          {/each}
        {/if}
      </div>

      <div class="notif-footer">
        {#if activeTab === 'dms'}
          <button type="button" class="notif-footer-btn" on:click={openDm}>
            <EnvelopeSimpleIcon size={16} />
            Open Messages
          </button>
        {:else}
          <button type="button" class="notif-footer-btn" on:click={openAll}>
            <BellIcon size={16} />
            View all notifications
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  /* Bell button — matches the header's icon-button sizing/hover. */
  .bell-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: none;
    border-radius: 9999px;
    background: transparent;
    color: var(--color-text-primary);
    cursor: pointer;
    transition: background-color 0.15s ease-out;
  }
  .bell-btn:hover,
  .bell-btn.is-open {
    background-color: var(--color-input-bg);
  }

  .bell-badge {
    position: absolute;
    top: -2px;
    right: -2px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 9999px;
    background: #ef4444;
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    line-height: 16px;
    text-align: center;
  }

  /* Dropdown panel — mirrors the IntelligenceMenu surface. */
  .notif-panel {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: 360px;
    max-height: 480px;
    display: flex;
    flex-direction: column;
    border-radius: 16px;
    border: 1px solid var(--color-input-border);
    background-color: var(--color-bg-primary);
    box-shadow:
      0 16px 40px rgba(0, 0, 0, 0.18),
      0 2px 8px rgba(0, 0, 0, 0.12);
    z-index: 60;
    overflow: hidden;
    animation: panel-in 0.14s ease-out;
  }
  @keyframes panel-in {
    from {
      opacity: 0;
      transform: translateY(-4px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .notif-panel-header {
    padding: 0.75rem 1rem 0.25rem;
  }
  .notif-panel-title {
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--color-text-primary);
  }

  .notif-tabs {
    display: flex;
    gap: 0.25rem;
    padding: 0 0.75rem;
    border-bottom: 1px solid var(--color-input-border);
  }
  .notif-tab {
    padding: 0.4rem 0.5rem;
    border: none;
    background: transparent;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--color-caption);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    white-space: nowrap;
  }
  .notif-tab:hover {
    color: var(--color-text-primary);
  }
  .notif-tab.active {
    color: var(--color-text-primary);
    border-image: linear-gradient(to right, #f97316, #f59e0b) 1;
    border-bottom: 2px solid #f97316;
  }
  /* Unread count beside the tab label — quiet, not part of the bold
     label. */
  .notif-tab-count {
    margin-left: 0.3rem;
    font-weight: 400;
    color: var(--color-caption);
  }

  .notif-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.25rem 0;
  }

  .notif-empty {
    padding: 1.5rem 1rem;
    text-align: center;
    font-size: 0.82rem;
    color: var(--color-caption);
  }

  .notif-row {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    width: 100%;
    padding: 0.55rem 1rem;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.12s ease-out;
  }
  .notif-row:hover {
    background-color: var(--color-input-bg);
  }
  .notif-row.unread {
    background-color: color-mix(in srgb, #f97316 5%, transparent);
  }
  .notif-row.unread:hover {
    background-color: color-mix(in srgb, #f97316 9%, transparent);
  }

  .notif-row-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .notif-row-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .notif-row-name {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .notif-row-time {
    flex-shrink: 0;
    font-size: 0.7rem;
    color: var(--color-caption);
  }
  .notif-row-action {
    font-size: 0.76rem;
    color: var(--color-caption);
  }
  .notif-row-action.zap {
    color: #f59e0b;
    font-weight: 600;
  }
  .notif-row-preview {
    font-size: 0.72rem;
    color: var(--color-caption);
    opacity: 0.8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .notif-dot {
    flex-shrink: 0;
    width: 0.5rem;
    height: 0.5rem;
    margin-top: 6px;
    border-radius: 9999px;
    background-color: #f97316;
  }

  .notif-footer {
    border-top: 1px solid var(--color-input-border);
  }
  .notif-footer-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    width: 100%;
    padding: 0.6rem 1rem;
    border: none;
    background: transparent;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--color-text-primary);
    cursor: pointer;
    transition: background-color 0.12s ease-out;
  }
  .notif-footer-btn:hover {
    background-color: var(--color-input-bg);
  }
</style>
