<script lang="ts" context="module">
  /**
   * A suggestion is a short, typed chip: a label, the message it stands
   * for, and how it behaves when tapped.
   *  - 'send'     → fire the prompt to Cheffy immediately
   *  - 'populate' → drop the prompt into the composer and let the user
   *    finish typing (these need a detail like an ingredient or count)
   */
  export interface CheffySuggestion {
    label: string;
    prompt: string;
    behavior: 'send' | 'populate';
  }

  // Welcome-state starters. Broad prompts send; specific ones populate.
  export const STARTER_SUGGESTIONS: CheffySuggestion[] = [
    { label: 'What can I make?', prompt: 'Help me figure out what to make.', behavior: 'send' },
    { label: 'Use what I have', prompt: 'I have ', behavior: 'populate' },
    { label: 'Help me cook', prompt: 'I need help while I cook.', behavior: 'send' },
    { label: 'Swap an ingredient', prompt: 'What can I substitute for ', behavior: 'populate' },
    {
      label: 'Make it healthier',
      prompt: 'Help me make this recipe healthier: ',
      behavior: 'populate'
    },
    { label: 'Scale a recipe', prompt: 'Scale this recipe to serve ', behavior: 'populate' },
    { label: 'Surprise me', prompt: 'Surprise me with something good to make.', behavior: 'send' }
  ];

  // Contextual follow-ups after a structured recipe (max four).
  export const CONTEXT_RECIPE: CheffySuggestion[] = [
    { label: 'Scale servings', prompt: 'Scale this recipe to serve ', behavior: 'populate' },
    { label: 'Swap an ingredient', prompt: 'What can I substitute for ', behavior: 'populate' },
    {
      label: 'Estimate nutrition',
      prompt: 'Estimate the nutrition for this recipe.',
      behavior: 'send'
    },
    {
      label: 'What side goes with it?',
      prompt: 'What side dish goes well with it?',
      behavior: 'send'
    }
  ];

  // Contextual follow-ups after a conversational answer (max four).
  export const CONTEXT_GENERAL: CheffySuggestion[] = [
    { label: 'Make it faster', prompt: 'How can I make it faster?', behavior: 'send' },
    { label: 'Add more protein', prompt: 'How can I add more protein?', behavior: 'send' },
    { label: 'Make it kid-friendly', prompt: 'Make it more kid-friendly.', behavior: 'send' },
    {
      label: 'What side goes with it?',
      prompt: 'What side dish goes well with it?',
      behavior: 'send'
    }
  ];
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';

  export let suggestions: CheffySuggestion[] = [];
  export let onSelect: (s: CheffySuggestion) => void = () => {};
  export let ariaLabel: string = 'Cheffy conversation suggestions';
  /** Slightly smaller chips for contextual follow-ups. */
  export let compact: boolean = false;

  let scroller: HTMLDivElement;
  let atStart = true;
  let atEnd = true;
  let reduceMotion = false;

  // Fade only the edge that has more content, so the cue is honest
  // (no left fade at the start, no right fade at the end).
  $: maskCss = `linear-gradient(to right, ${atStart ? 'rgba(0,0,0,1)' : 'rgba(0,0,0,0)'} 0, rgba(0,0,0,1) ${
    atStart ? '0px' : '18px'
  }, rgba(0,0,0,1) calc(100% - ${atEnd ? '0px' : '18px'}), ${
    atEnd ? 'rgba(0,0,0,1)' : 'rgba(0,0,0,0)'
  } 100%)`;

  function updateEdges() {
    if (!scroller) return;
    atStart = scroller.scrollLeft <= 1;
    atEnd = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1;
  }

  function onWheel(e: WheelEvent) {
    // Let native horizontal (trackpad) scrolling pass through; translate
    // vertical wheel into horizontal only when there's overflow.
    if (e.deltaY === 0 || !scroller) return;
    if (scroller.scrollWidth <= scroller.clientWidth) return;
    scroller.scrollLeft += e.deltaY;
    e.preventDefault();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const chips = Array.from(scroller.querySelectorAll<HTMLButtonElement>('button.chip'));
    const idx = chips.indexOf(document.activeElement as HTMLButtonElement);
    if (idx === -1) return;
    e.preventDefault();
    const next =
      e.key === 'ArrowRight' ? Math.min(idx + 1, chips.length - 1) : Math.max(idx - 1, 0);
    chips[next].focus();
    chips[next].scrollIntoView({
      inline: 'nearest',
      block: 'nearest',
      behavior: reduceMotion ? 'auto' : 'smooth'
    });
  }

  onMount(() => {
    reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    tick().then(updateEdges);
    const ro = new ResizeObserver(updateEdges);
    if (scroller) ro.observe(scroller);
    return () => ro.disconnect();
  });
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<!-- Arrow-key roving focus + wheel-to-horizontal scroll on the row. -->
<div
  class="chip-scroller"
  class:compact
  bind:this={scroller}
  role="group"
  aria-label={ariaLabel}
  style:-webkit-mask-image={maskCss}
  style:mask-image={maskCss}
  on:scroll={updateEdges}
  on:wheel={onWheel}
  on:keydown={onKeydown}
>
  {#each suggestions as s}
    <button type="button" class="chip" on:click={() => onSelect(s)}>{s.label}</button>
  {/each}
</div>

<style>
  .chip-scroller {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    overflow-y: hidden;
    /* Left/right padding so the first and last chips are fully reachable
       on mobile even with the edge fade. */
    padding: 2px 16px;
    scrollbar-width: none;
    -ms-overflow-style: none;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
    scroll-behavior: smooth;
  }
  .chip-scroller::-webkit-scrollbar {
    display: none;
  }

  .chip {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 16px;
    border-radius: 999px;
    border: 1px solid var(--color-input-border);
    background-color: var(--color-input-bg);
    color: var(--color-text-primary);
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background-color 140ms ease,
      border-color 140ms ease;
  }
  .chip:hover {
    background-color: color-mix(in srgb, var(--color-primary) 8%, var(--color-input-bg));
    border-color: color-mix(in srgb, var(--color-primary) 32%, var(--color-input-border));
  }
  .chip:active {
    background-color: color-mix(in srgb, var(--color-primary) 14%, var(--color-input-bg));
  }
  .chip:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 50%, transparent);
  }

  /* Contextual follow-ups sit a touch smaller and more secondary. */
  .compact .chip {
    min-height: 36px;
    padding: 0 13px;
    font-size: 0.82rem;
  }

  @media (prefers-reduced-motion: reduce) {
    .chip-scroller {
      scroll-behavior: auto;
    }
  }
</style>
