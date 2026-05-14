<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { userPublickey, userProfilePictureOverride } from '$lib/nostr';
  import { triggerExploreNav } from '$lib/exploreNav';
  import SVGNostrCookingWithText from '../assets/nostr.cooking-withtext.svg';
  import SearchIcon from 'phosphor-svelte/lib/MagnifyingGlass';
  import CookingPotIcon from 'phosphor-svelte/lib/CookingPot';
  import TagsSearchAutocomplete from './TagsSearchAutocomplete.svelte';
  import CustomAvatar from './CustomAvatar.svelte';
  import IntelligenceIcon from './icons/IntelligenceIcon.svelte';
  import IntelligenceMenu from './IntelligenceMenu.svelte';
  import DenominatedBalance from './DenominatedBalance.svelte';
  import { theme } from '$lib/themeStore';
  import WalletBalance from './WalletBalance.svelte';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import WalletIcon from 'phosphor-svelte/lib/Wallet';
  import { userSidePanelOpen } from '$lib/stores/userSidePanel';
  import { mobileSearchOpen } from '$lib/stores/mobileSearch';
  import { timerStore } from '$lib/timerStore';
  import {
    navBalanceVisible,
    walletConnected,
    walletBalance,
    walletLoading,
    balanceVisible,
    openWallet
  } from '$lib/wallet';
  import { displayCurrency } from '$lib/currencyStore';
  import { weblnConnected } from '$lib/wallet/webln';
  import { bitcoinConnectEnabled, bitcoinConnectWalletInfo } from '$lib/wallet/bitcoinConnect';
  import { cookingToolsStore, cookingToolsOpen } from '$lib/stores/cookingToolsWidget';
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

  function openTag(query: string) {
    mobileSearchOpen.set(false);
    if (query.startsWith('npub')) {
      goto(`/user/${query}`);
    } else if (query.startsWith('naddr')) {
      goto(`/recipe/${query}`);
    } else if (query.startsWith('note1') || query.startsWith('nevent1')) {
      goto(`/${query}`);
    } else {
      goto(`/tag/${query}`);
    }
  }

  $: resolvedTheme = $theme === 'system' ? theme.getResolvedTheme() : $theme;
  $: isDarkMode = resolvedTheme === 'dark';
  $: hasNavWallet =
    $walletConnected ||
    $weblnConnected ||
    ($bitcoinConnectEnabled && $bitcoinConnectWalletInfo.connected);

  // Active state highlights the Intelligence icon when the user is
  // currently on one of the AI surfaces.
  $: onIntelligenceSurface =
    $page.url.pathname.startsWith('/souschef') ||
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

</script>

<!-- Mobile-first sleek header -->
<div class="zh-root relative flex items-center gap-3 sm:gap-6 lg:gap-10 justify-between overflow-visible">
  <!-- Left: compact logo -->
  <button
    on:click={handleLogoClick}
    class="zh-logo flex-none xl:hidden cursor-pointer transition-transform duration-150 active:scale-95"
    aria-label="zap.cooking home"
  >
    <img
      src={SVGNostrCookingWithText}
      class="w-24 sm:w-32 my-1.5 sm:my-2 dark:hidden"
      alt="zap.cooking"
    />
    <img
      src="/zap_cooking_logo_white.svg"
      class="w-24 sm:w-32 my-1.5 sm:my-2 hidden dark:block"
      alt="zap.cooking"
    />
  </button>

  <!-- Center: search bar (desktop) -->
  <div
    class="hidden sm:flex flex-1 self-center print:hidden max-w-2xl min-w-[280px] lg:min-w-[500px]"
  >
    <TagsSearchAutocomplete
      placeholderString={'Search recipes, tags, or users...'}
      action={openTag}
    />
  </div>
  <span class="hidden lg:max-xl:flex lg:max-xl:grow"></span>

  <!-- Right: action cluster -->
  <div class="flex items-center gap-1.5 sm:gap-2.5 self-center flex-none print:hidden">
    <!-- Search icon (mobile only) -->
    <div class="block sm:hidden">
      <button
        on:click={() => mobileSearchOpen.set(true)}
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
          aria-label="Intelligence tools"
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
      <CookingPotIcon size={18} weight={$cookingToolsOpen || hasActiveTimers ? 'fill' : 'bold'} />
      {#if hasActiveTimers}
        <span
          class="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-amber-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center"
        >
          {activeTimers.length}
        </span>
      {/if}
    </button>

    <!-- Wallet (logged in) -->
    {#if $userPublickey && $navBalanceVisible}
      {#if hasNavWallet}
        <!-- Mobile compact wallet pill — split into two interactive
             zones so the user gets a one-tap currency cycle on the
             balance text while preserving "open wallet" on the icon. -->
        <div class="zh-wallet-mobile sm:hidden" role="group" aria-label="Wallet">
          <button
            type="button"
            on:click={() => openWallet()}
            class="zh-wallet-mobile-zone zh-wallet-mobile-icon"
            aria-label="Open wallet"
          >
            <LightningIcon size={14} weight="fill" class="text-amber-400" />
          </button>
          <button
            type="button"
            on:click={() => displayCurrency.cycleSatsFiat()}
            class="zh-wallet-mobile-zone zh-wallet-mobile-amount"
            aria-label="Toggle currency"
            title="Tap to toggle currency"
          >
            <DenominatedBalance
              sats={$walletBalance}
              visible={$balanceVisible}
              loading={$walletLoading}
            />
          </button>
        </div>
        <!-- Desktop full WalletBalance widget -->
        <div class="hidden sm:block">
          <WalletBalance />
        </div>
      {:else}
        <button
          type="button"
          on:click={() => openWallet('setup')}
          class="zh-wallet-mobile sm:hidden"
          aria-label="Set up a wallet"
        >
          <LightningIcon size={14} weight="fill" class="text-amber-400" />
          <span class="zh-wallet-amount">Set up</span>
        </button>
        <button
          type="button"
          on:click={() => openWallet('setup')}
          class="hidden sm:flex items-center gap-2 px-3 py-1.5 min-w-[154px] rounded-full text-sm font-medium transition-colors hover:bg-accent-gray cursor-pointer"
          style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
        >
          <LightningIcon size={14} weight="fill" class="text-amber-500" aria-hidden="true" />
          <span>Set up a Wallet</span>
        </button>
      {/if}
    {:else if $userPublickey && hasNavWallet}
      <!-- Wallet exists but balance is hidden via $navBalanceVisible: still
           expose a compact tap-to-open affordance on mobile. -->
      <button
        type="button"
        on:click={() => openWallet()}
        class="zh-iconbtn sm:hidden"
        aria-label="Open wallet"
      >
        <WalletIcon size={18} weight="bold" />
      </button>
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
    <div class="print:hidden flex-shrink-0">
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
        <a
          href="/login"
          class="px-3 py-1.5 sm:px-4 sm:py-2 rounded-full border font-medium transition duration-300 text-xs sm:text-sm signin-button"
          style="color: var(--color-text-primary); border-color: var(--color-input-border);"
          >Sign in</a
        >
      {/if}
    </div>
  </div>
</div>

<style>
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

  /* Mobile wallet pill — compact container split into two interactive
     zones: a lightning icon (opens the wallet modal) and a balance
     text (one-tap cycles SATS ↔ preferred fiat). Mobile only; desktop
     uses the existing WalletBalance widget. The media query is
     co-located with the component CSS so it beats the Tailwind
     `sm:hidden` utility (which would otherwise lose to this rule's
     specificity). */
  .zh-wallet-mobile {
    display: inline-flex;
    align-items: stretch;
    height: 30px;
    border-radius: 999px;
    background-color: var(--color-input-bg);
    border: 1px solid var(--color-input-border, transparent);
    color: var(--color-text-primary);
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    overflow: hidden;
    transition: background-color 140ms ease, border-color 140ms ease;
  }
  @media (min-width: 640px) {
    .zh-wallet-mobile {
      display: none;
    }
  }

  /* When `.zh-wallet-mobile` is used as a single button (the "Set up"
     branch), fall back to old behavior. */
  button.zh-wallet-mobile {
    cursor: pointer;
    padding: 0 10px 0 8px;
    gap: 6px;
    align-items: center;
  }
  button.zh-wallet-mobile:active {
    transform: scale(0.97);
  }

  /* Inner zones share styling, are full-height, and meet a 30px tap
     target via padding. They show a subtle hover state so the user
     sees the two are independent. */
  .zh-wallet-mobile-zone {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
    transition: background-color 120ms ease, color 120ms ease;
  }
  .zh-wallet-mobile-zone:hover {
    background-color: rgba(0, 0, 0, 0.05);
  }
  :global(.dark) .zh-wallet-mobile-zone:hover {
    background-color: rgba(255, 255, 255, 0.06);
  }
  :where(.zh-wallet-mobile-zone:active) {
    transform: scale(0.96);
  }
  .zh-wallet-mobile-icon {
    padding: 0 6px 0 9px;
  }
  .zh-wallet-mobile-amount {
    padding: 0 10px 0 6px;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.01em;
    min-width: 3.5ch;
  }
  :global(.dark) .zh-wallet-mobile {
    background-color: rgba(255, 255, 255, 0.04);
    border-color: rgba(255, 255, 255, 0.08);
    box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.06);
  }
  .zh-wallet-amount {
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.01em;
    min-width: 2.5ch;
    text-align: right;
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
