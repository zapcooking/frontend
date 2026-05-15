<script lang="ts">
  import { browser } from '$app/environment';
  import { clickOutside } from '$lib/clickOutside';
  import { fade } from 'svelte/transition';
  import { portal } from './Modal.svelte';
  import Button from './Button.svelte';
  import {
    wallets,
    activeWallet,
    walletBalance,
    walletConnected,
    walletLoading,
    balanceVisible,
    getWalletKindName,
    disconnectWallet,
    refreshBalance,
    setActiveWallet,
    toggleBalanceVisibility
  } from '$lib/wallet';
  import { openWallet } from '$lib/wallet/walletModalStore';
  import { dismissCookingToolsTip } from '$lib/cookingToolsTip';
  import {
    weblnConnected,
    weblnWalletName,
    disableWebln,
    getWeblnBalance
  } from '$lib/wallet/webln';
  import {
    bitcoinConnectEnabled,
    bitcoinConnectWalletInfo,
    bitcoinConnectBalance,
    bitcoinConnectBalanceLoading,
    refreshBitcoinConnectBalance,
    disableBitcoinConnect
  } from '$lib/wallet/bitcoinConnect';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwise';
  import ArrowsLeftRightIcon from 'phosphor-svelte/lib/ArrowsLeftRight';
  import SignOutIcon from 'phosphor-svelte/lib/SignOut';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
  import CaretRightIcon from 'phosphor-svelte/lib/CaretRight';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import EyeIcon from 'phosphor-svelte/lib/Eye';
  import EyeClosedIcon from 'phosphor-svelte/lib/EyeClosed';
  import SparkLogo from './icons/SparkLogo.svelte';
  import NwcLogo from './icons/NwcLogo.svelte';
  import BitcoinConnectLogo from './icons/BitcoinConnectLogo.svelte';
  import DenominatedBalance from './DenominatedBalance.svelte';
  import { displayCurrency, getPreferredFiat } from '$lib/currencyStore';

  function onPillKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleDropdown();
    }
  }

  // Target of the SATS ↔ fiat swap, used to label the dropdown item.
  // Recomputed reactively when the active currency changes so the
  // label always describes what the next click will switch to.
  $: cycleTarget = $displayCurrency === 'SATS' ? getPreferredFiat() : 'SATS';

  let dropdownActive = false;
  let showRemoveBitcoinConnectModal = false;
  let portalTarget: HTMLElement | null = null;

  $: portalTarget = browser ? document.body : null;

  // WebLN balance state
  let weblnBalance: number | null = null;
  let weblnBalanceLoading = false;

  async function refreshWeblnBalance() {
    if (!$weblnConnected) return;
    weblnBalanceLoading = true;
    try {
      const balance = await getWeblnBalance();
      weblnBalance = balance;
    } catch {
      weblnBalance = null;
    } finally {
      weblnBalanceLoading = false;
    }
  }

  // Fetch WebLN balance when connected
  $: if ($weblnConnected && weblnBalance === null && !weblnBalanceLoading) {
    refreshWeblnBalance();
  }

  async function handleRefresh() {
    await refreshBalance();
  }

  function handleSwitchWallet(walletId: number) {
    setActiveWallet(walletId);
    refreshBalance();
    dropdownActive = false;
  }

  async function handleDisconnect() {
    await disconnectWallet();
    dropdownActive = false;
  }

  function goToWallet() {
    dropdownActive = false;
    openWallet();
  }

  function toggleDropdown() {
    if (!dropdownActive) dismissCookingToolsTip();
    dropdownActive = !dropdownActive;
  }

  async function handleRefreshBitcoinConnect() {
    await refreshBitcoinConnectBalance();
  }

  function handleDisconnectBitcoinConnect() {
    disableBitcoinConnect();
    dropdownActive = false;
  }

  function confirmRemoveBitcoinConnect() {
    dropdownActive = false;
    showRemoveBitcoinConnectModal = true;
  }
</script>

{#if $weblnConnected}
  <!-- WebLN Wallet Widget -->
  <div class="relative" use:clickOutside on:click_outside={() => (dropdownActive = false)}>
    <!-- Balance pill — entire pill toggles the dropdown. Currency
         switching lives inside the dropdown so an accidental tap on
         the balance text doesn't change the displayed currency. -->
    <div
      class="balance-pill flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors cursor-pointer text-sm font-medium"
      style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
      role="button"
      tabindex="0"
      on:click={toggleDropdown}
      on:keydown={onPillKeydown}
    >
      <div
        class="w-4 h-4 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center flex-shrink-0"
      >
        <LightningIcon size={10} weight="fill" class="text-white" />
      </div>
      <span class="balance-text min-w-[3.5rem] text-right">
        <DenominatedBalance
          sats={weblnBalance}
          visible={$balanceVisible}
          loading={weblnBalanceLoading}
        />
      </span>

      <CaretDownIcon size={12} class="text-caption ml-0.5" />
    </div>

    <!-- Dropdown menu -->
    {#if dropdownActive}
      <div
        class="absolute right-0 top-full mt-2 z-20"
        transition:fade={{ delay: 0, duration: 150 }}
      >
        <div
          role="menu"
          tabindex="-1"
          on:keydown={(e) => e.key === 'Escape' && (dropdownActive = false)}
          class="flex flex-col gap-3 bg-input rounded-2xl drop-shadow px-4 py-4 min-w-[220px] max-w-[280px]"
          style="color: var(--color-text-primary)"
        >
          <!-- Current wallet — pill button that opens the wallet modal -->
          <button
            class="wallet-name-pill flex items-center justify-between gap-2 w-full px-4 py-2 min-h-[44px] rounded-full text-left transition-colors cursor-pointer"
            style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
            on:click={() => {
              dropdownActive = false;
              openWallet();
            }}
          >
            <span class="font-medium text-sm truncate">{$weblnWalletName || 'Browser Wallet'}</span>
            <CaretRightIcon size={14} class="text-caption flex-shrink-0" />
          </button>

          <!-- Actions -->
          <button
            class="flex items-center gap-2 text-sm hover:text-primary transition-colors cursor-pointer"
            on:click={() => displayCurrency.cycleSatsFiat()}
          >
            <ArrowsLeftRightIcon size={18} weight="bold" />
            Switch to {cycleTarget}
          </button>

          <button
            class="flex items-center gap-2 text-sm hover:text-primary transition-colors cursor-pointer"
            on:click={toggleBalanceVisibility}
          >
            {#if $balanceVisible}
              <EyeClosedIcon size={18} weight="bold" />
              Hide Balance
            {:else}
              <EyeIcon size={18} weight="bold" />
              Show Balance
            {/if}
          </button>

          <button
            class="flex items-center gap-2 text-sm hover:text-primary transition-colors cursor-pointer"
            on:click={refreshWeblnBalance}
            disabled={weblnBalanceLoading}
          >
            <span class:animate-spin={weblnBalanceLoading}>
              <ArrowClockwiseIcon size={18} weight="bold" />
            </span>
            Refresh Balance
          </button>

          <div class="border-t" style="border-color: var(--color-input-border);"></div>

          <button
            class="flex items-center gap-2 text-sm text-red-500 hover:text-red-600 transition-colors cursor-pointer"
            on:click={() => {
              disableWebln();
              weblnBalance = null;
              dropdownActive = false;
            }}
          >
            <SignOutIcon size={16} />
            Disconnect
          </button>
        </div>
      </div>
    {/if}
  </div>
{:else if $bitcoinConnectEnabled && $bitcoinConnectWalletInfo.connected}
  <!-- Bitcoin Connect Wallet Widget -->
  <div class="relative" use:clickOutside on:click_outside={() => (dropdownActive = false)}>
    <!-- Balance pill (see WebLN variant above for click rationale) -->
    <div
      class="balance-pill flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors cursor-pointer text-sm font-medium"
      style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
      role="button"
      tabindex="0"
      on:click={toggleDropdown}
      on:keydown={onPillKeydown}
    >
      <div
        class="w-4 h-4 rounded-full bg-gradient-to-br from-yellow-500 to-orange-500 flex items-center justify-center flex-shrink-0"
      >
        <BitcoinConnectLogo size={10} className="text-white" />
      </div>
      <span class="balance-text min-w-[3.5rem] text-right">
        <DenominatedBalance
          sats={$bitcoinConnectBalance}
          visible={$balanceVisible}
          loading={$bitcoinConnectBalanceLoading}
        />
      </span>

      <CaretDownIcon size={12} class="text-caption ml-0.5" />
    </div>

    <!-- Dropdown menu -->
    {#if dropdownActive}
      <div
        class="absolute right-0 top-full mt-2 z-20"
        transition:fade={{ delay: 0, duration: 150 }}
      >
        <div
          role="menu"
          tabindex="-1"
          on:keydown={(e) => e.key === 'Escape' && (dropdownActive = false)}
          class="flex flex-col gap-3 bg-input rounded-2xl drop-shadow px-4 py-4 min-w-[220px] max-w-[280px]"
          style="color: var(--color-text-primary)"
        >
          <!-- Current wallet — pill button that opens the wallet modal -->
          <button
            class="wallet-name-pill flex items-center justify-between gap-2 w-full px-4 py-2 min-h-[44px] rounded-full text-left transition-colors cursor-pointer"
            style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
            on:click={() => {
              dropdownActive = false;
              openWallet();
            }}
          >
            <span class="font-medium text-sm truncate">
              {$bitcoinConnectWalletInfo.alias || 'Bitcoin Connect'}
            </span>
            <CaretRightIcon size={14} class="text-caption flex-shrink-0" />
          </button>

          <!-- Actions -->
          <button
            class="flex items-center gap-2 text-sm hover:text-primary transition-colors cursor-pointer"
            on:click={() => displayCurrency.cycleSatsFiat()}
          >
            <ArrowsLeftRightIcon size={18} weight="bold" />
            Switch to {cycleTarget}
          </button>

          <button
            class="flex items-center gap-2 text-sm hover:text-primary transition-colors cursor-pointer"
            on:click={toggleBalanceVisibility}
          >
            {#if $balanceVisible}
              <EyeClosedIcon size={18} weight="bold" />
              Hide Balance
            {:else}
              <EyeIcon size={18} weight="bold" />
              Show Balance
            {/if}
          </button>

          <button
            class="flex items-center gap-2 text-sm hover:text-primary transition-colors cursor-pointer"
            on:click={handleRefreshBitcoinConnect}
            disabled={$bitcoinConnectBalanceLoading}
          >
            <span class:animate-spin={$bitcoinConnectBalanceLoading}>
              <ArrowClockwiseIcon size={18} weight="bold" />
            </span>
            Refresh Balance
          </button>

          <div class="border-t" style="border-color: var(--color-input-border);"></div>

          <button
            class="flex items-center gap-2 text-sm text-red-500 hover:text-red-600 transition-colors cursor-pointer"
            on:click={confirmRemoveBitcoinConnect}
          >
            <SignOutIcon size={16} />
            Disconnect
          </button>
        </div>
      </div>
    {/if}
  </div>
{:else if $walletConnected && $activeWallet}
  <!-- Embedded Wallet Widget -->
  <div class="relative" use:clickOutside on:click_outside={() => (dropdownActive = false)}>
    <!-- Balance pill (see WebLN variant above for click rationale) -->
    <div
      class="balance-pill flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors cursor-pointer text-sm font-medium"
      style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
      role="button"
      tabindex="0"
      on:click={toggleDropdown}
      on:keydown={onPillKeydown}
    >
      <LightningIcon size={16} weight="fill" class="text-amber-500" />
      <span class="balance-text min-w-[3.5rem] text-right">
        <DenominatedBalance
          sats={$walletBalance}
          visible={$balanceVisible}
          loading={$walletLoading}
        />
      </span>

      <CaretDownIcon size={12} class="text-caption ml-0.5" />
    </div>

    <!-- Dropdown menu -->
    {#if dropdownActive}
      <div
        class="absolute right-0 top-full mt-2 z-20"
        transition:fade={{ delay: 0, duration: 150 }}
      >
        <div
          role="menu"
          tabindex="-1"
          on:keydown={(e) => e.key === 'Escape' && (dropdownActive = false)}
          class="flex flex-col gap-3 bg-input rounded-2xl drop-shadow px-4 py-4 min-w-[220px] max-w-[280px]"
          style="color: var(--color-text-primary)"
        >
          <!-- Current wallet info (clickable to open wallet page) -->
          <!-- Current wallet — pill button that opens the wallet modal -->
          <button
            class="wallet-name-pill flex items-center justify-between gap-2 w-full px-4 py-2 min-h-[44px] rounded-full text-left transition-colors cursor-pointer"
            style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
            on:click={goToWallet}
          >
            <span class="flex items-center gap-2 min-w-0">
              <span class="font-medium text-sm truncate">{$activeWallet.name}</span>
              {#if $activeWallet.kind === 4}
                <SparkLogo size={14} className="flex-shrink-0 opacity-70" />
              {:else if $activeWallet.kind === 3}
                <NwcLogo size={14} className="flex-shrink-0 opacity-70" />
              {/if}
            </span>
            <CaretRightIcon size={14} class="text-caption flex-shrink-0" />
          </button>

          <!-- Wallet switcher (if multiple wallets) -->
          {#if $wallets.length > 1}
            <div class="flex flex-col gap-1">
              <span class="text-xs text-caption font-medium">Switch Wallet</span>
              {#each $wallets as wallet}
                <button
                  class="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors hover:bg-accent-gray cursor-pointer"
                  class:bg-accent-gray={wallet.active}
                  on:click={() => handleSwitchWallet(wallet.id)}
                >
                  {#if wallet.active}
                    <CheckIcon size={14} class="text-primary flex-shrink-0" />
                  {:else}
                    <span class="w-3.5 flex-shrink-0"></span>
                  {/if}
                  <span class="flex-1 text-left truncate">{wallet.name}</span>
                  {#if wallet.kind === 4}
                    <SparkLogo size={14} className="flex-shrink-0 opacity-60" />
                  {:else if wallet.kind === 3}
                    <NwcLogo size={14} className="flex-shrink-0 opacity-60" />
                  {/if}
                </button>
              {/each}
            </div>
            <div class="border-t" style="border-color: var(--color-input-border);"></div>
          {/if}

          <!-- Actions -->
          <button
            class="flex items-center gap-2 text-sm hover:text-primary transition-colors cursor-pointer"
            on:click={() => displayCurrency.cycleSatsFiat()}
          >
            <ArrowsLeftRightIcon size={18} weight="bold" />
            Switch to {cycleTarget}
          </button>

          <button
            class="flex items-center gap-2 text-sm hover:text-primary transition-colors cursor-pointer"
            on:click={toggleBalanceVisibility}
          >
            {#if $balanceVisible}
              <EyeClosedIcon size={18} weight="bold" />
              Hide Balance
            {:else}
              <EyeIcon size={18} weight="bold" />
              Show Balance
            {/if}
          </button>

          <button
            class="flex items-center gap-2 text-sm hover:text-primary transition-colors cursor-pointer"
            on:click={handleRefresh}
            disabled={$walletLoading}
          >
            <span class:animate-spin={$walletLoading}>
              <ArrowClockwiseIcon size={18} weight="bold" />
            </span>
            Refresh Balance
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}

{#if showRemoveBitcoinConnectModal && portalTarget}
  <div use:portal={portalTarget}>
    <div
      class="fixed inset-0 bg-black/50 flex z-50 p-4"
      style="display: flex; align-items: center; justify-content: center;"
    >
      <div
        class="rounded-2xl p-6 max-w-sm w-full max-h-[90vh] overflow-y-auto"
        style="background-color: var(--color-bg-primary);"
      >
        <h2 class="text-xl font-bold mb-2" style="color: var(--color-text-primary)">
          Remove External Wallet
        </h2>
        <p class="text-caption mb-6">
          Are you sure you want to disconnect your external wallet? You can reconnect it at any time
          from the wallet settings.
        </p>
        <div class="flex gap-3">
          <Button on:click={() => (showRemoveBitcoinConnectModal = false)} class="flex-1">
            Cancel
          </Button>
          <button
            class="flex-1 px-4 py-2 rounded-full bg-red-500 hover:bg-red-600 text-white font-medium transition-colors cursor-pointer"
            on:click={() => {
              handleDisconnectBitcoinConnect();
              showRemoveBitcoinConnectModal = false;
            }}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Highlight state for the pill that opens the wallet modal — subtle
     amber glow + brighter border on hover and keyboard focus so the
     button reads clearly as the primary action in the dropdown. */
  .wallet-name-pill {
    transition:
      background-color 0.15s ease-out,
      border-color 0.15s ease-out,
      box-shadow 0.15s ease-out;
  }
  .wallet-name-pill:hover,
  .wallet-name-pill:focus-visible {
    border-color: rgba(251, 191, 36, 0.5) !important;
    background-color: rgba(251, 191, 36, 0.08) !important;
    box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.12);
    outline: none;
  }
  .wallet-name-pill:active {
    transform: translateY(1px);
  }

  /* Outer pill is a role=button div; remove the default focus ring
     style and add our own to match the rest of the header chrome. */
  .balance-pill {
    outline: none;
  }
  .balance-pill:focus-visible {
    box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.35);
  }

  /* Dark mode — desktop pill matches the mobile pill (`.zh-wallet-mobile`
     in Header.svelte) so the header's wallet pill looks identical at
     every breakpoint. Translucent off-white fill + amber-tinted border
     picks up the brand colour. `!important` is necessary because the
     pill's <div> carries inline `style=` for background-color / border
     (set via CSS variables) — inline styles win class-selector
     specificity otherwise. */
  :global(.dark) .balance-pill {
    background-color: rgba(255, 255, 255, 0.08) !important;
    border-color: rgba(251, 191, 36, 0.35) !important;
    box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.08);
  }
  :global(.dark) .balance-pill:focus-visible {
    box-shadow:
      inset 0 0 0 1px rgba(251, 191, 36, 0.08),
      0 0 0 2px rgba(251, 191, 36, 0.35);
  }

  /* Inner balance text — display-only. Currency switching moved into
     the dropdown so an accidental tap on the balance can't change
     what's displayed; the outer pill handles the open-dropdown
     click. */
  .balance-text {
    display: inline-block;
    padding: 0 4px;
    margin: 0 -2px;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
</style>
