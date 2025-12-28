<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { userPublickey } from '$lib/nostr';
  import Button from '../../components/Button.svelte';
  import {
    wallets,
    activeWallet,
    walletBalance,
    walletConnected,
    walletLoading,
    balanceVisible,
    getWalletKindName,
    setActiveWallet,
    toggleBalanceVisibility,
    type WalletKind
  } from '$lib/wallet';
  import {
    connectWallet,
    disconnectWallet,
    refreshBalance,
    isValidNwcUrl,
    getPaymentHistory,
    type Transaction
  } from '$lib/wallet/walletManager';
  import {
    isSparkWalletConfigured,
    createAndConnectWallet as createSparkWallet,
    connectWallet as connectSparkWallet,
    restoreFromMnemonic,
    restoreFromBackup,
    createBackup,
    backupWalletToNostr,
    restoreWalletFromNostr,
    type SparkWalletBackup
  } from '$lib/spark';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import WalletIcon from 'phosphor-svelte/lib/Wallet';
  import PlusIcon from 'phosphor-svelte/lib/Plus';
  import TrashIcon from 'phosphor-svelte/lib/Trash';
  import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwise';
  import CloudArrowUpIcon from 'phosphor-svelte/lib/CloudArrowUp';
  import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUp';
  import ArrowDownIcon from 'phosphor-svelte/lib/ArrowDown';
  import ClockIcon from 'phosphor-svelte/lib/Clock';
  import CloudArrowDownIcon from 'phosphor-svelte/lib/CloudArrowDown';
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';
  import WarningIcon from 'phosphor-svelte/lib/Warning';
  import EyeIcon from 'phosphor-svelte/lib/Eye';
  import EyeSlashIcon from 'phosphor-svelte/lib/EyeSlash';

  let showAddWallet = false;
  let selectedWalletType: WalletKind | null = null;
  let nwcConnectionString = '';
  let isConnecting = false;
  let errorMessage = '';
  let successMessage = '';
  let sparkMnemonic = '';
  let showMnemonic = false;

  // Spark restore options
  let sparkRestoreMode: 'options' | 'mnemonic' | 'file' = 'options';
  let restoreMnemonicInput = '';
  let fileInput: HTMLInputElement;
  let sparkLoadingMessage = ''; // Status message during Spark operations

  // Delete confirmation state
  let walletToDelete: { id: number; name: string } | null = null;

  // Transaction history state
  let transactions: Transaction[] = [];
  let isLoadingHistory = false;
  let hasMoreTransactions = false;
  const TRANSACTIONS_PER_PAGE = 10;

  // Breez API key (should be in environment variable)
  const BREEZ_API_KEY = import.meta.env.VITE_BREEZ_API_KEY || '';

  onMount(() => {
    if ($userPublickey === '') {
      goto('/login');
    }
  });

  // Load transaction history when wallet connects (not for WebLN)
  $: if ($walletConnected && $activeWallet && $activeWallet.kind !== 1) {
    loadTransactionHistory(true);
  }

  async function loadTransactionHistory(reset = false) {
    if (isLoadingHistory) return;

    isLoadingHistory = true;
    try {
      const offset = reset ? 0 : transactions.length;
      const result = await getPaymentHistory({ limit: TRANSACTIONS_PER_PAGE, offset });

      if (reset) {
        transactions = result.transactions;
      } else {
        transactions = [...transactions, ...result.transactions];
      }
      hasMoreTransactions = result.hasMore;
    } catch (e) {
      console.error('Failed to load transaction history:', e);
    } finally {
      isLoadingHistory = false;
    }
  }

  function formatTransactionDate(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  }

  function formatBalance(balance: number | null): string {
    if (balance === null) return '---';
    return balance.toLocaleString();
  }

  async function handleConnectNWC() {
    if (!nwcConnectionString.trim()) {
      errorMessage = 'Please enter a NWC connection string';
      return;
    }

    if (!isValidNwcUrl(nwcConnectionString)) {
      errorMessage = 'Invalid NWC connection string. It should start with nostr+walletconnect://';
      return;
    }

    isConnecting = true;
    errorMessage = '';

    try {
      const result = await connectWallet(3, nwcConnectionString); // Kind 3 = NWC
      if (result.success) {
        successMessage = 'NWC wallet connected successfully!';
        showAddWallet = false;
        selectedWalletType = null;
        nwcConnectionString = '';
      } else {
        errorMessage = result.error || 'Failed to connect NWC wallet';
      }
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Connection failed';
    } finally {
      isConnecting = false;
    }
  }

  async function handleCreateSparkWallet() {
    if (!BREEZ_API_KEY) {
      errorMessage = 'Breez API key not configured. Please contact support.';
      return;
    }

    isConnecting = true;
    sparkLoadingMessage = 'Creating new wallet...';
    errorMessage = '';

    try {
      const mnemonic = await createSparkWallet($userPublickey, BREEZ_API_KEY);
      sparkMnemonic = mnemonic;
      showMnemonic = true;
      successMessage = 'Spark wallet created! Please save your recovery phrase.';

      // Register in wallet store (don't await - let balance refresh happen in background)
      connectWallet(4, 'spark').catch(e => {
        console.warn('[Wallet] Background wallet registration warning:', e);
      });
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Failed to create Spark wallet';
    } finally {
      isConnecting = false;
      sparkLoadingMessage = '';
    }
  }

  async function handleConnectExistingSpark() {
    if (!BREEZ_API_KEY) {
      errorMessage = 'Breez API key not configured. Please contact support.';
      return;
    }

    isConnecting = true;
    sparkLoadingMessage = 'Connecting to existing wallet...';
    errorMessage = '';

    try {
      const connected = await connectSparkWallet($userPublickey, BREEZ_API_KEY);
      if (connected) {
        // Close modal immediately after successful connection
        successMessage = 'Spark wallet connected successfully!';
        showAddWallet = false;
        selectedWalletType = null;

        // Register in wallet store (don't await - let balance refresh happen in background)
        connectWallet(4, 'spark').catch(e => {
          console.warn('[Wallet] Background wallet registration warning:', e);
        });
      } else {
        errorMessage = 'No existing Spark wallet found. Create a new one instead.';
      }
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Failed to connect Spark wallet';
    } finally {
      isConnecting = false;
      sparkLoadingMessage = '';
    }
  }

  async function handleRestoreFromNostr() {
    if (!BREEZ_API_KEY) {
      errorMessage = 'Breez API key not configured. Please contact support.';
      return;
    }

    isConnecting = true;
    sparkLoadingMessage = 'Restoring from Nostr backup...';
    errorMessage = '';

    try {
      const mnemonic = await restoreWalletFromNostr($userPublickey, BREEZ_API_KEY);
      if (mnemonic) {
        // Close modal immediately after successful restore
        successMessage = 'Spark wallet restored from Nostr backup!';
        showAddWallet = false;
        selectedWalletType = null;

        // Register in wallet store (don't await - let balance refresh happen in background)
        connectWallet(4, 'spark').catch(e => {
          console.warn('[Wallet] Background wallet registration warning:', e);
        });
      } else {
        errorMessage = 'No backup found on Nostr relays.';
      }
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Failed to restore from Nostr';
    } finally {
      isConnecting = false;
      sparkLoadingMessage = '';
    }
  }

  async function handleBackupToNostr() {
    isConnecting = true;
    errorMessage = '';

    try {
      await backupWalletToNostr($userPublickey);
      successMessage = 'Wallet backed up to Nostr relays!';
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Failed to backup to Nostr';
    } finally {
      isConnecting = false;
    }
  }

  async function handleRestoreFromMnemonic() {
    if (!BREEZ_API_KEY) {
      errorMessage = 'Breez API key not configured. Please contact support.';
      return;
    }

    const mnemonic = restoreMnemonicInput.trim();
    if (!mnemonic) {
      errorMessage = 'Please enter your recovery phrase';
      return;
    }

    isConnecting = true;
    sparkLoadingMessage = 'Restoring from recovery phrase...';
    errorMessage = '';

    try {
      const success = await restoreFromMnemonic($userPublickey, mnemonic, BREEZ_API_KEY);
      if (success) {
        // Close modal immediately after successful restore
        successMessage = 'Spark wallet restored from recovery phrase!';
        showAddWallet = false;
        selectedWalletType = null;
        sparkRestoreMode = 'options';
        restoreMnemonicInput = '';

        // Register in wallet store (don't await - let balance refresh happen in background)
        connectWallet(4, 'spark').catch(e => {
          console.warn('[Wallet] Background wallet registration warning:', e);
        });
      } else {
        errorMessage = 'Failed to restore wallet from recovery phrase';
      }
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Failed to restore wallet';
    } finally {
      isConnecting = false;
      sparkLoadingMessage = '';
    }
  }

  async function handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (!BREEZ_API_KEY) {
      errorMessage = 'Breez API key not configured. Please contact support.';
      return;
    }

    isConnecting = true;
    sparkLoadingMessage = 'Restoring from backup file...';
    errorMessage = '';

    try {
      const text = await file.text();
      const backup = JSON.parse(text) as SparkWalletBackup;

      sparkLoadingMessage = 'Decrypting wallet backup...';

      // Decrypt the mnemonic using NIP-44 via browser extension
      const decryptFn = async (ciphertext: string, senderPubkey: string): Promise<string> => {
        const nostr = (window as any).nostr;
        if (!nostr) {
          throw new Error('No Nostr extension found. Please install Alby or another NIP-07 extension.');
        }
        if (nostr.nip44?.decrypt) {
          const decrypted = await nostr.nip44.decrypt(senderPubkey, ciphertext);
          if (decrypted) return decrypted;
        }
        throw new Error('Decryption failed. Make sure your browser extension supports NIP-44.');
      };

      sparkLoadingMessage = 'Connecting to Spark network...';

      const success = await restoreFromBackup($userPublickey, backup, BREEZ_API_KEY, decryptFn);
      if (success) {
        // Close modal immediately after successful restore
        successMessage = 'Spark wallet restored from backup file!';
        showAddWallet = false;
        selectedWalletType = null;
        sparkRestoreMode = 'options';

        // Register in wallet store (don't await - let balance refresh happen in background)
        connectWallet(4, 'spark').catch(e => {
          console.warn('[Wallet] Background wallet registration warning:', e);
        });
      } else {
        errorMessage = 'Failed to restore wallet from backup file';
      }
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Failed to restore from backup file';
    } finally {
      isConnecting = false;
      sparkLoadingMessage = '';
      // Reset file input
      if (input) input.value = '';
    }
  }

  async function handleDisconnectWallet(walletId: number) {
    await disconnectWallet(walletId);
    successMessage = 'Wallet disconnected';
  }

  async function handleSetActive(walletId: number) {
    setActiveWallet(walletId);
    await refreshBalance();
  }

  function closeMnemonicModal() {
    showMnemonic = false;
    sparkMnemonic = '';
    showAddWallet = false;
    selectedWalletType = null;
  }
</script>

<svelte:head>
  <title>Wallet - zap.cooking</title>
</svelte:head>

<div class="max-w-2xl mx-auto py-8 px-4">
  <h1 class="text-2xl font-bold mb-6" style="color: var(--color-text-primary)">Wallet</h1>

  <!-- Error/Success Messages -->
  {#if errorMessage}
    <div class="mb-4 p-4 rounded-lg flex items-center gap-2" style="background-color: rgba(239, 68, 68, 0.1); color: #ef4444;">
      <WarningIcon size={20} />
      <span>{errorMessage}</span>
      <button class="ml-auto text-sm underline" on:click={() => errorMessage = ''}>Dismiss</button>
    </div>
  {/if}

  {#if successMessage}
    <div class="mb-4 p-4 rounded-lg flex items-center gap-2" style="background-color: rgba(34, 197, 94, 0.1); color: #22c55e;">
      <CheckCircleIcon size={20} />
      <span>{successMessage}</span>
      <button class="ml-auto text-sm underline" on:click={() => successMessage = ''}>Dismiss</button>
    </div>
  {/if}

  <!-- Balance Overview -->
  {#if $walletConnected && $activeWallet}
    <div class="mb-8 p-6 rounded-2xl bg-input border border-input">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <LightningIcon size={24} weight="fill" class="text-amber-500" />
          <span class="font-medium text-primary-color">Balance</span>
        </div>
        <div class="flex items-center gap-3">
          <button
            class="flex items-center gap-1 text-sm text-caption hover:text-primary transition-colors cursor-pointer"
            on:click={toggleBalanceVisibility}
            title={$balanceVisible ? 'Hide balance' : 'Show balance'}
          >
            {#if $balanceVisible}
              <EyeSlashIcon size={16} />
            {:else}
              <EyeIcon size={16} />
            {/if}
          </button>
          <button
            class="flex items-center gap-1 text-sm text-caption hover:text-primary transition-colors cursor-pointer"
            on:click={() => refreshBalance()}
            disabled={$walletLoading}
          >
            <span class:animate-spin={$walletLoading}>
              <ArrowsClockwiseIcon size={16} />
            </span>
            Refresh
          </button>
        </div>
      </div>
      <div class="text-4xl font-bold mb-2 text-primary-color flex items-center gap-3">
        {#if $walletLoading || $walletBalance === null}
          <span class="animate-pulse">...</span>
        {:else if $balanceVisible}
          {formatBalance($walletBalance)} <span class="text-lg font-normal text-caption">sats</span>
        {:else}
          *** <span class="text-lg font-normal text-caption">sats</span>
        {/if}
      </div>
      <div class="text-sm text-caption">
        Active: {$activeWallet.name} ({getWalletKindName($activeWallet.kind)})
      </div>

      <!-- Spark-specific actions -->
      {#if $activeWallet.kind === 4}
        <div class="mt-4 pt-4 border-t flex gap-2" style="border-color: var(--color-input-border);">
          <Button on:click={handleBackupToNostr} disabled={isConnecting}>
            <CloudArrowUpIcon size={16} />
            Backup to Nostr
          </Button>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Connected Wallets -->
  <div class="mb-8">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold" style="color: var(--color-text-primary)">Connected Wallets</h2>
      <Button on:click={() => { showAddWallet = true; selectedWalletType = null; }}>
        <PlusIcon size={16} />
        Add Wallet
      </Button>
    </div>

    {#if $wallets.length === 0}
      <div class="p-8 rounded-2xl text-center" style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);">
        <WalletIcon size={48} class="mx-auto mb-4 text-caption" />
        <p class="text-caption mb-4">No wallets connected yet</p>
        <Button on:click={() => { showAddWallet = true; selectedWalletType = null; }}>
          Connect Your First Wallet
        </Button>
      </div>
    {:else}
      <div class="space-y-3">
        {#each $wallets as wallet}
          <div
            class="p-4 rounded-xl flex items-center gap-4"
            style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
            class:ring-2={wallet.active}
            class:ring-amber-500={wallet.active}
          >
            <div class="flex-1">
              <div class="font-medium" style="color: var(--color-text-primary)">{wallet.name}</div>
              <div class="text-sm text-caption">{getWalletKindName(wallet.kind)}</div>
            </div>
            {#if wallet.active}
              <span class="text-xs px-2 py-1 rounded-full bg-amber-500 text-white">Active</span>
            {:else}
              <button
                class="text-sm text-caption hover:text-primary cursor-pointer"
                on:click={() => handleSetActive(wallet.id)}
              >
                Set Active
              </button>
            {/if}
            <button
              class="text-caption hover:text-red-500 cursor-pointer"
              on:click={() => walletToDelete = { id: wallet.id, name: wallet.name }}
            >
              <TrashIcon size={18} />
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Transaction History -->
  {#if $walletConnected && $activeWallet}
    <div class="mb-8">
      {#if $activeWallet.kind === 1}
        <!-- WebLN disclaimer -->
        <div class="p-6 rounded-2xl text-center bg-input border border-input">
          <ClockIcon size={32} class="mx-auto mb-3 text-caption" />
          <p class="text-caption text-sm">
            Transaction history is available in your browser wallet extension.
          </p>
        </div>
      {:else}
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold flex items-center gap-2" style="color: var(--color-text-primary)">
            <ClockIcon size={20} />
            Recent Transactions
          </h2>
        </div>

        {#if isLoadingHistory && transactions.length === 0}
        <div class="p-8 rounded-2xl text-center bg-input border border-input">
          <div class="animate-pulse text-caption">Loading transactions...</div>
        </div>
      {:else if transactions.length === 0}
        <div class="p-8 rounded-2xl text-center bg-input border border-input">
          <ClockIcon size={48} class="mx-auto mb-4 text-caption" />
          <p class="text-caption">No transactions yet</p>
        </div>
      {:else}
        <div class="space-y-2">
          {#each transactions as tx (tx.id)}
            <div class="p-4 rounded-xl flex items-center gap-4 bg-input border border-input">
              <div class="w-10 h-10 rounded-full flex items-center justify-center {tx.type === 'incoming' ? 'bg-green-500/20' : 'bg-orange-500/20'}">
                {#if tx.type === 'incoming'}
                  <ArrowDownIcon size={20} class="text-green-500" />
                {:else}
                  <ArrowUpIcon size={20} class="text-orange-500" />
                {/if}
              </div>
              <div class="flex-1 min-w-0">
                <div class="font-medium truncate text-primary-color">
                  {tx.description || (tx.type === 'incoming' ? 'Received' : 'Sent')}
                </div>
                <div class="text-sm text-caption">
                  {formatTransactionDate(tx.timestamp)}
                  {#if tx.fees && $balanceVisible}
                    <span class="ml-2">• Fee: {tx.fees} sats</span>
                  {/if}
                </div>
              </div>
              <div class="text-right">
                <div class="font-semibold {tx.type === 'incoming' ? 'text-green-500' : 'text-orange-500'}">
                  {#if $balanceVisible}
                    {tx.type === 'incoming' ? '+' : '-'}{tx.amount.toLocaleString()} sats
                  {:else}
                    {tx.type === 'incoming' ? '+' : '-'}*** sats
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        </div>

        {#if hasMoreTransactions}
          <div class="mt-4 text-center">
            <Button on:click={() => loadTransactionHistory(false)} disabled={isLoadingHistory}>
              {isLoadingHistory ? 'Loading...' : 'Load More'}
            </Button>
          </div>
        {/if}
      {/if}
    {/if}
    </div>
  {/if}

  <!-- Add Wallet Modal -->
  {#if showAddWallet}
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div class="rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto" style="background-color: var(--color-bg-primary);">
        <h2 class="text-xl font-bold mb-4" style="color: var(--color-text-primary)">Add Wallet</h2>

        {#if !selectedWalletType}
          <!-- Wallet type selection -->
          <div class="space-y-3">
            <button
              class="w-full p-4 rounded-xl text-left flex items-center gap-4 transition-colors cursor-pointer"
              style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
              on:click={() => selectedWalletType = 3}
            >
              <div class="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
                <WalletIcon size={24} class="text-purple-500" />
              </div>
              <div>
                <div class="font-medium" style="color: var(--color-text-primary)">NWC (Nostr Wallet Connect)</div>
                <div class="text-sm text-caption">Connect any NWC-compatible wallet</div>
              </div>
            </button>

            <button
              class="w-full p-4 rounded-xl text-left flex items-center gap-4 transition-colors cursor-pointer"
              style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
              on:click={() => selectedWalletType = 4}
            >
              <div class="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center">
                <LightningIcon size={24} weight="fill" class="text-orange-500" />
              </div>
              <div>
                <div class="font-medium" style="color: var(--color-text-primary)">Spark (Self-Custodial)</div>
                <div class="text-sm text-caption">Create or restore a built-in Lightning wallet</div>
              </div>
            </button>
          </div>
        {:else if selectedWalletType === 3}
          <!-- NWC connection -->
          <div>
            <p class="text-caption mb-4">
              Paste your NWC connection string below. You can get this from your wallet app.
            </p>
            <input
              type="text"
              class="w-full p-3 rounded-lg mb-4 input"
              placeholder="nostr+walletconnect://..."
              bind:value={nwcConnectionString}
              on:paste={(e) => {
                // Clean pasted content immediately
                setTimeout(() => {
                  nwcConnectionString = nwcConnectionString.trim().replace(/[\r\n\t]/g, '');
                }, 0);
              }}
            />
            <div class="flex gap-2">
              <Button on:click={() => { selectedWalletType = null; nwcConnectionString = ''; }} disabled={isConnecting}>Back</Button>
              <Button on:click={handleConnectNWC} disabled={isConnecting}>
                {isConnecting ? 'Connecting...' : 'Connect NWC'}
              </Button>
            </div>
          </div>
        {:else if selectedWalletType === 4}
          <!-- Spark wallet options -->
          <div>
            {#if sparkRestoreMode === 'options'}
              <p class="text-caption mb-4">
                Spark is a self-custodial Lightning wallet built into zap.cooking.
              </p>

              {#if isConnecting && sparkLoadingMessage}
                <!-- Show loading state -->
                <div class="p-8 rounded-xl text-center" style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);">
                  <div class="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full mx-auto mb-4"></div>
                  <p class="text-primary-color font-medium">{sparkLoadingMessage}</p>
                  <p class="text-caption text-sm mt-2">This may take a moment...</p>
                </div>
              {:else}
                <div class="space-y-3 mb-4">
                  {#if isSparkWalletConfigured($userPublickey)}
                    <Button on:click={handleConnectExistingSpark} disabled={isConnecting} class="w-full">
                      Connect Existing Wallet
                    </Button>
                  {/if}
                  <Button on:click={handleCreateSparkWallet} disabled={isConnecting} class="w-full">
                    Create New Wallet
                  </Button>
                  <div class="border-t pt-3 mt-3" style="border-color: var(--color-input-border);">
                    <p class="text-sm text-caption mb-2">Restore existing wallet:</p>
                    <div class="space-y-2">
                      <Button on:click={() => sparkRestoreMode = 'mnemonic'} disabled={isConnecting} class="w-full">
                        Restore from Recovery Phrase
                      </Button>
                      <Button on:click={() => fileInput?.click()} disabled={isConnecting} class="w-full">
                        Restore from Backup File
                      </Button>
                      <input
                        type="file"
                        accept=".json"
                        class="hidden"
                        bind:this={fileInput}
                        on:change={handleFileSelect}
                      />
                      <Button on:click={handleRestoreFromNostr} disabled={isConnecting} class="w-full">
                        <CloudArrowDownIcon size={16} />
                        Restore from Nostr Backup
                      </Button>
                    </div>
                  </div>
                </div>
              {/if}
              <Button on:click={() => selectedWalletType = null} disabled={isConnecting}>Back</Button>
            {:else if sparkRestoreMode === 'mnemonic'}
              <p class="text-caption mb-4">
                Enter your 12 or 24 word recovery phrase to restore your wallet.
              </p>
              <textarea
                class="w-full p-3 rounded-lg mb-4 input"
                rows="3"
                placeholder="Enter your recovery phrase..."
                bind:value={restoreMnemonicInput}
              ></textarea>
              <div class="flex gap-2">
                <Button on:click={() => { sparkRestoreMode = 'options'; restoreMnemonicInput = ''; }} disabled={isConnecting}>Back</Button>
                <Button on:click={handleRestoreFromMnemonic} disabled={isConnecting}>
                  {isConnecting ? 'Restoring...' : 'Restore Wallet'}
                </Button>
              </div>
            {/if}
          </div>
        {/if}

        <button
          class="mt-4 w-full text-center text-sm text-caption hover:text-primary cursor-pointer"
          on:click={() => { showAddWallet = false; selectedWalletType = null; nwcConnectionString = ''; errorMessage = ''; sparkRestoreMode = 'options'; restoreMnemonicInput = ''; }}
        >
          Cancel
        </button>
      </div>
    </div>
  {/if}

  <!-- Mnemonic Display Modal -->
  {#if showMnemonic && sparkMnemonic}
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div class="rounded-2xl p-6 max-w-md w-full" style="background-color: var(--color-bg-primary);">
        <h2 class="text-xl font-bold mb-4" style="color: var(--color-text-primary)">Save Your Recovery Phrase</h2>
        <div class="mb-4 p-4 rounded-lg" style="background-color: rgba(239, 68, 68, 0.1); color: #ef4444;">
          <WarningIcon size={20} class="inline mr-2" />
          Write down these 12 words and store them securely. If you lose them, you will lose access to your wallet.
        </div>
        <div class="p-4 rounded-lg mb-4 font-mono text-sm" style="background-color: var(--color-input-bg); color: var(--color-text-primary);">
          {sparkMnemonic}
        </div>
        <Button on:click={closeMnemonicModal} class="w-full">I've Saved My Recovery Phrase</Button>
      </div>
    </div>
  {/if}

  <!-- Delete Wallet Confirmation Modal -->
  {#if walletToDelete}
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div class="rounded-2xl p-6 max-w-sm w-full" style="background-color: var(--color-bg-primary);">
        <h2 class="text-xl font-bold mb-2" style="color: var(--color-text-primary)">Remove Wallet</h2>
        <p class="text-caption mb-6">
          Are you sure you want to remove <strong class="text-primary-color">{walletToDelete.name}</strong>? You can reconnect it later.
        </p>
        <div class="flex gap-3">
          <Button on:click={() => walletToDelete = null} class="flex-1">
            Cancel
          </Button>
          <button
            class="flex-1 px-4 py-2 rounded-full bg-red-500 hover:bg-red-600 text-white font-medium transition-colors cursor-pointer"
            on:click={async () => {
              if (walletToDelete) {
                await handleDisconnectWallet(walletToDelete.id);
                walletToDelete = null;
              }
            }}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
