<script lang="ts">
  import AtomIcon from 'phosphor-svelte/lib/Atom';

  export let size: number = 20;
  export let active: boolean = false;
  let className = '';
  export { className as class };
</script>

<span
  class={`intelligence-icon ${active ? 'is-active' : ''} ${className}`}
  aria-hidden="true"
>
  <AtomIcon {size} weight="bold" />
</span>

<style>
  .intelligence-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: currentColor;
    transition: filter 220ms ease, transform 220ms ease;
  }

  .is-active {
    filter:
      drop-shadow(0 0 3px rgba(168, 85, 247, 0.7))
      drop-shadow(0 0 8px rgba(168, 85, 247, 0.35));
  }

  .is-active :global(svg) {
    animation: orbit-spin 9s linear infinite;
  }

  @keyframes orbit-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .is-active :global(svg) {
      animation: none;
    }
  }
</style>
