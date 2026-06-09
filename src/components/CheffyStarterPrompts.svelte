<script lang="ts" context="module">
  export interface StarterPrompt {
    label: string;
    /** The natural-language message actually sent to Cheffy. */
    prompt: string;
    /** "hungry" routes through Surprise-Me; otherwise a normal chat turn. */
    mode?: 'chat' | 'hungry';
  }

  export interface StarterGroup {
    title: string;
    prompts: StarterPrompt[];
  }

  // Practical conversation starters, grouped. Labels stay short for
  // mobile; the `prompt` is the fuller thing Cheffy actually receives.
  export const STARTER_GROUPS: StarterGroup[] = [
    {
      title: 'Use what I have',
      prompts: [
        {
          label: 'Fridge cleanout',
          prompt: 'Help me cook something using what is in my fridge. I will tell you what I have.'
        },
        {
          label: 'Three-ingredient meal',
          prompt: 'Give me a meal I can make with just three ingredients.'
        },
        {
          label: 'Pantry dinner',
          prompt: 'I only have pantry staples. What can I make for dinner?'
        },
        {
          label: 'Leftover rescue',
          prompt: 'I have leftovers I want to turn into something new. Where do I start?'
        }
      ]
    },
    {
      title: 'Help me cook',
      prompts: [
        {
          label: 'Fix my recipe',
          prompt: 'Something went wrong with my recipe. Can you help me fix it?'
        },
        {
          label: 'Find a substitute',
          prompt: 'I need a substitute for an ingredient. Can you help?'
        },
        { label: 'Explain a technique', prompt: 'Explain a cooking technique to me simply.' },
        { label: 'Plan a side dish', prompt: 'Help me plan a side dish to go with my main.' }
      ]
    },
    {
      title: 'Feed me',
      prompts: [
        { label: 'Quick dinner', prompt: 'I need a quick dinner. Give me a recipe.' },
        { label: 'Comfort food', prompt: 'I want some comfort food tonight. Give me a recipe.' },
        { label: 'Something healthy', prompt: 'I want something healthy. Give me a recipe.' },
        { label: 'Surprise me', prompt: 'Surprise me with a complete recipe.', mode: 'hungry' }
      ]
    }
  ];
</script>

<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let disabled: boolean = false;

  const dispatch = createEventDispatcher<{ select: StarterPrompt }>();
</script>

<div class="starter-groups">
  {#each STARTER_GROUPS as group}
    <div class="starter-group">
      <span class="starter-title">{group.title}</span>
      <div class="starter-row">
        {#each group.prompts as p}
          <button
            type="button"
            class="starter-chip"
            {disabled}
            on:click={() => dispatch('select', p)}
          >
            {p.label}
          </button>
        {/each}
      </div>
    </div>
  {/each}
</div>

<style>
  .starter-groups {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .starter-group {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .starter-title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--color-text-caption, #9ca3af);
    opacity: 0.78;
  }
  /* Wrap on desktop; on narrow screens become a single horizontally
     scrollable row so the chips never stack into a tall wall. */
  .starter-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  @media (max-width: 640px) {
    .starter-row {
      flex-wrap: nowrap;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      margin: 0 -1rem;
      padding: 0 1rem 2px;
    }
    .starter-row::-webkit-scrollbar {
      display: none;
    }
  }
  .starter-chip {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    height: 34px;
    padding: 0 14px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--color-primary) 22%, transparent);
    background-color: color-mix(in srgb, var(--color-primary) 8%, transparent);
    color: var(--color-primary);
    font-size: 13px;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background-color 140ms ease,
      transform 140ms ease,
      box-shadow 140ms ease;
  }
  .starter-chip:hover:not(:disabled) {
    background-color: color-mix(in srgb, var(--color-primary) 16%, transparent);
  }
  .starter-chip:active:not(:disabled) {
    transform: scale(0.96);
  }
  .starter-chip:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 55%, transparent);
  }
  .starter-chip:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
