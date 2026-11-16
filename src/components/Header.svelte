<script lang="ts">
  import { browser } from '$app/environment';
  import ListIcon from 'phosphor-svelte/lib/List';
  import TagsSearchAutocomplete from './TagsSearchAutocomplete.svelte';
  import HeaderActions from './HeaderActions.svelte';
  import IdentityControl from './IdentityControl.svelte';
  import { mobileNavOpen } from '$lib/stores/mobileNav';
  import { totalUnreadCount } from '$lib/stores/messages';
  import { openSearch, openTag } from '$lib/searchNav';
  import { scrollActiveSurfaceToTop } from '$lib/activeScrollSurface';

  /**
   * Engaging search jumps the page back to the top, so results/typing aren't
   * happening while the user is stranded mid-feed. Scrolls the #app-scroll
   * container (the element the app actually scrolls) with a window fallback.
   * Additive — does not interfere with focusing the input or opening the
   * mobile search overlay.
   */
  function scrollToTopOnSearch() {
    if (!browser) return;
    scrollActiveSurfaceToTop(document.getElementById('app-scroll'));
  }
</script>

<!-- Mobile-first sleek header. The search hugs the account cluster on
     the right (ml-auto) at sm and up; the narrowest view keeps its
     original spacing and the mobile search icon instead. -->
<div class="zh-root relative flex items-center gap-3 sm:gap-6 lg:gap-10 justify-between overflow-visible">
  <!-- Burger + logo group (mobile only, tightly paired) -->
  <div class="flex items-center gap-1 flex-none lg:hidden">
    <button
      on:click={() => mobileNavOpen.set(true)}
      class="p-2 cursor-pointer transition-transform duration-150 active:scale-90"
      style="color: var(--color-text-primary);"
      aria-label="Open navigation menu"
    >
      <span class="relative">
        <ListIcon size={22} weight="bold" />
        {#if $totalUnreadCount > 0}
          <span
            class="absolute top-0 right-0 w-2.5 h-2.5 rounded-full bg-red-500"
            aria-hidden="true"
          ></span>
        {/if}
      </span>
    </button>

    <a
      href="/explore"
      class="zh-logo cursor-pointer transition-transform duration-150 active:scale-95"
      aria-label="zap.cooking home"
    >
      <img
        src="/zapcooking-text-light.svg"
        class="w-24 sm:w-32 my-1.5 sm:my-2 dark:hidden"
        alt="zap.cooking"
      />
      <img
        src="/zapcooking-text-dark.svg"
        class="w-24 sm:w-32 my-1.5 sm:my-2 hidden dark:block"
        alt="zap.cooking"
      />
    </a>
  </div>

  <!-- Search bar: ml-auto groups it with the account cluster on the
       right edge of the strip. -->
  <!-- focusin (not click) so keyboard tabbing into search also jumps to top. -->
  <div
    class="hidden sm:flex ml-auto w-full max-w-xs self-center print:hidden lg:pl-2.5"
    on:focusin={scrollToTopOnSearch}
  >
    <TagsSearchAutocomplete
      placeholderString={'Search recipes, tags, or users...'}
      action={openTag}
      onSubmitQuery={openSearch}
    />
  </div>
  <!-- Right: account cluster — extracted so the same controls can nest
       in the sidebar at xl, where the strip is gone. -->
  <div class="flex items-center gap-1.5 sm:gap-2.5 self-center flex-none print:hidden">
    <HeaderActions />
    <IdentityControl />
  </div>
</div>

<style>
  /* Pin the content row to the CSS-deterministic header token so the painted
     header height equals --header-h on the first frame, independent of font or
     logo image load timing. The token is >= the natural content height at each
     breakpoint, so children center within it and never clip. */
  .zh-root {
    height: var(--header-row-h);
  }
</style>
