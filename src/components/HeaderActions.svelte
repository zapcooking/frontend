<script lang="ts">
  /**
   * The header's account cluster: Kitchen help (Intelligence), cooking
   * tools, notifications, the member tier badge and the avatar/sign-in
   * controls. Rendered in the fixed header strip below xl, and nested in
   * the sidebar under the logo at xl+, where the strip is gone.
   */
  import { onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { userPublickey } from '$lib/nostr';
  import { lockedVaultPubkey } from '$lib/auth/lockedVault';
  import EggTimerIcon from './icons/EggTimerIcon.svelte';
  import IntelligenceIcon from './icons/IntelligenceIcon.svelte';
  import IntelligenceMenu from './IntelligenceMenu.svelte';
  import NotificationBell from './NotificationBell.svelte';
  import SearchIcon from 'phosphor-svelte/lib/MagnifyingGlass';
  import { mobileSearchOpen } from '$lib/stores/mobileSearch';
  import { scrollActiveSurfaceToTop } from '$lib/activeScrollSurface';
  import { cookingToolsStore, cookingToolsOpen } from '$lib/stores/cookingToolsWidget';
  import { timerStore } from '$lib/timerStore';
  import {
    membershipStatusMap,
    queueMembershipLookup,
    type MembershipStatus,
    type MembershipTier
  } from '$lib/stores/membershipStatus';

  /** Which way the nested panels open: 'right' in the header strip,
      'left' in the sidebar's user bar. */
  export let panelAlign: 'right' | 'left' = 'right';

  let intelligenceMenuOpen = false;
  let bellOpen = false;

  // The two popovers exclude each other: opening one closes the other,
  // and both render from state this component owns.
  function toggleIntelligence() {
    intelligenceMenuOpen = !intelligenceMenuOpen;
    if (intelligenceMenuOpen) bellOpen = false;
  }
  function openBell() {
    bellOpen = true;
    intelligenceMenuOpen = false;
  }
  function closeBell() {
    bellOpen = false;
  }

  // Count active timers (running or paused + done)
  $: activeTimers = $timerStore.timers.filter(
    (t) => t.status === 'running' || t.status === 'paused' || t.status === 'done'
  );
  $: hasActiveTimers = activeTimers.length > 0;

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

  // A locked vault session keeps $userPublickey (seeded from localStorage)
  // but isn't signed in yet: no member icons until it's unlocked. Also leaves
  // the phone header room for the "Continue as" chip.
  $: showMemberChrome = !!$userPublickey && !$lockedVaultPubkey;

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
        return '';
      default:
        return '';
    }
  }

  function toggleCookingTools() {
    cookingToolsStore.toggle();
  }

  onDestroy(() => {
    unsubMembership();
  });
</script>

<div class="flex items-center gap-1.5 sm:gap-2.5 self-center flex-none print:hidden">
  <!-- Search icon (mobile only — ≥sm has the search field) -->
  <div class="block sm:hidden">
    <button
      on:click={() => {
        scrollActiveSurfaceToTop(document.getElementById('app-scroll'));
        mobileSearchOpen.set(true);
      }}
      class="zh-iconbtn"
      aria-label="Search"
    >
      <SearchIcon size={18} weight="bold" />
    </button>
  </div>

  <!-- Cooking Tools toggle (timer + converter) — kept but lighter -->
  <button
    on:click={toggleCookingTools}
    data-cooking-tools-button
    class="zh-iconbtn relative {$cookingToolsOpen
      ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
      : ''}"
    aria-label={$cookingToolsOpen ? 'Hide cooking tools' : 'Show cooking tools'}
  >
    <EggTimerIcon size={20} weight={$cookingToolsOpen || hasActiveTimers ? 'fill' : 'bold'} />
    {#if hasActiveTimers}
      <span
        class="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-amber-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center"
      >
        {activeTimers.length}
      </span>
    {/if}
  </button>

  <!-- Unified Intelligence icon (logged in) -->
  {#if showMemberChrome}
    <div class="relative">
      <button
        type="button"
        on:click|stopPropagation={toggleIntelligence}
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
        panelAlign={panelAlign}
        open={intelligenceMenuOpen}
        on:close={() => (intelligenceMenuOpen = false)}
      />
    </div>
  {/if}

  <!-- Notifications bell + dropdown (desktop only — mobile keeps the
       bottom-nav bell) -->
  {#if showMemberChrome}
    <div class="hidden sm:inline-flex sm:items-center">
      <NotificationBell
        panelAlign={panelAlign}
        open={bellOpen}
        on:open={openBell}
        on:close={closeBell}
      />
    </div>
  {/if}

  <!-- Tier badge for active members -->
  {#if showMemberChrome && isActiveMember && getTierLabel(membershipTier)}
    <a
      href="/membership"
      class="hidden sm:inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide border transition-colors hover:opacity-80 {getTierClasses(
        membershipTier
      )}"
    >
      {getTierLabel(membershipTier)}
    </a>
  {/if}

</div>

<style>
  /* Shared icon button — minimal, balanced tap target, subtle hover.
     Wrapped in :where() so Tailwind responsive utilities can override
     individual properties without specificity fights. */
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

  /* Intelligence button — selected accent ring + glow */
  .zh-intelligence-btn.is-active {
    background-color: color-mix(in srgb, var(--color-primary) 10%, transparent);
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--color-primary) 35%, transparent),
      0 0 12px color-mix(in srgb, var(--color-primary) 18%, transparent);
    color: var(--color-primary);
  }
  :global(.dark) .zh-intelligence-btn.is-active {
    color: var(--color-primary);
  }

</style>
