<script lang="ts">
  import {
    notifications,
    unreadCount,
    subscribeToNotifications,
    fetchOlderNotifications,
    type Notification
  } from '$lib/notificationStore';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { formatDistanceToNow } from 'date-fns';
  import { nip19, nip21 } from 'nostr-tools';
  import CustomAvatar from '../../components/CustomAvatar.svelte';
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

  // Pattern to match nostr:npub mentions
  const NPUB_MENTION_PATTERN = /nostr:(npub1[a-z0-9]+)/gi;

  function scrollAppToTop() {
    if (!browser) return;
    const el = document.getElementById('app-scroll');
    if (el) el.scrollTop = 0;
    else window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }

  async function forceRefreshNotifications() {
    // Re-subscribe to notifications with force refresh to fetch older data
    if ($userPublickey) {
      const ndkInstance = get(ndk);
      if (ndkInstance) {
        subscribeToNotifications(ndkInstance, $userPublickey, true); // Force full refresh
      }
    }
    // Wait a bit for notifications to come in
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
      // Reset load more state on refresh
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

    // Determine the timestamp to fetch before
    let fetchBefore: number;

    if (oldestFetchedTimestamp !== null) {
      // Continue from where we left off
      fetchBefore = oldestFetchedTimestamp;
    } else {
      // First load more - find the oldest notification timestamp
      const oldestNotification = $notifications.reduce(
        (oldest, n) => (n.createdAt < oldest.createdAt ? n : oldest),
        $notifications[0]
      );

      if (!oldestNotification) return;
      fetchBefore = oldestNotification.createdAt;
    }

    loadingMore = true;
    try {
      // The fetch function looks back 7 days from fetchBefore
      const newCount = await fetchOlderNotifications(ndkInstance, $userPublickey, fetchBefore);

      // Update the oldest fetched timestamp to continue pagination
      // Next fetch should start from (fetchBefore - 7 days)
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

  // Load muted users from localStorage immediately
  if (browser) {
    try {
      const stored = localStorage.getItem('mutedUsers');
      console.log('[Notifications] Raw localStorage mutedUsers:', stored);
      if (stored) {
        const parsed = JSON.parse(stored);
        console.log('[Notifications] Parsed localStorage mutes:', parsed);
        localMutedUsers = new Set(parsed);
        console.log('[Notifications] localMutedUsers Set size:', localMutedUsers.size);
      }
    } catch (e) {
      console.error('[Notifications] Error parsing localStorage:', e);
    }
  }

  // Debug: log store values
  $: console.log(
    '[Notifications] $mutedPubkeys size:',
    $mutedPubkeys.size,
    'values:',
    Array.from($mutedPubkeys)
  );

  // Combined muted users from store + localStorage
  $: combinedMutedPubkeys = new Set([...$mutedPubkeys, ...localMutedUsers]);
  $: console.log('[Notifications] combinedMutedPubkeys size:', combinedMutedPubkeys.size);

  $: filteredNotifications = $notifications.filter((n) => {
    // Filter out notifications from muted users
    const isMuted = n.fromPubkey && combinedMutedPubkeys.has(n.fromPubkey);
    if (isMuted) {
      console.log('[Notifications] FILTERING OUT muted user:', n.fromPubkey);
      return false;
    }

    // Filter out notifications referencing hellthread events
    const refId = getReferencedEventId(n);
    if (refId && hellthreadEventIds.has(refId)) {
      return false;
    }

    // Filter by tab
    if (activeTab === 'all') return true;
    if (activeTab === 'zaps') return n.type === 'zap';
    if (activeTab === 'replies') return n.type === 'comment';
    if (activeTab === 'mentions') return n.type === 'mention';
    return true;
  });

  function getReferencedEventId(notification: Notification): string | null {
    // Reactions/zaps/reposts: eventId points to the post/recipe being reacted to
    if (
      notification.type === 'reaction' ||
      notification.type === 'zap' ||
      notification.type === 'repost'
    ) {
      return notification.eventId || null;
    }
    // Replies: show the parent note being replied to (if known)
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

  /**
   * Extract all npub mentions from text and resolve their profiles
   */
  async function resolveNpubMentions(text: string): Promise<void> {
    if (!text) return;

    const ndkInstance = get(ndk);
    if (!ndkInstance) return;

    const matches = text.matchAll(NPUB_MENTION_PATTERN);
    const npubs: string[] = [];

    for (const match of matches) {
      const npub = match[1]; // e.g., npub1xxdd8...
      if (npub && !resolvedNames[npub] && !namesInFlight.has(npub)) {
        npubs.push(npub);
      }
    }

    if (npubs.length === 0) return;

    // Mark as in-flight to prevent duplicate fetches
    npubs.forEach((npub) => namesInFlight.add(npub));

    // Resolve profiles in parallel
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
          // If decode fails, use truncated npub as fallback
          resolvedNames = { ...resolvedNames, [npub]: `${npub.slice(0, 12)}...` };
        } finally {
          namesInFlight.delete(npub);
        }
      })
    );
  }

  /**
   * Replace nostr:npub mentions with resolved display names
   */
  function replaceNpubMentions(text: string): string {
    if (!text) return text;

    return text.replace(NPUB_MENTION_PATTERN, (match, npub) => {
      const name = resolvedNames[npub];
      if (name) {
        return `@${name}`;
      }
      // Not yet resolved, show truncated npub
      return `@${npub.slice(0, 12)}...`;
    });
  }

  /**
   * Replace image URLs with [image] placeholder for cleaner display
   */
  function cleanImageUrls(text: string): string {
    if (!text) return text;
    // Match common image URLs (http/https URLs ending with image extensions or from known image hosts)
    const imageUrlPattern =
      /https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|svg|bmp|avif)(?:\?[^\s]*)?/gi;
    const imageHostPattern =
      /https?:\/\/(?:i\.)?(?:nostr\.build|imgur\.com|primal\.b-cdn\.net|image\.nostr\.build|void\.cat|m\.primal\.net|cdn\.satellite\.earth)[^\s]*/gi;

    return text
      .replace(imageUrlPattern, '[image]')
      .replace(imageHostPattern, '[image]')
      .replace(/\[image\](\s*\[image\])+/g, '[image]') // Collapse multiple consecutive [image] tags
      .trim();
  }

  /**
   * Check if an event is a hellthread based on number of 'p' tags
   */
  function isHellthread(event: NDKEvent): boolean {
    const threshold = get(hellthreadThreshold);
    if (threshold === 0) return false; // Disabled

    if (!event.tags || !Array.isArray(event.tags)) return false;

    const mentionCount = event.tags.filter(
      (tag: string[]) => Array.isArray(tag) && tag[0] === 'p'
    ).length;
    return mentionCount >= threshold;
  }

  function buildContextPreview(event: NDKEvent): ContextPreview {
    const kind = event.kind || 1;
    const pubkey = event.pubkey;

    if (kind === 30023) {
      const title =
        event.tags.find((t) => t[0] === 'title')?.[1] || event.tags.find((t) => t[0] === 'd')?.[1];
      const summary = event.tags.find((t) => t[0] === 'summary')?.[1] || '';
      const base = title ? `Recipe: ${normalizeText(title)}` : 'Recipe';
      const extra = normalizeText(summary) || normalizeText(event.content || '');
      const preview = extra ? `${base} — ${extra}` : base;
      const previewText = preview.slice(0, 220);
      // Trigger async resolution of any npub mentions
      void resolveNpubMentions(previewText);
      return {
        kind,
        pubkey,
        title: title ? normalizeText(title) : undefined,
        preview: previewText
      };
    }

    const preview = normalizeText(event.content || '').slice(0, 220);
    // Trigger async resolution of any npub mentions
    void resolveNpubMentions(preview);
    return { kind, pubkey, preview: preview || '(No text)' };
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
          // Mark as hellthread so we can filter out notifications referencing it
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
    // Also resolve npub mentions in notification content
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
    // When signed in: load mute list, refresh, mark read. When signed out: show empty state (no redirect).
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

  function getIcon(type: string): string {
    switch (type) {
      case 'reaction':
        return '❤️';
      case 'zap':
        return '⚡';
      case 'comment':
        return '💬';
      case 'mention':
        return '📣';
      case 'repost':
        return '🔁';
      default:
        return '🔔';
    }
  }

  function getMessage(notification: any): string {
    switch (notification.type) {
      case 'reaction':
        return `reacted ${notification.emoji || '❤️'} to your post`;
      case 'zap':
        return `zapped you ${notification.amount?.toLocaleString() || ''} sats`;
      case 'comment':
        return 'replied to your post';
      case 'mention':
        return 'mentioned you in a note';
      case 'repost':
        return 'reposted your note';
      default:
        return 'interacted with you';
    }
  }

  function formatTime(timestamp: number): string {
    return formatDistanceToNow(timestamp * 1000, { addSuffix: true });
  }

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
      case 'today':
        return 'Today';
      case 'yesterday':
        return 'Yesterday';
      case 'thisWeek':
        return 'This Week';
      case 'lastWeek':
        return 'Last Week';
      case 'thisMonth':
        return 'This Month';
      case 'older':
        return 'Older';
    }
  }

  // Group notifications by time section
  $: groupedNotifications = (() => {
    const groups: {
      section: TimeSection;
      label: string;
      notifications: typeof filteredNotifications;
    }[] = [];
    let currentSection: TimeSection | null = null;

    for (const notification of filteredNotifications) {
      const section = getTimeSection(notification.createdAt);
      if (section !== currentSection) {
        currentSection = section;
        groups.push({ section, label: getSectionLabel(section), notifications: [] });
      }
      groups[groups.length - 1].notifications.push(notification);
    }

    return groups;
  })();

  async function handleNotificationClick(notification: any) {
    notifications.markAsRead(notification.id);

    // For mentions and comments, use the notification id (which is the event id)
    // as fallback if eventId is not set (for backwards compatibility with old notifications)
    const eventIdToView =
      notification.eventId ||
      (['mention', 'comment'].includes(notification.type) ? notification.id : null);

    if (!eventIdToView) {
      return;
    }

    // For reactions, zaps, and reposts on recipes, try to fetch the event
    // to determine if it's a recipe (kind 30023) and route accordingly
    if (['reaction', 'zap', 'repost'].includes(notification.type)) {
      try {
        const ndkInstance = get(ndk);
        if (ndkInstance) {
          const event = await ndkInstance.fetchEvent({ ids: [eventIdToView] });
          if (event && event.kind === 30023) {
            // It's a recipe - build naddr and go to recipe page
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
        // If fetch fails, fall back to note view
        console.debug('[Notifications] Could not fetch event for routing:', e);
      }
    }

    // Default: go to note view
    const raw = String(eventIdToView).trim();
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
      <!-- Signed-out empty state: no redirect, clear CTA (4.2 first-60-seconds improvement) -->
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
        <div class="flex gap-1">
          {#each tabs as tab}
            <button
              on:click={() => (activeTab = tab.id)}
              class="px-4 py-2 text-sm font-medium transition-colors relative cursor-pointer"
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
      {#each groupedNotifications as group (group.section)}
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
          {#each group.notifications as notification (notification.id)}
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
                    {replaceNpubMentions(cleanImageUrls(notification.content))}
                  </p>
                {/if}

                {#if getReferencedEventId(notification)}
                  {@const refId = getReferencedEventId(notification)}
                  {@const ctx = refId ? contextById[refId] : undefined}
                  <div
                    class="mt-2 px-3 py-2 rounded-lg border-l-2"
                    style="background-color: var(--color-input-bg); border-color: #f97316;"
                  >
                    {#if refId && ctx === undefined}
                      <div class="flex items-center gap-2">
                        <div class="w-4 h-4 bg-accent-gray rounded-full animate-pulse"></div>
                        <div class="h-3 bg-accent-gray rounded w-28 animate-pulse"></div>
                      </div>
                      <div class="mt-1 h-3 bg-accent-gray rounded w-48 animate-pulse"></div>
                    {:else if refId && ctx}
                      <div class="flex items-center gap-2">
                        <CustomAvatar pubkey={ctx.pubkey} size={18} />
                        <span
                          class="text-xs font-medium"
                          style="color: var(--color-text-secondary);"
                        >
                          <CustomName pubkey={ctx.pubkey} />
                        </span>
                      </div>
                      <p
                        class="mt-1 text-xs line-clamp-2"
                        style="color: var(--color-text-secondary);"
                      >
                        {replaceNpubMentions(cleanImageUrls(ctx.preview))}
                      </p>
                    {:else}
                      <p class="text-xs" style="color: var(--color-text-secondary);">
                        Referenced post unavailable
                      </p>
                    {/if}
                  </div>
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
