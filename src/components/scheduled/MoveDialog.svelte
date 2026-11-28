<script lang="ts">
  /**
   * Move a scheduled post to a new time, and nothing else: the post goes
   * out exactly as it was written ($lib/scheduleClient, moveScheduled).
   *
   * This dialog is the confirmation. It shows the time the post has now,
   * the time it would get, and for a poll its new closing time, and only
   * "Move post" asks the signer for anything. It is opened by "Move" on a
   * post (no time chosen yet) and by a drag in the calendar (the dropped-on
   * time already filled in), so a drag is confirmed here too.
   *
   * If the move fails, nothing has changed and the dialog says why.
   */
  import { createEventDispatcher } from 'svelte';
  import {
    moveScheduled,
    planMove,
    scheduleErrorCopy,
    type MoveScheduledResult,
    type ScheduledItem
  } from '$lib/scheduleClient';
  import {
    formatScheduleTime,
    fromLocalInputValue,
    originalIsSettled,
    pickerBounds,
    toLocalInputValue
  } from '$lib/composerSchedule';
  import { previewOf } from '$lib/scheduledList';
  import { firstLine, localDay, type CalendarEntry } from '$lib/scheduledCalendar';
  import { nextOpenSlots, openSlotsOn, type PostingTimes } from '$lib/postingSlots';
  import Modal from '../Modal.svelte';
  import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRight';

  export let open = false;
  export let item: ScheduledItem | null = null;
  /** A time to start from (a drag's target), unix seconds; null starts from the post's own time. */
  export let to: number | null = null;
  /** Everything on the calendar and the person's posting times: for offering the chosen day's open slots. */
  export let entries: CalendarEntry[] = [];
  export let times: PostingTimes | null = null;

  const dispatch = createEventDispatcher<{
    moved: Extract<MoveScheduledResult, { ok: true }>;
    /** The post turned out not to be movable any more (sent, cancelled, gone): the caller should reload. */
    stale: ScheduledItem;
  }>();

  const nowSeconds = () => Math.floor(Date.now() / 1000);

  let input = '';
  let min = '';
  let max = '';
  let now = nowSeconds();
  let busy = false;
  let failure = '';
  let startedFor = '';

  // Fresh state each time the dialog opens for a post.
  $: if (open && item && startedFor !== `${item.id}:${to}`) {
    startedFor = `${item.id}:${to}`;
    now = nowSeconds();
    const bounds = pickerBounds(now);
    min = toLocalInputValue(bounds.min);
    max = toLocalInputValue(bounds.max);
    input = toLocalInputValue(to ?? item.publishAt);
    busy = false;
    failure = '';
  }
  $: if (!open) startedFor = '';

  $: preview = item ? previewOf(item.event) : null;
  $: summary = preview
    ? firstLine(preview.text) || (preview.image ? 'Photo' : preview.hasVideo ? 'Video' : preview.kind)
    : '';
  $: picked = fromLocalInputValue(input);
  $: unchanged = !!item && picked === item.publishAt;
  $: plan = item && picked !== null && !unchanged ? planMove(item.event, picked, now) : null;
  $: problem = picked === null ? scheduleErrorCopy({ code: 'bad_publish_time' }) : plan && !plan.ok ? scheduleErrorCopy(plan) : '';

  // The open slots of the day the field is on: one tap sets the time.
  // The post being moved does not hold its own slot against itself.
  $: slotDay = item ? localDay(new Date((picked ?? item.publishAt) * 1000)) : null;
  $: daySlots = item && times && slotDay ? openSlotsOn(slotDay, entries, times, now, item.id) : [];
  const slotTime = (at: number) => new Date(at * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const slotDayName = (day: Date) => day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  // The next open slots from today on, whatever day they fall on: a post
  // can be moved by tapping one, with no date to pick (what a drag does
  // for someone with a mouse). Those already listed for the chosen day
  // are not repeated.
  $: upcoming =
    item && times
      ? nextOpenSlots(localDay(new Date(now * 1000)), entries, times, now, { ignoreId: item.id, limit: 4 }).filter(
          (at) => !daySlots.includes(at)
        )
      : [];
  const slotDayTime = (at: number) =>
    `${new Date(at * 1000).toLocaleDateString(undefined, { weekday: 'short' })} ${slotTime(at)}`;
  const slotFull = (at: number) =>
    `${new Date(at * 1000).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} at ${slotTime(at)}`;

  function chooseSlot(at: number) {
    input = toLocalInputValue(at);
    onInput();
  }

  function onInput() {
    now = nowSeconds();
    failure = '';
  }

  function close() {
    if (busy) return;
    open = false;
  }

  async function confirmMove() {
    if (!item || !plan?.ok || busy) return;
    busy = true;
    failure = '';
    const result = await moveScheduled(item, plan.to);
    busy = false;
    if (result.ok) {
      open = false;
      dispatch('moved', result);
      return;
    }
    failure = `${scheduleErrorCopy(result)} The post has not been moved.`;
    now = nowSeconds();
    if (originalIsSettled(result)) dispatch('stale', item);
  }
</script>

<Modal bind:open compact autoHeight locked={busy}>
  <svelte:fragment slot="title">Move this post</svelte:fragment>
  {#if item}
    <div class="move">
      <p class="move-post">
        <span class="move-kind">{preview?.kind}</span>
        <span class="move-text">{summary}</span>
      </p>

      <div class="move-field">
        <label class="move-label" for="move-post-time">New time</label>
        <input
          id="move-post-time"
          class="move-input"
          type="datetime-local"
          bind:value={input}
          {min}
          {max}
          disabled={busy}
          aria-describedby="move-post-summary"
          on:input={onInput}
          on:change={onInput}
        />
        <p class="move-hint">Your local time. From 5 minutes to 90 days from now.</p>
        {#if slotDay && daySlots.length > 0}
          <div class="move-slots" role="group" aria-label="Open slots on {slotDayName(slotDay)}">
            <span class="move-slots-label">Open slots that day</span>
            {#each daySlots as at (at)}
              <button
                type="button"
                class="move-slot"
                aria-pressed={picked === at}
                disabled={busy}
                on:click={() => chooseSlot(at)}
              >
                {slotTime(at)}
              </button>
            {/each}
          </div>
        {/if}
        {#if upcoming.length > 0}
          <div class="move-slots" role="group" aria-label="Next open slots">
            <span class="move-slots-label">Next open slots</span>
            {#each upcoming as at (at)}
              <button
                type="button"
                class="move-slot"
                data-next-slot={at}
                aria-pressed={picked === at}
                aria-label={slotFull(at)}
                disabled={busy}
                on:click={() => chooseSlot(at)}
              >
                {slotDayTime(at)}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <div id="move-post-summary" class="move-summary" role="status">
        <div class="move-row">
          <span class="move-row-label">Posts</span>
          <span class="move-times">
            <span class="move-old">{formatScheduleTime(item.publishAt, now)}</span>
            {#if plan?.ok}
              <ArrowRightIcon size={14} class="flex-shrink-0" aria-label="moves to" />
              <strong class="move-new">{formatScheduleTime(plan.to, now)}</strong>
            {/if}
          </span>
        </div>
        {#if plan?.ok && plan.pollClose}
          <div class="move-row">
            <span class="move-row-label">Poll closes</span>
            <span class="move-times">
              <span class="move-old">{formatScheduleTime(plan.pollClose.from, now)}</span>
              <ArrowRightIcon size={14} class="flex-shrink-0" aria-label="moves to" />
              <strong class="move-new">{formatScheduleTime(plan.pollClose.to, now)}</strong>
            </span>
          </div>
        {/if}
        {#if unchanged}
          <p class="move-note">Pick a different time to move it.</p>
        {:else if problem}
          <p class="move-problem" role="alert">{problem}</p>
        {:else}
          <p class="move-note">
            Only the time changes. The post goes out exactly as written, and your signer will ask you to
            sign it again.
          </p>
        {/if}
      </div>

      {#if failure}
        <p class="move-problem" role="alert">{failure}</p>
      {/if}

      <div class="move-actions">
        <button type="button" class="move-keep" on:click={close} disabled={busy}>Keep as it is</button>
        <button type="button" class="move-confirm" on:click={confirmMove} disabled={busy || !plan?.ok}>
          {busy ? 'Moving…' : 'Move post'}
        </button>
      </div>
    </div>
  {/if}
</Modal>

<style>
  .move {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
  }
  .move-post {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    min-width: 0;
    padding: 0.5rem 0.75rem;
    border-radius: 0.75rem;
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
  }
  .move-kind {
    flex-shrink: 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-caption);
  }
  .move-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-primary);
  }
  .move-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .move-label {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .move-input {
    width: 100%;
    padding: 0.5rem 0.625rem;
    font-size: 1rem;
    border-radius: 0.5rem;
    color: var(--color-text-primary);
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
  }
  .move-input:focus {
    outline: none;
    border-color: var(--color-primary);
  }
  .move-slots {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.25rem;
  }
  .move-slots-label {
    width: 100%;
    font-size: 0.8125rem;
    color: var(--color-caption);
  }
  .move-slot {
    padding: 0.3125rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 600;
    border-radius: 9999px;
    color: var(--color-text-primary);
    border: 1px dashed var(--color-input-border);
  }
  .move-slot:hover:not(:disabled) {
    border-color: var(--color-primary);
  }
  .move-slot[aria-pressed='true'] {
    color: var(--color-on-action, #fff);
    border: 1px solid var(--color-action);
    background: var(--color-action);
  }
  .move-hint,
  .move-note {
    font-size: 0.8125rem;
    color: var(--color-caption);
  }
  .move-summary {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .move-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.125rem 0.75rem;
  }
  .move-row-label {
    width: 5.5rem;
    flex-shrink: 0;
    font-size: 0.8125rem;
    color: var(--color-caption);
  }
  .move-times {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.5rem;
    color: var(--color-text-primary);
  }
  .move-new {
    font-weight: 700;
  }
  .move-problem {
    font-size: 0.875rem;
    color: #ef4444;
  }
  .move-actions {
    display: flex;
    gap: 0.5rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--color-input-border);
  }
  .move-keep,
  .move-confirm {
    padding: 0.5rem 0.875rem;
    font-size: 0.9375rem;
    font-weight: 600;
    border-radius: 0.5rem;
  }
  .move-keep {
    color: var(--color-text-primary);
  }
  .move-keep:hover:not(:disabled) {
    background: var(--color-hover-bg);
  }
  .move-confirm {
    flex: 1;
    color: var(--color-on-action, #fff);
    background: var(--color-action);
  }
  .move-confirm:hover:not(:disabled) {
    background: var(--color-action-hover);
  }
  .move-keep:disabled,
  .move-confirm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
