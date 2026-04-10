<script lang="ts">
  import {
    notifications,
    visibleNotifications,
    unreadCount,
    subscribeToNotifications,
    fetchOlderNotifications,
    type Notification
  } from '$lib/notificationStore';
  import { buildDisplayItems, type NotificationDisplayItem } from '$lib/groupedNotifications';
  import { isHellthread, stripMediaAndBech32 } from '$lib/notificationUtils';
  import { formatCompactTime } from '$lib/utils';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { nip19 } from 'nostr-tools';
  import Avatar from '../../components/Avatar.svelte';
  import AvatarStack from '../../components/notifications/AvatarStack.svelte';
  import NotifText from '../../components/notifications/NotifText.svelte';
  import CustomName from '../../components/CustomName.svelte';
  import { userPublickey, ndk } from '$lib/nostr';
  import { onMount } from 'svelte';
  import PullToRefresh from '../../components/PullToRefresh.svelte';
  import { get } from 'svelte/store';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { notificationsNavTick } from '$lib/notificationsNav';
  import { muteListStore } from '$lib/muteListStore';
  import { resolveProfileByPubkey, getDisplayName } from '$lib/profileResolver';
  import { resolveNote, resolveRecipe } from '$lib/utils/nostrRefs';
  import HeartIcon from 'phosphor-svelte/lib/Heart';
  import ChatCircleIcon from 'phosphor-svelte/lib/ChatCircle';
  import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwise';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import AtIcon from 'phosphor-svelte/lib/At';
  import BellIcon from 'phosphor-svelte/lib/Bell';
  import VideoIcon from 'phosphor-svelte/lib/Video';

  // Pull-to-refresh ref
  let pullToRefreshEl: PullToRefresh;

  // Load more state
  let loadingMore = false;
  let noMoreNotifications = false;
  let oldestFetchedTimestamp: number | null = null;

  type TabType = 'all' | 'zaps' | 'replies' | 'mentions';
  type ContextPreview = {
    kind: number;
    pubkey: string;
    title?: string;
    preview: string;
    image?: string;
    hasVideo?: boolean;
  } | null;

  // Map of referenced eventId -> preview data (null = failed to load)
  let contextById: Record<string, ContextPreview> = {};
  let contextInFlight = new Set<string>();
  const MAX_CONTEXT_FETCH = 50;
  const CONTEXT_CONCURRENCY = 4;

  // Track event IDs that are hellthreads (to filter out notifications referencing them)
  let hellthreadEventIds = new Set<string>();

  // Map of pubkey -> display name for resolving nostr:npub mentions
  let resolvedNames: Record<string, string> = {};
  let namesInFlight = new Set<string>();

  // Map of nostr ref -> resolved preview text for notes/events/addresses
  let resolvedRefs: Record<string, string> = {};
  let refsInFlight = new Set<string>();

  // Patterns to match nostr: mentions
  const NPUB_MENTION_PATTERN = /nostr:((?:npub1|nprofile1)[a-z0-9]+)/gi;
  const NOSTR_REF_PATTERN = /nostr:((nevent1|note1|naddr1)[a-z0-9]+)/gi;

  function scrollAppToTop() {
    if (!browser) return;
    const el = document.getElementById('app-scroll');
    if (el) el.scrollTop = 0;
    else window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }

  async function forceRefreshNotifications() {
    if ($userPublickey) {
      const ndkInstance = get(ndk);
      if (ndkInstance) {
        subscribeToNotifications(ndkInstance, $userPublickey, true);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  async function refreshAndResetView() {
    scrollAppToTop();
    activeTab = 'all';
    await forceRefreshNotifications();
  }

  async function handleRefresh() {
    try {
      await forceRefreshNotifications();
      noMoreNotifications = false;
      oldestFetchedTimestamp = null;
    } finally {
      pullToRefreshEl?.complete();
    }
  }

  async function loadMoreNotifications() {
    if (loadingMore || noMoreNotifications || !$userPublickey) return;

    const ndkInstance = get(ndk);
    if (!ndkInstance) return;

    let fetchBefore: number;

    if (oldestFetchedTimestamp !== null) {
      fetchBefore = oldestFetchedTimestamp;
    } else {
      const oldestNotification = $notifications.reduce(
        (oldest, n) => (n.createdAt < oldest.createdAt ? n : oldest),
        $notifications[0]
      );

      if (!oldestNotification) return;
      fetchBefore = oldestNotification.createdAt;
    }

    loadingMore = true;
    try {
      const newCount = await fetchOlderNotifications(ndkInstance, $userPublickey, fetchBefore);
      oldestFetchedTimestamp = fetchBefore - 7 * 24 * 60 * 60;

      if (newCount === 0) {
        noMoreNotifications = true;
      }
    } catch (error) {
      console.error('[Notifications] Error loading more:', error);
    } finally {
      loadingMore = false;
    }
  }

  let activeTab: TabType = 'all';

  const tabs: { id: TabType; label: string; icon: typeof BellIcon }[] = [
    { id: 'all', label: 'All', icon: BellIcon },
    { id: 'zaps', label: 'Zaps', icon: LightningIcon },
    { id: 'replies', label: 'Replies', icon: ChatCircleIcon },
    { id: 'mentions', label: 'Mentions', icon: AtIcon }
  ];

  // visibleNotifications already excludes muted users (handled in notificationStore)
  $: filteredNotifications = $visibleNotifications.filter((n) => {
    const refId = getReferencedEventId(n);
    if (refId && hellthreadEventIds.has(refId)) return false;

    if (activeTab === 'all') return true;
    if (activeTab === 'zaps') return n.type === 'zap';
    if (activeTab === 'replies') return n.type === 'comment';
    if (activeTab === 'mentions') return n.type === 'mention';
    return true;
  });

  // Build display items (grouped reactions / small zaps) from filtered notifications
  $: displayItems = buildDisplayItems(filteredNotifications);

  // Resolve nostr: references in notification content
  $: {
    for (const n of filteredNotifications) {
      if (n.content) {
        void resolveNostrRefs(n.content);
      }
    }
  }

  function getReferencedEventId(notification: Notification): string | null {
    if (
      notification.type === 'reaction' ||
      notification.type === 'zap' ||
      notification.type === 'repost'
    ) {
      return notification.eventId || null;
    }
    if (notification.type === 'comment' && notification.targetEventId) {
      return notification.targetEventId;
    }
    return null;
  }

  function normalizeText(s: string): string {
    return String(s || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async function resolveNpubMentions(text: string): Promise<void> {
    if (!text) return;

    const ndkInstance = get(ndk);
    if (!ndkInstance) return;

    const matches = text.matchAll(NPUB_MENTION_PATTERN);
    const npubs: string[] = [];

    for (const match of matches) {
      const npub = match[1];
      if (npub && !resolvedNames[npub] && !namesInFlight.has(npub)) {
        npubs.push(npub);
      }
    }

    if (npubs.length === 0) return;

    npubs.forEach((npub) => namesInFlight.add(npub));

    await Promise.all(
      npubs.map(async (npub) => {
        try {
          const decoded = nip19.decode(npub);
          let pubkey: string | undefined;
          if (decoded.type === 'npub') {
            pubkey = decoded.data as string;
          } else if (decoded.type === 'nprofile') {
            pubkey = (decoded.data as { pubkey: string }).pubkey;
          }
          if (pubkey) {
            const profile = await resolveProfileByPubkey(pubkey, ndkInstance);
            const name = getDisplayName(profile);
            resolvedNames = { ...resolvedNames, [npub]: name };
          }
        } catch (e) {
          resolvedNames = { ...resolvedNames, [npub]: 'someone' };
        } finally {
          namesInFlight.delete(npub);
        }
      })
    );
  }

  async function resolveNostrRefs(text: string): Promise<void> {
    if (!text) return;

    const ndkInstance = get(ndk);
    if (!ndkInstance) return;

    const refs: string[] = [];
    const matches = text.matchAll(NOSTR_REF_PATTERN);
    for (const match of matches) {
      const ref = match[1]; // e.g. nevent1abc... or naddr1abc...
      if (ref && !resolvedRefs[ref] && !refsInFlight.has(ref)) {
        refs.push(ref);
      }
    }

    if (refs.length === 0) return;

    refs.forEach((ref) => refsInFlight.add(ref));

    const newResolved: Record<string, string> = {};
    await Promise.all(
      refs.map(async (ref) => {
        try {
          if (ref.startsWith('nevent1') || ref.startsWith('note1')) {
            const result = await resolveNote(ref, ndkInstance);
            if (result) {
              newResolved[ref] = result.title;
              return;
            }
          } else if (ref.startsWith('naddr1')) {
            const result = await resolveRecipe(ref, ndkInstance);
            if (result) {
              newResolved[ref] = result.title;
              return;
            }
          }
          // Leave unresolved — display fallback in replaceNostrMentions handles it
        } catch {
          // Leave unresolved — display fallback handles it
        } finally {
          refsInFlight.delete(ref);
        }
      })
    );
    if (Object.keys(newResolved).length > 0) {
      resolvedRefs = { ...resolvedRefs, ...newResolved };
    }
  }

  function replaceNostrMentions(text: string): string {
    if (!text) return text;

    return text
      .replace(NPUB_MENTION_PATTERN, (_match, npub) => {
        const name = resolvedNames[npub];
        return name ? `@${name}` : '@someone';
      })
      .replace(NOSTR_REF_PATTERN, (_match, ref) => {
        const preview = resolvedRefs[ref];
        if (preview) return `"${preview}"`;
        return ref.startsWith('naddr1') ? 'a recipe' : 'a post';
      });
  }

  // cleanMediaUrls consolidated into notificationUtils.stripMediaAndBech32

  function extractFirstImage(content: string): string | undefined {
    if (!content) return undefined;
    const imageUrlPattern =
      /https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|avif)(?:\?[^\s]*)?/i;
    const imageHostPattern =
      /https?:\/\/(?:i\.)?(?:nostr\.build|imgur\.com|primal\.b-cdn\.net|image\.nostr\.build|void\.cat|m\.primal\.net|cdn\.satellite\.earth)[^\s]*/i;
    const match = content.match(imageUrlPattern) || content.match(imageHostPattern);
    return match?.[0];
  }

  function hasVideoUrl(content: string): boolean {
    if (!content) return false;
    return /https?:\/\/[^\s]+\.(?:mp4|webm|mov|ogg)(?:\?[^\s]*)?/i.test(content) ||
      /https?:\/\/v\.nostr\.build\/[^\s]*/i.test(content);
  }

  function buildContextPreview(event: NDKEvent): ContextPreview {
    const kind = event.kind || 1;
    const pubkey = event.pubkey;

    if (kind === 30023) {
      const title =
        event.tags.find((t) => t[0] === 'title')?.[1] || event.tags.find((t) => t[0] === 'd')?.[1];
      const summary = event.tags.find((t) => t[0] === 'summary')?.[1] || '';
      const image = event.tags.find((t) => t[0] === 'image')?.[1] || undefined;
      const extra = normalizeText(summary) || normalizeText(event.content || '');
      const preview = extra.slice(0, 500);
      void resolveNpubMentions(preview);
      void resolveNostrRefs(preview);
      return {
        kind,
        pubkey,
        title: title ? normalizeText(title) : undefined,
        preview,
        image
      };
    }

    const rawContent = event.content || '';
    const image = extractFirstImage(rawContent);
    const video = !image && hasVideoUrl(rawContent);
    const preview = normalizeText(rawContent).slice(0, 500);
    void resolveNpubMentions(preview);
    void resolveNostrRefs(preview);
    return { kind, pubkey, preview: preview || '(No text)', image, hasVideo: video };
  }

  async function runWithConcurrency(
    items: string[],
    limit: number,
    worker: (id: string) => Promise<void>
  ): Promise<void> {
    const queue = [...items];
    const runners: Promise<void>[] = [];

    const runOne = async () => {
      while (queue.length) {
        const id = queue.shift();
        if (!id) return;
        await worker(id);
      }
    };

    for (let i = 0; i < Math.max(1, limit); i++) {
      runners.push(runOne());
    }
    await Promise.all(runners);
  }

  async function prefetchReferencedNotes(list: Notification[]) {
    const ndkInstance = get(ndk);
    if (!ndkInstance) return;

    const ids: string[] = [];
    for (const n of list) {
      const id = getReferencedEventId(n);
      if (!id) continue;
      if (id in contextById) continue;
      if (contextInFlight.has(id)) continue;
      ids.push(id);
      if (ids.length >= MAX_CONTEXT_FETCH) break;
    }

    if (ids.length === 0) return;
    ids.forEach((id) => contextInFlight.add(id));

    await runWithConcurrency(ids, CONTEXT_CONCURRENCY, async (id) => {
      try {
        const ev = await ndkInstance.fetchEvent({ ids: [id] });
        if (ev && isHellthread(ev)) {
          hellthreadEventIds = new Set([...hellthreadEventIds, id]);
          contextById = { ...contextById, [id]: null };
        } else {
          contextById = { ...contextById, [id]: ev ? buildContextPreview(ev) : null };
        }
      } catch {
        contextById = { ...contextById, [id]: null };
      } finally {
        contextInFlight.delete(id);
      }
    });
  }

  // Prefetch referenced notes for context as notifications load/update
  $: if ($userPublickey && filteredNotifications.length > 0) {
    void prefetchReferencedNotes(filteredNotifications);
    filteredNotifications.forEach((n) => {
      if (n.content) void resolveNpubMentions(n.content);
    });
  }

  let lastNavTick = 0;
  $: if ($notificationsNavTick !== lastNavTick) {
    lastNavTick = $notificationsNavTick;
    void refreshAndResetView();
  }

  onMount(() => {
    if ($userPublickey) {
      muteListStore.load();
      lastNavTick = $notificationsNavTick;
      void refreshAndResetView();
      // Snapshot-based: mark only currently-unread items as read after a short delay,
      // so notifications that stream in after mount don't get silently marked read.
      const unreadIds = $visibleNotifications.filter((n) => !n.read).map((n) => n.id);
      if (unreadIds.length > 0) {
        setTimeout(() => {
          for (const id of unreadIds) {
            notifications.markAsRead(id);
          }
        }, 500);
      }
    }
  });

  // Time sections for grouping display items
  type TimeSection = 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'older';

  function getTimeSection(timestamp: number): TimeSection {
    const now = new Date();
    const date = new Date(timestamp * 1000);

    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
    const startOfThisWeek = new Date(
      startOfToday.getTime() - startOfToday.getDay() * 24 * 60 * 60 * 1000
    );
    const startOfLastWeek = new Date(startOfThisWeek.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    if (date >= startOfToday) return 'today';
    if (date >= startOfYesterday) return 'yesterday';
    if (date >= startOfThisWeek) return 'thisWeek';
    if (date >= startOfLastWeek) return 'lastWeek';
    if (date >= startOfThisMonth) return 'thisMonth';
    return 'older';
  }

  function getSectionLabel(section: TimeSection): string {
    switch (section) {
      case 'today': return 'Today';
      case 'yesterday': return 'Yesterday';
      case 'thisWeek': return 'This Week';
      case 'lastWeek': return 'Last Week';
      case 'thisMonth': return 'This Month';
      case 'older': return 'Older';
    }
  }

  function getEffectiveTimestamp(item: NotificationDisplayItem): number {
    return item.kind === 'single' ? item.notification.createdAt : item.latestTimestamp;
  }

  function isItemRead(item: NotificationDisplayItem): boolean {
    return item.kind === 'single' ? item.notification.read : item.read;
  }

  // Group display items by time section
  $: groupedDisplayItems = (() => {
    const groups: {
      section: TimeSection;
      label: string;
      items: NotificationDisplayItem[];
    }[] = [];
    let currentSection: TimeSection | null = null;

    for (const item of displayItems) {
      const section = getTimeSection(getEffectiveTimestamp(item));
      if (section !== currentSection) {
        currentSection = section;
        groups.push({ section, label: getSectionLabel(section), items: [] });
      }
      groups[groups.length - 1].items.push(item);
    }

    return groups;
  })();

  function getDisplayItemKey(item: NotificationDisplayItem): string {
    if (item.kind === 'single') return item.notification.id;
    return item.key;
  }

  async function handleNotificationClick(notification: Notification) {
    notifications.markAsRead(notification.id);

    const eventIdToView =
      notification.eventId ||
      (['mention', 'comment'].includes(notification.type) ? notification.id : null);

    if (!eventIdToView) return;

    if (['reaction', 'zap', 'repost'].includes(notification.type)) {
      try {
        const ndkInstance = get(ndk);
        if (ndkInstance) {
          const event = await ndkInstance.fetchEvent({ ids: [eventIdToView] });
          if (event && event.kind === 30023) {
            const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
            if (dTag) {
              const naddr = nip19.naddrEncode({
                kind: 30023,
                pubkey: event.pubkey,
                identifier: dTag
              });
              goto(`/recipe/${naddr}`);
              return;
            }
          }
        }
      } catch (e) {
        console.debug('[Notifications] Could not fetch event for routing:', e);
      }
    }

    navigateToNote(eventIdToView);
  }

  async function handleGroupedClick(item: NotificationDisplayItem) {
    if (item.kind === 'single') {
      handleNotificationClick(item.notification);
      return;
    }

    // Mark all notifications in the group as read
    for (const n of item.notifications) {
      notifications.markAsRead(n.id);
    }

    const eventId = item.targetEventId;
    if (!eventId) return;

    // Try recipe routing
    try {
      const ndkInstance = get(ndk);
      if (ndkInstance) {
        const event = await ndkInstance.fetchEvent({ ids: [eventId] });
        if (event && event.kind === 30023) {
          const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
          if (dTag) {
            const naddr = nip19.naddrEncode({
              kind: 30023,
              pubkey: event.pubkey,
              identifier: dTag
            });
            goto(`/recipe/${naddr}`);
            return;
          }
        }
      }
    } catch (e) {
      console.debug('[Notifications] Could not fetch event for routing:', e);
    }

    navigateToNote(eventId);
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
      console.warn('[Notifications] Invalid eventId for note view:', raw, e);
    }
  }

  function getContext(eventId: string | undefined): ContextPreview | undefined {
    if (!eventId) return undefined;
    const ctx = contextById[eventId];
    if (ctx === undefined || ctx === null) return ctx as ContextPreview | undefined;
    return ctx;
  }

  function formatPreview(preview: string): string {
    return replaceNostrMentions(stripMediaAndBech32(preview));
  }

  // --- Unified display helpers for notification template ---

  function getNotifType(item: NotificationDisplayItem): Notification['type'] {
    if (item.kind === 'single') return item.notification.type;
    if (item.kind === 'grouped-reactions') return 'reaction';
    return 'zap';
  }

  function getLeadPubkey(item: NotificationDisplayItem): string {
    if (item.kind === 'single') return item.notification.fromPubkey;
    return item.notifications[0].fromPubkey;
  }

  function getAllPubkeys(item: NotificationDisplayItem): string[] {
    if (item.kind === 'single') return [item.notification.fromPubkey];
    return item.notifications.map(n => n.fromPubkey);
  }

  function getContextEventId(item: NotificationDisplayItem): string | undefined {
    if (item.kind === 'single') {
      const n = item.notification;
      if (n.type === 'comment') return n.targetEventId;
      if (n.type === 'mention') return undefined;
      return n.eventId;
    }
    return item.targetEventId;
  }

  function getGroupCount(item: NotificationDisplayItem): number {
    if (item.kind === 'single') return 1;
    return item.notifications.length;
  }

  function getSecondPubkey(item: NotificationDisplayItem): string {
    if (item.kind !== 'single' && item.notifications.length >= 2) {
      return item.notifications[1].fromPubkey;
    }
    return '';
  }

  function getNotifContent(item: NotificationDisplayItem): string | undefined {
    if (item.kind !== 'single') return undefined;
    const n = item.notification;
    // Show content for replies, mentions, and zaps with comments (NIP-57)
    if (n.type === 'comment' || n.type === 'mention' || n.type === 'zap') return n.content;
    return undefined;
  }

  function getZapAmount(item: NotificationDisplayItem): string {
    if (item.kind === 'grouped-zaps') return item.totalAmount.toLocaleString();
    if (item.kind === 'single' && item.notification.type === 'zap') {
      return item.notification.amount?.toLocaleString() || '';
    }
    return '';
  }

  function getEmoji(item: NotificationDisplayItem): string {
    if (item.kind === 'single' && item.notification.type === 'reaction') {
      const emoji = item.notification.emoji;
      if (emoji && emoji !== '+') return ` ${emoji}`;
      return ' ❤️';
    }
    return '';
  }

  function isLargeZap(item: NotificationDisplayItem): boolean {
    return item.kind === 'single' &&
      item.notification.type === 'zap' &&
      (item.notification.amount || 0) >= 100;
  }
</script>

<svelte:head>
  <title>Notifications | Zap Cooking</title>
</svelte:head>

<PullToRefresh bind:this={pullToRefreshEl} on:refresh={handleRefresh}>
  <div class="max-w-2xl mx-auto px-4 py-8">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">Notifications</h1>
    </div>

    {#if !$userPublickey}
      <div
        class="flex flex-col items-center justify-center py-16 px-4 rounded-xl text-center"
        style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
      >
        <span class="text-5xl mb-4" aria-hidden="true">🔔</span>
        <h2 class="text-xl font-semibold mb-2" style="color: var(--color-text-primary);">
          Sign in to see your notifications
        </h2>
        <p class="text-caption text-sm mb-6 max-w-xs">
          When someone reacts, zaps, or replies to you, it will show up here.
        </p>
        <a
          href="/login?redirect=/notifications"
          class="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full font-semibold transition-all"
          style="background: linear-gradient(135deg, #f97316 0%, #fb923c 100%); color: white;"
        >
          Sign in
        </a>
      </div>
    {:else}
      <!-- Tabs -->
      <div class="mb-6">
        <div class="flex overflow-x-auto scrollbar-hide pb-0 border-b border-solid" style="border-color: var(--color-input-border); background: none; border-radius: 0; border-top: none; border-left: none; border-right: none;">
          {#each tabs as tab}
            <button
              on:click={() => (activeTab = tab.id)}
              class="flex-1 py-2 text-sm font-medium transition-colors relative cursor-pointer whitespace-nowrap text-center flex items-center justify-center gap-1.5"
              style="color: {activeTab === tab.id
                ? 'var(--color-text-primary)'
                : 'var(--color-text-secondary)'}"
            >
              <svelte:component this={tab.icon} size={16} />
              {tab.label}
              {#if activeTab === tab.id}
                <span
                  class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
                ></span>
              {/if}
            </button>
          {/each}
        </div>
      </div>

      {#if $visibleNotifications.length === 0}
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
      {#each groupedDisplayItems as group (group.section)}
        <!-- Section header -->
        <div class="mt-5 first:mt-0 mb-2">
          <p
            class="text-xs font-medium uppercase tracking-wide"
            style="color: var(--color-text-secondary);"
          >
            {group.label}
          </p>
        </div>

        <div
          class="rounded-xl overflow-hidden"
          style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
        >
          {#each group.items as item (getDisplayItemKey(item))}
            {@const type = getNotifType(item)}
            {@const leadPubkey = getLeadPubkey(item)}
            {@const isGrouped = item.kind !== 'single'}
            {@const count = getGroupCount(item)}
            {@const isRead = isItemRead(item)}
            {@const timestamp = getEffectiveTimestamp(item)}
            {@const contextId = getContextEventId(item)}
            {@const ctx = contextId ? getContext(contextId) : null}
            {@const content = getNotifContent(item)}

            <button
              on:click={() => item.kind === 'single' ? handleNotificationClick(item.notification) : handleGroupedClick(item)}
              class="notif-row"
              class:notif-read={isRead}
              class:notif-zap-accent={isLargeZap(item)}
            >
              <!-- Left gutter: icon + avatar -->
              <div class="notif-gutter">
                <div class="notif-icon">
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
                {#if isGrouped}
                  <AvatarStack pubkeys={getAllPubkeys(item).slice(0, 3)} size={24} />
                {:else}
                  <Avatar pubkey={leadPubkey} size={32} />
                {/if}
              </div>

              <!-- Content column -->
              <div class="notif-body">
                <!-- Action line + timestamp -->
                <div class="notif-header">
                  <p class="notif-action"><strong><CustomName pubkey={leadPubkey} /></strong>{#if isGrouped && count === 2}{' '}and <strong><CustomName pubkey={getSecondPubkey(item)} /></strong>{:else if isGrouped && count > 2}{' '}and {count - 1} others{/if}{#if type === 'reaction'}{' '}reacted{getEmoji(item)} to your post{:else if type === 'zap'}{' '}zapped{#if !isGrouped} you{/if} <span class="zap-sats">{getZapAmount(item)} sats</span>{:else if type === 'comment'}{' '}replied to {#if ctx === undefined}…{:else if ctx && ctx.pubkey}<strong><CustomName pubkey={ctx.pubkey} /></strong>{:else}your post{/if}{:else if type === 'repost'}{' '}reposted your note{:else if type === 'mention'}{' '}mentioned you{:else}{' '}interacted with you{/if}</p>
                  <div class="notif-time-area">
                    <span class="notif-time">{formatCompactTime(timestamp)}</span>
                    {#if !isRead}
                      <span class="unread-dot"></span>
                    {/if}
                  </div>
                </div>

                <!-- Reply/mention content -->
                {#if content}
                  <p class="notif-content"><NotifText text={content} /></p>
                {/if}

                <!-- Context preview card (skip for replies — action line shows "replied to @Author") -->
                {#if type !== 'comment' && contextId && ctx}
                  <div class="ctx-card">
                    <div class="ctx-body">
                      {#if ctx.title}
                        <p class="ctx-title">{ctx.title}</p>
                      {/if}
                      <p class="ctx-text">{formatPreview(ctx.preview)}</p>
                    </div>
                    {#if ctx.image}
                      <img src={ctx.image} alt="" class="ctx-thumb" loading="lazy" />
                    {:else if ctx.hasVideo}
                      <div class="ctx-thumb ctx-video-placeholder"><VideoIcon size={20} /></div>
                    {/if}
                  </div>
                {:else if type !== 'comment' && contextId && ctx === undefined}
                  <div class="ctx-card">
                    <div class="ctx-loading"></div>
                  </div>
                {/if}
              </div>
            </button>
          {/each}
        </div>
      {/each}

      <!-- Load more button -->
      <div class="mt-6 text-center">
        {#if noMoreNotifications}
          <p class="text-sm" style="color: var(--color-text-secondary);">No more notifications</p>
        {:else}
          <button
            on:click={loadMoreNotifications}
            disabled={loadingMore}
            class="px-6 py-2 rounded-lg font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
          >
            {#if loadingMore}
              <span class="inline-flex items-center gap-2">
                <span
                  class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
                ></span>
                Loading...
              </span>
            {:else}
              Load more
            {/if}
          </button>
        {/if}
      </div>
    {/if}
    {/if}
  </div>
</PullToRefresh>

<style>
  .scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
  .scrollbar-hide::-webkit-scrollbar {
    display: none;
  }

  /* --- Notification row: two-column layout --- */
  .notif-row {
    width: 100%;
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    cursor: pointer;
    text-align: left;
    transition: background-color 150ms;
    border-bottom: 1px solid var(--color-input-border);
  }
  .notif-row:last-child {
    border-bottom: none;
  }
  .notif-row:hover {
    background-color: var(--color-input-bg);
  }
  .notif-read {
    opacity: 0.55;
  }
  .notif-zap-accent {
    border-left: 2.5px solid #f59e0b;
  }

  /* --- Left gutter: icon + avatar side-by-side --- */
  .notif-gutter {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex-shrink: 0;
    width: 72px;
  }
  .notif-icon {
    flex-shrink: 0;
    width: 16px;
  }

  /* --- Body --- */
  .notif-body {
    flex: 1;
    min-width: 0;
    width: 100%;
  }

  /* --- Header: action text + time --- */
  .notif-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .notif-action {
    flex: 1;
    min-width: 0;
    font-size: 0.875rem;
    line-height: 1.4;
    color: var(--color-text-primary);
  }
  .notif-action strong {
    font-weight: 700;
  }
  .zap-sats {
    font-weight: 700;
    color: #f59e0b;
  }

  /* --- Timestamp + unread dot --- */
  .notif-time-area {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex-shrink: 0;
  }
  .notif-time {
    font-size: 0.75rem;
    white-space: nowrap;
    color: var(--color-text-secondary);
  }
  .unread-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 9999px;
    background-color: #f97316;
    flex-shrink: 0;
  }

  /* --- Reply/mention content --- */
  .notif-content {
    margin-top: 0.375rem;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--color-text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* --- Context preview card --- */
  .ctx-card {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    margin-top: 0.5rem;
    padding: 0.5rem 0.625rem;
    border-left: 2.5px solid;
    border-image: linear-gradient(to bottom, #f97316, #f59e0b) 1;
    border-radius: 0 0.375rem 0.375rem 0;
    background-color: var(--color-input-bg);
  }
  .ctx-body {
    flex: 1;
    min-width: 0;
  }
  .ctx-title {
    font-size: 0.75rem;
    font-weight: 500;
    margin-bottom: 0.125rem;
    color: var(--color-text-primary);
  }
  .ctx-text {
    font-size: 0.8125rem;
    line-height: 1.4;
    font-style: italic;
    color: var(--color-text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .ctx-thumb {
    width: 40px;
    height: 40px;
    border-radius: 0.375rem;
    object-fit: cover;
    flex-shrink: 0;
  }
  .ctx-video-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-accent-gray);
    color: var(--color-text-secondary);
  }
  .ctx-loading {
    height: 0.75rem;
    border-radius: 0.25rem;
    width: 75%;
    background-color: var(--color-input-border);
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
</style>
