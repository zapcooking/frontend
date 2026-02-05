<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { walletBalance, walletConnected, activeWallet, getWalletKindName } from '$lib/wallet';
  import { lightningAddress, walletInitialized } from '$lib/spark';
  import { userPublickey } from '$lib/nostr';
  import Button from '../../../components/Button.svelte';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import WalletIcon from 'phosphor-svelte/lib/Wallet';
  import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRight';

  // Redirect to new wallet page on mount
  onMount(() => {
    if (browser) {
      goto('/wallet');
    }
  });

  function formatBalance(balance: number | null): string {
    if (balance === null) return '---';
    return balance.toLocaleString();
  }
</script>

<div class="space-y-6 p-4">
  <h1 class="text-2xl font-bold" style="color: var(--color-text-primary)">Wallet Settings</h1>

  <p class="text-caption">Wallet management has moved to a dedicated page with more features.</p>

  <!-- Quick status if wallet connected -->
  {#if $walletConnected && $activeWallet}
    <div
      class="rounded-xl p-4"
      style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
    >
      <div class="flex items-center gap-3 mb-2">
        <LightningIcon size={24} weight="fill" class="text-amber-500" />
        <span class="font-medium" style="color: var(--color-text-primary)">Connected Wallet</span>
      </div>
      <div class="ml-9 space-y-1">
        <p style="color: var(--color-text-primary)">
          {$activeWallet.name} ({getWalletKindName($activeWallet.kind)})
        </p>
        <p class="text-2xl font-bold" style="color: var(--color-text-primary)">
          {formatBalance($walletBalance)}
        </p>
        {#if $lightningAddress}
          <p class="text-sm text-caption">Lightning: {$lightningAddress}</p>
        {/if}
      </div>
    </div>
  {:else}
    <div
      class="rounded-xl p-4"
      style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
    >
      <div class="flex items-center gap-3">
        <WalletIcon size={24} class="text-caption" />
        <span style="color: var(--color-text-primary)">No wallet connected</span>
      </div>
    </div>
  {/if}

  <Button on:click={() => goto('/wallet')}>
    <span class="flex items-center gap-2">
      Go to Wallet Page
      <ArrowRightIcon size={16} />
    </span>
  </Button>

  <p class="text-sm text-caption">
    The wallet page lets you connect WebLN, NWC, or Spark wallets, view your balance, and manage
    multiple wallets.
  </p>
</div>
