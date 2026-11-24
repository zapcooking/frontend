<script lang="ts">
  /**
   * My Kitchen › Scheduled — the signed-in account's scheduled posts:
   * what is waiting (soonest first), what failed, and what went out
   * recently. One queue serves web, Android and iOS, so posts scheduled
   * in the apps show up here too.
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
    type ScheduledItem,
    type ScheduleFailure
  } from '$lib/scheduleClient';
  import {
    groupScheduled,
    previewOf,
    relayModeLabel,
    failedExplanation,
    restoreForComposer,
    hasUnsentDraft,
    NOTE_DRAFT_KEY
  } from '$lib/scheduledList';
  import { formatScheduleTime } from '$lib/composerSchedule';
  import { postComposerOpen, openComposerRestored } from '$lib/postComposerStore';
  import { eventIdPath } from '$lib/utils/eventUrl';
  import { showToast } from '$lib/toast';
  import PanLoader from '../../../components/PanLoader.svelte';
  import PullToRefresh from '../../../components/PullToRefresh.svelte';
  import ClockCountdownIcon from 'phosphor-svelte/lib/ClockCountdown';
  import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwise';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import VideoIcon from 'phosphor-svelte/lib/Video';
  import WarningIcon from 'phosphor-svelte/lib/Warning';

  /** Don't refetch more often than this when focus flaps. */
  const FOCUS_REFRESH_MIN_MS = 10_000;

  let items: ScheduledItem[] = [];
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

  onMount(() => {
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
   * Reschedule = cancel, then reopen the composer with the post in it and
   * the time picker open. The composer only opens if the cancel went
   * through: otherwise the original is still going out (or already has)
   * and a second copy would be a duplicate.
   */
  async function reschedule(item: ScheduledItem) {
    const restored = restoreForComposer(item, Math.floor(Date.now() / 1000));
    const lines = ['Reschedule this post? It will be cancelled and opened in the composer so you can pick a new time.'];
    lines.push(...restored.notRestored);
    if (hasUnsentDraft(localStorage.getItem(NOTE_DRAFT_KEY))) {
      lines.push('You have an unsent draft in the composer. It will be replaced by this post.');
    }
    if (!confirm(lines.join('\n\n'))) return;

    busy = { ...busy, [item.id]: true };
    const result = await cancelScheduled(item.id);
    busy = { ...busy, [item.id]: false };
    if (!result.ok) {
      setNotice(item.id, scheduleErrorCopy(result));
      await load();
      return;
    }
    openInComposer(restored);
    await load();
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
        JSON.stringify({ content: restored.draft.content, media: restored.draft.media, savedAt: Date.now() })
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
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <h1 class="text-xl font-bold">Scheduled</h1>
          <p class="text-caption text-sm">Posts go out within a minute of their time.</p>
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
      {:else if isEmpty && !loadFailure}
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
      {:else}
        {#if groups.upcoming.length > 0}
          <section class="flex flex-col gap-3" aria-labelledby="scheduled-upcoming">
            <h2 id="scheduled-upcoming" class="section-title">Upcoming</h2>
            {#each groups.upcoming as item (item.id)}
              {@const preview = previewOf(item.event)}
              <article class="row-card">
                <div class="row-head">
                  <span class="row-time">
                    <ClockCountdownIcon size={16} class="flex-shrink-0" />
                    {#if item.status === 'publishing'}
                      Publishing now…
                    {:else}
                      {formatScheduleTime(item.publishAt, now)}
                    {/if}
                  </span>
                  <span class="row-meta">{preview.kind} · {relayModeLabel(item.relayMode)}</span>
                </div>

                <div class="row-body">
                  {#if preview.image}
                    <img class="row-thumb" src={preview.image.url} alt={preview.image.alt} loading="lazy" />
                  {/if}
                  <div class="min-w-0 flex-1">
                    {#if preview.text}
                      <p class="row-text">{preview.text}</p>
                    {:else if !preview.image && preview.pollOptions.length === 0}
                      <p class="row-text text-caption">No text</p>
                    {/if}
                    {#if preview.pollOptions.length > 0}
                      <ul class="poll-options">
                        {#each preview.pollOptions as option}
                          <li>{option}</li>
                        {/each}
                      </ul>
                    {/if}
                    {#if preview.moreMedia > 0}
                      <p class="row-more">
                        {#if preview.hasVideo}<VideoIcon size={14} class="inline -mt-0.5" />{/if}
                        {preview.image ? '+' : ''}{preview.moreMedia}
                        {preview.image ? 'more' : ''}
                        {preview.moreMedia === 1 ? 'attachment' : 'attachments'}
                      </p>
                    {/if}
                  </div>
                </div>

                {#if notices[item.id]}
                  <p class="row-notice" role="status">{notices[item.id]}</p>
                {/if}

                {#if item.status === 'pending'}
                  <div class="row-actions">
                    <button type="button" class="action-primary" on:click={() => reschedule(item)} disabled={busy[item.id]}>
                      Reschedule
                    </button>
                    <button type="button" class="action-danger" on:click={() => cancel(item)} disabled={busy[item.id]}>
                      {busy[item.id] ? 'Working…' : 'Cancel'}
                    </button>
                  </div>
                {/if}
              </article>
            {/each}
          </section>
        {/if}

        {#if groups.failed.length > 0}
          <section class="flex flex-col gap-3" aria-labelledby="scheduled-failed">
            <h2 id="scheduled-failed" class="section-title">Not sent</h2>
            {#each groups.failed as item (item.id)}
              {@const preview = previewOf(item.event)}
              <article class="row-card row-card--failed">
                <div class="row-head">
                  <span class="row-time row-time--failed">
                    <WarningIcon size={16} class="flex-shrink-0" />
                    Was due {formatScheduleTime(item.publishAt, now)}
                  </span>
                  <span class="row-meta">{preview.kind} · {relayModeLabel(item.relayMode)}</span>
                </div>
                <div class="row-body">
                  {#if preview.image}
                    <img class="row-thumb" src={preview.image.url} alt={preview.image.alt} loading="lazy" />
                  {/if}
                  <div class="min-w-0 flex-1">
                    {#if preview.text}<p class="row-text">{preview.text}</p>{/if}
                    {#if preview.pollOptions.length > 0}
                      <ul class="poll-options">
                        {#each preview.pollOptions as option}<li>{option}</li>{/each}
                      </ul>
                    {/if}
                  </div>
                </div>
                <p class="row-explain">{failedExplanation(item)}</p>
                {#if item.lastError}
                  <details class="row-detail">
                    <summary>Details</summary>
                    <p>
                      Last response: <code>{item.lastError}</code>
                      {#if item.attempts > 0}({item.attempts} {item.attempts === 1 ? 'attempt' : 'attempts'}){/if}
                    </p>
                  </details>
                {/if}
                <div class="row-actions">
                  <button type="button" class="action-primary" on:click={() => postAgain(item)}>
                    Edit and post again
                  </button>
                </div>
              </article>
            {/each}
          </section>
        {/if}

        {#if groups.sent.length > 0}
          <section class="flex flex-col gap-3" aria-labelledby="scheduled-sent">
            <h2 id="scheduled-sent" class="section-title">Recently posted</h2>
            {#each groups.sent as item (item.id)}
              {@const preview = previewOf(item.event)}
              <article class="row-card row-card--sent">
                <div class="row-head">
                  <span class="row-time row-time--sent">Posted {formatScheduleTime(item.sentAt ?? item.publishAt, now)}</span>
                  <span class="row-meta">{preview.kind} · {relayModeLabel(item.relayMode)}</span>
                </div>
                <div class="row-body">
                  {#if preview.image}
                    <img class="row-thumb" src={preview.image.url} alt={preview.image.alt} loading="lazy" />
                  {/if}
                  <div class="min-w-0 flex-1">
                    {#if preview.text}<p class="row-text">{preview.text}</p>{/if}
                    {#if preview.pollOptions.length > 0}
                      <ul class="poll-options">
                        {#each preview.pollOptions as option}<li>{option}</li>{/each}
                      </ul>
                    {/if}
                  </div>
                </div>
                <div class="row-actions">
                  <a class="action-link" href={eventIdPath(item.id)}>View post</a>
                </div>
              </article>
            {/each}
          </section>
        {/if}
      {/if}
    </div>
  </PullToRefresh>
{/if}

<style>
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

  .section-title {
    font-size: 0.8125rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-caption);
  }

  .row-card {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    border-radius: 0.75rem;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
  }
  .row-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.25rem 0.75rem;
  }
  .row-time {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .row-time :global(svg) {
    color: var(--color-primary);
  }
  .row-time--failed :global(svg) {
    color: #ef4444;
  }
  .row-time--sent {
    font-weight: 500;
    color: var(--color-text-secondary);
  }
  .row-meta {
    font-size: 0.8125rem;
    color: var(--color-caption);
  }
  .row-body {
    display: flex;
    gap: 0.75rem;
  }
  .row-thumb {
    width: 4.5rem;
    height: 4.5rem;
    flex-shrink: 0;
    border-radius: 0.5rem;
    object-fit: cover;
    background: var(--color-input-bg);
  }
  .row-text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
    color: var(--color-text-primary);
  }
  .poll-options {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.5rem;
  }
  .poll-options li {
    padding: 0.25rem 0.625rem;
    font-size: 0.875rem;
    border-radius: 0.5rem;
    border: 1px solid var(--color-input-border);
    background: var(--color-input-bg);
    overflow-wrap: anywhere;
  }
  .row-more {
    margin-top: 0.375rem;
    font-size: 0.8125rem;
    color: var(--color-caption);
  }
  .row-explain {
    font-size: 0.9375rem;
    color: var(--color-text-primary);
  }
  .row-notice {
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    border-radius: 0.5rem;
    color: var(--color-text-primary);
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
  }
  .row-detail {
    font-size: 0.8125rem;
    color: var(--color-caption);
  }
  .row-detail summary {
    cursor: pointer;
  }
  .row-detail code {
    overflow-wrap: anywhere;
  }
  .row-actions {
    display: flex;
    gap: 0.5rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--color-input-border);
  }
  .action-primary,
  .action-danger,
  .action-link {
    padding: 0.5rem 0.875rem;
    font-size: 0.9375rem;
    font-weight: 600;
    border-radius: 0.5rem;
    text-align: center;
  }
  .action-primary {
    flex: 1;
    color: var(--color-on-action, #fff);
    background: var(--color-action);
  }
  .action-primary:hover:not(:disabled) {
    background: var(--color-action-hover);
  }
  .action-danger {
    color: #ef4444;
  }
  .action-danger:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.1);
  }
  .action-link {
    color: var(--color-primary);
  }
  .action-link:hover {
    text-decoration: underline;
  }
  .action-primary:disabled,
  .action-danger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
