<script lang="ts">
  /**
   * My Kitchen › Scheduled, as a calendar. Read-only: it shows where the
   * posts fall and opens one for the same Cancel / Reschedule the list
   * has. It fetches nothing; the page owns the data and the refresh rules.
   *
   *   Week   seven day columns at desktop width; the same seven days as
   *          a day-by-day agenda on a phone, where columns do not fit.
   *   Month  an overview with a count per day; choosing a day opens its
   *          week.
   *
   * Days are local calendar days ($lib/scheduledCalendar). Paging stops
   * 30 days back and 90 days ahead: nothing can be outside that.
   */
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import { addDays, addMonths, startOfMonth } from 'date-fns';
  import type { ScheduledItem } from '$lib/scheduleClient';
  import { previewOf } from '$lib/scheduledList';
  import {
    SCHEDULED_CALENDAR_MODE_KEY,
    bucketByDay,
    calendarBounds,
    calendarEntries,
    canShowMonth,
    canShowWeek,
    countDay,
    dayKey,
    describeCounts,
    entryTime,
    firstLine,
    inBounds,
    monthTitle,
    monthWeeks,
    parseCalendarMode,
    weekDays,
    weekStart,
    weekTitle,
    type CalendarEntry,
    type CalendarMode
  } from '$lib/scheduledCalendar';
  import Modal from '../Modal.svelte';
  import ScheduledPostCard from './ScheduledPostCard.svelte';
  import CaretLeftIcon from 'phosphor-svelte/lib/CaretLeft';
  import CaretRightIcon from 'phosphor-svelte/lib/CaretRight';
  import WarningIcon from 'phosphor-svelte/lib/Warning';
  import CheckIcon from 'phosphor-svelte/lib/Check';

  export let items: ScheduledItem[];
  /** Unix seconds. */
  export let now: number;
  /** The server cut the list at its cap: some older history is missing. */
  export let truncated = false;
  export let busy: Record<string, boolean> = {};
  export let notices: Record<string, string> = {};

  const dispatch = createEventDispatcher<{
    cancel: ScheduledItem;
    reschedule: ScheduledItem;
    postAgain: ScheduledItem;
  }>();

  let mode: CalendarMode = 'week';
  let rootEl: HTMLElement;

  $: bounds = calendarBounds(now);
  $: todayKey = dayKey(bounds.today);
  $: entries = calendarEntries(items, now);
  $: buckets = bucketByDay(entries);

  // What is on screen: the Monday of the week shown, and the month shown.
  let shownWeek = weekStart(new Date(now * 1000));
  let shownMonth = startOfMonth(new Date(now * 1000));

  $: days = weekDays(shownWeek);
  $: weeks = monthWeeks(shownMonth);
  $: title = mode === 'week' ? weekTitle(shownWeek, bounds.today) : monthTitle(shownMonth);
  $: step = mode === 'week' ? 'week' : 'month';
  $: canPrev =
    mode === 'week' ? canShowWeek(addDays(shownWeek, -7), bounds) : canShowMonth(addMonths(shownMonth, -1), bounds);
  $: canNext =
    mode === 'week' ? canShowWeek(addDays(shownWeek, 7), bounds) : canShowMonth(addMonths(shownMonth, 1), bounds);
  $: onToday =
    mode === 'week'
      ? shownWeek.getTime() === weekStart(bounds.today).getTime()
      : shownMonth.getTime() === startOfMonth(bounds.today).getTime();

  onMount(() => {
    try {
      mode = parseCalendarMode(localStorage.getItem(SCHEDULED_CALENDAR_MODE_KEY));
    } catch {
      /* storage unavailable: week */
    }
  });

  function setMode(next: CalendarMode) {
    if (next === 'month') shownMonth = startOfMonth(shownWeek < bounds.min ? bounds.min : shownWeek);
    mode = next;
    try {
      localStorage.setItem(SCHEDULED_CALENDAR_MODE_KEY, next);
    } catch {
      /* not remembered */
    }
  }

  function page(direction: -1 | 1) {
    if (mode === 'week') {
      const next = addDays(shownWeek, 7 * direction);
      if (canShowWeek(next, bounds)) shownWeek = next;
    } else {
      const next = addMonths(shownMonth, direction);
      if (canShowMonth(next, bounds)) shownMonth = next;
    }
  }

  function goToday() {
    shownWeek = weekStart(bounds.today);
    shownMonth = startOfMonth(bounds.today);
    monthFocus = todayKey;
  }

  /** From the month: open that day's week and move focus to the day. */
  async function openDay(day: Date) {
    shownWeek = weekStart(day);
    // Looking into one day is not a change of preference: the remembered
    // view stays as the person set it.
    mode = 'week';
    await tick();
    const heading = rootEl?.querySelector<HTMLElement>(`[data-day-heading="${dayKey(day)}"]`);
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: 'nearest' });
  }

  // ── month grid keyboard: one tab stop, arrows move between days ─────

  /** The day that holds the grid's tab stop. */
  let monthFocus = dayKey(new Date(now * 1000));
  $: monthKeys = weeks.flat().map(dayKey);
  // Keep the tab stop on a day that is on screen and can be chosen.
  $: if (mode === 'month' && !monthKeys.includes(monthFocus)) {
    const first = weeks.flat().find((d) => d.getMonth() === shownMonth.getMonth() && inBounds(d, bounds));
    if (first) monthFocus = dayKey(first);
  }

  async function moveMonthFocus(from: Date, deltaDays: number) {
    const target = addDays(from, deltaDays);
    if (!inBounds(target, bounds)) return;
    if (target.getMonth() !== shownMonth.getMonth() || target.getFullYear() !== shownMonth.getFullYear()) {
      shownMonth = startOfMonth(target);
    }
    monthFocus = dayKey(target);
    await tick();
    rootEl?.querySelector<HTMLElement>(`[data-month-day="${monthFocus}"]`)?.focus();
  }

  function onMonthKey(event: KeyboardEvent, day: Date) {
    const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let move = delta[event.key];
    if (event.key === 'Home') move = -((day.getDay() + 6) % 7);
    if (event.key === 'End') move = 6 - ((day.getDay() + 6) % 7);
    if (move === undefined) return;
    event.preventDefault();
    if (move !== 0) void moveMonthFocus(day, move);
  }

  // ── a post's details ────────────────────────────────────────────────

  let openId: string | null = null;
  let detailOpen = false;
  $: openItem = openId ? (items.find((i) => i.id === openId) ?? null) : null;
  // The post was cancelled or rescheduled away: nothing left to show.
  $: if (detailOpen && openId && (!openItem || openItem.status === 'cancelled')) closeDetail();

  function openDetail(entry: CalendarEntry) {
    openId = entry.item.id;
    detailOpen = true;
  }
  function closeDetail() {
    detailOpen = false;
    openId = null;
  }

  /**
   * Reschedule and "Edit and post again" open the composer, which is a
   * dialog of its own. This one closes first: two stacked dialogs fight
   * over focus and Escape, and the composer must not open underneath.
   */
  function handOff(action: 'reschedule' | 'postAgain', item: ScheduledItem) {
    closeDetail();
    dispatch(action, item);
  }

  // ── wording ─────────────────────────────────────────────────────────

  const WEEKDAY = (d: Date, width: 'short' | 'long') => d.toLocaleDateString(undefined, { weekday: width });
  const FULL_DATE = (d: Date) =>
    d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  function chipText(entry: CalendarEntry): string {
    const preview = previewOf(entry.item.event);
    const line = firstLine(preview.text);
    if (preview.kind === 'Poll' || preview.kind === 'Zap poll') return line ? `${preview.kind}: ${line}` : preview.kind;
    if (line) return line;
    if (preview.image) return 'Photo';
    if (preview.hasVideo) return 'Video';
    return preview.kind;
  }

  function chipStatus(entry: CalendarEntry): string {
    if (entry.tone === 'failed') return 'Not sent';
    if (entry.tone === 'sent') return 'Posted';
    if (entry.tone === 'publishing') return 'Publishing now';
    return 'Scheduled';
  }
</script>

<div class="cal" bind:this={rootEl}>
  <div class="cal-bar">
    <div class="cal-nav">
      <button
        type="button"
        class="nav-btn"
        on:click={() => page(-1)}
        disabled={!canPrev}
        aria-label="Previous {step}"
      >
        <CaretLeftIcon size={18} weight="bold" />
      </button>
      <h2 class="cal-title" aria-live="polite">{title}</h2>
      <button type="button" class="nav-btn" on:click={() => page(1)} disabled={!canNext} aria-label="Next {step}">
        <CaretRightIcon size={18} weight="bold" />
      </button>
    </div>
    <div class="cal-tools">
      <button type="button" class="today-btn" on:click={goToday} disabled={onToday}>Today</button>
      <div class="seg" role="group" aria-label="Calendar view">
        <button type="button" class="seg-btn" aria-pressed={mode === 'week'} on:click={() => setMode('week')}>
          Week
        </button>
        <button type="button" class="seg-btn" aria-pressed={mode === 'month'} on:click={() => setMode('month')}>
          Month
        </button>
      </div>
    </div>
  </div>

  {#if mode === 'week'}
    <!-- Seven days: stacked as an agenda on a phone, columns at lg. -->
    <div class="grid gap-3 grid-cols-1 lg:grid-cols-7">
      {#each days as day (dayKey(day))}
        {@const key = dayKey(day)}
        {@const dayEntries = buckets.get(key) ?? []}
        {@const isToday = key === todayKey}
        {@const outside = !inBounds(day, bounds)}
        <section class="day" class:day--today={isToday} class:day--outside={outside} aria-labelledby="cal-day-{key}">
          <h3 id="cal-day-{key}" class="day-head" tabindex="-1" data-day-heading={key}>
            <span class="day-name">
              <span class="lg:hidden">{WEEKDAY(day, 'long')}</span>
              <span class="hidden lg:inline">{WEEKDAY(day, 'short')}</span>
            </span>
            <span class="day-date">
              {day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
            {#if isToday}<span class="day-today">Today</span>{/if}
          </h3>

          {#if dayEntries.length > 0}
            <ul class="chips">
              {#each dayEntries as entry (entry.item.id)}
                <li>
                  <button
                    type="button"
                    class="chip chip--{entry.tone}"
                    on:click={() => openDetail(entry)}
                    aria-label="{chipStatus(entry)}, {entryTime(entry.at)}: {chipText(entry)}. Open details"
                  >
                    <span class="chip-time">
                      {#if entry.tone === 'failed'}
                        <WarningIcon size={14} weight="fill" class="flex-shrink-0" />
                      {:else if entry.tone === 'sent'}
                        <CheckIcon size={14} weight="bold" class="flex-shrink-0" />
                      {/if}
                      {entryTime(entry.at)}
                      {#if entry.tone !== 'pending'}
                        <span class="chip-status">{chipStatus(entry)}</span>
                      {/if}
                    </span>
                    <span class="chip-text">{chipText(entry)}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="day-empty">{outside ? 'Outside the calendar' : 'Nothing scheduled'}</p>
          {/if}
        </section>
      {/each}
    </div>
  {:else}
    <div class="month" role="grid" aria-label={title}>
      <div class="month-row" role="row">
        {#each weeks[0] as day}
          <div class="month-weekday" role="columnheader" aria-label={WEEKDAY(day, 'long')}>
            {WEEKDAY(day, 'short')}
          </div>
        {/each}
      </div>
      {#each weeks as week}
        <div class="month-row" role="row">
          {#each week as day (dayKey(day))}
            {@const key = dayKey(day)}
            {@const counts = countDay(buckets.get(key))}
            {@const summary = describeCounts(counts)}
            {@const isToday = key === todayKey}
            {@const outside = !inBounds(day, bounds)}
            <div role="gridcell" class="month-cell">
              <button
                type="button"
                class="month-day"
                class:month-day--today={isToday}
                class:month-day--other={day.getMonth() !== shownMonth.getMonth()}
                disabled={outside}
                tabindex={key === monthFocus ? 0 : -1}
                data-month-day={key}
                aria-label="{FULL_DATE(day)}{isToday ? ', today' : ''}{summary ? `, ${summary}` : ', nothing scheduled'}"
                aria-current={isToday ? 'date' : undefined}
                on:click={() => openDay(day)}
                on:keydown={(e) => onMonthKey(e, day)}
                on:focus={() => (monthFocus = key)}
              >
                <span class="month-num">{day.getDate()}</span>
                <span class="month-counts" aria-hidden="true">
                  {#if counts.upcoming > 0}<span class="count count--upcoming">{counts.upcoming}</span>{/if}
                  {#if counts.failed > 0}
                    <span class="count count--failed"><WarningIcon size={11} weight="fill" />{counts.failed}</span>
                  {/if}
                  {#if counts.sent > 0}
                    <span class="count count--sent"><CheckIcon size={11} weight="bold" />{counts.sent}</span>
                  {/if}
                </span>
              </button>
            </div>
          {/each}
        </div>
      {/each}
    </div>
  {/if}

  <ul class="legend" aria-label="Key">
    <li><span class="dot dot--upcoming"></span>Scheduled</li>
    <li><WarningIcon size={13} weight="fill" class="legend-failed" />Not sent</li>
    <li><CheckIcon size={13} weight="bold" />Posted, last 30 days</li>
  </ul>

  {#if truncated}
    <p class="cal-note" role="note">
      You have more scheduled-post history than fits here, so some older posts aren't shown. Everything
      still waiting to go out is.
    </p>
  {/if}
</div>

<Modal bind:open={detailOpen} cleanup={closeDetail} compact autoHeight>
  <svelte:fragment slot="title">
    {#if openItem}
      {openItem.status === 'failed'
        ? 'Not sent'
        : openItem.status === 'sent'
          ? 'Posted'
          : 'Scheduled post'}
    {/if}
  </svelte:fragment>
  {#if openItem}
    <ScheduledPostCard
      item={openItem}
      {now}
      busy={busy[openItem.id]}
      notice={notices[openItem.id] ?? ''}
      on:cancel={(e) => dispatch('cancel', e.detail)}
      on:reschedule={(e) => handOff('reschedule', e.detail)}
      on:postAgain={(e) => handOff('postAgain', e.detail)}
    />
  {/if}
</Modal>

<style>
  .cal {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
  }
  .cal-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .cal-nav {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .cal-title {
    min-width: 9.5rem;
    text-align: center;
    font-size: 1.0625rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .nav-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 9999px;
    color: var(--color-text-primary);
  }
  .nav-btn:hover:not(:disabled) {
    background: var(--color-hover-bg);
  }
  .nav-btn:disabled,
  .today-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .cal-tools {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .today-btn {
    padding: 0.375rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 600;
    border-radius: 9999px;
    color: var(--color-text-primary);
    border: 1px solid var(--color-input-border);
  }
  .today-btn:hover:not(:disabled) {
    background: var(--color-hover-bg);
  }
  .seg {
    display: inline-flex;
    padding: 0.125rem;
    border-radius: 9999px;
    border: 1px solid var(--color-input-border);
    background: var(--color-input-bg);
  }
  .seg-btn {
    padding: 0.25rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 600;
    border-radius: 9999px;
    color: var(--color-text-secondary);
  }
  .seg-btn[aria-pressed='true'] {
    color: var(--color-on-action, #fff);
    background: var(--color-action);
  }

  /* ── week / agenda ── */
  .day {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
    padding: 0.75rem;
    border-radius: 1rem;
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
    scroll-margin-top: 5rem;
  }
  .day--today {
    border-color: rgb(249 115 22 / 0.6);
    box-shadow: 0 0 0 1px rgb(249 115 22 / 0.35);
  }
  .day--outside {
    opacity: 0.45;
  }
  .day-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.125rem 0.5rem;
    font-size: 0.875rem;
    outline-offset: 4px;
  }
  .day-name {
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .day-date {
    font-size: 0.75rem;
    color: var(--color-caption);
  }
  .day-today {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-primary);
  }
  .day-empty {
    font-size: 0.8125rem;
    color: var(--color-caption);
  }
  .chips {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .chip {
    display: flex;
    align-items: baseline;
    gap: 0.625rem;
    width: 100%;
    min-width: 0;
    padding: 0.5rem 0.625rem;
    text-align: left;
    border-radius: 0.75rem;
    background: var(--color-bg-primary);
    border: 1px solid var(--color-input-border);
    border-left: 3px solid var(--color-primary);
  }
  .chip:hover {
    border-color: var(--color-primary);
  }
  .chip-time {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
    font-size: 0.8125rem;
    font-weight: 700;
    white-space: nowrap;
    color: var(--color-text-primary);
  }
  .chip-status {
    font-weight: 600;
  }
  .chip-text {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.875rem;
    color: var(--color-text-primary);
  }
  .chip--failed {
    border-left-color: #ef4444;
  }
  .chip--failed .chip-time {
    color: #ef4444;
  }
  .chip--sent {
    border-left-color: var(--color-input-border);
    background: transparent;
  }
  .chip--sent .chip-time,
  .chip--sent .chip-text {
    font-weight: 500;
    color: var(--color-caption);
  }
  @media (min-width: 1024px) {
    .day {
      min-height: 11rem;
    }
    .day-head {
      flex-direction: column;
      gap: 0;
    }
    .chip {
      flex-direction: column;
      gap: 0.125rem;
      padding: 0.375rem 0.5rem;
    }
    .chip-time {
      flex-wrap: wrap;
      white-space: normal;
    }
    /* A column is narrow: give the preview two lines there. */
    .chip-text {
      width: 100%;
      flex: none;
      font-size: 0.8125rem;
      white-space: normal;
      overflow-wrap: anywhere;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      -webkit-box-orient: vertical;
    }
  }

  /* ── month ── */
  .month {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .month-row {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 0.25rem;
  }
  .month-weekday {
    padding-bottom: 0.125rem;
    text-align: center;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-caption);
  }
  .month-cell {
    min-width: 0;
  }
  .month-day {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.125rem;
    width: 100%;
    min-height: 3.5rem;
    padding: 0.3125rem 0.125rem;
    border-radius: 0.625rem;
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
    color: var(--color-text-primary);
  }
  .month-day:hover:not(:disabled) {
    border-color: var(--color-primary);
  }
  .month-day:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .month-day--other .month-num {
    color: var(--color-caption);
  }
  .month-day--today {
    border-color: rgb(249 115 22 / 0.6);
    box-shadow: 0 0 0 1px rgb(249 115 22 / 0.35);
  }
  .month-day--today .month-num {
    font-weight: 700;
    color: var(--color-primary);
  }
  .month-num {
    font-size: 0.8125rem;
    font-weight: 600;
    line-height: 1.1;
  }
  .month-counts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 0.125rem 0.25rem;
  }
  .count {
    display: inline-flex;
    align-items: center;
    gap: 0.0625rem;
    font-size: 0.6875rem;
    font-weight: 700;
    line-height: 1;
  }
  .count--upcoming {
    min-width: 1.125rem;
    justify-content: center;
    padding: 0.1875rem 0.3125rem;
    border-radius: 9999px;
    color: var(--color-on-action, #fff);
    background: var(--color-action);
  }
  .count--failed {
    color: #ef4444;
  }
  .count--sent {
    font-weight: 600;
    color: var(--color-caption);
  }
  @media (min-width: 1024px) {
    .month-day {
      min-height: 4.75rem;
      align-items: flex-start;
      padding: 0.5rem 0.625rem;
    }
    .month-counts {
      justify-content: flex-start;
      gap: 0.25rem 0.5rem;
    }
    .count {
      font-size: 0.75rem;
    }
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    font-size: 0.75rem;
    color: var(--color-caption);
  }
  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 0.3125rem;
  }
  .legend :global(.legend-failed) {
    color: #ef4444;
  }
  .dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 9999px;
  }
  .dot--upcoming {
    background: var(--color-action);
  }
  .cal-note {
    padding: 0.5rem 0.75rem;
    font-size: 0.8125rem;
    border-radius: 0.5rem;
    color: var(--color-text-secondary);
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
  }
</style>
