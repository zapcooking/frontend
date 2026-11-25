<script lang="ts">
  /**
   * "Posting times": the times of day the calendar offers as slots, set
   * once, weekdays and weekends separately ($lib/postingSlots). Saved on
   * this device. Changing them moves no post: they only decide where the
   * empty slots are.
   */
  import { createEventDispatcher } from 'svelte';
  import {
    DEFAULT_POSTING_TIMES,
    MAX_SLOTS_PER_DAY,
    fromTimeInputValue,
    normalizeTimes,
    slotLabel,
    toTimeInputValue,
    type PostingTimes
  } from '$lib/postingSlots';
  import Modal from '../Modal.svelte';
  import PlusIcon from 'phosphor-svelte/lib/Plus';
  import XIcon from 'phosphor-svelte/lib/X';

  export let open = false;
  export let times: PostingTimes;

  const dispatch = createEventDispatcher<{ save: PostingTimes }>();

  type Group = 'weekdays' | 'weekends';
  const GROUPS: { key: Group; title: string; hint: string }[] = [
    { key: 'weekdays', title: 'Weekdays', hint: 'Monday to Friday' },
    { key: 'weekends', title: 'Weekends', hint: 'Saturday and Sunday' }
  ];

  /** The fields as typed: `HH:mm` strings, so a half-typed time is not lost. */
  let draft: Record<Group, string[]> = { weekdays: [], weekends: [] };
  // Start from the saved times each time the dialog opens. One block, so
  // the "already started" flag is read and written in a fixed order.
  let started = false;
  $: if (!open) {
    started = false;
  } else if (!started) {
    started = true;
    draft = { weekdays: times.weekdays.map(toTimeInputValue), weekends: times.weekends.map(toTimeInputValue) };
  }

  const parsed = (values: string[]) => values.map(fromTimeInputValue);
  $: problems = {
    weekdays: problemOf(draft.weekdays),
    weekends: problemOf(draft.weekends)
  };

  function problemOf(values: string[]): string {
    const minutes = parsed(values);
    if (minutes.some((m) => m === null)) return 'Fill in or remove the empty time.';
    if (new Set(minutes).size !== minutes.length) return 'The same time is listed twice.';
    return '';
  }

  function add(group: Group) {
    if (draft[group].length >= MAX_SLOTS_PER_DAY) return;
    // Two hours after the last one, or 9:00 for the first.
    const known = parsed(draft[group]).filter((m): m is number => m !== null);
    const next = known.length ? Math.min(Math.max(...known) + 120, 23 * 60 + 45) : 9 * 60;
    draft = { ...draft, [group]: [...draft[group], toTimeInputValue(next)] };
  }

  function remove(group: Group, index: number) {
    draft = { ...draft, [group]: draft[group].filter((_, i) => i !== index) };
  }

  function reset() {
    draft = {
      weekdays: DEFAULT_POSTING_TIMES.weekdays.map(toTimeInputValue),
      weekends: DEFAULT_POSTING_TIMES.weekends.map(toTimeInputValue)
    };
  }

  function save() {
    if (problems.weekdays || problems.weekends) return;
    dispatch('save', {
      weekdays: normalizeTimes(parsed(draft.weekdays)),
      weekends: normalizeTimes(parsed(draft.weekends))
    });
    open = false;
  }

  const describe = (value: string) => {
    const m = fromTimeInputValue(value);
    return m === null ? 'empty time' : slotLabel(m);
  };
</script>

<Modal bind:open compact autoHeight>
  <svelte:fragment slot="title">Posting times</svelte:fragment>
  <div class="pt">
    <p class="pt-intro">
      The times you usually post. Each day of the calendar offers them as slots to fill. Changing them
      doesn't move any post you have already scheduled.
    </p>

    {#each GROUPS as group (group.key)}
      <fieldset class="pt-group">
        <legend class="pt-legend">
          {group.title} <span class="pt-legend-hint">{group.hint}</span>
        </legend>
        {#if draft[group.key].length === 0}
          <p class="pt-none">No slots on these days.</p>
        {/if}
        <ul class="pt-list">
          {#each draft[group.key] as value, i}
            <li class="pt-row">
              <input
                class="pt-input"
                type="time"
                bind:value={draft[group.key][i]}
                aria-label="{group.title} posting time {i + 1}"
              />
              <button
                type="button"
                class="pt-remove"
                on:click={() => remove(group.key, i)}
                aria-label="Remove {describe(value)} from {group.title.toLowerCase()}"
                title="Remove"
              >
                <XIcon size={16} />
              </button>
            </li>
          {/each}
        </ul>
        {#if problems[group.key]}
          <p class="pt-problem" role="alert">{problems[group.key]}</p>
        {/if}
        <button
          type="button"
          class="pt-add"
          on:click={() => add(group.key)}
          disabled={draft[group.key].length >= MAX_SLOTS_PER_DAY}
        >
          <PlusIcon size={14} weight="bold" />
          Add a time
        </button>
        {#if draft[group.key].length >= MAX_SLOTS_PER_DAY}
          <span class="pt-max">{MAX_SLOTS_PER_DAY} is the most.</span>
        {/if}
      </fieldset>
    {/each}

    <p class="pt-note">
      Times are in your local time and are saved on this device only.
    </p>

    <div class="pt-actions">
      <button type="button" class="pt-reset" on:click={reset}>Use the defaults</button>
      <button type="button" class="pt-save" on:click={save} disabled={!!problems.weekdays || !!problems.weekends}>
        Save
      </button>
    </div>
  </div>
</Modal>

<style>
  .pt {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
  }
  .pt-intro,
  .pt-note,
  .pt-none,
  .pt-max {
    font-size: 0.8125rem;
    color: var(--color-caption);
  }
  .pt-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    border-radius: 0.75rem;
    border: 1px solid var(--color-input-border);
    background: var(--color-input-bg);
  }
  .pt-legend {
    padding: 0 0.25rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .pt-legend-hint {
    margin-left: 0.25rem;
    font-size: 0.75rem;
    font-weight: 400;
    color: var(--color-caption);
  }
  .pt-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .pt-row {
    display: inline-flex;
    align-items: center;
    gap: 0.125rem;
    padding-right: 0.125rem;
    border-radius: 0.5rem;
    background: var(--color-bg-primary);
    border: 1px solid var(--color-input-border);
  }
  .pt-input {
    padding: 0.375rem 0.25rem 0.375rem 0.5rem;
    font-size: 1rem;
    border-radius: 0.5rem;
    color: var(--color-text-primary);
    background: transparent;
  }
  .pt-input:focus {
    outline: 2px solid var(--color-primary);
    outline-offset: 1px;
  }
  .pt-remove {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 9999px;
    color: var(--color-caption);
  }
  .pt-remove:hover {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
  }
  .pt-add {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: 0.375rem;
    padding: 0.375rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 600;
    border-radius: 9999px;
    color: var(--color-text-primary);
    border: 1px dashed var(--color-input-border);
  }
  .pt-add:hover:not(:disabled) {
    border-color: var(--color-primary);
  }
  .pt-add:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .pt-problem {
    font-size: 0.8125rem;
    color: #ef4444;
  }
  .pt-actions {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--color-input-border);
  }
  .pt-reset,
  .pt-save {
    padding: 0.5rem 0.875rem;
    font-size: 0.9375rem;
    font-weight: 600;
    border-radius: 0.5rem;
  }
  .pt-reset {
    color: var(--color-text-primary);
  }
  .pt-reset:hover {
    background: var(--color-hover-bg);
  }
  .pt-save {
    min-width: 6rem;
    color: var(--color-on-action, #fff);
    background: var(--color-action);
  }
  .pt-save:hover:not(:disabled) {
    background: var(--color-action-hover);
  }
  .pt-save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
