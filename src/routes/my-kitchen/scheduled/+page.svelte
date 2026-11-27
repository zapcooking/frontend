<script lang="ts">
  /**
   * My Kitchen › Scheduled — the signed-in account's scheduled posts:
   * what is waiting (soonest first), what failed, and what went out
   * recently. One queue serves web, Android and iOS, so posts scheduled
   * in the apps show up here too.
   *
   * Two views of the same rows: a list, and a calendar
   * (ScheduledCalendar). The choice is remembered on this device. Both
   * act through the same cancel / reschedule functions here.
   *
   * Data comes from $lib/scheduleClient and nothing is cached: the list
   * is fetched on arrival, when the tab regains focus, on a manual
   * refresh, and after the composer schedules something. There is no
   * polling loop.
   */
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { get } from 'svelte/store';
  import { ndk, userPublickey } from '$lib/nostr';
  import {
    listScheduled,
    cancelScheduled,
    scheduleErrorCopy,
    MAX_PENDING_SCHEDULED,
    type MoveScheduledResult,
    type ScheduledItem,
    type ScheduleFailure
  } from '$lib/scheduleClient';
  import { formatScheduleTime } from '$lib/composerSchedule';
  import { groupScheduled, restoreForComposer, hasUnsentDraft, NOTE_DRAFT_KEY } from '$lib/scheduledList';
  import {
    SCHEDULED_VIEW_KEY,
    calendarEntries,
    parseScheduledView,
    type ScheduledView
  } from '$lib/scheduledCalendar';
  import {
    POSTING_TIMES_KEY,
    parsePostingTimes,
    serializePostingTimes,
    type PostingTimes
  } from '$lib/postingSlots';
  import { postComposerOpen, openComposerRestored, openComposerAt } from '$lib/postComposerStore';
  import { showToast } from '$lib/toast';
  import PanLoader from '../../../components/PanLoader.svelte';
  import PullToRefresh from '../../../components/PullToRefresh.svelte';
  import ScheduledPostCard from '../../../components/scheduled/ScheduledPostCard.svelte';
  import ScheduledCalendar from '../../../components/scheduled/ScheduledCalendar.svelte';
  import MoveDialog from '../../../components/scheduled/MoveDialog.svelte';
  import PostingTimesDialog from '../../../components/scheduled/PostingTimesDialog.svelte';
  import ClockCountdownIcon from 'phosphor-svelte/lib/ClockCountdown';
  import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwise';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import WarningIcon from 'phosphor-svelte/lib/Warning';
  import ListBulletsIcon from 'phosphor-svelte/lib/ListBullets';
  import CalendarBlankIcon from 'phosphor-svelte/lib/CalendarBlank';

  /** Don't refetch more often than this when focus flaps. */
  const FOCUS_REFRESH_MIN_MS = 10_000;

  let items: ScheduledItem[] = [];
  /** The server's 100-row cap cut the result: some older history is missing. */
  let truncated = false;
  let view: ScheduledView = 'list';
  let loaded = false;
  let loading = false;
  let loadFailure: ScheduleFailure | null = null;
  let lastLoadedAt = 0;
  let now = Math.floor(Date.now() / 1000);
  /** Row ids with a cancel or reschedule in flight. */
  let busy: Record<string, boolean> = {};
  /** What happened to a row's last action, in plain words. */
  let notices: Record<string, string> = {};
  let pullToRefreshEl: PullToRefresh;

  $: groups = groupScheduled(items, now);

  // How much of the account's limit is in use. Only pending posts count
  // toward it (the server's rule); the list always holds all of them.
  $: pendingCount = items.filter((i) => i.status === 'pending').length;
  $: full = pendingCount >= MAX_PENDING_SCHEDULED;

  // Posting times: the slots each day of the calendar offers. Kept on
  // this device.
  let times: PostingTimes = parsePostingTimes(null);
  let timesOpen = false;
  $: entries = calendarEntries(items, now);

  function saveTimes(next: PostingTimes) {
    times = next;
    try {
      localStorage.setItem(POSTING_TIMES_KEY, serializePostingTimes(next));
    } catch (_) {
      /* not remembered */
    }
    showToast('success', 'Posting times saved');
  }
  $: isEmpty = groups.upcoming.length === 0 && groups.failed.length === 0 && groups.sent.length === 0;

  /**
   * On a direct load or a reload the account is known (from storage)
   * before its signer has been restored: a bunker takes several seconds.
   * Every request here needs a signature, so wait for the signer, up to a
   * limit, instead of failing at once with "sign in".
   */
  const SIGNER_WAIT_MS = 12_000;
  async function signerReady(): Promise<boolean> {
    const deadline = Date.now() + SIGNER_WAIT_MS;
    while (!get(ndk)?.signer) {
      if (Date.now() >= deadline) return false;
      await new Promise((r) => setTimeout(r, 200));
    }
    return true;
  }

  async function load() {
    if (!$userPublickey || loading) return;
    loading = true;
    await signerReady();
    const result = await listScheduled();
    now = Math.floor(Date.now() / 1000);
    lastLoadedAt = Date.now();
    if (result.ok) {
      items = result.items;
      truncated = result.truncated;
      loadFailure = null;
    } else {
      // Keep showing what we had; say the refresh failed.
      loadFailure = result;
    }
    loaded = true;
    loading = false;
  }

  async function handlePull() {
    try {
      await load();
    } finally {
      pullToRefreshEl?.complete();
    }
  }

  function refreshOnFocus() {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastLoadedAt < FOCUS_REFRESH_MIN_MS) return;
    void load();
  }

  const onScheduledChanged = () => void load();

  function setView(next: ScheduledView) {
    view = next;
    try {
      localStorage.setItem(SCHEDULED_VIEW_KEY, next);
    } catch (_) {
      /* not remembered */
    }
  }

  onMount(() => {
    try {
      view = parseScheduledView(localStorage.getItem(SCHEDULED_VIEW_KEY));
      times = parsePostingTimes(localStorage.getItem(POSTING_TIMES_KEY));
    } catch (_) {
      /* storage unavailable: the list, and the default times */
    }
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnFocus);
    window.addEventListener('zc:scheduled-changed', onScheduledChanged);
  });

  onDestroy(() => {
    if (!browser) return;
    window.removeEventListener('focus', refreshOnFocus);
    document.removeEventListener('visibilitychange', refreshOnFocus);
    window.removeEventListener('zc:scheduled-changed', onScheduledChanged);
  });

  // Load once a session is known (it restores a moment after first paint),
  // and start over if the account changes.
  let loadedFor = '';
  $: if (browser && $userPublickey && $userPublickey !== loadedFor) {
    loadedFor = $userPublickey;
    items = [];
    truncated = false;
    loaded = false;
    notices = {};
    void load();
  }

  function setNotice(id: string, text: string) {
    notices = { ...notices, [id]: text };
  }

  async function cancel(item: ScheduledItem) {
    if (!confirm("Cancel this scheduled post? It won't be published.")) return;
    busy = { ...busy, [item.id]: true };
    const result = await cancelScheduled(item.id);
    busy = { ...busy, [item.id]: false };
    if (result.ok) {
      showToast('success', 'Scheduled post cancelled');
    } else {
      // Too late, or gone: say which, then show the row as it really is.
      setNotice(item.id, scheduleErrorCopy(result));
    }
    await load();
  }

  /**
   * Reschedule opens the composer with the post in it and the time picker
   * open, and cancels NOTHING. The post stays scheduled as it is until the
   * person presses Schedule there; the new one then takes its place in one
   * step (`replaces`). Closing the composer leaves the original untouched.
   * See ReschedulingTarget in $lib/composerSchedule.
   *
   * There is something to confirm only when opening the composer loses
   * something: an unsent draft, or part of the post that does not come
   * back as it was.
   */
  function reschedule(item: ScheduledItem) {
    const restored = restoreForComposer(item, Math.floor(Date.now() / 1000), { replace: true });
    const lines = [...restored.notRestored];
    if (hasUnsentDraft(localStorage.getItem(NOTE_DRAFT_KEY))) {
      lines.push('You have an unsent draft in the composer. It will be replaced by this post.');
    }
    if (lines.length > 0) {
      lines.unshift('Open this post in the composer to pick a new time? It stays scheduled until you press Schedule.');
      if (!confirm(lines.join('\n\n'))) return;
    }
    openInComposer(restored);
  }

  // ── Move: only the time changes ────────────────────────────────────
  // MoveDialog shows the old and new time and asks before anything is
  // signed. `to` is a time already chosen by a drag, or null.
  let moveOpen = false;
  let moveItem: ScheduledItem | null = null;
  let moveTo: number | null = null;

  function askToMove(item: ScheduledItem, to: number | null = null) {
    moveItem = item;
    moveTo = to;
    moveOpen = true;
  }

  /**
   * The move went through. The answer already holds the new row, so the
   * view is updated from it: no refetch, which would cost a third
   * signature on top of the two a move needs.
   */
  function onMoved(result: Extract<MoveScheduledResult, { ok: true }>) {
    now = Math.floor(Date.now() / 1000);
    items = [...items.filter((i) => i.id !== result.replacedId && i.id !== result.item.id), result.item];
    if (result.replacement === 'original_still_scheduled') {
      showToast(
        'error',
        `Scheduled for ${formatScheduleTime(result.item.publishAt, now)}, but the original is still scheduled too. Cancel it so it isn't posted twice.`,
        20000
      );
      void load();
      return;
    }
    showToast('success', `Moved to ${formatScheduleTime(result.item.publishAt, now)}`);
  }

  /** A failed post is already final, so there is nothing to cancel first. */
  function postAgain(item: ScheduledItem) {
    const restored = restoreForComposer(item, Math.floor(Date.now() / 1000));
    const lines = ['Open this post in the composer to send it again?', ...restored.notRestored];
    if (hasUnsentDraft(localStorage.getItem(NOTE_DRAFT_KEY))) {
      lines.push('You have an unsent draft in the composer. It will be replaced by this post.');
    }
    if (!confirm(lines.join('\n\n'))) return;
    openInComposer(restored);
  }

  function openInComposer(restored: ReturnType<typeof restoreForComposer>) {
    // The text and attachments go in as the composer's stored draft, so
    // they survive a reload: once the original is cancelled this is the
    // only copy.
    try {
      localStorage.setItem(
        NOTE_DRAFT_KEY,
        JSON.stringify({ ...restored.draft, savedAt: Date.now() })
      );
    } catch (_) {
      /* storage unavailable: the composer still opens with the poll and time */
    }
    openComposerRestored(restored.restore);
  }
</script>

<svelte:head>
  <title>Scheduled - My Kitchen - zap.cooking</title>
  <meta name="description" content="Posts you have scheduled to publish later on zap.cooking." />
</svelte:head>

{#if !$userPublickey}
  <div class="state-card">
    <ClockCountdownIcon size={28} class="state-icon" />
    <p class="state-title">Sign in to see your scheduled posts</p>
    <p class="state-desc">Write a note or a poll now and have it posted later, at a time you pick.</p>
    <a href="/login?redirect=/my-kitchen/scheduled" class="primary-btn">Sign in</a>
  </div>
{:else}
  <PullToRefresh bind:this={pullToRefreshEl} on:refresh={handlePull}>
    <div class="flex flex-col gap-5">
      <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div class="min-w-[12rem] flex-1">
          <!-- The count sits beside the title, so it never wraps onto a line of its own. -->
          <div class="flex items-center gap-2">
            <h1 class="text-xl font-bold">Scheduled</h1>
            {#if loaded}
              <span
                class="in-use"
                class:in-use--full={full}
                aria-label="{pendingCount} of {MAX_PENDING_SCHEDULED} scheduled posts in use"
                title="{pendingCount} of {MAX_PENDING_SCHEDULED} scheduled posts in use"
              >
                {pendingCount}/{MAX_PENDING_SCHEDULED}
              </span>
            {/if}
          </div>
          <p class="text-caption text-sm">Posts go out within a minute of their time.</p>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <div class="view-toggle" role="group" aria-label="Show scheduled posts as">
            <button type="button" class="view-btn" aria-pressed={view === 'list'} on:click={() => setView('list')}>
              <ListBulletsIcon size={16} />
              List
            </button>
            <button
              type="button"
              class="view-btn"
              aria-pressed={view === 'calendar'}
              on:click={() => setView('calendar')}
            >
              <CalendarBlankIcon size={16} />
              Calendar
            </button>
          </div>
          <button
            type="button"
            class="refresh-btn"
            on:click={() => load()}
            disabled={loading}
            aria-label="Refresh scheduled posts"
            title="Refresh"
          >
            <ArrowsClockwiseIcon size={18} class={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {#if loadFailure}
        <div class="notice notice--error" role="alert">
          <WarningIcon size={18} class="flex-shrink-0" />
          <span class="flex-1">{scheduleErrorCopy(loadFailure)}</span>
          <button type="button" class="notice-action" on:click={() => load()} disabled={loading}>Try again</button>
        </div>
      {/if}

      {#if !loaded}
        <div class="flex justify-center py-10" aria-label="Loading scheduled posts">
          <PanLoader size="sm" />
        </div>
      {:else if isEmpty && !loadFailure && view === 'list'}
        <div class="state-card">
          <ClockCountdownIcon size={28} class="state-icon" />
          <p class="state-title">Nothing scheduled</p>
          <p class="state-desc">
            Write a note or a poll now and pick when it posts, from 5 minutes to 90 days ahead. In the
            composer, tap the calendar to set a time. Posts you schedule in the Zap Cooking apps show
            up here too.
          </p>
          <button type="button" class="primary-btn" on:click={() => postComposerOpen.set(true)}>
            <PencilSimpleIcon size={16} />
            Write a post
          </button>
        </div>
      {:else if view === 'calendar'}
        <ScheduledCalendar
          {items}
          {now}
          {truncated}
          {times}
          {full}
          {busy}
          {notices}
          on:create={(e) => openComposerAt(e.detail)}
          on:editTimes={() => (timesOpen = true)}
          on:cancel={(e) => cancel(e.detail)}
          on:move={(e) => askToMove(e.detail.item, e.detail.to)}
          on:reschedule={(e) => reschedule(e.detail)}
          on:postAgain={(e) => postAgain(e.detail)}
        />
      {:else}
        {#if groups.upcoming.length > 0}
          <section class="flex flex-col gap-3" aria-labelledby="scheduled-upcoming">
            <h2 id="scheduled-upcoming" class="section-title">Upcoming</h2>
            {#each groups.upcoming as item (item.id)}
              <ScheduledPostCard
                {item}
                {now}
                busy={busy[item.id]}
                notice={notices[item.id] ?? ''}
                on:cancel={(e) => cancel(e.detail)}
                on:move={(e) => askToMove(e.detail)}
                on:reschedule={(e) => reschedule(e.detail)}
              />
            {/each}
          </section>
        {/if}

        {#if groups.failed.length > 0}
          <section class="flex flex-col gap-3" aria-labelledby="scheduled-failed">
            <h2 id="scheduled-failed" class="section-title">Not sent</h2>
            {#each groups.failed as item (item.id)}
              <ScheduledPostCard {item} {now} on:postAgain={(e) => postAgain(e.detail)} />
            {/each}
          </section>
        {/if}

        {#if groups.sent.length > 0}
          <section class="flex flex-col gap-3" aria-labelledby="scheduled-sent">
            <h2 id="scheduled-sent" class="section-title">Recently posted</h2>
            {#each groups.sent as item (item.id)}
              <ScheduledPostCard {item} {now} />
            {/each}
          </section>
        {/if}
      {/if}
    </div>
  </PullToRefresh>
{/if}

<MoveDialog
  bind:open={moveOpen}
  item={moveItem}
  to={moveTo}
  {entries}
  {times}
  on:moved={(e) => onMoved(e.detail)}
  on:stale={() => void load()}
/>

<PostingTimesDialog bind:open={timesOpen} {times} on:save={(e) => saveTimes(e.detail)} />

<style>
  .in-use {
    padding: 0.0625rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
    border-radius: 9999px;
    color: var(--color-text-secondary);
    border: 1px solid var(--color-input-border);
  }
  .in-use--full {
    color: #ef4444;
    border-color: #ef4444;
  }

  .state-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.75rem;
    padding: 3rem 1.5rem;
    border-radius: 0.75rem;
    border: 1px solid var(--color-input-border);
    background: var(--color-input-bg);
  }
  .state-card :global(.state-icon) {
    color: var(--color-primary);
  }
  .state-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .state-desc {
    max-width: 30rem;
    font-size: 0.9375rem;
    color: var(--color-caption);
  }
  .primary-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.25rem;
    padding: 0.5rem 1.25rem;
    border-radius: 9999px;
    font-weight: 600;
    color: var(--color-on-action, #fff);
    background: var(--color-action);
  }
  .primary-btn:hover {
    background: var(--color-action-hover);
  }

  .refresh-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    flex-shrink: 0;
    border-radius: 9999px;
    color: var(--color-text-secondary);
    border: 1px solid var(--color-input-border);
  }
  .refresh-btn:hover:not(:disabled) {
    color: var(--color-text-primary);
    background: var(--color-hover-bg);
  }
  .refresh-btn:disabled {
    opacity: 0.6;
  }

  .view-toggle {
    display: inline-flex;
    padding: 0.125rem;
    border-radius: 9999px;
    border: 1px solid var(--color-input-border);
    background: var(--color-input-bg);
  }
  .view-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3125rem;
    padding: 0.3125rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 600;
    border-radius: 9999px;
    color: var(--color-text-secondary);
  }
  .view-btn[aria-pressed='true'] {
    color: var(--color-on-action, #fff);
    background: var(--color-action);
  }

  .section-title {
    font-size: 0.8125rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-caption);
  }

  .notice {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.625rem 0.875rem;
    font-size: 0.9375rem;
    border-radius: 0.75rem;
    border: 1px solid var(--color-input-border);
    background: var(--color-bg-secondary);
  }
  .notice--error :global(svg) {
    color: #ef4444;
  }
  .notice-action {
    font-weight: 600;
    color: var(--color-primary);
  }
</style>
