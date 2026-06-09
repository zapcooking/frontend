<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  import { goto } from '$app/navigation';
  import SparkleIcon from 'phosphor-svelte/lib/Sparkle';
  import LeafIcon from 'phosphor-svelte/lib/Leaf';
  import CheffyIcon from './icons/CheffyIcon.svelte';

  export let open: boolean = false;

  const dispatch = createEventDispatcher();
  let panelEl: HTMLDivElement;

  const items = [
    {
      href: '/souschef',
      label: 'Sous Chef',
      blurb: 'Recipe guidance & ideas',
      Icon: SparkleIcon,
      accent: 'rgb(168, 85, 247)'
    },
    {
      href: '/cheffy',
      label: 'Cheffy',
      blurb: 'Your kitchen companion',
      Icon: CheffyIcon,
      // Cheffy's warm orange — uses the CSS var so the accent shifts
      // automatically between the light (#ec4700) and dark
      // (#ff5722) palettes.
      accent: 'var(--color-primary)'
    },
    {
      href: '/nourish',
      label: 'Nourish',
      blurb: 'Smart nutrition scoring',
      Icon: LeafIcon,
      accent: 'rgb(34, 197, 94)'
    }
  ];

  function close() {
    dispatch('close');
  }

  function go(href: string) {
    close();
    goto(href);
  }

  function onDocClick(e: MouseEvent) {
    if (!open || !panelEl) return;
    if (!panelEl.contains(e.target as Node)) close();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  onMount(() => {
    // Use `click` rather than `mousedown` so the opener's own click
    // handler runs first. Otherwise mousedown closes the menu, then
    // the opener's click immediately re-toggles it back open — and
    // tapping the icon while the menu is open feels broken.
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

{#if open}
  <div bind:this={panelEl} class="intelligence-menu" role="menu" aria-label="Intelligence tools">
    <div class="header-row">
      <span class="eyebrow">Intelligence</span>
    </div>
    {#each items as item}
      <button type="button" class="item" role="menuitem" on:click={() => go(item.href)}>
        <span class="icon" style:color={item.accent}>
          {#if item.Icon === CheffyIcon}
            <!-- Cheffy renders as the full colored character (no
                 monochrome `weight`), one of his branded touches in
                 the menu. -->
            <CheffyIcon size={18} expression="happy" />
          {:else}
            <svelte:component this={item.Icon} size={16} weight="fill" />
          {/if}
        </span>
        <span class="text">
          <span class="label">{item.label}</span>
          <span class="blurb">{item.blurb}</span>
        </span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .intelligence-menu {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    min-width: 232px;
    padding: 6px;
    border-radius: 14px;
    background-color: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border, var(--color-accent-gray));
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.04) inset,
      0 8px 24px rgba(0, 0, 0, 0.35),
      0 2px 6px rgba(0, 0, 0, 0.25);
    backdrop-filter: blur(12px);
    z-index: 60;
    animation: menu-in 140ms ease-out;
  }

  :global(.dark) .intelligence-menu {
    background-color: rgba(17, 24, 39, 0.92);
  }

  .header-row {
    padding: 8px 10px 4px;
  }

  .eyebrow {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-caption, #9ca3af);
    opacity: 0.7;
  }

  .item {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 9px 10px;
    border-radius: 10px;
    background: transparent;
    border: 0;
    color: var(--color-text-primary);
    cursor: pointer;
    text-align: left;
    transition: background-color 120ms ease;
  }

  .item:hover {
    background-color: var(--color-input-bg);
  }

  .icon {
    display: inline-flex;
    width: 16px;
    height: 16px;
    align-items: center;
    justify-content: center;
  }

  .text {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
    min-width: 0;
  }

  .label {
    font-size: 13px;
    font-weight: 600;
  }

  .blurb {
    font-size: 11px;
    opacity: 0.62;
  }

  @keyframes menu-in {
    from {
      opacity: 0;
      transform: translateY(-4px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
</style>
