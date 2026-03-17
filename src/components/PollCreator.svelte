<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Modal from './Modal.svelte';
  import PlusIcon from 'phosphor-svelte/lib/Plus';
  import TrashIcon from 'phosphor-svelte/lib/Trash';
  import { generateOptionId, type PollConfig, type PollOption, type PollType } from '$lib/polls';

  export let open = false;

  const dispatch = createEventDispatcher<{ create: PollConfig }>();

  let pollType: PollType = 'singlechoice';
  let options: PollOption[] = [
    { id: generateOptionId(), label: '' },
    { id: generateOptionId(), label: '' }
  ];
  let hasEndDate = false;
  let endsAtInput = '';

  $: validOptions = options.filter((o) => o.label.trim().length > 0);
  $: canCreate = validOptions.length >= 2;

  function addOption() {
    if (options.length >= 10) return;
    options = [...options, { id: generateOptionId(), label: '' }];
  }

  function removeOption(index: number) {
    if (options.length <= 2) return;
    options = options.filter((_, i) => i !== index);
  }

  function handleCreate() {
    if (!canCreate) return;

    let endsAt: number | undefined;
    if (hasEndDate && endsAtInput) {
      const ts = Math.floor(new Date(endsAtInput).getTime() / 1000);
      // Only set if the date is in the future
      if (ts > Math.floor(Date.now() / 1000)) {
        endsAt = ts;
      }
    }

    dispatch('create', {
      options: validOptions,
      pollType,
      endsAt
    });
    close();
  }

  function close() {
    open = false;
    reset();
  }

  function reset() {
    pollType = 'singlechoice';
    options = [
      { id: generateOptionId(), label: '' },
      { id: generateOptionId(), label: '' }
    ];
    hasEndDate = false;
    endsAtInput = '';
  }
</script>

<Modal {open} cleanup={close} compact>
  <h1 slot="title">Create Poll</h1>

  <div class="poll-creator">
    <!-- Poll type toggle -->
    <div class="flex items-center gap-2 mb-4">
      <button
        class="poll-type-btn"
        class:active={pollType === 'singlechoice'}
        on:click={() => (pollType = 'singlechoice')}
      >
        Single choice
      </button>
      <button
        class="poll-type-btn"
        class:active={pollType === 'multiplechoice'}
        on:click={() => (pollType = 'multiplechoice')}
      >
        Multiple choice
      </button>
    </div>

    <!-- Options -->
    <div class="space-y-2 mb-4">
      {#each options as option, index}
        <div class="flex items-center gap-2">
          <span class="text-xs text-caption w-5 text-center flex-shrink-0">{index + 1}</span>
          <input
            type="text"
            value={option.label}
            on:input={(e) => {
              options[index] = { ...options[index], label: e.currentTarget.value };
              options = options;
            }}
            placeholder={`Option ${index + 1}`}
            class="poll-option-input flex-1"
            maxlength="80"
          />
          {#if options.length > 2}
            <button
              class="p-1 text-caption hover:text-red-500 transition-colors flex-shrink-0"
              on:click={() => removeOption(index)}
              title="Remove option"
            >
              <TrashIcon size={14} />
            </button>
          {/if}
        </div>
      {/each}
    </div>

    <!-- Add option -->
    {#if options.length < 10}
      <button class="add-option-btn mb-4" on:click={addOption}>
        <PlusIcon size={14} />
        <span>Add option</span>
      </button>
    {/if}

    <!-- End date -->
    <div class="mb-4">
      <label class="flex items-center gap-2 text-sm text-caption cursor-pointer">
        <input type="checkbox" bind:checked={hasEndDate} class="accent-primary" />
        Set end date
      </label>
      {#if hasEndDate}
        <input
          type="datetime-local"
          bind:value={endsAtInput}
          class="poll-option-input mt-2 w-full"
          min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
        />
      {/if}
    </div>

    <!-- Actions -->
    <div class="flex justify-end gap-2">
      <button class="px-4 py-2 text-sm text-caption hover:opacity-80 transition-colors" on:click={close}>
        Cancel
      </button>
      <button
        class="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        disabled={!canCreate}
        on:click={handleCreate}
      >
        Create Poll
      </button>
    </div>
  </div>
</Modal>

<style>
  .poll-creator {
    width: 100%;
  }

  .poll-type-btn {
    padding: 0.375rem 0.75rem;
    font-size: 0.8125rem;
    border-radius: 9999px;
    border: 1px solid var(--color-input-border);
    background: transparent;
    color: var(--color-caption);
    cursor: pointer;
    transition: all 0.15s;
  }

  .poll-type-btn.active {
    background: var(--color-primary, #f97316);
    color: white;
    border-color: var(--color-primary, #f97316);
  }

  .poll-option-input {
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    border-radius: 0.5rem;
    border: 1px solid var(--color-input-border);
    background: var(--color-bg-primary);
    color: var(--color-text-primary);
    outline: none;
    transition: border-color 0.15s;
  }

  .poll-option-input:focus {
    border-color: var(--color-primary);
  }

  .poll-option-input::placeholder {
    color: var(--color-caption);
  }

  .add-option-btn {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.75rem;
    font-size: 0.8125rem;
    color: var(--color-primary, #f97316);
    background: transparent;
    border: 1px dashed var(--color-input-border);
    border-radius: 0.5rem;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .add-option-btn:hover {
    opacity: 0.8;
  }
</style>
