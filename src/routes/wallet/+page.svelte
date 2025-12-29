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
  import { parseNwcUrl, getNwcInfo, connectNwc, isNwcConnected } from '$lib/wallet/nwc';
  import {
    createAndConnectWallet as createSparkWallet,
    restoreFromMnemonic,
    restoreFromBackup,
    createBackup,
    backupWalletToNostr,
    restoreWalletFromNostr,
    loadMnemonic,
    lightningAddress as sparkLightningAddressStore,
    checkLightningAddressAvailable,
    registerLightningAddress,
    deleteLightningAddress,
    type SparkWalletBackup
  } from '$lib/spark';
  import { syncLightningAddressToProfile } from '$lib/spark/profileSync';
  import { ndk, ndkReady } from '$lib/nostr';
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
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
  import GearIcon from 'phosphor-svelte/lib/Gear';
  import KeyIcon from 'phosphor-svelte/lib/Key';
  import DownloadSimpleIcon from 'phosphor-svelte/lib/DownloadSimple';
  import CopyIcon from 'phosphor-svelte/lib/Copy';
  import InfoIcon from 'phosphor-svelte/lib/Info';
  import LinkIcon from 'phosphor-svelte/lib/Link';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import XIcon from 'phosphor-svelte/lib/X';
  import UserCirclePlusIcon from 'phosphor-svelte/lib/UserCirclePlus';
  import SparkLogo from '../../components/icons/SparkLogo.svelte';
  import NwcLogo from '../../components/icons/NwcLogo.svelte';

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
  let walletToDelete: { id: number; name: string; kind: number; data: string } | null = null;

  // Wallet options (shared between Spark and NWC)
  let expandedWalletId: number | null = null;
  let revealedMnemonic: string | null = null;
  let isBackingUp = false;

  // NWC wallet info
  let nwcWalletInfo: { alias?: string; methods: string[]; relay: string; pubkey: string } | null = null;
  let isLoadingNwcInfo = false;

  // Lightning address state
  let newLightningUsername = '';
  let isCheckingAvailability = false;
  let isUsernameAvailable: boolean | null = null;
  let isRegisteringAddress = false;
  let isDeletingAddress = false;
  let isSyncingProfile = false;
  let showSyncConfirmModal = false;
  let showDeleteAddressConfirmModal = false;
  let availabilityCheckTimeout: ReturnType<typeof setTimeout> | null = null;

  // User's profile lud16 (from Nostr kind 0)
  let profileLud16: string | null = null;
  let isLoadingProfileLud16 = false;

  // Check if profile lud16 matches Spark wallet address
  $: isProfileSynced = profileLud16 && $sparkLightningAddressStore &&
    profileLud16.toLowerCase().trim() === $sparkLightningAddressStore.toLowerCase().trim();

  // Check if a Spark wallet already exists (only one allowed at a time)
  $: hasExistingSparkWallet = $wallets.some(w => w.kind === 4);

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
      return;
    }

    // Fetch user's profile lud16
    fetchProfileLud16();

    // Load transaction history if wallet is already connected (not for WebLN)
    if ($walletConnected && $activeWallet && $activeWallet.kind !== 1) {
      loadTransactionHistory(true);
    }
  });

  /**
   * Fetch the user's profile lud16 from Nostr (kind 0)
   */
  async function fetchProfileLud16() {
    if (!$userPublickey) return;

    isLoadingProfileLud16 = true;
    try {
      await ndkReady;
      const ndkInstance = $ndk;

      const filter = {
        kinds: [0],
        authors: [$userPublickey],
        limit: 1
      };

      const events = await ndkInstance.fetchEvents(filter, { closeOnEose: true });

      if (events && events.size > 0) {
        // Get the most recent profile event
        let latestEvent: any = null;
        for (const event of events) {
          if (!latestEvent || (event.created_at && latestEvent.created_at && event.created_at > latestEvent.created_at)) {
            latestEvent = event;
          }
        }

        if (latestEvent && latestEvent.content) {
          try {
            const profile = JSON.parse(latestEvent.content);
            profileLud16 = profile.lud16 || null;
            console.log('[Wallet] User profile lud16:', profileLud16);
          } catch (e) {
            console.error('[Wallet] Failed to parse profile:', e);
          }
        }
      }
    } catch (e) {
      console.error('[Wallet] Failed to fetch profile:', e);
    } finally {
      isLoadingProfileLud16 = false;
    }
  }

  // Load transaction history when wallet connects or changes (not for WebLN)
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
      successMessage = 'Breez Spark wallet created! Please save your recovery phrase.';

      // Register in wallet store - await to ensure stores are updated for transaction history
      await connectWallet(4, 'spark');
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Failed to create Breez Spark wallet';
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
        // Register in wallet store and wait for balance refresh
        await connectWallet(4, 'spark');

        // Close modal after successful registration
        successMessage = 'Breez Spark wallet restored from Nostr backup!';
        showAddWallet = false;
        selectedWalletType = null;
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
        // Register in wallet store and wait for balance refresh
        await connectWallet(4, 'spark');

        // Close modal after successful registration
        successMessage = 'Breez Spark wallet restored from recovery phrase!';
        showAddWallet = false;
        selectedWalletType = null;
        sparkRestoreMode = 'options';
        restoreMnemonicInput = '';
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

      // Decrypt using the encryption method - detect from backup format
      const decryptFn = async (ciphertext: string, senderPubkey: string): Promise<string> => {
        const nostr = (window as any).nostr;
        if (!nostr) {
          throw new Error('No Nostr extension found. Please install Alby or another NIP-07 extension.');
        }

        // Determine encryption method (compatible with Yakihonne/Primal/Jumble backups)
        // Priority: 1) explicit encryption field, 2) detect from format, 3) assume based on version
        let useNip44 = false;
        if (backup.encryption) {
          // Explicit encryption field (v2 backups from zap.cooking, Primal)
          useNip44 = backup.encryption === 'nip44';
        } else if (ciphertext.includes('?iv=')) {
          // NIP-04 format has ?iv= separator
          useNip44 = false;
        } else {
          // Default: v2 = NIP-44, v1 = NIP-04
          useNip44 = backup.version === 2;
        }

        if (useNip44) {
          if (!nostr.nip44?.decrypt) {
            throw new Error('This backup was encrypted with NIP-44 but your extension does not support it.');
          }
          const decrypted = await nostr.nip44.decrypt(senderPubkey, ciphertext);
          if (decrypted) return decrypted;
        } else {
          // NIP-04
          if (!nostr.nip04?.decrypt) {
            throw new Error('This backup was encrypted with NIP-04 but your extension does not support it.');
          }
          const decrypted = await nostr.nip04.decrypt(senderPubkey, ciphertext);
          if (decrypted) return decrypted;
        }

        throw new Error('Decryption failed. Make sure you are using the same Nostr key that created this backup.');
      };

      sparkLoadingMessage = 'Connecting to Spark network...';

      const success = await restoreFromBackup($userPublickey, backup, BREEZ_API_KEY, decryptFn);
      if (success) {
        // Register in wallet store and wait for balance refresh
        await connectWallet(4, 'spark');

        // Close modal after successful registration
        successMessage = 'Breez Spark wallet restored from backup file!';
        showAddWallet = false;
        selectedWalletType = null;
        sparkRestoreMode = 'options';
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

  function toggleWalletOptions(walletId: number) {
    expandedWalletId = expandedWalletId === walletId ? null : walletId;
  }

  async function handleRevealMnemonic() {
    errorMessage = '';
    try {
      const mnemonic = await loadMnemonic($userPublickey);
      if (mnemonic) {
        revealedMnemonic = mnemonic;
      } else {
        errorMessage = 'Could not load recovery phrase';
      }
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Failed to load recovery phrase';
    }
  }

  function closeRevealMnemonicModal() {
    revealedMnemonic = null;
  }

  async function handleDownloadBackup() {
    isBackingUp = true;
    errorMessage = '';

    try {
      const nostr = (window as any).nostr;
      if (!nostr) {
        throw new Error('No Nostr extension found. Please install Alby or another NIP-07 extension.');
      }

      // Determine encryption method - prefer NIP-44, fall back to NIP-04
      let encryptionMethod: 'nip44' | 'nip04';
      let encryptFn: (plaintext: string, recipientPubkey: string) => Promise<string>;

      if (nostr.nip44?.encrypt) {
        encryptionMethod = 'nip44';
        encryptFn = async (plaintext: string, recipientPubkey: string): Promise<string> => {
          return await nostr.nip44.encrypt(recipientPubkey, plaintext);
        };
      } else if (nostr.nip04?.encrypt) {
        encryptionMethod = 'nip04';
        encryptFn = async (plaintext: string, recipientPubkey: string): Promise<string> => {
          return await nostr.nip04.encrypt(recipientPubkey, plaintext);
        };
      } else {
        throw new Error('Your Nostr extension does not support encryption. Please use a different extension like Alby.');
      }

      const backup = await createBackup($userPublickey, encryptFn, encryptionMethod);

      // Download as JSON file
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `spark-wallet-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      successMessage = encryptionMethod === 'nip04'
        ? 'Backup file downloaded! (encrypted with NIP-04)'
        : 'Backup file downloaded!';
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Failed to create backup';
    } finally {
      isBackingUp = false;
    }
  }

  async function handleBackupToNostr() {
    isBackingUp = true;
    errorMessage = '';

    try {
      await backupWalletToNostr($userPublickey);
      successMessage = 'Wallet backed up to Nostr relays!';
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Failed to backup to Nostr';
    } finally {
      isBackingUp = false;
    }
  }

  // NWC wallet functions
  async function handleViewNwcInfo(wallet: { data: string }) {
    isLoadingNwcInfo = true;
    errorMessage = '';

    try {
      const parsed = parseNwcUrl(wallet.data);
      if (!parsed) {
        throw new Error('Invalid NWC connection string');
      }

      // Ensure NWC is connected before fetching info
      if (!isNwcConnected()) {
        await connectNwc(wallet.data);
      }

      const info = await getNwcInfo();
      nwcWalletInfo = {
        alias: info.alias,
        methods: info.methods,
        relay: parsed.relay,
        pubkey: parsed.pubkey
      };
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Failed to get wallet info';
    } finally {
      isLoadingNwcInfo = false;
    }
  }

  function closeNwcInfoModal() {
    nwcWalletInfo = null;
  }

  async function handleCopyNwcConnection(wallet: { data: string }) {
    try {
      await navigator.clipboard.writeText(wallet.data);
      successMessage = 'Connection string copied to clipboard!';
    } catch (e) {
      errorMessage = 'Failed to copy to clipboard';
    }
  }

  function handleDownloadNwcBackup(wallet: { data: string; name: string }) {
    try {
      const parsed = parseNwcUrl(wallet.data);

      // Create plain text backup with NWC string on its own line for easy copying
      const lines = [
        'Important: Store this information securely. If you lose it, recovery may not be possible. Keep it private and protected at all times.',
        '---',
        `Wallet: ${wallet.name}`
      ];

      // Add relay info
      if (parsed) {
        lines.push(`Relay: ${parsed.relay}`);
      }

      // Add NWC connection string on its own line for easy copying
      lines.push('');
      lines.push('NWC Connection String:');
      lines.push(wallet.data);

      const content = lines.join('\n');

      // Download as text file
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = wallet.name.replace(/[^a-zA-Z0-9]/g, '-');
      a.download = `${safeName}-NWC.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      successMessage = 'NWC backup file downloaded!';
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Failed to create backup';
    }
  }

  // Lightning address functions
  function handleUsernameInput(event: Event) {
    const input = event.target as HTMLInputElement;
    newLightningUsername = input.value.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Clear previous timeout
    if (availabilityCheckTimeout) {
      clearTimeout(availabilityCheckTimeout);
    }

    // Reset availability state
    isUsernameAvailable = null;

    // Don't check if empty or too short
    if (newLightningUsername.length < 3) {
      isCheckingAvailability = false;
      return;
    }

    // Debounce the availability check
    isCheckingAvailability = true;
    availabilityCheckTimeout = setTimeout(async () => {
      try {
        isUsernameAvailable = await checkLightningAddressAvailable(newLightningUsername);
      } catch (e) {
        console.error('Availability check failed:', e);
        isUsernameAvailable = null;
      } finally {
        isCheckingAvailability = false;
      }
    }, 500);
  }

  async function handleRegisterLightningAddress() {
    if (!newLightningUsername || !isUsernameAvailable) return;

    isRegisteringAddress = true;
    errorMessage = '';

    try {
      const address = await registerLightningAddress(newLightningUsername);
      successMessage = `Lightning address registered: ${address}`;
      newLightningUsername = '';
      isUsernameAvailable = null;
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Failed to register lightning address';
    } finally {
      isRegisteringAddress = false;
    }
  }

  async function handleDeleteLightningAddress() {
    isDeletingAddress = true;
    errorMessage = '';

    try {
      await deleteLightningAddress();
      successMessage = 'Lightning address deleted';
      showDeleteAddressConfirmModal = false;
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Failed to delete lightning address';
    } finally {
      isDeletingAddress = false;
    }
  }

  async function handleSyncToProfile() {
    const address = $sparkLightningAddressStore;
    if (!address) return;

    isSyncingProfile = true;
    errorMessage = '';

    try {
      await syncLightningAddressToProfile(address, $userPublickey, $ndk);
      successMessage = 'Lightning address synced to your Nostr profile!';
      showSyncConfirmModal = false;

      // Refresh profile lud16 to update the sync status
      await fetchProfileLud16();
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Failed to sync to profile';
    } finally {
      isSyncingProfile = false;
    }
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
            class="rounded-xl overflow-hidden"
            style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
            class:ring-2={wallet.active}
            class:ring-amber-500={wallet.active}
          >
            <div class="p-4 flex items-center gap-4">
              <div class="flex-1 min-w-0">
                <div class="font-medium" style="color: var(--color-text-primary)">{wallet.name}</div>
                <div class="text-sm text-caption">
                  {getWalletKindName(wallet.kind)}{#if wallet.kind === 3}{@const parsed = parseNwcUrl(wallet.data)}{#if parsed} · {parsed.pubkey.slice(0, 8)}...{/if}{/if}
                </div>
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
              {#if wallet.kind === 4 || wallet.kind === 3}
                <button
                  class="relative flex items-center gap-1 px-2 py-1 rounded-lg text-caption hover:text-primary hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer transition-all"
                  on:click={() => toggleWalletOptions(wallet.id)}
                  title="Wallet options"
                >
                  <GearIcon size={18} weight={expandedWalletId === wallet.id ? "fill" : "regular"} />
                  <!-- Notification dot for Spark wallets without lightning address -->
                  {#if wallet.kind === 4 && !$sparkLightningAddressStore && expandedWalletId !== wallet.id}
                    <span class="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-amber-500 rounded-full border-2" style="border-color: var(--color-input-bg);"></span>
                  {/if}
                  <CaretDownIcon
                    size={14}
                    weight="bold"
                    class="transition-transform {expandedWalletId === wallet.id ? 'rotate-180' : ''}"
                  />
                </button>
              {/if}
              <button
                class="text-caption hover:text-red-500 cursor-pointer"
                on:click={() => walletToDelete = { id: wallet.id, name: wallet.name, kind: wallet.kind, data: wallet.data }}
              >
                <TrashIcon size={18} />
              </button>
            </div>

            <!-- Spark wallet backup options -->
            {#if wallet.kind === 4 && expandedWalletId === wallet.id}
              <div class="px-4 pb-4 pt-2 border-t" style="border-color: var(--color-input-border);">
                <div class="text-xs text-caption mb-3 uppercase tracking-wide">Backup Options</div>
                <div class="flex flex-wrap gap-2">
                  <button
                    class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer"
                    style="background-color: var(--color-bg-primary); border: 1px solid var(--color-input-border);"
                    on:click={handleBackupToNostr}
                    disabled={isBackingUp}
                  >
                    <CloudArrowUpIcon size={16} />
                    {isBackingUp ? 'Backing up...' : 'Backup to Nostr'}
                  </button>
                  <button
                    class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer"
                    style="background-color: var(--color-bg-primary); border: 1px solid var(--color-input-border);"
                    on:click={handleDownloadBackup}
                    disabled={isBackingUp}
                  >
                    <DownloadSimpleIcon size={16} />
                    Download Backup
                  </button>
                  <button
                    class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer"
                    style="background-color: var(--color-bg-primary); border: 1px solid var(--color-input-border);"
                    on:click={handleRevealMnemonic}
                  >
                    <KeyIcon size={16} />
                    Show Recovery Phrase
                  </button>
                </div>

                <!-- Lightning Address Section -->
                <div class="mt-4 pt-4 border-t" style="border-color: var(--color-input-border);">
                  <div class="text-xs text-caption mb-3 uppercase tracking-wide flex items-center gap-2">
                    <LightningIcon size={14} />
                    Lightning Address
                  </div>

                  {#if $sparkLightningAddressStore}
                    <!-- Has lightning address -->
                    <div class="p-3 rounded-lg mb-3" style="background-color: var(--color-bg-primary); border: 1px solid var(--color-input-border);">
                      <div class="text-sm text-caption mb-1">Your lightning address:</div>
                      <div class="font-medium text-primary-color flex items-center gap-2">
                        {$sparkLightningAddressStore}
                        {#if isLoadingProfileLud16}
                          <div class="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
                        {:else if isProfileSynced}
                          <span class="text-green-500" title="Synced to your Nostr profile">
                            <CheckCircleIcon size={18} weight="fill" />
                          </span>
                        {:else}
                          <span class="text-amber-500" title="Not synced to your Nostr profile">
                            <WarningIcon size={18} weight="fill" />
                          </span>
                        {/if}
                      </div>
                    </div>

                    <!-- Profile sync status -->
                    {#if !isLoadingProfileLud16}
                      {#if isProfileSynced}
                        <div class="p-3 rounded-lg mb-3" style="background-color: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3);">
                          <div class="text-sm text-green-600 flex items-center gap-2">
                            <CheckCircleIcon size={16} weight="fill" />
                            This address is set in your Nostr profile
                          </div>
                        </div>
                      {:else if profileLud16}
                        <div class="p-3 rounded-lg mb-3" style="background-color: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3);">
                          <div class="text-sm" style="color: var(--color-text-primary);">
                            <div class="flex items-center gap-2 mb-1">
                              <WarningIcon size={16} class="text-amber-500" />
                              <span class="font-medium">Profile uses a different address:</span>
                            </div>
                            <div class="text-caption font-mono text-xs ml-6">{profileLud16}</div>
                          </div>
                        </div>
                      {:else}
                        <div class="p-3 rounded-lg mb-3" style="background-color: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3);">
                          <div class="text-sm flex items-center gap-2" style="color: var(--color-text-primary);">
                            <WarningIcon size={16} class="text-amber-500" />
                            No lightning address in your Nostr profile yet
                          </div>
                        </div>
                      {/if}
                    {/if}

                    <div class="flex flex-wrap gap-2">
                      {#if !isProfileSynced}
                        <button
                          class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer bg-amber-500 hover:bg-amber-600 text-white"
                          on:click={() => showSyncConfirmModal = true}
                        >
                          <UserCirclePlusIcon size={16} />
                          Sync to Profile
                        </button>
                      {:else}
                        <button
                          class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer"
                          style="background-color: var(--color-bg-primary); border: 1px solid var(--color-input-border);"
                          on:click={() => showSyncConfirmModal = true}
                        >
                          <UserCirclePlusIcon size={16} />
                          Sync to Profile
                        </button>
                      {/if}
                      <button
                        class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                        style="background-color: var(--color-bg-primary); border: 1px solid var(--color-input-border);"
                        on:click={() => showDeleteAddressConfirmModal = true}
                      >
                        <TrashIcon size={16} />
                        Delete
                      </button>
                    </div>
                  {:else}
                    <!-- No lightning address - show registration form -->
                    <div class="p-3 rounded-lg mb-3" style="background-color: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3);">
                      <div class="text-sm" style="color: var(--color-text-primary);">
                        Set up a lightning address to receive payments easily!
                      </div>
                    </div>
                    <div class="flex items-center gap-2 mb-3">
                      <div class="flex-1 relative">
                        <input
                          type="text"
                          class="w-full p-2 pr-20 rounded-lg text-sm"
                          style="background-color: var(--color-bg-primary); border: 1px solid var(--color-input-border); color: var(--color-text-primary);"
                          placeholder="username"
                          value={newLightningUsername}
                          on:input={handleUsernameInput}
                          disabled={isRegisteringAddress}
                        />
                        <span class="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-caption">@breez.tips</span>
                      </div>
                      {#if isCheckingAvailability}
                        <div class="w-6 h-6 flex items-center justify-center">
                          <div class="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
                        </div>
                      {:else if isUsernameAvailable === true}
                        <div class="w-6 h-6 flex items-center justify-center text-green-500">
                          <CheckIcon size={20} weight="bold" />
                        </div>
                      {:else if isUsernameAvailable === false}
                        <div class="w-6 h-6 flex items-center justify-center text-red-500">
                          <XIcon size={20} weight="bold" />
                        </div>
                      {:else}
                        <div class="w-6 h-6"></div>
                      {/if}
                    </div>
                    {#if isUsernameAvailable === false}
                      <p class="text-xs text-red-500 mb-2">This username is already taken</p>
                    {/if}
                    <button
                      class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer disabled:opacity-50"
                      style="background-color: var(--color-bg-primary); border: 1px solid var(--color-input-border);"
                      on:click={handleRegisterLightningAddress}
                      disabled={!isUsernameAvailable || isRegisteringAddress || newLightningUsername.length < 3}
                    >
                      <LightningIcon size={16} />
                      {isRegisteringAddress ? 'Registering...' : 'Register Address'}
                    </button>
                  {/if}
                </div>
              </div>
            {/if}

            <!-- NWC wallet options -->
            {#if wallet.kind === 3 && expandedWalletId === wallet.id}
              <div class="px-4 pb-4 pt-2 border-t" style="border-color: var(--color-input-border);">
                <div class="text-xs text-caption mb-3 uppercase tracking-wide">Wallet Options</div>
                <div class="flex flex-wrap gap-2">
                  <button
                    class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer"
                    style="background-color: var(--color-bg-primary); border: 1px solid var(--color-input-border);"
                    on:click={() => handleViewNwcInfo(wallet)}
                    disabled={isLoadingNwcInfo}
                  >
                    <InfoIcon size={16} />
                    {isLoadingNwcInfo ? 'Loading...' : 'Wallet Info'}
                  </button>
                  <button
                    class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer"
                    style="background-color: var(--color-bg-primary); border: 1px solid var(--color-input-border);"
                    on:click={() => handleCopyNwcConnection(wallet)}
                  >
                    <CopyIcon size={16} />
                    Copy Connection
                  </button>
                  <button
                    class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer"
                    style="background-color: var(--color-bg-primary); border: 1px solid var(--color-input-border);"
                    on:click={() => handleDownloadNwcBackup(wallet)}
                  >
                    <DownloadSimpleIcon size={16} />
                    Download Backup
                  </button>
                </div>
              </div>
            {/if}
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
              class="w-full p-4 rounded-xl text-left flex items-center gap-4 transition-colors cursor-pointer hover:opacity-80"
              style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
              on:click={() => selectedWalletType = 3}
            >
              <div class="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                <NwcLogo size={28} />
              </div>
              <div>
                <div class="font-medium" style="color: var(--color-text-primary)">NWC (Nostr Wallet Connect)</div>
                <div class="text-sm text-caption">Connect any NWC-compatible wallet</div>
              </div>
            </button>

            <button
              class="w-full p-4 rounded-xl text-left flex items-center gap-4 transition-colors"
              class:cursor-pointer={!hasExistingSparkWallet}
              class:cursor-not-allowed={hasExistingSparkWallet}
              class:opacity-50={hasExistingSparkWallet}
              style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
              on:click={() => !hasExistingSparkWallet && (selectedWalletType = 4)}
              disabled={hasExistingSparkWallet}
            >
              <div class="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center">
                <SparkLogo size={24} className="text-orange-500" />
              </div>
              <div>
                <div class="font-medium" style="color: var(--color-text-primary)">Breez Spark (Self-Custodial)</div>
                {#if hasExistingSparkWallet}
                  <div class="text-sm text-amber-500">You already have a Spark wallet connected</div>
                {:else}
                  <div class="text-sm text-caption">Create or restore a built-in Lightning wallet</div>
                {/if}
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
              on:paste={() => {
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
                Breez Spark is a self-custodial Lightning wallet built into zap.cooking.
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
                  <Button on:click={handleCreateSparkWallet} disabled={isConnecting} class="w-full">
                    Create New Wallet
                  </Button>
                  <div class="border-t pt-3 mt-3" style="border-color: var(--color-input-border);">
                    <p class="text-sm text-caption mb-2">Restore existing wallet:</p>
                    <div class="space-y-2">
                      <Button on:click={handleRestoreFromNostr} disabled={isConnecting} class="w-full">
                        <CloudArrowDownIcon size={16} />
                        Restore from Nostr Backup
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
                      <Button on:click={() => sparkRestoreMode = 'mnemonic'} disabled={isConnecting} class="w-full">
                        Restore from Recovery Phrase
                      </Button>
                    </div>
                  </div>
                </div>
              {/if}
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

  <!-- Mnemonic Display Modal (after wallet creation) -->
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

  <!-- Reveal Mnemonic Modal -->
  {#if revealedMnemonic}
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div class="rounded-2xl p-6 max-w-md w-full" style="background-color: var(--color-bg-primary);">
        <h2 class="text-xl font-bold mb-4" style="color: var(--color-text-primary)">Recovery Phrase</h2>
        <div class="mb-4 p-4 rounded-lg" style="background-color: rgba(239, 68, 68, 0.1); color: #ef4444;">
          <WarningIcon size={20} class="inline mr-2" />
          Never share this phrase with anyone. Anyone with these words can access your funds.
        </div>
        <div class="p-4 rounded-lg mb-4 font-mono text-sm select-all" style="background-color: var(--color-input-bg); color: var(--color-text-primary);">
          {revealedMnemonic}
        </div>
        <Button on:click={closeRevealMnemonicModal} class="w-full">Close</Button>
      </div>
    </div>
  {/if}

  <!-- NWC Wallet Info Modal -->
  {#if nwcWalletInfo}
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div class="rounded-2xl p-6 max-w-md w-full" style="background-color: var(--color-bg-primary);">
        <h2 class="text-xl font-bold mb-4" style="color: var(--color-text-primary)">Wallet Info</h2>

        <div class="space-y-4">
          {#if nwcWalletInfo.alias}
            <div>
              <div class="text-xs text-caption uppercase tracking-wide mb-1">Wallet Name</div>
              <div class="font-medium" style="color: var(--color-text-primary)">{nwcWalletInfo.alias}</div>
            </div>
          {/if}

          <div>
            <div class="text-xs text-caption uppercase tracking-wide mb-1">Relay</div>
            <div class="text-sm font-mono break-all" style="color: var(--color-text-primary)">{nwcWalletInfo.relay}</div>
          </div>

          <div>
            <div class="text-xs text-caption uppercase tracking-wide mb-1">Wallet Pubkey</div>
            <div class="text-sm font-mono break-all" style="color: var(--color-text-primary)">{nwcWalletInfo.pubkey}</div>
          </div>

          <div>
            <div class="text-xs text-caption uppercase tracking-wide mb-1">Supported Methods</div>
            <div class="flex flex-wrap gap-1 mt-1">
              {#each nwcWalletInfo.methods as method}
                <span class="text-xs px-2 py-1 rounded-full" style="background-color: var(--color-input-bg); color: var(--color-text-primary);">
                  {method}
                </span>
              {/each}
            </div>
          </div>
        </div>

        <Button on:click={closeNwcInfoModal} class="w-full mt-6">Close</Button>
      </div>
    </div>
  {/if}

  <!-- Delete Wallet Confirmation Modal -->
  {#if walletToDelete}
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div class="rounded-2xl p-6 max-w-md w-full" style="background-color: var(--color-bg-primary);">
        <h2 class="text-xl font-bold mb-2" style="color: var(--color-text-primary)">Remove Wallet</h2>

        {#if walletToDelete.kind === 4}
          <!-- Spark wallet - show backup reminder -->
          <div class="p-4 rounded-xl mb-4" style="background-color: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3);">
            <div class="flex items-start gap-3">
              <WarningIcon size={24} class="text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p class="font-medium text-amber-600 mb-2">Back up your wallet first!</p>
                <p class="text-sm text-caption mb-3">
                  If you remove this wallet without a backup, you may lose access to your funds permanently.
                </p>
                <div class="flex flex-wrap gap-2">
                  <button
                    class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer bg-amber-500 hover:bg-amber-600 text-white"
                    on:click={handleBackupToNostr}
                    disabled={isBackingUp}
                  >
                    <CloudArrowUpIcon size={16} />
                    {isBackingUp ? 'Backing up...' : 'Backup to Nostr'}
                  </button>
                  <button
                    class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer"
                    style="background-color: var(--color-bg-primary); border: 1px solid var(--color-input-border);"
                    on:click={handleDownloadBackup}
                    disabled={isBackingUp}
                  >
                    <DownloadSimpleIcon size={16} />
                    Download Backup
                  </button>
                </div>
              </div>
            </div>
          </div>
          <p class="text-caption mb-4 text-sm">
            Are you sure you want to remove <strong class="text-primary-color">{walletToDelete.name}</strong>?
          </p>
        {:else if walletToDelete.kind === 3}
          <!-- NWC wallet - show backup reminder (download only) -->
          <div class="p-4 rounded-xl mb-4" style="background-color: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3);">
            <div class="flex items-start gap-3">
              <WarningIcon size={24} class="text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p class="font-medium text-amber-600 mb-2">Save your connection string!</p>
                <p class="text-sm text-caption mb-3">
                  Download your NWC connection details so you can reconnect this wallet later.
                </p>
                <button
                  class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer bg-amber-500 hover:bg-amber-600 text-white"
                  on:click={() => handleDownloadNwcBackup(walletToDelete)}
                >
                  <DownloadSimpleIcon size={16} />
                  Download Backup
                </button>
              </div>
            </div>
          </div>
          <p class="text-caption mb-4 text-sm">
            Are you sure you want to remove <strong class="text-primary-color">{walletToDelete.name}</strong>?
          </p>
        {:else}
          <p class="text-caption mb-6">
            Are you sure you want to remove <strong class="text-primary-color">{walletToDelete.name}</strong>? You can reconnect it later.
          </p>
        {/if}

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
            Remove Anyway
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Sync Lightning Address to Profile Confirmation Modal -->
  {#if showSyncConfirmModal}
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div class="rounded-2xl p-6 max-w-sm w-full" style="background-color: var(--color-bg-primary);">
        <h2 class="text-xl font-bold mb-2" style="color: var(--color-text-primary)">Sync to Profile</h2>
        <p class="text-caption mb-4">
          This will update your Nostr profile (kind 0) to include your lightning address:
        </p>
        <div class="p-3 rounded-lg mb-4 font-mono text-sm" style="background-color: var(--color-input-bg); color: var(--color-text-primary);">
          {$sparkLightningAddressStore}
        </div>
        <p class="text-caption text-sm mb-6">
          Your profile's <strong>lud16</strong> field will be updated. All other profile fields (name, bio, picture, etc.) will be preserved.
        </p>
        <div class="flex gap-3">
          <Button on:click={() => showSyncConfirmModal = false} disabled={isSyncingProfile} class="flex-1">
            Cancel
          </Button>
          <button
            class="flex-1 px-4 py-2 rounded-full bg-amber-500 hover:bg-amber-600 text-white font-medium transition-colors cursor-pointer disabled:opacity-50"
            on:click={handleSyncToProfile}
            disabled={isSyncingProfile}
          >
            {isSyncingProfile ? 'Syncing...' : 'Sync'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Delete Lightning Address Confirmation Modal -->
  {#if showDeleteAddressConfirmModal}
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div class="rounded-2xl p-6 max-w-sm w-full" style="background-color: var(--color-bg-primary);">
        <h2 class="text-xl font-bold mb-2" style="color: var(--color-text-primary)">Delete Lightning Address</h2>
        <p class="text-caption mb-4">
          Are you sure you want to delete your lightning address?
        </p>
        <div class="p-3 rounded-lg mb-4 font-mono text-sm" style="background-color: var(--color-input-bg); color: var(--color-text-primary);">
          {$sparkLightningAddressStore}
        </div>
        <p class="text-caption text-sm mb-6">
          This will remove the address from your Breez Spark wallet. Payments sent to this address will no longer reach you. Your Nostr profile will not be changed.
        </p>
        <div class="flex gap-3">
          <Button on:click={() => showDeleteAddressConfirmModal = false} disabled={isDeletingAddress} class="flex-1">
            Cancel
          </Button>
          <button
            class="flex-1 px-4 py-2 rounded-full bg-red-500 hover:bg-red-600 text-white font-medium transition-colors cursor-pointer disabled:opacity-50"
            on:click={handleDeleteLightningAddress}
            disabled={isDeletingAddress}
          >
            {isDeletingAddress ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
