<script lang="ts">
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { userPublickey, userProfilePictureOverride } from '$lib/nostr';
  import { triggerExploreNav } from '$lib/exploreNav';
  import SearchIcon from 'phosphor-svelte/lib/MagnifyingGlass';
  import MeasuringCupIcon from './icons/MeasuringCupIcon.svelte';
  import ListIcon from 'phosphor-svelte/lib/List';
  import TagsSearchAutocomplete from './TagsSearchAutocomplete.svelte';
  import CustomAvatar from './CustomAvatar.svelte';
  import IntelligenceIcon from './icons/IntelligenceIcon.svelte';
  import IntelligenceMenu from './IntelligenceMenu.svelte';
  import NotificationBell from './NotificationBell.svelte';
  import { theme } from '$lib/themeStore';
  import { userSidePanelOpen } from '$lib/stores/userSidePanel';
  import { mobileNavOpen } from '$lib/stores/mobileNav';
  import { loginOverlayOpen } from '$lib/stores/loginOverlay';
  import { mobileSearchOpen } from '$lib/stores/mobileSearch';
  import { parseNip19Input, isSecretKeyInput } from '$lib/nip19Input';
  import { timerStore } from '$lib/timerStore';
  import { cookingToolsStore, cookingToolsOpen } from '$lib/stores/cookingToolsWidget';
  import { scrollActiveSurfaceToTop } from '$lib/activeScrollSurface';
  import {
    membershipStatusMap,
    queueMembershipLookup,
    type MembershipStatus,
    type MembershipTier
  } from '$lib/stores/membershipStatus';

  let intelligenceMenuOpen = false;

  // Count active timers (running or paused + done)
  $: activeTimers = $timerStore.timers.filter(
    (t) => t.status === 'running' || t.status === 'paused' || t.status === 'done'
  );
  $: hasActiveTimers = activeTimers.length > 0;

  function openSearch(query: string) {
    mobileSearchOpen.set(false);
    // A pasted identifier is a destination, not a search term — and a
    // secret key is neither, so it never reaches the results page (which
    // would hand it to the search relays verbatim).
    if (isSecretKeyInput(query)) return;
    const target = parseNip19Input(query);
    if (target) {
      goto(target.path);
      return;
    }
    goto(`/search?q=${encodeURIComponent(query)}`);
  }

  function openTag(query: string) {
    mobileSearchOpen.set(false);
    // Same invariant as openSearch: a secret key is never written into a
    // URL, so it cannot become `/tag/nsec1…` either.
    if (isSecretKeyInput(query)) return;
    // Identifiers route to the thing they name, whether or not they arrived
    // wearing NIP-21's `nostr:` scheme; anything else is a tag.
    const target = parseNip19Input(query);
    if (target) {
      goto(target.path);
      return;
    }
    goto(`/tag/${query}`);
  }

  $: resolvedTheme = $theme === 'system' ? theme.getResolvedTheme() : $theme;
  $: isDarkMode = resolvedTheme === 'dark';

  // Active state highlights the Intelligence icon when the user is
  // currently on one of the AI surfaces.
  $: onIntelligenceSurface =
    $page.url.pathname.startsWith('/souschef') ||
    $page.url.pathname.startsWith('/cheffy') ||
    $page.url.pathname.startsWith('/zappy') ||
    $page.url.pathname.startsWith('/nourish');

  // Membership
  let membershipMap: Record<string, MembershipStatus> = {};
  const unsubMembership = membershipStatusMap.subscribe((value) => {
    membershipMap = value;
  });

  $: if ($userPublickey) {
    queueMembershipLookup($userPublickey);
  }

  $: userMembershipStatus = $userPublickey
    ? membershipMap[$userPublickey.trim().toLowerCase()]
    : undefined;
  $: isActiveMember = Boolean(userMembershipStatus?.active);
  $: membershipTier = userMembershipStatus?.tier;

  function getTierLabel(tier: MembershipTier | undefined): string {
    switch (tier) {
      case 'cook_plus':
        return 'COOK+';
      case 'pro_kitchen':
        return 'PRO';
      case 'founders':
        return 'FOUNDER';
      default:
        return '';
    }
  }

  function getTierClasses(tier: MembershipTier | undefined): string {
    switch (tier) {
      case 'founders':
        return 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700';
      case 'pro_kitchen':
        return 'bg-violet-100 text-violet-700 border-violet-300 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-700';
      case 'cook_plus':
        return 'bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700';
      default:
        return '';
    }
  }

  import { onDestroy } from 'svelte';
  onDestroy(() => {
    unsubMembership();
  });

  function toggleCookingTools() {
    cookingToolsStore.toggle();
  }

  function handleLogoClick() {
    if ($page.url.pathname === '/explore') {
      triggerExploreNav();
    } else {
      goto('/explore');
    }
  }

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

<!-- Mobile-first sleek header -->
<div class="zh-root relative flex items-center gap-3 sm:gap-6 lg:gap-10 justify-between overflow-visible">
  <!-- Burger + logo group (mobile only, tightly paired) -->
  <div class="flex items-center gap-1 flex-none lg:hidden">
    <button
      on:click={() => mobileNavOpen.set(true)}
      class="p-2 cursor-pointer transition-transform duration-150 active:scale-90"
      style="color: var(--color-text-primary);"
      aria-label="Open navigation menu"
    >
      <ListIcon size={22} weight="bold" />
    </button>

    <button
      on:click={handleLogoClick}
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
    </button>
  </div>

  <!-- Center: search bar (desktop). Left padding at xl sets the gap from
       the pipe's vertical line to 12px (10px here + the input's 2px margin),
       matching the header's 12px top/bottom padding so the search box has
       equal visual padding on all three framed sides. The xl max-width adds
       the same 10px back on top of the feed column's 42rem (672px) so the
       visible input box — after this container's 10px padding and the
       autocomplete's 2px side margins — lands at exactly 672px, flush with
       the feed column below it. -->
  <!-- focusin (not click) so keyboard tabbing into search also jumps to top. -->
  <div
    class="hidden sm:flex flex-1 self-center print:hidden min-w-[280px] lg:max-w-xs xl:max-w-[calc(42rem+14px)] xl:min-w-[500px] lg:pl-2.5"
    on:focusin={scrollToTopOnSearch}
  >
    <TagsSearchAutocomplete
      placeholderString={'Search recipes, tags, or users...'}
      action={openTag}
      onSubmitQuery={openSearch}
    />
  </div>
  <span class="hidden sm:max-lg:flex sm:max-lg:grow"></span>

  <!-- Right: action cluster -->
  <div class="flex items-center gap-1.5 sm:gap-2.5 self-center flex-none print:hidden">
    <!-- Search icon (mobile only) -->
    <div class="block sm:hidden">
      <button
        on:click={() => {
          scrollToTopOnSearch();
          mobileSearchOpen.set(true);
        }}
        class="zh-iconbtn"
        aria-label="Search"
      >
        <SearchIcon size={18} weight="bold" />
      </button>
    </div>

    <!-- Unified Intelligence icon (logged in) -->
    {#if $userPublickey}
      <div class="relative">
        <button
          type="button"
          on:click|stopPropagation={() => (intelligenceMenuOpen = !intelligenceMenuOpen)}
          class="zh-iconbtn zh-intelligence-btn {onIntelligenceSurface || intelligenceMenuOpen
            ? 'is-active'
            : ''}"
          aria-label="Kitchen help"
          aria-haspopup="menu"
          aria-expanded={intelligenceMenuOpen}
        >
          <IntelligenceIcon size={20} active={onIntelligenceSurface || intelligenceMenuOpen} />
        </button>
        <IntelligenceMenu
          open={intelligenceMenuOpen}
          on:close={() => (intelligenceMenuOpen = false)}
        />
      </div>
    {/if}

    <!-- Cooking Tools toggle (timer + converter) — kept but lighter -->
    <button
      on:click={toggleCookingTools}
      data-cooking-tools-button
      class="zh-iconbtn relative {$cookingToolsOpen
        ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
        : ''}"
      aria-label={$cookingToolsOpen ? 'Hide cooking tools' : 'Show cooking tools'}
    >
      <MeasuringCupIcon size={18} weight={$cookingToolsOpen || hasActiveTimers ? 'fill' : 'bold'} />
      {#if hasActiveTimers}
        <span
          class="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-amber-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center"
        >
          {activeTimers.length}
        </span>
      {/if}
    </button>

    <!-- Notifications bell + dropdown (desktop only — mobile keeps the
         bottom-nav bell) -->
    {#if $userPublickey}
      <div class="hidden sm:inline-flex sm:items-center">
        <NotificationBell />
      </div>
    {/if}

    <!-- Tier badge for active members -->
    {#if $userPublickey && isActiveMember && getTierLabel(membershipTier)}
      <a
        href="/membership"
        class="hidden sm:inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide border transition-colors hover:opacity-80 {getTierClasses(
          membershipTier
        )}"
      >
        {getTierLabel(membershipTier)}
      </a>
    {/if}

    <!-- Sign in / User menu -->
    <div class="print:hidden flex-shrink-0 inline-flex items-center">
      {#if $userPublickey !== ''}
        <button
          class="zh-avatar-btn"
          on:click={() => userSidePanelOpen.set(true)}
          aria-label="Open user menu"
        >
          <span class="zh-avatar-ring">
            <CustomAvatar
              pubkey={$userPublickey}
              size={32}
              imageUrl={$userProfilePictureOverride}
            />
          </span>
        </button>
      {:else}
        <button
          type="button"
          on:click={() => loginOverlayOpen.set(true)}
          class="px-3 py-1.5 sm:px-4 sm:py-2 rounded-full border font-medium transition duration-300 text-xs sm:text-sm signin-button"
          style="color: var(--color-text-primary); border-color: var(--color-input-border); background: none; cursor: pointer;"
          >Sign in</button
        >
      {/if}
    </div>
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

  /* Shared icon button — minimal, balanced tap target, subtle hover.
     Wrapped in :where() so Tailwind responsive utilities (sm:hidden,
     etc.) can override individual properties without specificity
     fights. */
  :where(.zh-iconbtn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 999px;
    color: var(--color-text-primary);
    background: transparent;
    border: 0;
    cursor: pointer;
    transition:
      background-color 140ms ease,
      color 140ms ease,
      box-shadow 140ms ease;
  }
  .zh-iconbtn:hover {
    background-color: var(--color-input-bg);
  }
  .zh-iconbtn:active {
    transform: scale(0.96);
  }

  /* Intelligence button — when active, soft purple ring + glow */
  .zh-intelligence-btn.is-active {
    background-color: rgba(168, 85, 247, 0.1);
    box-shadow:
      inset 0 0 0 1px rgba(168, 85, 247, 0.35),
      0 0 12px rgba(168, 85, 247, 0.18);
    color: rgb(216, 180, 254);
  }
  :global(.dark) .zh-intelligence-btn.is-active {
    color: rgb(233, 213, 255);
  }

  /* Avatar — soft purple glow ring, scales softly on hover/tap */
  .zh-avatar-btn {
    display: inline-flex;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: 999px;
    cursor: pointer;
    transition: transform 200ms ease;
  }
  .zh-avatar-btn:hover {
    transform: scale(1.04);
  }
  .zh-avatar-btn:active {
    transform: scale(0.96);
  }
  .zh-avatar-ring {
    display: inline-flex;
    padding: 2px;
    border-radius: 999px;
    background:
      radial-gradient(
        circle at 30% 30%,
        rgba(168, 85, 247, 0.55),
        rgba(168, 85, 247, 0.18) 60%,
        transparent 80%
      );
    box-shadow:
      0 0 0 1px rgba(168, 85, 247, 0.35),
      0 0 10px rgba(168, 85, 247, 0.25);
  }
  :global(.dark) .zh-avatar-ring {
    background:
      radial-gradient(
        circle at 30% 30%,
        rgba(192, 132, 252, 0.6),
        rgba(168, 85, 247, 0.2) 60%,
        transparent 80%
      );
    box-shadow:
      0 0 0 1px rgba(192, 132, 252, 0.4),
      0 0 12px rgba(168, 85, 247, 0.3);
  }

  .signin-button:hover {
    border-color: var(--color-accent-gray);
    background-color: var(--color-input-bg);
  }
</style>
