<script lang="ts">
  import {
    notifications,
    unreadCount,
    subscribeToNotifications,
    fetchOlderNotifications,
    type Notification
  } from '$lib/notificationStore';
  import { buildDisplayItems, type NotificationDisplayItem } from '$lib/groupedNotifications';
  import { formatCompactTime } from '$lib/utils';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { nip19 } from 'nostr-tools';
  import Avatar from '../../components/Avatar.svelte';
  import AvatarStack from '../../components/notifications/AvatarStack.svelte';
  import CustomName from '../../components/CustomName.svelte';
  import { userPublickey, ndk } from '$lib/nostr';
  import { hellthreadThreshold } from '$lib/hellthreadFilterSettings';
  import { onMount } from 'svelte';
  import PullToRefresh from '../../components/PullToRefresh.svelte';
  import { get } from 'svelte/store';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { notificationsNavTick } from '$lib/notificationsNav';
  import { mutedPubkeys, muteListStore } from '$lib/muteListStore';
  import { resolveProfileByPubkey, getDisplayName } from '$lib/profileResolver';
  import { resolveNote, resolveRecipe } from '$lib/utils/nostrRefs';
  import HeartIcon from 'phosphor-svelte/lib/Heart';
  import ChatCircleIcon from 'phosphor-svelte/lib/ChatCircle';
  import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwise';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import AtIcon from 'phosphor-svelte/lib/At';

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
  const NPUB_MENTION_PATTERN = /nostr:(npub1[a-z0-9]+)/gi;
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

  const tabs: { id: TabType; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'zaps', label: 'Zaps' },
    { id: 'replies', label: 'Replies' },
    { id: 'mentions', label: 'Mentions' }
  ];

  // Local muted users set - populated from localStorage immediately
  let localMutedUsers: Set<string> = new Set();

  if (browser) {
    try {
      const stored = localStorage.getItem('mutedUsers');
      if (stored) {
        const parsed = JSON.parse(stored);
        localMutedUsers = new Set(parsed);
      }
    } catch (e) {
      console.error('[Notifications] Error parsing localStorage:', e);
    }
  }

  // Combined muted users from store + localStorage
  $: combinedMutedPubkeys = new Set([...$mutedPubkeys, ...localMutedUsers]);

  $: filteredNotifications = $notifications.filter((n) => {
    const isMuted = n.fromPubkey && combinedMutedPubkeys.has(n.fromPubkey);
    if (isMuted) return false;

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
          if (decoded.type === 'npub') {
            const pubkey = decoded.data as string;
            const profile = await resolveProfileByPubkey(pubkey, ndkInstance);
            const name = getDisplayName(profile);
            resolvedNames = { ...resolvedNames, [npub]: name };
          }
        } catch (e) {
          resolvedNames = { ...resolvedNames, [npub]: `${npub.slice(0, 12)}...` };
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

    await Promise.all(
      refs.map(async (ref) => {
        try {
          if (ref.startsWith('nevent1') || ref.startsWith('note1')) {
            const result = await resolveNote(ref, ndkInstance);
            if (result) {
              resolvedRefs = { ...resolvedRefs, [ref]: result.title };
              return;
            }
          } else if (ref.startsWith('naddr1')) {
            const result = await resolveRecipe(ref, ndkInstance);
            if (result) {
              resolvedRefs = { ...resolvedRefs, [ref]: result.title };
              return;
            }
          }
          // Fallback if resolution failed
          resolvedRefs = { ...resolvedRefs, [ref]: `${ref.slice(0, 12)}...` };
        } catch {
          resolvedRefs = { ...resolvedRefs, [ref]: `${ref.slice(0, 12)}...` };
        } finally {
          refsInFlight.delete(ref);
        }
      })
    );
  }

  function replaceNostrMentions(text: string): string {
    if (!text) return text;

    return text
      .replace(NPUB_MENTION_PATTERN, (_match, npub) => {
        const name = resolvedNames[npub];
        if (name) return `@${name}`;
        return `@${npub.slice(0, 12)}...`;
      })
      .replace(NOSTR_REF_PATTERN, (_match, ref) => {
        const preview = resolvedRefs[ref];
        if (preview) return `"${preview}"`;
        return `${ref.slice(0, 12)}...`;
      });
  }

  // Keep backward-compatible alias used in template
  function replaceNpubMentions(text: string): string {
    return replaceNostrMentions(text);
  }

  function cleanImageUrls(text: string): string {
    if (!text) return text;
    const imageUrlPattern =
      /https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|svg|bmp|avif)(?:\?[^\s]*)?/gi;
    const imageHostPattern =
      /https?:\/\/(?:i\.)?(?:nostr\.build|imgur\.com|primal\.b-cdn\.net|image\.nostr\.build|void\.cat|m\.primal\.net|cdn\.satellite\.earth)[^\s]*/gi;

    return text
      .replace(imageUrlPattern, '')
      .replace(imageHostPattern, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function isHellthread(event: NDKEvent): boolean {
    const threshold = get(hellthreadThreshold);
    if (threshold === 0) return false;

    if (!event.tags || !Array.isArray(event.tags)) return false;

    const mentionCount = event.tags.filter(
      (tag: string[]) => Array.isArray(tag) && tag[0] === 'p'
    ).length;
    return mentionCount >= threshold;
  }

  function extractFirstImage(content: string): string | undefined {
    if (!content) return undefined;
    const imageUrlPattern =
      /https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|avif)(?:\?[^\s]*)?/i;
    const imageHostPattern =
      /https?:\/\/(?:i\.)?(?:nostr\.build|imgur\.com|primal\.b-cdn\.net|image\.nostr\.build|void\.cat|m\.primal\.net|cdn\.satellite\.earth)[^\s]*/i;
    const match = content.match(imageUrlPattern) || content.match(imageHostPattern);
    return match?.[0];
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
    const preview = normalizeText(rawContent).slice(0, 500);
    void resolveNpubMentions(preview);
    void resolveNostrRefs(preview);
    return { kind, pubkey, preview: preview || '(No text)', image };
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
      if ($unreadCount > 0) {
        setTimeout(() => {
          notifications.markAllAsRead();
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
    return replaceNpubMentions(cleanImageUrls(preview));
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
      <div class="mb-6 border-b" style="border-color: var(--color-input-border)">
        <div class="flex overflow-x-auto scrollbar-hide">
          {#each tabs as tab}
            <button
              on:click={() => (activeTab = tab.id)}
              class="flex-1 py-2 text-sm font-medium transition-colors relative cursor-pointer whitespace-nowrap text-center"
              style="color: {activeTab === tab.id
                ? 'var(--color-text-primary)'
                : 'var(--color-text-secondary)'}"
            >
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
          class="rounded-xl divide-y"
          style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
        >
          {#each group.items as item (getDisplayItemKey(item))}
            <!-- GROUPED REACTIONS -->
            {#if item.kind === 'grouped-reactions'}
              <button
                on:click={() => handleGroupedClick(item)}
                class="w-full flex items-start gap-3 px-4 py-3 transition-colors cursor-pointer text-left hover:opacity-80"
                class:opacity-60={item.read}
                style="border-color: var(--color-input-border);"
              >
                <div class="flex-shrink-0 w-5 mt-1">
                  <HeartIcon size={20} weight="fill" color="#ef4444" />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <AvatarStack pubkeys={item.notifications.map(n => n.fromPubkey)} size={28} />
                    <p class="text-sm flex-1 min-w-0" style="color: var(--color-text-primary);">
                      <span class="font-semibold"><CustomName pubkey={item.notifications[0].fromPubkey} /></span>{#if item.notifications.length === 2}{' '}and <span class="font-semibold"><CustomName pubkey={item.notifications[1].fromPubkey} /></span>{:else if item.notifications.length > 2}{' '}and {item.notifications.length - 1} others{/if}
                      {' '}reacted to your post
                    </p>
                    <span class="text-xs flex-shrink-0" style="color: var(--color-text-secondary);">{formatCompactTime(item.latestTimestamp)}</span>
                    {#if !item.read}
                      <span class="w-2 h-2 bg-orange-500 rounded-full flex-shrink-0"></span>
                    {/if}
                  </div>
                  {#if getContext(item.targetEventId)}
                    <div class="quote-preview mt-2">
                      <div class="flex-1 min-w-0">
                        {#if getContext(item.targetEventId)?.title}
                          <p class="text-xs font-medium mb-0.5" style="color: var(--color-text-primary);">{getContext(item.targetEventId)?.title}</p>
                        {/if}
                        <p class="quote-text">{formatPreview(getContext(item.targetEventId)?.preview || '')}</p>
                      </div>
                      {#if getContext(item.targetEventId)?.image}
                        <img src={getContext(item.targetEventId)?.image} alt="" class="quote-thumb" loading="lazy" />
                      {/if}
                    </div>
                  {:else if getContext(item.targetEventId) === undefined && item.targetEventId}
                    <div class="quote-preview mt-2"><div class="h-3 bg-accent-gray rounded w-3/4 animate-pulse"></div></div>
                  {/if}
                </div>
              </button>

            <!-- GROUPED SMALL ZAPS -->
            {:else if item.kind === 'grouped-zaps'}
              <button
                on:click={() => handleGroupedClick(item)}
                class="w-full flex items-start gap-3 px-4 py-3 transition-colors cursor-pointer text-left hover:opacity-80"
                class:opacity-60={item.read}
                style="border-color: var(--color-input-border);"
              >
                <div class="flex-shrink-0 w-5 mt-1">
                  <LightningIcon size={20} weight="fill" color="#f59e0b" />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <AvatarStack pubkeys={item.notifications.map(n => n.fromPubkey)} size={28} />
                    <p class="text-sm flex-1 min-w-0" style="color: var(--color-text-primary);">
                      <span class="font-semibold"><CustomName pubkey={item.notifications[0].fromPubkey} /></span>{#if item.notifications.length === 2}{' '}and <span class="font-semibold"><CustomName pubkey={item.notifications[1].fromPubkey} /></span>{:else if item.notifications.length > 2}{' '}and {item.notifications.length - 1} others{/if}
                      {' '}zapped <span class="font-semibold text-amber-500">{item.totalAmount.toLocaleString()} sats</span>
                    </p>
                    <span class="text-xs flex-shrink-0" style="color: var(--color-text-secondary);">{formatCompactTime(item.latestTimestamp)}</span>
                    {#if !item.read}
                      <span class="w-2 h-2 bg-orange-500 rounded-full flex-shrink-0"></span>
                    {/if}
                  </div>
                  {#if getContext(item.targetEventId)}
                    <div class="quote-preview mt-2">
                      <div class="flex-1 min-w-0">
                        {#if getContext(item.targetEventId)?.title}
                          <p class="text-xs font-medium mb-0.5" style="color: var(--color-text-primary);">{getContext(item.targetEventId)?.title}</p>
                        {/if}
                        <p class="quote-text">{formatPreview(getContext(item.targetEventId)?.preview || '')}</p>
                      </div>
                      {#if getContext(item.targetEventId)?.image}
                        <img src={getContext(item.targetEventId)?.image} alt="" class="quote-thumb" loading="lazy" />
                      {/if}
                    </div>
                  {:else if getContext(item.targetEventId) === undefined && item.targetEventId}
                    <div class="quote-preview mt-2"><div class="h-3 bg-accent-gray rounded w-3/4 animate-pulse"></div></div>
                  {/if}
                </div>
              </button>

            <!-- SINGLE NOTIFICATIONS -->
            {:else}
              {@const n = item.notification}

              <!-- REACTION (single, ungrouped) -->
              {#if n.type === 'reaction'}
                <button
                  on:click={() => handleNotificationClick(n)}
                  class="w-full flex items-start gap-3 px-4 py-3 transition-colors cursor-pointer text-left hover:opacity-80"
                  class:opacity-60={n.read}
                  style="border-color: var(--color-input-border);"
                >
                  <div class="flex-shrink-0 w-5 mt-1">
                    <HeartIcon size={20} weight="fill" color="#ef4444" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <div class="flex-shrink-0">
                        <Avatar pubkey={n.fromPubkey} size={28} />
                      </div>
                      <p class="text-sm flex-1 min-w-0" style="color: var(--color-text-primary);">
                        <span class="font-semibold"><CustomName pubkey={n.fromPubkey} /></span>
                        {' '}reacted {n.emoji || '❤️'} to your post
                      </p>
                      <span class="text-xs flex-shrink-0" style="color: var(--color-text-secondary);">{formatCompactTime(n.createdAt)}</span>
                      {#if !n.read}
                        <span class="w-2 h-2 bg-orange-500 rounded-full flex-shrink-0"></span>
                      {/if}
                    </div>
                    {#if getContext(n.eventId)}
                      <div class="quote-preview mt-2">
                        <div class="flex-1 min-w-0">
                          {#if getContext(n.eventId)?.title}
                            <p class="text-xs font-medium mb-0.5" style="color: var(--color-text-primary);">{getContext(n.eventId)?.title}</p>
                          {/if}
                          <p class="quote-text">{formatPreview(getContext(n.eventId)?.preview || '')}</p>
                        </div>
                        {#if getContext(n.eventId)?.image}
                          <img src={getContext(n.eventId)?.image} alt="" class="quote-thumb" loading="lazy" />
                        {/if}
                      </div>
                    {:else if getContext(n.eventId) === undefined && n.eventId}
                      <div class="quote-preview mt-2"><div class="h-3 bg-accent-gray rounded w-3/4 animate-pulse"></div></div>
                    {/if}
                  </div>
                </button>

              <!-- REPLY -->
              {:else if n.type === 'comment'}
                <button
                  on:click={() => handleNotificationClick(n)}
                  class="w-full flex items-start gap-3 px-4 py-3.5 transition-colors cursor-pointer text-left hover:opacity-80"
                  class:opacity-60={n.read}
                  style="border-color: var(--color-input-border);"
                >
                  <div class="flex-shrink-0 w-5 mt-1">
                    <ChatCircleIcon size={20} weight="fill" color="#3b82f6" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <div class="flex-shrink-0">
                        <Avatar pubkey={n.fromPubkey} size={32} />
                      </div>
                      <p class="text-sm flex-1 min-w-0" style="color: var(--color-text-primary);">
                        <span class="font-semibold"><CustomName pubkey={n.fromPubkey} /></span>
                        {' '}replied to your post
                      </p>
                      <span class="text-xs flex-shrink-0" style="color: var(--color-text-secondary);">{formatCompactTime(n.createdAt)}</span>
                      {#if !n.read}
                        <span class="w-2 h-2 bg-orange-500 rounded-full flex-shrink-0"></span>
                      {/if}
                    </div>
                    {#if n.content}
                      <p class="mt-1.5 text-sm line-clamp-3" style="color: var(--color-text-primary);">
                        {replaceNpubMentions(cleanImageUrls(n.content))}
                      </p>
                    {/if}
                    {#if getContext(n.targetEventId)}
                      <div class="quote-preview mt-2">
                        <div class="flex-1 min-w-0">
                          <p class="quote-text">{formatPreview(getContext(n.targetEventId)?.preview || '')}</p>
                        </div>
                        {#if getContext(n.targetEventId)?.image}
                          <img src={getContext(n.targetEventId)?.image} alt="" class="quote-thumb" loading="lazy" />
                        {/if}
                      </div>
                    {/if}
                  </div>
                </button>

              <!-- REPOST -->
              {:else if n.type === 'repost'}
                <button
                  on:click={() => handleNotificationClick(n)}
                  class="w-full flex items-start gap-3 px-4 py-3 transition-colors cursor-pointer text-left hover:opacity-80"
                  class:opacity-60={n.read}
                  style="border-color: var(--color-input-border);"
                >
                  <div class="flex-shrink-0 w-5 mt-1">
                    <ArrowsClockwiseIcon size={20} weight="bold" color="#22c55e" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <div class="flex-shrink-0">
                        <Avatar pubkey={n.fromPubkey} size={32} />
                      </div>
                      <p class="text-sm flex-1 min-w-0" style="color: var(--color-text-primary);">
                        <span class="font-semibold"><CustomName pubkey={n.fromPubkey} /></span>
                        {' '}reposted your note
                      </p>
                      <span class="text-xs flex-shrink-0" style="color: var(--color-text-secondary);">{formatCompactTime(n.createdAt)}</span>
                      {#if !n.read}
                        <span class="w-2 h-2 bg-orange-500 rounded-full flex-shrink-0"></span>
                      {/if}
                    </div>
                    {#if getContext(n.eventId)}
                      <div class="quote-preview mt-2">
                        <div class="flex-1 min-w-0">
                          {#if getContext(n.eventId)?.title}
                            <p class="text-xs font-medium mb-0.5" style="color: var(--color-text-primary);">{getContext(n.eventId)?.title}</p>
                          {/if}
                          <p class="quote-text">{formatPreview(getContext(n.eventId)?.preview || '')}</p>
                        </div>
                        {#if getContext(n.eventId)?.image}
                          <img src={getContext(n.eventId)?.image} alt="" class="quote-thumb" loading="lazy" />
                        {/if}
                      </div>
                    {:else if getContext(n.eventId) === undefined && n.eventId}
                      <div class="quote-preview mt-2"><div class="h-3 bg-accent-gray rounded w-3/4 animate-pulse"></div></div>
                    {/if}
                  </div>
                </button>

              <!-- ZAP (large, single) -->
              {:else if n.type === 'zap'}
                <button
                  on:click={() => handleNotificationClick(n)}
                  class="w-full flex items-start gap-3 px-4 py-3.5 transition-colors cursor-pointer text-left hover:opacity-80 border-l-2 border-l-amber-500"
                  class:opacity-60={n.read}
                  style="border-color: var(--color-input-border);"
                >
                  <div class="flex-shrink-0 w-5 mt-1">
                    <LightningIcon size={20} weight="fill" color="#f59e0b" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <div class="flex-shrink-0">
                        <Avatar pubkey={n.fromPubkey} size={32} />
                      </div>
                      <p class="text-sm flex-1 min-w-0" style="color: var(--color-text-primary);">
                        <span class="font-semibold"><CustomName pubkey={n.fromPubkey} /></span>
                        {' '}zapped you <span class="font-bold text-amber-500">{n.amount?.toLocaleString() || ''} sats</span>
                      </p>
                      <span class="text-xs flex-shrink-0" style="color: var(--color-text-secondary);">{formatCompactTime(n.createdAt)}</span>
                      {#if !n.read}
                        <span class="w-2 h-2 bg-orange-500 rounded-full flex-shrink-0"></span>
                      {/if}
                    </div>
                    {#if getContext(n.eventId)}
                      <div class="quote-preview mt-2">
                        <div class="flex-1 min-w-0">
                          {#if getContext(n.eventId)?.title}
                            <p class="text-xs font-medium mb-0.5" style="color: var(--color-text-primary);">{getContext(n.eventId)?.title}</p>
                          {/if}
                          <p class="quote-text">{formatPreview(getContext(n.eventId)?.preview || '')}</p>
                        </div>
                        {#if getContext(n.eventId)?.image}
                          <img src={getContext(n.eventId)?.image} alt="" class="quote-thumb" loading="lazy" />
                        {/if}
                      </div>
                    {:else if getContext(n.eventId) === undefined && n.eventId}
                      <div class="quote-preview mt-2"><div class="h-3 bg-accent-gray rounded w-3/4 animate-pulse"></div></div>
                    {/if}
                  </div>
                </button>

              <!-- MENTION -->
              {:else if n.type === 'mention'}
                <button
                  on:click={() => handleNotificationClick(n)}
                  class="w-full flex items-start gap-3 px-4 py-3 transition-colors cursor-pointer text-left hover:opacity-80"
                  class:opacity-60={n.read}
                  style="border-color: var(--color-input-border);"
                >
                  <div class="flex-shrink-0 w-5 mt-1">
                    <AtIcon size={20} weight="bold" color="#a855f7" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <div class="flex-shrink-0">
                        <Avatar pubkey={n.fromPubkey} size={32} />
                      </div>
                      <p class="text-sm flex-1 min-w-0" style="color: var(--color-text-primary);">
                        <span class="font-semibold"><CustomName pubkey={n.fromPubkey} /></span>
                        {' '}mentioned you
                      </p>
                      <span class="text-xs flex-shrink-0" style="color: var(--color-text-secondary);">{formatCompactTime(n.createdAt)}</span>
                      {#if !n.read}
                        <span class="w-2 h-2 bg-orange-500 rounded-full flex-shrink-0"></span>
                      {/if}
                    </div>
                    {#if n.content}
                      <p class="mt-1.5 text-sm line-clamp-2" style="color: var(--color-text-secondary);">
                        {replaceNpubMentions(cleanImageUrls(n.content))}
                      </p>
                    {/if}
                  </div>
                </button>

              <!-- FALLBACK -->
              {:else}
                <button
                  on:click={() => handleNotificationClick(n)}
                  class="w-full flex items-start gap-3 px-4 py-3 transition-colors cursor-pointer text-left hover:opacity-80"
                  class:opacity-60={n.read}
                  style="border-color: var(--color-input-border);"
                >
                  <div class="flex-shrink-0 w-5 mt-1"></div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <div class="flex-shrink-0">
                        <Avatar pubkey={n.fromPubkey} size={32} />
                      </div>
                      <p class="text-sm flex-1 min-w-0" style="color: var(--color-text-primary);">
                        <span class="font-semibold"><CustomName pubkey={n.fromPubkey} /></span>
                        {' '}interacted with you
                      </p>
                      <span class="text-xs flex-shrink-0" style="color: var(--color-text-secondary);">{formatCompactTime(n.createdAt)}</span>
                      {#if !n.read}
                        <span class="w-2 h-2 bg-orange-500 rounded-full flex-shrink-0"></span>
                      {/if}
                    </div>
                  </div>
                </button>
              {/if}
            {/if}
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

  .quote-preview {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.5rem 0.625rem;
    border-left: 2.5px solid;
    border-image: linear-gradient(to bottom, #f97316, #f59e0b) 1;
    border-radius: 0 0.375rem 0.375rem 0;
    background-color: var(--color-input-bg);
  }

  .quote-text {
    font-size: 0.8125rem;
    line-height: 1.4;
    font-style: italic;
    color: var(--color-text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .quote-thumb {
    width: 40px;
    height: 40px;
    border-radius: 0.375rem;
    object-fit: cover;
    flex-shrink: 0;
  }
</style>
