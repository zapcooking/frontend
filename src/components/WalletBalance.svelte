<script lang="ts">
  import { goto } from '$app/navigation';
  import { clickOutside } from '$lib/clickOutside';
  import { fade } from 'svelte/transition';
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
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import WalletIcon from 'phosphor-svelte/lib/Wallet';
  import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwise';
  import GearIcon from 'phosphor-svelte/lib/Gear';
  import SignOutIcon from 'phosphor-svelte/lib/SignOut';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import EyeIcon from 'phosphor-svelte/lib/Eye';
  import EyeSlashIcon from 'phosphor-svelte/lib/EyeSlash';
  import SparkLogo from './icons/SparkLogo.svelte';
  import NwcLogo from './icons/NwcLogo.svelte';

  let dropdownActive = false;

  function formatBalance(balance: number | null): string {
    if (balance === null) return '---';
    if (balance >= 1000000) {
      return `${(balance / 1000000).toFixed(2)}M`;
    }
    if (balance >= 1000) {
      return `${(balance / 1000).toFixed(1)}k`;
    }
    return balance.toLocaleString();
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
    goto('/wallet');
  }
</script>

{#if $walletConnected && $activeWallet}
  <div class="relative" use:clickOutside on:click_outside={() => (dropdownActive = false)}>
    <!-- Balance button -->
    <button
      class="flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors cursor-pointer text-sm font-medium"
      style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
      on:click={() => (dropdownActive = !dropdownActive)}
    >
      <LightningIcon size={16} weight="fill" class="text-amber-500" />
      {#if $walletLoading || $walletBalance === null}
        <span class="animate-pulse">...</span>
      {:else if $balanceVisible}
        <span>{formatBalance($walletBalance)}</span>
      {:else}
        <span>***</span>
      {/if}
      <span class="text-caption text-xs">sats</span>
      <CaretDownIcon size={12} class="text-caption ml-0.5" />
    </button>

    <!-- Dropdown menu -->
    {#if dropdownActive}
      <div class="absolute right-0 top-full mt-2 z-20" transition:fade={{ delay: 0, duration: 150 }}>
        <div
          role="menu"
          tabindex="-1"
          on:keydown={(e) => e.key === 'Escape' && (dropdownActive = false)}
          class="flex flex-col gap-3 bg-input rounded-2xl drop-shadow px-4 py-4 min-w-[220px] max-w-[280px]"
          style="color: var(--color-text-primary)"
        >
          <!-- Current wallet info (clickable to open wallet page) -->
          <button
            class="flex items-center gap-2 pb-2 border-b w-full text-left hover:opacity-80 transition-opacity cursor-pointer"
            style="border-color: var(--color-input-border);"
            on:click={goToWallet}
          >
            <WalletIcon size={18} class="text-amber-500 flex-shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="font-medium text-sm truncate">{$activeWallet.name}</div>
            </div>
            {#if $activeWallet.kind === 4}
              <SparkLogo size={16} className="flex-shrink-0" />
            {:else if $activeWallet.kind === 3}
              <NwcLogo size={16} className="flex-shrink-0" />
            {/if}
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
            on:click={toggleBalanceVisibility}
          >
            {#if $balanceVisible}
              <EyeSlashIcon size={16} />
              Hide Balance
            {:else}
              <EyeIcon size={16} />
              Show Balance
            {/if}
          </button>

          <button
            class="flex items-center gap-2 text-sm hover:text-primary transition-colors cursor-pointer"
            on:click={handleRefresh}
            disabled={$walletLoading}
          >
            <span class:animate-spin={$walletLoading}>
              <ArrowsClockwiseIcon size={16} />
            </span>
            Refresh Balance
          </button>

          <button
            class="flex items-center gap-2 text-sm hover:text-primary transition-colors cursor-pointer"
            on:click={goToWallet}
          >
            <GearIcon size={16} />
            Wallet Settings
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}
