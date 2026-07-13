<script lang="ts">
  /**
   * My Kitchen hub shell — persistent section nav above every hub
   * section. The Recipes page is the hub index; the [naddr] collection
   * detail escapes this layout via +page@.svelte (full-bleed view with
   * its own back affordance).
   */
  import SectionNav from '../../components/SectionNav.svelte';
  import BookOpenIcon from 'phosphor-svelte/lib/BookOpen';
  import ShoppingCartIcon from 'phosphor-svelte/lib/ShoppingCart';
  import CalendarBlankIcon from 'phosphor-svelte/lib/CalendarBlank';
  import LeafIcon from 'phosphor-svelte/lib/Leaf';

  const sections = [
    {
      href: '/my-kitchen',
      label: 'Recipes',
      icon: BookOpenIcon,
      // Exact match: child routes (grocery, planner, nourish) must not
      // false-highlight the index section.
      match: (p: string) => p === '/my-kitchen'
    },
    {
      href: '/my-kitchen/grocery',
      label: 'Grocery',
      icon: ShoppingCartIcon,
      // startsWith so the /my-kitchen/grocery/[id] detail keeps the tab active
      match: (p: string) => p.startsWith('/my-kitchen/grocery')
    },
    {
      href: '/my-kitchen/planner',
      label: 'Planner',
      icon: CalendarBlankIcon,
      match: (p: string) => p.startsWith('/my-kitchen/planner')
    },
    {
      href: '/my-kitchen/nourish',
      label: 'Nourish',
      icon: LeafIcon,
      match: (p: string) => p.startsWith('/my-kitchen/nourish')
    }
  ];
</script>

<div class="flex flex-col gap-4">
  <SectionNav items={sections} />
  <slot />
</div>
