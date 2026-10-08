<script lang="ts">
  /**
   * The shared frame of Fresh's special cards (topic spotlight, memory,
   * explore rows): the paper card, its tab, a "…" menu of the card's own
   * choices, and a one-time `seen` event when half the card is on screen
   * (for the device-local "already shown" memory; nothing is sent).
   */
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { clickOutside } from '$lib/clickOutside';
  import DotsThreeIcon from 'phosphor-svelte/lib/DotsThree';

  export let tab: string;
  export let menu: { label: string; action: () => void }[] = [];

  const dispatch = createEventDispatcher<{ seen: void }>();
  let open = false;
  let observer: IntersectionObserver | null = null;

  function seen(node: HTMLElement) {
    if (typeof IntersectionObserver === 'undefined') return;
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          dispatch('seen');
          observer?.disconnect();
          observer = null;
        }
      },
      { root: document.getElementById('app-scroll'), threshold: 0.5 }
    );
    observer.observe(node);
    return { destroy: () => observer?.disconnect() };
  }

  onDestroy(() => observer?.disconnect());

  function choose(action: () => void) {
    open = false;
    action();
  }
</script>

<section class="special fresh-paper" use:seen>
  <span class="box-tab">{tab}</span>
  {#if menu.length}
    <div class="special-menu" use:clickOutside on:click_outside={() => (open = false)}>
      <button
        type="button"
        class="special-menu-button"
        aria-label="Card options"
        aria-haspopup="menu"
        aria-expanded={open}
        on:click={() => (open = !open)}
      >
        <DotsThreeIcon size={20} weight="bold" />
      </button>
      {#if open}
        <div class="special-menu-list" role="menu">
          {#each menu as item}
            <button type="button" role="menuitem" on:click={() => choose(item.action)}>
              {item.label}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
  <slot />
</section>

<style>
  .special {
    position: relative;
    margin-top: 1.125rem;
    padding: 1.125rem 1.25rem;
    border-radius: 1rem;
    background-color: var(--box-paper);
    border: 1px solid var(--box-edge);
    box-shadow: 0 1px 2px rgba(120, 84, 40, 0.08);
    --media-bleed-x: 1.25rem;
  }

  :global(html.dark) .special {
    box-shadow: none;
  }

  .special-menu {
    position: absolute;
    top: 0.625rem;
    right: 0.75rem;
    z-index: 2;
  }

  .special-menu-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 999px;
    color: var(--color-text-secondary);
  }

  .special-menu-button:hover {
    background: var(--box-chip);
  }

  .special-menu-list {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 0.25rem;
    min-width: 12rem;
    padding: 0.25rem 0;
    border-radius: 0.5rem;
    background: var(--color-input-bg);
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
  }

  .special-menu-list button {
    display: block;
    width: 100%;
    padding: 0.5rem 1rem;
    text-align: left;
    font-size: 0.875rem;
    color: var(--color-text-primary);
  }

  .special-menu-list button:hover {
    background: var(--color-accent-gray);
  }
</style>
