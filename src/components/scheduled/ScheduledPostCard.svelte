<script lang="ts">
  /**
   * One scheduled post, in full: when, what kind, where it goes, a
   * preview, and what can be done with it. The Scheduled list shows these
   * as its rows and the calendar shows one when a post is opened.
   *
   * It owns no behaviour: Move, Edit, Cancel and "Edit and post again"
   * are events the page handles, so both views act the same way.
   *
   * Two ways to change a pending post, named for what they change:
   *   Move  only the time; the post goes out exactly as written.
   *   Edit  opens it in the composer, to change the text or the time.
   *         (The event stays `reschedule`, the name the page gives it.)
   */
  import { createEventDispatcher } from 'svelte';
  import type { ScheduledItem } from '$lib/scheduleClient';
  import { previewOf, relayModeLabel, failedExplanation } from '$lib/scheduledList';
  import { formatScheduleTime } from '$lib/composerSchedule';
  import { eventIdPath } from '$lib/utils/eventUrl';
  import ClockCountdownIcon from 'phosphor-svelte/lib/ClockCountdown';
  import VideoIcon from 'phosphor-svelte/lib/Video';
  import WarningIcon from 'phosphor-svelte/lib/Warning';

  export let item: ScheduledItem;
  /** Unix seconds, for "Today" / "Tomorrow" wording. */
  export let now: number;
  export let busy = false;
  /** What happened to this post's last action, in plain words. */
  export let notice = '';

  const dispatch = createEventDispatcher<{
    cancel: ScheduledItem;
    move: ScheduledItem;
    reschedule: ScheduledItem;
    postAgain: ScheduledItem;
  }>();

  $: preview = previewOf(item.event);
  $: failed = item.status === 'failed';
  $: sent = item.status === 'sent';
</script>

<article class="row-card" class:row-card--failed={failed} class:row-card--sent={sent}>
  <div class="row-head">
    {#if failed}
      <span class="row-time row-time--failed">
        <WarningIcon size={16} class="flex-shrink-0" />
        Was due {formatScheduleTime(item.publishAt, now)}
      </span>
    {:else if sent}
      <span class="row-time row-time--sent">Posted {formatScheduleTime(item.sentAt ?? item.publishAt, now)}</span>
    {:else}
      <span class="row-time">
        <ClockCountdownIcon size={16} class="flex-shrink-0" />
        {#if item.status === 'publishing'}
          Publishing now…
        {:else}
          {formatScheduleTime(item.publishAt, now)}
        {/if}
      </span>
    {/if}
    <span class="row-meta">{preview.kind} · {relayModeLabel(item.relayMode)}</span>
  </div>

  <div class="row-body">
    {#if preview.image}
      <img class="row-thumb" src={preview.image.url} alt={preview.image.alt} loading="lazy" />
    {/if}
    <div class="min-w-0 flex-1">
      {#if preview.text}
        <p class="row-text">{preview.text}</p>
      {:else if !failed && !sent && !preview.image && preview.pollOptions.length === 0}
        <p class="row-text text-caption">No text</p>
      {/if}
      {#if preview.pollOptions.length > 0}
        <ul class="poll-options">
          {#each preview.pollOptions as option}
            <li>{option}</li>
          {/each}
        </ul>
      {/if}
      {#if !failed && !sent && preview.moreMedia > 0}
        <p class="row-more">
          {#if preview.hasVideo}<VideoIcon size={14} class="inline -mt-0.5" />{/if}
          {preview.image ? '+' : ''}{preview.moreMedia}
          {preview.image ? 'more' : ''}
          {preview.moreMedia === 1 ? 'attachment' : 'attachments'}
        </p>
      {/if}
    </div>
  </div>

  {#if failed}
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
  {/if}

  {#if notice}
    <p class="row-notice" role="status">{notice}</p>
  {/if}

  {#if item.status === 'pending'}
    <div class="row-actions">
      <button
        type="button"
        class="action-primary"
        data-action="move"
        title="Change only the time. The post stays exactly as written."
        on:click={() => dispatch('move', item)}
        disabled={busy}
      >
        Move
      </button>
      <button
        type="button"
        class="action-secondary"
        data-action="edit"
        title="Open in the composer to change the text or the time."
        on:click={() => dispatch('reschedule', item)}
        disabled={busy}
      >
        Edit
      </button>
      <button
        type="button"
        class="action-danger"
        data-action="cancel"
        on:click={() => dispatch('cancel', item)}
        disabled={busy}
      >
        {busy ? 'Working…' : 'Cancel'}
      </button>
    </div>
  {:else if failed}
    <div class="row-actions">
      <button type="button" class="action-primary" data-action="post-again" on:click={() => dispatch('postAgain', item)}>
        Edit and post again
      </button>
    </div>
  {:else if sent}
    <div class="row-actions">
      <a class="action-link" href={eventIdPath(item.id)}>View post</a>
    </div>
  {/if}
</article>

<style>
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
  .action-secondary {
    padding: 0.5rem 0.875rem;
    font-size: 0.9375rem;
    font-weight: 600;
    border-radius: 0.5rem;
    text-align: center;
    color: var(--color-text-primary);
    border: 1px solid var(--color-input-border);
  }
  .action-secondary:hover:not(:disabled) {
    background: var(--color-hover-bg);
  }
  .action-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
</style>
