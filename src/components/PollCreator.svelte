<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Modal from './Modal.svelte';
  import PlusIcon from 'phosphor-svelte/lib/Plus';
  import TrashIcon from 'phosphor-svelte/lib/Trash';
  import ImageIcon from 'phosphor-svelte/lib/Image';
  import { generateOptionId, type PollConfig, type PollOption, type PollType } from '$lib/polls';
  import { ndk } from '$lib/nostr';
  import { uploadImage } from '$lib/mediaUpload';

  export let open = false;

  const dispatch = createEventDispatcher<{ create: PollConfig }>();

  let pollType: PollType = 'singlechoice';
  let options: PollOption[] = [
    { id: generateOptionId(), label: '' },
    { id: generateOptionId(), label: '' }
  ];

  // Duration-based end time (default: 1 day)
  let days = 1;
  let hours = 0;
  let minutes = 0;

  // Image upload state
  let uploadingIndex: number | null = null;
  let uploadError = '';
  let fileInputs: Record<number, HTMLInputElement> = {};

  $: validOptions = options.filter((o) => o.label.trim().length > 0 || o.image);
  $: canCreate = validOptions.length >= 2;
  $: totalMinutes = days * 1440 + hours * 60 + minutes;
  $: durationLabel = formatDuration(days, hours, minutes);

  function formatDuration(d: number, h: number, m: number): string {
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    return parts.length > 0 ? parts.join(' ') : 'No duration';
  }

  function addOption() {
    if (options.length >= 10) return;
    options = [...options, { id: generateOptionId(), label: '' }];
  }

  function removeOption(index: number) {
    if (options.length <= 2) return;
    options = options.filter((_, i) => i !== index);
  }

  async function handleImageUpload(index: number, e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    uploadingIndex = index;
    uploadError = '';
    try {
      const url = await uploadImage($ndk, file);
      options[index] = { ...options[index], image: url };
      options = options;
    } catch (err: any) {
      uploadError = err?.message || 'Failed to upload image.';
    } finally {
      uploadingIndex = null;
      if (target) target.value = '';
    }
  }

  function removeImage(index: number) {
    options[index] = { ...options[index], image: undefined };
    options = options;
  }

  function handleCreate() {
    if (!canCreate) return;

    let endsAt: number | undefined;
    if (totalMinutes > 0) {
      endsAt = Math.floor(Date.now() / 1000) + totalMinutes * 60;
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
    days = 1;
    hours = 0;
    minutes = 0;
    uploadingIndex = null;
    uploadError = '';
    fileInputs = {};
  }

  function setPreset(d: number, h: number, m: number) {
    days = d;
    hours = h;
    minutes = m;
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
    <div class="space-y-3 mb-4">
      {#each options as option, index}
        <div class="option-row">
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
            <!-- Image upload button -->
            <label
              class="option-img-btn"
              class:opacity-50={uploadingIndex !== null}
              title="Add image"
            >
              <ImageIcon size={14} />
              <input
                bind:this={fileInputs[index]}
                type="file"
                accept="image/*"
                class="sr-only"
                on:change={(e) => handleImageUpload(index, e)}
                disabled={uploadingIndex !== null}
              />
            </label>
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

          <!-- Image preview -->
          {#if option.image}
            <div class="option-img-preview">
              <img src={option.image} alt="Option {index + 1}" />
              <button
                class="option-img-remove"
                on:click={() => removeImage(index)}
                title="Remove image"
              >
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          {/if}

          {#if uploadingIndex === index}
            <span class="text-xs text-caption ml-7">Uploading...</span>
          {/if}
        </div>
      {/each}
    </div>

    {#if uploadError}
      <p class="text-red-500 text-xs mb-2">{uploadError}</p>
    {/if}

    <!-- Add option -->
    {#if options.length < 10}
      <button class="add-option-btn mb-4" on:click={addOption}>
        <PlusIcon size={14} />
        <span>Add option</span>
      </button>
    {/if}

    <!-- Duration -->
    <div class="mb-4">
      <span class="text-sm text-caption">Poll length</span>

      <!-- Quick presets -->
      <div class="flex flex-wrap gap-1.5 mt-2 mb-3">
        {#each [
          { label: '1h', d: 0, h: 1, m: 0 },
          { label: '6h', d: 0, h: 6, m: 0 },
          { label: '12h', d: 0, h: 12, m: 0 },
          { label: '1d', d: 1, h: 0, m: 0 },
          { label: '3d', d: 3, h: 0, m: 0 },
          { label: '7d', d: 7, h: 0, m: 0 }
        ] as preset}
          <button
            class="duration-preset"
            class:active={days === preset.d && hours === preset.h && minutes === preset.m}
            on:click={() => setPreset(preset.d, preset.h, preset.m)}
          >
            {preset.label}
          </button>
        {/each}
      </div>

      <!-- Custom selectors -->
      <div class="flex items-center gap-2">
        <div class="duration-field">
          <select bind:value={days} class="duration-select">
            {#each Array.from({ length: 31 }, (_, i) => i) as d}
              <option value={d}>{d}</option>
            {/each}
          </select>
          <span class="duration-unit">days</span>
        </div>
        <div class="duration-field">
          <select bind:value={hours} class="duration-select">
            {#each Array.from({ length: 24 }, (_, i) => i) as h}
              <option value={h}>{h}</option>
            {/each}
          </select>
          <span class="duration-unit">hrs</span>
        </div>
        <div class="duration-field">
          <select bind:value={minutes} class="duration-select">
            {#each [0, 5, 10, 15, 20, 30, 45] as m}
              <option value={m}>{m}</option>
            {/each}
          </select>
          <span class="duration-unit">min</span>
        </div>
      </div>

      {#if totalMinutes > 0}
        <p class="text-xs text-caption mt-1.5">Ends in {durationLabel}</p>
      {:else}
        <p class="text-xs text-amber-600 mt-1.5">No end time — poll stays open indefinitely</p>
      {/if}
    </div>

    <!-- Actions -->
    <div class="flex justify-end gap-2">
      <button class="px-4 py-2 text-sm text-caption hover:opacity-80 transition-colors" on:click={close}>
        Cancel
      </button>
      <button
        class="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        disabled={!canCreate || uploadingIndex !== null}
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

  .option-row {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .option-img-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.375rem;
    color: var(--color-caption);
    border-radius: 0.375rem;
    cursor: pointer;
    transition: opacity 0.15s;
    flex-shrink: 0;
  }

  .option-img-btn:hover {
    opacity: 0.7;
  }

  .option-img-preview {
    position: relative;
    display: inline-block;
    margin-left: 1.75rem;
  }

  .option-img-preview img {
    width: 4rem;
    height: 4rem;
    object-fit: cover;
    border-radius: 0.5rem;
    border: 1px solid var(--color-input-border);
  }

  .option-img-remove {
    position: absolute;
    top: -0.375rem;
    right: -0.375rem;
    background: #ef4444;
    color: white;
    border: none;
    border-radius: 9999px;
    padding: 0.125rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    transition: background 0.15s;
  }

  .option-img-remove:hover {
    background: #dc2626;
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

  .duration-preset {
    padding: 0.25rem 0.625rem;
    font-size: 0.75rem;
    border-radius: 9999px;
    border: 1px solid var(--color-input-border);
    background: transparent;
    color: var(--color-caption);
    cursor: pointer;
    transition: all 0.15s;
  }

  .duration-preset.active {
    background: var(--color-primary, #f97316);
    color: white;
    border-color: var(--color-primary, #f97316);
  }

  .duration-preset:hover:not(.active) {
    border-color: var(--color-primary, #f97316);
  }

  .duration-field {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .duration-select {
    padding: 0.375rem 0.5rem;
    font-size: 0.8125rem;
    border-radius: 0.375rem;
    border: 1px solid var(--color-input-border);
    background: var(--color-bg-primary);
    color: var(--color-text-primary);
    outline: none;
    cursor: pointer;
    -webkit-appearance: none;
    appearance: none;
    min-width: 3rem;
    text-align: center;
  }

  .duration-select:focus {
    border-color: var(--color-primary);
  }

  .duration-unit {
    font-size: 0.75rem;
    color: var(--color-caption);
  }
</style>
