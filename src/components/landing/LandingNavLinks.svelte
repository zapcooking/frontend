<script lang="ts">
  import CompassIcon from 'phosphor-svelte/lib/Compass';
  import FlameIcon from 'phosphor-svelte/lib/Flame';
  import ForkKnifeIcon from 'phosphor-svelte/lib/ForkKnife';
  import NewspaperIcon from 'phosphor-svelte/lib/Newspaper';
  import PollIcon from 'phosphor-svelte/lib/ChartBarHorizontal';
  import EnvelopeIcon from 'phosphor-svelte/lib/EnvelopeSimple';
  import MemoriesIcon from 'phosphor-svelte/lib/ClockCounterClockwise';
  import CookbookIcon from 'phosphor-svelte/lib/BookOpen';
  import LeafIcon from 'phosphor-svelte/lib/Leaf';
  import CrownIcon from 'phosphor-svelte/lib/CrownSimple';
  import HandshakeIcon from 'phosphor-svelte/lib/Handshake';
  import ChefHatIcon from 'phosphor-svelte/lib/ChefHat';
  import PlusCircleIcon from 'phosphor-svelte/lib/PlusCircle';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';

  /** Public links only: no account, wallet or message state in cached HTML. */
  export let label = 'Main navigation';
  const primary = [
    { href: '/explore', label: 'Explore', icon: CompassIcon },
    { href: '/feed', label: 'Feed', icon: FlameIcon },
    { href: '/recipes', label: 'Recipes', icon: ForkKnifeIcon },
    { href: '/packs', label: 'Recipe Packs', icon: CookbookIcon },
    { href: '/reads', label: 'Food stories', icon: NewspaperIcon },
    { href: '/polls', label: 'Polls', icon: PollIcon },
    { href: '/messages', label: 'Messages', icon: EnvelopeIcon },
    { href: '/memories', label: 'Memories', icon: MemoriesIcon }
  ];
  const kitchen = [
    { href: '/my-kitchen', label: 'My Kitchen', icon: CookbookIcon },
    { href: '/cheffy', label: 'Cheffy', icon: ChefHatIcon },
    { href: '/explore#import-recipe', label: 'Import a recipe', icon: PlusCircleIcon },
    { href: '/nourish', label: 'Nourish', icon: LeafIcon },
    { href: '/membership', label: 'Membership', icon: CrownIcon },
    { href: '/sponsors', label: 'Sponsors', icon: HandshakeIcon }
  ];
</script>

<nav aria-label={label}>
  <ul>
    {#each primary as item (item.href)}
      <li>
        <a
          href={item.href}
          class:active={item.href === '/explore'}
          aria-current={item.href === '/explore' ? 'page' : undefined}
        >
          <span class="nav-icon"><svelte:component this={item.icon} size={20} /></span>
          <span>{item.label}</span>
        </a>
      </li>
    {/each}
  </ul>
  <details class="kitchen-links">
    <summary>My Kitchen <CaretDownIcon size={14} /></summary>
    <ul>
      {#each kitchen as item (item.href)}
        <li>
          <a href={item.href}
            ><span class="nav-icon"><svelte:component this={item.icon} size={20} /></span><span
              >{item.label}</span
            ></a
          >
        </li>
      {/each}
    </ul>
  </details>
</nav>

<style>
  nav {
    font-family: 'Albert Sans', ui-sans-serif, system-ui, sans-serif;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  a {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 12px;
    min-height: 48px;
    border-radius: 12px;
    color: var(--color-text-primary);
    text-decoration: none;
    font-size: 16px;
    font-weight: 500;
  }
  a:hover {
    background: var(--color-bg-secondary);
    text-decoration: none !important;
  }
  a.active {
    background: var(--color-bg-secondary);
    border-left: 2px solid var(--color-primary);
    padding-left: 10px;
  }
  .nav-icon {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .kitchen-links {
    margin-top: 16px;
  }
  summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    min-height: 44px;
    color: var(--color-caption);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  details[open] summary :global(svg) {
    transform: rotate(180deg);
  }
  a:focus-visible,
  summary:focus-visible {
    outline: 3px solid var(--color-primary);
    outline-offset: 2px;
  }
</style>
