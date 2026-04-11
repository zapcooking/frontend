<script lang="ts">
  /**
   * NourishInputTabs — segmented input control.
   *
   * Three modes: Ingredients / Describe a Dish / Photo
   * Each has contextual placeholder text and examples.
   */

  import NourishPhotoInput from './NourishPhotoInput.svelte';
  import LeafIcon from 'phosphor-svelte/lib/Leaf';

  export let text: string = '';
  export let imageData: string | null = null;
  export let disabled: boolean = false;

  type TabId = 'ingredients' | 'describe' | 'photo';
  export let activeTab: TabId = 'ingredients';

  const TABS: { id: TabId; label: string }[] = [
    { id: 'ingredients', label: 'Ingredients' },
    { id: 'describe', label: 'Describe a Meal' },
    { id: 'photo', label: 'Photo' }
  ];

  const PLACEHOLDERS: Record<TabId, string> = {
    ingredients: 'chicken thighs, sweet potato, kale, olive oil, garlic...',
    describe: 'A bowl of oatmeal with banana, walnuts, and honey...',
    photo: ''
  };

  const EXAMPLES: Record<TabId, string[]> = {
    ingredients: [
      'Greek yogurt, berries, walnuts',
      'Eggs, sourdough, avocado',
      'Rice, beans, chicken, salsa'
    ],
    describe: [
      'Homemade ramen with soft egg and greens',
      'Sheet pan salmon with roasted vegetables',
      'Smoothie bowl with fruit and granola'
    ],
    photo: []
  };

  let textareaEl: HTMLTextAreaElement;

  function useExample(example: string) {
    text = example;
    // Trigger auto-resize after example is set
    requestAnimationFrame(() => autoResize());
  }

  function autoResize() {
    if (!textareaEl) return;
    textareaEl.style.height = 'auto';
    const lineHeight = 24; // ~1.5rem at 16px
    const maxHeight = lineHeight * 5; // 5 lines
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, maxHeight) + 'px';
  }

  $: currentExamples = EXAMPLES[activeTab];
  $: hasInput = text.trim().length > 0 || imageData !== null;
</script>

<div class="nit-wrapper">
  <!-- Segmented control -->
  <div class="nit-tabs" role="tablist">
    {#each TABS as tab}
      <button
        role="tab"
        class="nit-tab"
        class:active={activeTab === tab.id}
        aria-selected={activeTab === tab.id}
        on:click={() => { activeTab = tab.id; }}
        {disabled}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <!-- Input area -->
  <div class="nit-input" role="tabpanel">
    {#if activeTab === 'photo'}
      <NourishPhotoInput bind:imageData {disabled} />
    {:else}
      <textarea
        class="nit-textarea"
        bind:this={textareaEl}
        bind:value={text}
        on:input={autoResize}
        placeholder={PLACEHOLDERS[activeTab]}
        rows={2}
        {disabled}
      />
    {/if}
  </div>

  <!-- Contextual examples -->
  {#if currentExamples.length > 0 && !hasInput}
    <div class="nit-examples">
      <span class="nit-examples-label">Try:</span>
      {#each currentExamples as example}
        <button
          class="nit-example"
          on:click={() => useExample(example)}
          {disabled}
        >
          {example}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .nit-wrapper {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  /* Segmented control */
  .nit-tabs {
    display: flex;
    border-radius: 0.5rem;
    border: 1px solid var(--color-input-border, rgba(255, 255, 255, 0.08));
    overflow: hidden;
    background: var(--color-input-bg, rgba(255, 255, 255, 0.02));
  }

  .nit-tab {
    flex: 1;
    padding: 0.5rem 0.75rem;
    font-size: 0.8125rem;
    font-weight: 500;
    font-family: inherit;
    color: var(--color-text-secondary);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background 150ms, color 150ms;
    position: relative;
  }
  .nit-tab:not(:last-child)::after {
    content: '';
    position: absolute;
    right: 0;
    top: 20%;
    height: 60%;
    width: 1px;
    background: var(--color-input-border, rgba(255, 255, 255, 0.06));
  }
  .nit-tab.active {
    background: rgba(34, 197, 94, 0.1);
    color: #22c55e;
    font-weight: 600;
  }
  .nit-tab.active::after {
    display: none;
  }
  .nit-tab:hover:not(.active):not(:disabled) {
    background: rgba(255, 255, 255, 0.03);
  }

  /* Textarea — auto-grows from 2 lines to max 5, then scrolls */
  .nit-textarea {
    width: 100%;
    padding: 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid var(--color-input-border, rgba(255, 255, 255, 0.08));
    background: var(--color-input-bg, rgba(255, 255, 255, 0.02));
    color: var(--color-text-primary);
    font-size: 1rem; /* 16px prevents iOS zoom */
    font-family: inherit;
    line-height: 1.5;
    resize: none;
    overflow-y: auto;
    min-height: calc(1.5rem * 2 + 1.5rem); /* 2 lines + padding */
    max-height: calc(1.5rem * 5 + 1.5rem); /* 5 lines + padding */
    transition: border-color 150ms;
  }
  .nit-textarea::placeholder {
    color: var(--color-text-secondary);
    opacity: 0.5;
  }
  .nit-textarea:focus {
    outline: none;
    border-color: rgba(34, 197, 94, 0.4);
  }

  /* Examples */
  .nit-examples {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
  }

  .nit-examples-label {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    opacity: 0.5;
  }

  .nit-example {
    font-size: 0.75rem;
    padding: 0.25rem 0.625rem;
    border-radius: 9999px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.04);
    color: var(--color-text-secondary);
    cursor: pointer;
    font-family: inherit;
    transition: background 150ms, border-color 150ms, color 150ms, transform 100ms;
    white-space: nowrap;
  }
  .nit-example:hover {
    background: rgba(34, 197, 94, 0.08);
    border-color: rgba(34, 197, 94, 0.3);
    color: #22c55e;
  }
  .nit-example:active {
    transform: scale(0.97);
    background: rgba(34, 197, 94, 0.12);
  }
</style>
