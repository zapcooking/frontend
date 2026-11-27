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
  import { pickedTimeProblem } from '$lib/composerSchedule';
  import { layoutDay, pickerStartFor, type DayRow, type PostingTimes } from '$lib/postingSlots';
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
    sameTimeOn,
    shortTime,
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
  import PlusIcon from 'phosphor-svelte/lib/Plus';
  import ClockIcon from 'phosphor-svelte/lib/Clock';

  export let items: ScheduledItem[];
  /** Unix seconds. */
  export let now: number;
  /** The server cut the list at its cap: some older history is missing. */
  export let truncated = false;
  /** The person's posting times: each day offers them as slots. */
  export let times: PostingTimes;
  /** No room for another post (the account's limit on pending posts): empty slots cannot be used. */
  export let full = false;
  export let busy: Record<string, boolean> = {};
  export let notices: Record<string, string> = {};

  const dispatch = createEventDispatcher<{
    cancel: ScheduledItem;
    reschedule: ScheduledItem;
    postAgain: ScheduledItem;
    /** Ask to move a post: `to` is a time already chosen (a drag), or null to pick one. Nothing is moved yet. */
    move: { item: ScheduledItem; to: number | null };
    /**
     * Write a new post: `publishAt` when an empty slot was chosen (the
     * time is set), `pickerAt` when a day was (the picker opens there).
     */
    create: { publishAt: number | null; pickerAt: number | null };
    editTimes: void;
  }>();

  const FULL_COPY = 'You have the most posts scheduled that you can. Cancel one, or wait for one to go out.';

  /** A day's "+", or its empty space: a post on that day at a time the person picks. */
  function createOn(day: Date) {
    dispatch('create', { publishAt: null, pickerAt: pickerStartFor(day, Math.floor(Date.now() / 1000)) });
  }

  let mode: CalendarMode = 'week';
  let rootEl: HTMLElement;

  /** In a month cell: how many posts are listed before "+N more", and how many marks a phone cell shows. */
  const MONTH_LINES = 3;
  const MONTH_MARKS = 6;
  const isPostRow = (row: DayRow): row is Extract<DayRow, { type: 'post' }> => row.type === 'post';
  const isOpenRow = (row: DayRow): row is Extract<DayRow, { type: 'open' }> => row.type === 'open';

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
    void bringTodayIntoView();
  });

  const isAgenda = () => typeof window !== 'undefined' && !window.matchMedia('(min-width: 1024px)').matches;

  /**
   * On arrival in the phone agenda, today can be several days down the
   * week, below the fold behind days that are over. Bring it up once.
   * Only then: at desktop width the whole week is on screen, and after
   * arrival the page is left where the person put it.
   */
  async function bringTodayIntoView() {
    await tick();
    if (mode !== 'week' || !isAgenda()) return;
    const today = rootEl?.querySelector<HTMLElement>('.day--today');
    if (!today) return;
    const top = today.getBoundingClientRect().top;
    if (top > window.innerHeight * 0.45) today.scrollIntoView({ block: 'start' });
  }

  /**
   * After paging, if the calendar's own controls have scrolled off the
   * top, bring them back: otherwise a phone shows the middle of the new
   * week (or month) with nothing to say which one it is.
   */
  async function keepBarInView() {
    await tick();
    if (rootEl && rootEl.getBoundingClientRect().top < 0) rootEl.scrollIntoView({ block: 'start' });
  }

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
    void keepBarInView();
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

  function handOffMove(item: ScheduledItem) {
    closeDetail();
    dispatch('move', { item, to: null });
  }

  // ── dragging a post to another day (desktop) ────────────────────────
  // A drag only ASKS for a move: dropping opens the same confirmation as
  // "Move" in a post's details, with the new time filled in, and nothing
  // is signed until that is confirmed. "Move" is always there for anyone
  // not using a mouse.

  let dragged: CalendarEntry | null = null;
  let dropDay: string | null = null;

  /** Where a dragged post would land on `day`, or null if it cannot go there. */
  function dropTarget(entry: CalendarEntry | null, day: Date): number | null {
    if (!entry || entry.day === dayKey(day) || !inBounds(day, bounds)) return null;
    const to = sameTimeOn(day, entry.at);
    return pickedTimeProblem(to, Math.floor(Date.now() / 1000)) ? null : to;
  }

  function onDragStart(event: DragEvent, entry: CalendarEntry) {
    if (entry.tone !== 'pending' || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    dragged = entry;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', entry.item.id);
  }

  function onDragOver(event: DragEvent, day: Date) {
    if (dropTarget(dragged, day) === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dropDay = dayKey(day);
  }

  function onDrop(event: DragEvent, day: Date) {
    const to = dropTarget(dragged, day);
    const entry = dragged;
    endDrag();
    if (to === null || !entry) return;
    event.preventDefault();
    dispatch('move', { item: entry.item, to });
  }

  function endDrag() {
    dragged = null;
    dropDay = null;
    dropSlot = null;
  }

  // Dropped on an EMPTY SLOT, a post goes to that slot's time, on the
  // same day or another. Dropped anywhere else in a day it keeps its own
  // time of day (above).
  let dropSlot: number | null = null;

  const canDropOnSlot = (at: number, usable: boolean) => !!dragged && usable && at !== dragged.at;

  function onSlotDragOver(event: DragEvent, at: number, usable: boolean) {
    if (!canDropOnSlot(at, usable)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dropSlot = at;
    dropDay = null;
  }

  function onSlotDrop(event: DragEvent, at: number, usable: boolean) {
    if (!canDropOnSlot(at, usable)) return;
    const entry = dragged;
    event.preventDefault();
    event.stopPropagation();
    endDrag();
    if (entry) dispatch('move', { item: entry.item, to: at });
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
      <!-- Only once paged away: on the current week or month it would do nothing. -->
      {#if !onToday}
        <button type="button" class="today-btn" on:click={goToday}>
          {mode === 'week' ? 'This week' : 'This month'}
        </button>
      {/if}
    </div>
    <div class="cal-tools">
      <button type="button" class="times-btn" on:click={() => dispatch('editTimes')} title="Edit posting times">
        <ClockIcon size={16} />
        <span>Posting times</span>
      </button>
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
        {@const canAdd = !outside && key >= todayKey && !full}
        {@const rows = layoutDay(day, dayEntries, times, now, { emptySlots: !outside && key >= todayKey })}
        <section
          class="day"
          class:day--dense={rows.length > 4}
          class:day--today={isToday}
          class:day--outside={outside}
          class:day--drop={dropDay === key}
          aria-labelledby="cal-day-{key}"
          on:dragover={(e) => onDragOver(e, day)}
          on:dragleave={() => {
            if (dropDay === key) dropDay = null;
          }}
          on:drop={(e) => onDrop(e, day)}
        >
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

          {#if canAdd}
            <button
              type="button"
              class="day-add"
              on:click={() => createOn(day)}
              aria-label="Schedule a post on {FULL_DATE(day)} at a time you pick"
              title="Schedule a post on this day at another time"
            >
              <PlusIcon size={14} weight="bold" />
            </button>
          {/if}

          {#if rows.length > 0}
            <ul class="chips">
              {#each rows as row (row.type === 'post' ? row.entry.item.id : `slot-${row.at}`)}
                <li>
                  {#if row.type === 'post'}
                    {@const entry = row.entry}
                    <button
                      type="button"
                      class="chip chip--{entry.tone}"
                      class:chip--own={row.slot === null}
                      class:chip--dragging={dragged?.item.id === entry.item.id}
                      draggable={entry.tone === 'pending'}
                      on:dragstart={(e) => onDragStart(e, entry)}
                      on:dragend={endDrag}
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
                  {:else}
                    {@const usable = row.usable && !full}
                    <!-- An empty slot: a place to put a post, and a place to drop one. -->
                    <button
                      type="button"
                      class="slot"
                      class:slot--drop={dropSlot === row.at}
                      disabled={!usable}
                      data-slot={row.at}
                      on:click={() => dispatch('create', { publishAt: row.at, pickerAt: null })}
                      on:dragover={(e) => onSlotDragOver(e, row.at, row.usable)}
                      on:dragleave={() => {
                        if (dropSlot === row.at) dropSlot = null;
                      }}
                      on:drop={(e) => onSlotDrop(e, row.at, row.usable)}
                      aria-label={usable
                        ? `Empty slot, ${entryTime(row.at)} on ${FULL_DATE(day)}. Schedule a post`
                        : `Empty slot, ${entryTime(row.at)}. ${full && row.usable ? FULL_COPY : 'This time has passed or is too close'}`}
                      title={full && row.usable ? FULL_COPY : undefined}
                    >
                      <span class="slot-time">{entryTime(row.at)}</span>
                      {#if usable}
                        <span class="slot-add"><PlusIcon size={12} weight="bold" /><span class="slot-add-text">Add a post</span></span>
                      {/if}
                    </button>
                  {/if}
                </li>
              {/each}
            </ul>
          {:else}
            <p class="day-empty">{outside ? 'Outside the calendar' : 'Nothing scheduled'}</p>
          {/if}
          {#if canAdd}
            <!-- The rest of the day: a mouse shortcut for the "+" above, which is the real control. -->
            <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
            <div class="day-space" on:click={() => createOn(day)}></div>
          {/if}
        </section>
      {/each}
    </div>
  {:else}
    <!--
      The month, for planning. One cell per day:
        - the day number is a button (opens that day's week) and is the
          cell the arrow keys move between;
        - at desktop width the day's posts are listed as short lines, then
          "+N more", then its empty slots as faint markers;
        - on a phone there is no room for text, so the button carries one
          mark per slot and post instead (see the key under the grid).
      Lines and markers of the day that holds the grid's tab stop are in
      the tab order, so Tab goes from a day into what is on it.
    -->
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
            {@const dayEntries = buckets.get(key) ?? []}
            {@const counts = countDay(dayEntries)}
            {@const summary = describeCounts(counts)}
            {@const isToday = key === todayKey}
            {@const outside = !inBounds(day, bounds)}
            {@const rows = outside ? [] : layoutDay(day, dayEntries, times, now, { emptySlots: key >= todayKey })}
            {@const posts = rows.filter(isPostRow)}
            {@const openSlots = rows.filter(isOpenRow).filter((r) => r.usable)}
            {@const inTabOrder = key === monthFocus ? 0 : -1}
            <!-- svelte-ignore a11y-interactive-supports-focus -->
            <div
              role="gridcell"
              class="month-cell"
              class:month-cell--today={isToday}
              class:month-cell--other={day.getMonth() !== shownMonth.getMonth()}
              class:month-cell--outside={outside}
              class:month-cell--drop={dropDay === key}
              on:dragover={(e) => onDragOver(e, day)}
              on:dragleave={() => {
                if (dropDay === key) dropDay = null;
              }}
              on:drop={(e) => onDrop(e, day)}
            >
              <button
                type="button"
                class="month-day"
                disabled={outside}
                tabindex={key === monthFocus ? 0 : -1}
                data-month-day={key}
                aria-label="{FULL_DATE(day)}{isToday ? ', today' : ''}{summary ? `, ${summary}` : ', nothing scheduled'}{openSlots.length
                  ? `, ${openSlots.length} open ${openSlots.length === 1 ? 'slot' : 'slots'}`
                  : ''}. Open this day"
                aria-current={isToday ? 'date' : undefined}
                on:click={() => openDay(day)}
                on:keydown={(e) => onMonthKey(e, day)}
                on:focus={() => (monthFocus = key)}
              >
                <span class="month-num">{day.getDate()}</span>
                <span class="month-marks" aria-hidden="true">
                  {#each rows.slice(0, MONTH_MARKS) as row}
                    {#if row.type === 'open'}
                      {#if row.usable}<span class="mark mark--open"></span>{/if}
                    {:else if row.entry.tone === 'failed'}
                      <span class="mark mark--failed"><WarningIcon size={9} weight="fill" /></span>
                    {:else}
                      <span
                        class="mark mark--post"
                        class:mark--own={row.slot === null}
                        class:mark--sent={row.entry.tone === 'sent'}
                      ></span>
                    {/if}
                  {/each}
                  {#if rows.length > MONTH_MARKS}<span class="mark-more">+</span>{/if}
                </span>
              </button>

              {#if posts.length > 0 || openSlots.length > 0}
                <ul class="month-lines">
                  {#each posts.slice(0, MONTH_LINES) as row (row.entry.item.id)}
                    {@const entry = row.entry}
                    <li>
                      <button
                        type="button"
                        class="mline mline--{entry.tone}"
                        class:mline--own={row.slot === null}
                        class:chip--dragging={dragged?.item.id === entry.item.id}
                        tabindex={inTabOrder}
                        draggable={entry.tone === 'pending'}
                        on:dragstart={(e) => onDragStart(e, entry)}
                        on:dragend={endDrag}
                        on:click={() => openDetail(entry)}
                        aria-label="{chipStatus(entry)}, {entryTime(entry.at)}: {chipText(entry)}. Open details"
                      >
                        {#if entry.tone === 'failed'}
                          <WarningIcon size={11} weight="fill" class="flex-shrink-0" />
                        {:else if entry.tone === 'sent'}
                          <CheckIcon size={11} weight="bold" class="flex-shrink-0" />
                        {/if}
                        <span class="mline-time">{shortTime(entry.at)}</span>
                        <span class="mline-text">{chipText(entry)}</span>
                      </button>
                    </li>
                  {/each}
                  {#if posts.length > MONTH_LINES}
                    <li>
                      <button type="button" class="month-more" tabindex={inTabOrder} on:click={() => openDay(day)}>
                        +{posts.length - MONTH_LINES} more
                      </button>
                    </li>
                  {/if}
                  {#if openSlots.length > 0}
                    <li class="mslots">
                      {#each openSlots as row (row.at)}
                        <button
                          type="button"
                          class="mslot"
                          class:slot--drop={dropSlot === row.at}
                          disabled={full}
                          tabindex={inTabOrder}
                          data-slot={row.at}
                          on:click={() => dispatch('create', { publishAt: row.at, pickerAt: null })}
                          on:dragover={(e) => onSlotDragOver(e, row.at, row.usable)}
                          on:dragleave={() => {
                            if (dropSlot === row.at) dropSlot = null;
                          }}
                          on:drop={(e) => onSlotDrop(e, row.at, row.usable)}
                          aria-label={full
                            ? `Empty slot, ${entryTime(row.at)}. ${FULL_COPY}`
                            : `Empty slot, ${entryTime(row.at)} on ${FULL_DATE(day)}. Schedule a post`}
                          title={full ? FULL_COPY : `Schedule a post for ${entryTime(row.at)}`}
                        >
                          {shortTime(row.at)}
                        </button>
                      {/each}
                    </li>
                  {/if}
                </ul>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    </div>
  {/if}

  <p class="sr-only">
    To move a post to another time, open it and choose Move. To write a post for an empty slot, choose
    the slot.
  </p>

  <ul class="legend" aria-label="Key">
    <li><span class="dot dot--upcoming"></span>Scheduled</li>
    <li><span class="dot dot--upcoming dot--own"></span>At a time of its own</li>
    <li><span class="dot dot--slot"></span>Empty slot</li>
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
      on:move={(e) => handOffMove(e.detail)}
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
    scroll-margin-top: 5rem;
    /* Room to scroll the last rows clear of the floating compose button. */
    padding-bottom: 5rem;
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
  .nav-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .cal-tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .times-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 600;
    border-radius: 9999px;
    color: var(--color-text-primary);
    border: 1px solid var(--color-input-border);
  }
  .times-btn:hover {
    background: var(--color-hover-bg);
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
  .day {
    position: relative;
  }
  .day-add {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 9999px;
    color: var(--color-text-secondary);
    border: 1px solid var(--color-input-border);
    background: var(--color-bg-primary);
  }
  .day-add:hover {
    color: var(--color-primary);
    border-color: var(--color-primary);
  }
  .day-head {
    padding-right: 2rem;
  }
  .day-space {
    flex: 1;
    min-height: 0.5rem;
    cursor: pointer;
  }
  .slot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    width: 100%;
    min-width: 0;
    padding: 0.4375rem 0.625rem;
    text-align: left;
    border-radius: 0.75rem;
    color: var(--color-text-secondary);
    border: 1px dashed var(--color-input-border);
  }
  .slot:hover:not(:disabled) {
    color: var(--color-primary);
    border-color: var(--color-primary);
    background: var(--color-bg-primary);
  }
  .slot:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .slot--drop {
    color: var(--color-primary);
    border-style: solid;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 1px var(--color-primary);
    background: var(--color-bg-primary);
  }
  .slot-time {
    font-size: 0.8125rem;
    font-weight: 600;
    white-space: nowrap;
  }
  /* Phone: the label follows the time, on the left, clear of the
     floating compose button at the right edge. */
  @media (max-width: 1023px) {
    .slot {
      justify-content: flex-start;
      gap: 0.875rem;
    }
  }
  .slot-add {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.8125rem;
    font-weight: 600;
  }
  @media (min-width: 1024px) {
    .slot {
      padding: 0.3125rem 0.5rem;
    }
    .slot-add-text {
      display: none;
    }
  }
  .day--today {
    border-color: rgb(249 115 22 / 0.6);
    box-shadow: 0 0 0 1px rgb(249 115 22 / 0.35);
  }
  .day--outside {
    opacity: 0.45;
  }
  .day--drop {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px var(--color-primary);
  }
  .chip[draggable='true'] {
    cursor: grab;
  }
  .chip--dragging {
    opacity: 0.4;
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
  /* A post at a time of its own, not in a slot: a dotted edge. */
  .chip--own {
    border-left-style: dotted;
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

  @media (min-width: 1024px) {
    .cal {
      padding-bottom: 0;
    }
    /* A long day: one line of text per post, and tighter rows, so the
       column stays readable instead of running off the screen. */
    .day--dense .chip {
      padding: 0.25rem 0.5rem;
    }
    .day--dense .chip-text {
      -webkit-line-clamp: 1;
      line-clamp: 1;
    }
    .day--dense .chips {
      gap: 0.25rem;
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
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    min-height: 3.5rem;
    border-radius: 0.625rem;
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
  }
  .month-cell--today {
    border-color: rgb(249 115 22 / 0.6);
    box-shadow: 0 0 0 1px rgb(249 115 22 / 0.35);
  }
  .month-cell--outside {
    opacity: 0.35;
  }
  .month-cell--drop {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px var(--color-primary);
  }
  /* Phone: the day button is the whole cell. */
  .month-day {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    gap: 0.1875rem;
    width: 100%;
    padding: 0.3125rem 0.125rem;
    border-radius: 0.625rem;
    color: var(--color-text-primary);
  }
  .month-day:disabled {
    cursor: default;
  }
  .month-num {
    font-size: 0.8125rem;
    font-weight: 600;
    line-height: 1.1;
  }
  .month-cell--other .month-num {
    color: var(--color-caption);
  }
  .month-cell--today .month-num {
    font-weight: 700;
    color: var(--color-primary);
  }
  .month-marks {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 0.1875rem;
    max-width: 2.75rem;
  }
  .mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 0.4375rem;
    height: 0.4375rem;
    border-radius: 9999px;
  }
  .mark--post {
    background: var(--color-action);
  }
  /* A post at a time of its own: a diamond. */
  .mark--own {
    border-radius: 1px;
    transform: rotate(45deg) scale(0.9);
  }
  .mark--sent {
    background: var(--color-caption);
    opacity: 0.7;
  }
  .mark--open {
    border: 1px solid var(--color-caption);
  }
  .mark--failed {
    width: 0.5625rem;
    height: 0.5625rem;
    color: #ef4444;
  }
  .mark-more {
    font-size: 0.625rem;
    font-weight: 700;
    line-height: 1;
    color: var(--color-caption);
  }
  .month-lines {
    display: none;
  }
  @media (min-width: 1024px) {
    .month-cell {
      min-height: 7.25rem;
      padding: 0.25rem;
    }
    .month-day {
      flex: none;
      align-items: flex-start;
      width: auto;
      align-self: flex-start;
      padding: 0.125rem 0.375rem;
      border-radius: 0.375rem;
    }
    .month-day:hover:not(:disabled) {
      background: var(--color-hover-bg);
    }
    /* The lines say it all at this width. */
    .month-marks {
      display: none;
    }
    .month-lines {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      min-width: 0;
    }
    .mline {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      width: 100%;
      min-width: 0;
      padding: 0.125rem 0.3125rem;
      text-align: left;
      font-size: 0.75rem;
      line-height: 1.25;
      border-radius: 0.3125rem;
      color: var(--color-text-primary);
      background: var(--color-bg-primary);
      border-left: 3px solid var(--color-primary);
    }
    .mline:hover {
      outline: 1px solid var(--color-primary);
    }
    .mline[draggable='true'] {
      cursor: grab;
    }
    .mline-time {
      flex-shrink: 0;
      font-weight: 700;
      white-space: nowrap;
    }
    .mline-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mline--own {
      border-left-style: dotted;
    }
    .mline--failed {
      border-left-color: #ef4444;
      color: #ef4444;
    }
    .mline--failed .mline-text {
      color: var(--color-text-primary);
    }
    .mline--sent {
      border-left-color: var(--color-input-border);
      background: transparent;
      color: var(--color-caption);
    }
    .month-more {
      padding: 0 0.3125rem;
      font-size: 0.6875rem;
      font-weight: 600;
      color: var(--color-primary);
    }
    .month-more:hover {
      text-decoration: underline;
    }
    .mslots {
      display: flex;
      flex-wrap: wrap;
      gap: 0.1875rem;
      margin-top: 0.0625rem;
    }
    .mslot {
      padding: 0.0625rem 0.3125rem;
      font-size: 0.6875rem;
      font-weight: 600;
      line-height: 1.3;
      white-space: nowrap;
      border-radius: 0.3125rem;
      color: var(--color-caption);
      border: 1px dashed var(--color-input-border);
    }
    .mslot:hover:not(:disabled) {
      color: var(--color-primary);
      border-color: var(--color-primary);
      background: var(--color-bg-primary);
    }
    .mslot:disabled {
      opacity: 0.45;
      cursor: default;
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
  .dot--slot {
    border: 1px solid var(--color-caption);
  }
  .dot--own {
    border-radius: 1px;
    transform: rotate(45deg) scale(0.85);
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
