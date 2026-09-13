<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';

  export let expanded = false;
  export let className = '';

  const dispatch = createEventDispatcher<{ toggle: void }>();
</script>

<button
  type="button"
  class="engagement-toggle {className}"
  aria-label={expanded ? 'Hide post activity' : 'Show post activity'}
  aria-expanded={expanded}
  on:click|stopPropagation={() => dispatch('toggle')}
>
  <span class:expanded>
    <CaretDownIcon size={20} weight="bold" />
  </span>
</button>

<style>
  .engagement-toggle {
    display: inline-flex;
    width: 2.25rem;
    height: 2.25rem;
    flex: 0 0 2.25rem;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    color: var(--color-text-secondary);
    transition:
      color 140ms ease,
      background-color 140ms ease;
  }

  .engagement-toggle:hover,
  .engagement-toggle:focus-visible {
    color: var(--color-text-primary);
    background: var(--color-accent-gray);
  }

  .engagement-toggle:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 1px;
  }

  .engagement-toggle span {
    display: flex;
    transition: transform 180ms ease;
  }

  .engagement-toggle span.expanded {
    transform: rotate(180deg);
  }

  @media (prefers-reduced-motion: reduce) {
    .engagement-toggle span {
      transition: none;
    }
  }
</style>
