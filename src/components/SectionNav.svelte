<script lang="ts">
  /**
   * Routed section nav for the My Kitchen hub.
   *
   * Anchor-based: each item is a real link to a child route, and the
   * active pill derives from $page.url.pathname via the item's match()
   * predicate (same idiom as DesktopSideNav's NavItems). This is
   * deliberately NOT the state-based view-pill pattern used inside the
   * Recipes page — those pills switch ?view= modes over one dataset;
   * these switch between hub sections that are separate routes.
   */
  import { page } from '$app/stores';

  export let items: Array<{
    href: string;
    label: string;
    icon: any;
    match: (pathname: string) => boolean;
  }>;

  /** Accessible name for the nav landmark. */
  export let label: string = 'My Kitchen sections';

  $: pathname = $page.url.pathname;
</script>

<nav
  class="inline-flex p-0.5 rounded-full self-start"
  style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
  aria-label={label}
>
  {#each items as item (item.href)}
    {@const active = item.match(pathname)}
    <a
      href={item.href}
      aria-current={active ? 'page' : undefined}
      class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors {active
        ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-sm'
        : ''}"
      style={active ? '' : 'color: var(--color-text-secondary);'}
    >
      <svelte:component this={item.icon} size={16} weight={active ? 'fill' : 'regular'} />
      <span>{item.label}</span>
    </a>
  {/each}
</nav>
