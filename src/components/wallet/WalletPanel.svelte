<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount, tick } from 'svelte';
  import { browser } from '$app/environment';
  import { userPublickey } from '$lib/nostr';
  import { portal } from '../Modal.svelte';
  import { getAuthManager } from '$lib/authManager';
  import Button from '../Button.svelte';
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
    removeWallet,
    type WalletKind
  } from '$lib/wallet';
  import {
    connectWallet,
    disconnectWallet,
    refreshBalance,
    createInvoice,
    lookupInvoice,
    sendPayment,
    isValidNwcUrl,
    getPaymentHistory,
    pendingTransactions,
    addPendingTransaction,
    updatePendingTransaction,
    removePendingTransaction,
    transactionsNeedRefresh,
    ensurePendingTransactionsLoaded,
    type Transaction
  } from '$lib/wallet/walletManager';
  import { closeWallet as closeWalletModal, walletModalOpen } from '$lib/wallet/walletModalStore';
  import {
    parseNwcUrl,
    getNwcInfo,
    connectNwc,
    isNwcConnected,
    getNwcLud16
  } from '$lib/wallet/nwc';
  import {
    backupNwcToNostr,
    restoreNwcFromNostr,
    hasNwcBackupInNostr,
    hasEncryptionSupport as hasNwcEncryptionSupport,
    deleteBackupFromNostr as deleteNwcBackupFromNostr
  } from '$lib/wallet/nwcBackup';
  import {
    createAndConnectWallet as createSparkWallet,
    restoreFromMnemonic,
    restoreFromBackup,
    createBackup,
    backupWalletToNostr,
    listSparkBackups,
    restoreSparkBackup,
    hasSparkBackupInNostr,
    loadMnemonic,
    lightningAddress as sparkLightningAddressStore,
    walletInitialized as sparkWalletInitialized,
    sparkSyncing,
    checkLightningAddressAvailable,
    registerLightningAddress,
    deleteLightningAddress,
    onSparkEvent,
    recentSparkPayments,
    getBestEncryptionMethod,
    deleteBackupFromNostr as deleteSparkBackupFromNostr,
    getSparkWalletId,
    getSparkWalletInfo,
    receiveOnchain,
    prepareOnchainSend,
    sendOnchain,
    listUnclaimedDeposits,
    claimDeposit,
    claimDepositWithNetworkFee,
    refundDeposit,
    isBitcoinAddress,
    type SparkWalletBackup,
    type SparkBackupEntry,
    type SparkWalletInfo,
    type OnchainFeeQuote,
    type UnclaimedDeposit,
    type ClaimDepositResult,
    type RefundDepositResult
  } from '$lib/spark';
  import {
    hasEncryptionSupport,
    encrypt as encryptionServiceEncrypt,
    decrypt as encryptionServiceDecrypt,
    detectEncryptionMethod,
    type EncryptionMethod
  } from '$lib/encryptionService';
  import { syncLightningAddressToProfile } from '$lib/spark/profileSync';
  import { qr } from '@svelte-put/qr/svg';
  import { ndk, ndkReady } from '$lib/nostr';
  import { nip19 } from 'nostr-tools';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import WalletIcon from 'phosphor-svelte/lib/Wallet';
  import PlusIcon from 'phosphor-svelte/lib/Plus';
  import TrashIcon from 'phosphor-svelte/lib/Trash';
  import CloudArrowUpIcon from 'phosphor-svelte/lib/CloudArrowUp';
  import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUp';
  import ArrowDownIcon from 'phosphor-svelte/lib/ArrowDown';
  import ClockIcon from 'phosphor-svelte/lib/Clock';
  import CloudArrowDownIcon from 'phosphor-svelte/lib/CloudArrowDown';
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';
  import WarningIcon from 'phosphor-svelte/lib/Warning';
  import EyeIcon from 'phosphor-svelte/lib/Eye';
  import EyeClosedIcon from 'phosphor-svelte/lib/EyeClosed';
  import EyeSlashIcon from 'phosphor-svelte/lib/EyeSlash';
  import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwise';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
  import GearIcon from 'phosphor-svelte/lib/Gear';
  import KeyIcon from 'phosphor-svelte/lib/Key';
  import DownloadSimpleIcon from 'phosphor-svelte/lib/DownloadSimple';
  import CopyIcon from 'phosphor-svelte/lib/Copy';
  import InfoIcon from 'phosphor-svelte/lib/Info';
  import LinkIcon from 'phosphor-svelte/lib/Link';
  import QrCodeIcon from 'phosphor-svelte/lib/QrCode';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import XIcon from 'phosphor-svelte/lib/X';
  import UserCirclePlusIcon from 'phosphor-svelte/lib/UserCirclePlus';
  import SparkLogo from '../icons/SparkLogo.svelte';
  import BitcoinIcon from '../icons/BitcoinIcon.svelte';
  import NwcLogo from '../icons/NwcLogo.svelte';
  import BitcoinConnectLogo from '../icons/BitcoinConnectLogo.svelte';
  import CustomAvatar from '../CustomAvatar.svelte';
  import CustomName from '../CustomName.svelte';
  import LifebuoyIcon from 'phosphor-svelte/lib/Lifebuoy';
  import ShieldCheckIcon from 'phosphor-svelte/lib/ShieldCheck';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import CloudCheckIcon from 'phosphor-svelte/lib/CloudCheck';
  import WalletRecoveryHelpModal from '../WalletRecoveryHelpModal.svelte';
  import CheckRelayBackupsModal from '../CheckRelayBackupsModal.svelte';
  import BrantaBadge from '../BrantaBadge.svelte';
  import {
    bitcoinConnectEnabled,
    bitcoinConnectWalletInfo,
    bitcoinConnectBalance,
    bitcoinConnectBalanceLoading,
    enableBitcoinConnect,
    disableBitcoinConnect,
    refreshBitcoinConnectBalance
  } from '$lib/wallet/bitcoinConnect';

  import {
    weblnConnected,
    weblnWalletName,
    isWeblnAvailable,
    enableWebln,
    disableWebln,
    reconnectWeblnIfEnabled,
    getWeblnBalance
  } from '$lib/wallet/webln';
  import { lightningService } from '$lib/lightningService';
  import { isNofferString, decodeNoffer } from '$lib/clink/noffer';
  import { decode as decodeBolt11 } from '@gandlaf21/bolt11-decode';
  import { requestInvoice } from '$lib/clink/nofferClient';
  import { NofferError, type NofferData } from '$lib/clink/types';
  import { displayCurrency } from '$lib/currencyStore';
  import CurrencySelector from '../CurrencySelector.svelte';
  import DenominatedBalance from '../DenominatedBalance.svelte';

  // Pull-to-refresh refs

  let showAddWallet = false;
  let selectedWalletType: WalletKind | null = null;
  let nwcConnectionString = '';
  let isConnecting = false;
  let errorMessage = '';
  let successMessage = '';
  let sparkMnemonic = '';
  let showMnemonic = false;
  let mnemonicVisible = false;

  // Backup reminder state
  let showBackupReminder = false;
  let backupReminderDismissed = false;
  let showPaperBackupInline = false;

  // Spark restore options
  let sparkRestoreMode: 'options' | 'mnemonic' | 'file' | 'nostr-select' = 'options';
  let restoreMnemonicInput = '';
  let fileInput: HTMLInputElement;
  let sparkLoadingMessage = ''; // Status message during Spark operations
  let sparkBackupExists: boolean | null = null;
  let nwcBackupExists: boolean | null = null;
  let sparkBackupChecking = false;
  let nwcBackupChecking = false;
  let sparkBackupOptions: SparkBackupEntry[] = [];
  let selectedSparkBackupId = '';
  // Per-type cache so the two reactives below (Spark + NWC) don't keep
  // invalidating each other when the picker fires both simultaneously.
  let lastSparkBackupCheckPubkey: string | null = null;
  let lastNwcBackupCheckPubkey: string | null = null;
  const BACKUP_CHECK_TIMEOUT_MS = 8000;
  $: canCheckSparkBackup = browser && hasEncryptionSupport();
  $: canCheckNwcBackup = browser && hasNwcEncryptionSupport();

  // Delete confirmation state
  let walletToDelete: { id: number; name: string; kind: number; data: string } | null = null;
  let deleteRelayBackups = false; // Checkbox state for also deleting relay backups
  let isDeletingWallet = false;

  // Wallet options (shared between Spark and NWC)
  let expandedWalletId: number | null = null;
  let revealedMnemonic: string | null = null;
  let isBackingUp = false;
  // Picker-home altcoin-curious prompt toggle
  let showAltcoinReply = false;

  // NWC wallet info
  let nwcWalletInfo: { alias?: string; methods: string[]; relay: string; pubkey: string } | null =
    null;
  let isLoadingNwcInfo = false;

  // Spark wallet info state
  let sparkWalletInfo: SparkWalletInfo | null = null;
  let isLoadingSparkInfo = false;

  // WebLN balance state
  let weblnBalance: number | null = null;
  let weblnBalanceLoading = false;

  // Portal target for modals (renders at body level to fix positioning)
  $: portalTarget = browser ? document.body : null;

  // Lightning address state
  let newLightningUsername = '';
  let isCheckingAvailability = false;
  let isUsernameAvailable: boolean | null = null;
  let isRegisteringAddress = false;
  let isDeletingAddress = false;
  let isSyncingProfile = false;
  let showSyncConfirmModal = false;
  let showNwcSyncConfirmModal = false;
  let showDeleteAddressConfirmModal = false;
  let showRecoveryHelpModal = false;
  let showCheckRelayBackupsModal = false;
  let checkRelayBackupsWalletType: 'spark' | 'nwc' = 'spark';
  let availabilityCheckTimeout: ReturnType<typeof setTimeout> | null = null;
  let showSparkCreateConfirmModal = false;

  // User's profile lud16 (from Nostr kind 0)
  let profileLud16: string | null = null;
  let isLoadingProfileLud16 = false;

  // Check if profile lud16 matches Spark wallet address
  $: isProfileSynced =
    profileLud16 &&
    $sparkLightningAddressStore &&
    profileLud16.toLowerCase().trim() === $sparkLightningAddressStore.toLowerCase().trim();

  // NWC Lightning address from connection string
  $: nwcLud16 =
    $activeWallet?.kind === 3 && $activeWallet?.data ? getNwcLud16($activeWallet.data) : null;

  // Check if NWC lud16 matches profile
  $: isNwcProfileSynced =
    nwcLud16 && profileLud16 && nwcLud16.toLowerCase().trim() === profileLud16.toLowerCase().trim();

  // Check if a Spark wallet already exists (only one allowed at a time)
  $: hasExistingSparkWallet = $wallets.some((w) => w.kind === 4);

  // Get the active Spark wallet (for on-chain features)
  $: activeSparkWallet = $wallets.find((w) => w.kind === 4) || null;

  // Check if an NWC wallet already exists (only one allowed at a time)
  $: hasExistingNwcWallet = $wallets.some((w) => w.kind === 3);

  // Check if user has maximum wallets (1)
  $: hasMaxWallets = $wallets.length >= 1;

  // True when any wallet is configured. Drives the unified empty-state-
  // as-picker experience inside the wallet modal.
  $: hasAnyWallet = $wallets.length > 0 || $weblnConnected || $bitcoinConnectEnabled;
  $: showPicker = showAddWallet || !hasAnyWallet;

  // Tracks whether the wallet modal body has been scrolled. Drives the
  // sticky/compact balance header so the user can always see their
  // balance even after scrolling into the transaction list.
  let isPanelScrolled = false;
  let panelScrollEl: HTMLElement | null = null;

  function dismissPicker() {
    showAddWallet = false;
    selectedWalletType = null;
    nwcConnectionString = '';
    errorMessage = '';
    sparkRestoreMode = 'options';
    restoreMnemonicInput = '';
    sparkBackupOptions = [];
    selectedSparkBackupId = '';
    if (!hasAnyWallet) closeWalletModal();
  }

  // Step back from a wallet-type sub-screen (Spark options / NWC
  // connect) to the wallet picker home, clearing the type-specific
  // state so the user can pick a different wallet type cleanly.
  function backToPickerHome() {
    selectedWalletType = null;
    sparkRestoreMode = 'options';
    restoreMnemonicInput = '';
    sparkBackupOptions = [];
    selectedSparkBackupId = '';
    nwcConnectionString = '';
    errorMessage = '';
  }

  // ndkReady fires on the FIRST relay WebSocket open. The rest of the pool
  // connects incrementally, so an immediate scan may only hit 1-2 relays.
  // We retry up to 3 times at increasing delays so slower relays have time
  // to join before we give up. Retries stop as soon as a backup is found or
  // the user connects a wallet.
  const BACKUP_RELAY_RETRY_DELAYS = [3000, 8000, 14000];

  async function checkSparkBackupStatus(pubkey: string, retryIndex = 0) {
    if (sparkBackupChecking) return;
    sparkBackupChecking = true;
    if (retryIndex === 0) sparkBackupExists = null;
    try {
      sparkBackupExists = await Promise.race([
        hasSparkBackupInNostr(pubkey),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error('Backup check timed out')), BACKUP_CHECK_TIMEOUT_MS)
        )
      ]);
    } catch {
      sparkBackupExists = false;
    } finally {
      sparkBackupChecking = false;
      lastSparkBackupCheckPubkey = pubkey;
      const nextDelay = BACKUP_RELAY_RETRY_DELAYS[retryIndex];
      if (!sparkBackupExists && nextDelay !== undefined && !$walletConnected) {
        setTimeout(() => {
          if (!$walletConnected && lastSparkBackupCheckPubkey === pubkey) {
            checkSparkBackupStatus(pubkey, retryIndex + 1);
          }
        }, nextDelay);
      }
    }
  }

  async function checkNwcBackupStatus(pubkey: string, retryIndex = 0) {
    if (nwcBackupChecking) return;
    nwcBackupChecking = true;
    if (retryIndex === 0) nwcBackupExists = null;
    try {
      nwcBackupExists = await Promise.race([
        hasNwcBackupInNostr(pubkey),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error('Backup check timed out')), BACKUP_CHECK_TIMEOUT_MS)
        )
      ]);
    } catch {
      nwcBackupExists = false;
    } finally {
      nwcBackupChecking = false;
      lastNwcBackupCheckPubkey = pubkey;
      const nextDelay = BACKUP_RELAY_RETRY_DELAYS[retryIndex];
      if (!nwcBackupExists && nextDelay !== undefined && !$walletConnected) {
        setTimeout(() => {
          if (!$walletConnected && lastNwcBackupCheckPubkey === pubkey) {
            checkNwcBackupStatus(pubkey, retryIndex + 1);
          }
        }, nextDelay);
      }
    }
  }

  // Kick off backup-status checks as soon as the wallet picker is
  // visible (whether the user clicked "Add Wallet" or has no wallet
  // yet) so that by the time they reach the Spark or NWC option, the
  // "Backup found" hint is already populated. Also re-fires when the
  // user lands on the type-specific screen, in case canCheck* flipped
  // true after the initial picker render (e.g. NDK signer warming up).
  $: if (
    (showPicker || selectedWalletType === 4) &&
    $userPublickey &&
    canCheckSparkBackup &&
    lastSparkBackupCheckPubkey !== $userPublickey
  ) {
    checkSparkBackupStatus($userPublickey);
  }

  $: if (
    (showPicker || selectedWalletType === 3) &&
    $userPublickey &&
    canCheckNwcBackup &&
    lastNwcBackupCheckPubkey !== $userPublickey
  ) {
    checkNwcBackupStatus($userPublickey);
  }

  // Auto-fetch the Bitcoin Connect balance when the wallet modal opens
  // and BC is the only wallet — otherwise the user lands on a sparse
  // "Balance unavailable" screen and has to click Refresh manually.
  let bcBalanceFetched = false;
  $: if (
    $walletModalOpen &&
    $bitcoinConnectEnabled &&
    $bitcoinConnectWalletInfo.connected &&
    $bitcoinConnectBalance === null &&
    !$bitcoinConnectBalanceLoading &&
    !bcBalanceFetched
  ) {
    bcBalanceFetched = true;
    refreshBitcoinConnectBalance();
  }
  $: if (!$walletModalOpen) bcBalanceFetched = false;

  $: if (!canCheckSparkBackup) {
    sparkBackupExists = null;
    sparkBackupChecking = false;
  }

  $: if (!canCheckNwcBackup) {
    nwcBackupExists = null;
    nwcBackupChecking = false;
  }

  // Check if signer extension supports encryption (NIP-44 or NIP-04)
  // Required for wallet backup functionality
  let encryptionSupported: boolean = false;
  let isNip46User: boolean = false;

  function checkEncryptionSupport() {
    encryptionSupported = hasEncryptionSupport();

    // Check if user is logged in via NIP-46 (remote signer)
    const authManager = getAuthManager();
    isNip46User = authManager?.getState()?.authMethod === 'nip46';
  }

  // Nostr-relay backup is unavailable for NIP-46 remote signers. Some
  // NIP-46 remote signers may encrypt under their session/auth key
  // rather than the user's real identity key, producing ciphertext no
  // future session can decrypt. Since we can't reliably tell which
  // remote signers do this, the conservative default is to allow new
  // backups only from nsec / NIP-07 users.
  //
  // NOTE: the gate is deliberately NOT a `$:` derived. In this
  // component (large enough to exceed 192 reactive slots) the compiled
  // dirty-bitmask guard for `$: canShowNostrBackup = …` stopped
  // matching the slots its dependencies invalidate, so the derived
  // latched its initial `false` even after encryptionSupported flipped
  // true — and the backup buttons never appeared. Template gates
  // inline the expression (`encryptionSupported && !isNip46User`)
  // instead, which tracks the two plain variables directly and updates
  // reliably.

  // Re-check encryption support when NDK signer changes (reactive).
  // Note: this only fires when the $ndk STORE re-emits — authManager
  // attaches the signer by mutating the existing NDK instance, which
  // the store never re-emits, so this alone can latch a too-early
  // "false" for the whole session (e.g. checked before a NIP-07
  // extension injected window.nostr).
  $: {
    const signer = $ndk?.signer;
    if (browser) {
      checkEncryptionSupport();
    }
  }

  // …so also re-check every time the wallet panel opens. By the time a
  // user can open the wallet, the extension/signer is up, which makes
  // the Backup-to-Nostr buttons appear reliably for NIP-07 sessions.
  $: if (browser && $walletModalOpen) {
    checkEncryptionSupport();
  }

  // Filter pending transactions to only show those for the active wallet
  $: filteredPendingTransactions = $pendingTransactions.filter(
    (tx) => !tx.walletId || tx.walletId === $activeWallet?.id
  );

  // Transaction history state
  let transactions: Transaction[] = [];
  let isLoadingHistory = false;
  let hasMoreTransactions = false;
  let oldestTransactionTimestamp: number | undefined = undefined; // Cursor for pagination
  const TRANSACTIONS_PER_PAGE = 30;

  // Send/Receive view state — these flows render INLINE inside the
  // wallet modal's scroll area instead of as stacked sub-modals. The
  // existing `showSendModal` / `showReceiveModal` flags are retained as
  // the source of truth so all the existing reset/close call sites keep
  // working unchanged. `dashboardView` is a derived label for the
  // markup guards and the back-bar / button visibility logic.
  let showSendModal = false;
  let showReceiveModal = false;
  type DashboardView = 'home' | 'send' | 'receive' | 'wallet-info' | 'remove-wallet';
  // Order matters: more specific overlays win over the dashboard.
  $: dashboardView = (
    showSendModal
      ? 'send'
      : showReceiveModal
        ? 'receive'
        : walletToDelete
          ? 'remove-wallet'
          : nwcWalletInfo || sparkWalletInfo
            ? 'wallet-info'
            : 'home'
  ) as DashboardView;
  $: hasOverlayView = dashboardView !== 'home';

  function openSendView() {
    resetSendModal();
    showReceiveModal = false;
    showSendModal = true;
  }

  function openReceiveView() {
    resetReceiveModal();
    showSendModal = false;
    showReceiveModal = true;
  }

  // Closes whichever overlay view is currently active. Used by the
  // back-bar in send / receive / wallet-info / remove-wallet views.
  function closeOverlayView() {
    if (showSendModal) {
      showSendModal = false;
      resetSendModal();
      return;
    }
    if (showReceiveModal) {
      showReceiveModal = false;
      resetReceiveModal();
      return;
    }
    if (nwcWalletInfo) {
      nwcWalletInfo = null;
      return;
    }
    if (sparkWalletInfo) {
      sparkWalletInfo = null;
      return;
    }
    if (walletToDelete) {
      walletToDelete = null;
      deleteRelayBackups = false;
      return;
    }
  }

  // Backwards-compat alias for legacy callsites that still call
  // closeSendReceive (e.g. existing back-bars).
  const closeSendReceive = closeOverlayView;

  // When the wallet modal is closed entirely, reset whatever overlay
  // is active so re-opening lands on the dashboard rather than stale
  // wallet-info / remove-wallet / send / receive content.
  $: if (!$walletModalOpen && hasOverlayView) {
    closeOverlayView();
  }
  let sendInput = ''; // Invoice or Lightning address
  let brantaVerifyTriggered = false;
  let rawQrText = ''; // Raw QR text for QR-based branta verification
  let onchainAddressBrantaSecret = '';
  let onchainAddressBrantaEncryptedDestination = '';
  let generatedInvoiceBrantaSecret = '';
  let generatedInvoiceBrantaEncryptedDestination = '';
  let nwcLud16BrantaSecret = '';
  let nwcLud16BrantaEncryptedDestination = '';
  let sparkLightningAddressBrantaSecret = '';
  let sparkLightningAddressBrantaEncryptedDestination = '';
  let sendAmount = 0; // Amount for Lightning address sends
  let sendComment = ''; // Optional message for Lightning address sends
  let receiveAmount = 0;
  let customReceiveAmount = '';
  let generatedInvoice = '';
  let invoiceCreatedAt: number = 0; // Unix timestamp when invoice was created
  let generatedPaymentHash = '';
  let invoicePollInterval: ReturnType<typeof setInterval> | null = null;
  let invoicePaid = false;
  let balanceBeforeInvoice: number | null = null; // For Spark balance-based detection
  let showLightningAddressQr: string | null = null; // Lightning address to show QR for
  let isSending = false;
  let isGeneratingInvoice = false;
  let sendError = '';
  let receiveError = '';
  let sendSuccess = '';

  // On-chain Bitcoin state
  let receiveMode: 'lightning' | 'onchain' = 'lightning';
  let onchainAddress: string | null = null;
  let isGeneratingOnchainAddress = false;
  let unclaimedDeposits: UnclaimedDeposit[] = [];
  let isLoadingDeposits = false;
  let isClaimingDeposit = false;
  let claimingTxid: string | null = null;

  // Mempool fee estimates from mempool.space API
  interface MempoolFees {
    fastestFee: number; // sat/vB for next block
    halfHourFee: number; // sat/vB for ~30 min
    hourFee: number; // sat/vB for ~1 hour
    economyFee: number; // sat/vB for low priority
    minimumFee: number; // sat/vB minimum relay fee
  }
  let mempoolFees: MempoolFees | null = null;
  let isLoadingMempoolFees = false;

  async function fetchMempoolFees(): Promise<void> {
    if (isLoadingMempoolFees) return;
    isLoadingMempoolFees = true;
    try {
      const response = await fetch('https://mempool.space/api/v1/fees/recommended');
      if (response.ok) {
        mempoolFees = await response.json();
      }
    } catch (e) {
      console.warn('Failed to fetch mempool fees:', e);
    } finally {
      isLoadingMempoolFees = false;
    }
  }

  // On-chain send state
  let onchainFeeQuote: OnchainFeeQuote | null = null;
  let onchainPrepareResponse: any = null;
  let selectedFeeSpeed: 'fast' | 'medium' | 'slow' = 'medium';
  let isPreparingOnchain = false;
  let isSendingOnchain = false;
  let showOnchainConfirmation = false; // Show address verification step before sending
  let sendingMaxBalance = false; // Track if user wants to send full balance (fee will be deducted)

  // QR scan state
  let showQrCamera = false;
  let qrVideoElement: HTMLVideoElement;
  let qrCameraStream: MediaStream | null = null;
  let qrAnimFrame: number | null = null;
  let jsQRModule: typeof import('jsqr').default | null = null;
  let qrScanError = '';

  // Check if send input is a Bitcoin address
  $: isBtcAddress = isBitcoinAddress(sendInput);

  // Preset amounts for receiving (matching jumble-spark)
  const RECEIVE_PRESETS = [1000, 5000, 10000, 20000, 50000, 100000];

  // Check if input is a Lightning address (contains @)
  $: isLightningAddress = sendInput.includes('@') && !sendInput.toLowerCase().startsWith('lnbc');

  // Check if input is a CLINK noffer1… offer string. Users can paste an
  // offer string (or scan a `lightning:noffer1…` QR, which the scanner
  // strips down to the bare token) directly into the Send field. We
  // decode it here so the amount UI and pay button can react; the actual
  // RPC + bolt11 payment happens in handleSend → handleSendNoffer.
  $: isNoffer = isNofferString(sendInput);
  $: nofferData = (() => {
    if (!isNoffer) return null;
    try {
      return decodeNoffer(sendInput);
    } catch {
      return null;
    }
  })();
  // Variable / Spontaneous offers need the user to enter an amount; Fixed
  // offers carry their price in the offer (TLV-4) so the amount is read-only.
  $: nofferNeedsAmount = nofferData ? nofferData.pricingType !== 'fixed' : false;

  // Breez API key (should be in environment variable)
  const BREEZ_API_KEY = import.meta.env.VITE_BREEZ_API_KEY || '';

  // Transaction metadata storage (for persisting descriptions across page reloads)
  const TX_METADATA_KEY = 'zapcooking_tx_metadata';

  interface TransactionMetadata {
    description?: string;
    recipient?: string; // Lightning address or npub
    pubkey?: string; // Nostr pubkey for zap sender/recipient
    comment?: string; // Zap comment
    txid?: string;
  }

  function getTransactionMetadata(txId: string): TransactionMetadata | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const stored = localStorage.getItem(TX_METADATA_KEY);
      if (stored) {
        const all = JSON.parse(stored) as Record<string, TransactionMetadata>;
        return all[txId] || null;
      }
    } catch (e) {
      console.error('[Wallet] Failed to load tx metadata:', e);
    }
    return null;
  }

  function saveTransactionMetadata(txId: string, metadata: TransactionMetadata): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const stored = localStorage.getItem(TX_METADATA_KEY);
      const all: Record<string, TransactionMetadata> = stored ? JSON.parse(stored) : {};
      all[txId] = { ...all[txId], ...metadata };

      // Keep only last 100 entries to avoid unbounded growth
      const entries = Object.entries(all);
      if (entries.length > 100) {
        const trimmed = Object.fromEntries(entries.slice(-100));
        localStorage.setItem(TX_METADATA_KEY, JSON.stringify(trimmed));
      } else {
        localStorage.setItem(TX_METADATA_KEY, JSON.stringify(all));
      }
    } catch (e) {
      console.error('[Wallet] Failed to save tx metadata:', e);
    }
  }

  // Cache for profile lookups to avoid repeated fetches
  const profileCache = new Map<string, { name: string; fetchedAt: number }>();

  /**
   * Parse zap request from invoice description
   * Returns the relevant pubkey (recipient for outgoing, sender for incoming) and comment
   */
  function parseZapFromDescription(
    description: string,
    isIncoming: boolean
  ): { pubkey: string; isZap: boolean; comment?: string } | null {
    if (!description) return null;

    try {
      // Try to parse as JSON (zap request event)
      const parsed = JSON.parse(description);

      // Check if it's a kind 9734 zap request event
      if (parsed.kind === 9734) {
        const comment = parsed.content || undefined; // Zap comment is in content field
        if (isIncoming) {
          // For incoming zaps, the sender is the event author
          return { pubkey: parsed.pubkey, isZap: true, comment };
        } else {
          // For outgoing zaps, the recipient is in the 'p' tag
          const pTag = parsed.tags?.find((t: string[]) => t[0] === 'p');
          if (pTag && pTag[1]) {
            return { pubkey: pTag[1], isZap: true, comment };
          }
        }
      }
    } catch {
      // Not JSON, might be a plain description with embedded JSON
      // Try to find JSON object in the string (more permissive regex for nested objects)
      const jsonMatch = description.match(/\{[^{}]*"kind"\s*:\s*9734[\s\S]*?\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          const comment = parsed.content || undefined;
          if (isIncoming) {
            return { pubkey: parsed.pubkey, isZap: true, comment };
          } else {
            const pTag = parsed.tags?.find((t: string[]) => t[0] === 'p');
            if (pTag && pTag[1]) {
              return { pubkey: pTag[1], isZap: true, comment };
            }
          }
        } catch {
          // Ignore nested parse errors
        }
      }
    }

    return null;
  }

  /**
   * Look up profile display name for a pubkey
   */
  async function getProfileName(pubkey: string): Promise<string | null> {
    if (!pubkey) return null;

    // Check cache first (cache for 5 minutes)
    const cached = profileCache.get(pubkey);
    if (cached && Date.now() - cached.fetchedAt < 300000) {
      return cached.name;
    }

    try {
      await ndkReady;
      const ndkInstance = $ndk;

      const user = ndkInstance.getUser({ pubkey });
      await user.fetchProfile();

      const name = user.profile?.displayName || user.profile?.name || null;
      if (name) {
        profileCache.set(pubkey, { name, fetchedAt: Date.now() });
      }
      return name;
    } catch (e) {
      console.error('[Wallet] Failed to fetch profile for', pubkey.slice(0, 8), e);
      return null;
    }
  }

  /**
   * Format pubkey as truncated npub for display
   */
  function formatPubkeyShort(pubkey: string): string {
    try {
      const npub = nip19.npubEncode(pubkey);
      return npub.slice(0, 8) + '...' + npub.slice(-4);
    } catch {
      return pubkey.slice(0, 8) + '...';
    }
  }

  onMount(() => {
    if ($userPublickey === '') {
      goto('/login');
      return;
    }

    // Initialize currency preference
    displayCurrency.initialize();

    // Ensure pending transactions are loaded from localStorage
    ensurePendingTransactionsLoaded();

    // Migrate existing WebLN wallets (kind 1) to the new external wallet system
    // Remove any kind 1 wallets from the wallets array - they're now handled separately
    const existingWeblnWallets = $wallets.filter((w) => w.kind === 1);
    if (existingWeblnWallets.length > 0) {
      for (const weblnWallet of existingWeblnWallets) {
        removeWallet(weblnWallet.id);
      }
    }

    // Reconnect WebLN if it was previously connected (state is in localStorage)
    reconnectWeblnIfEnabled().then((weblnReconnected) => {
      if (weblnReconnected) {
        // Fetch WebLN balance after reconnection
        refreshWeblnBalance();
      }
    });

    // Fetch user's profile lud16
    fetchProfileLud16();

    // Check if signer extension supports encryption for backup features
    // Wait for NDK to be ready (signer may not be set immediately)
    ndkReady.then(() => {
      checkEncryptionSupport();
    });

    // Load backup status
    loadBackupStatus();

    // Load transaction history if wallet is already connected (not for WebLN)
    if ($walletConnected && $activeWallet && $activeWallet.kind !== 1) {
      loadTransactionHistory(true);
    }

    const handleStorageChange = (event: StorageEvent) => {
      if (
        event.key === 'zapcooking_tx_refresh' &&
        $walletConnected &&
        $activeWallet &&
        $activeWallet.kind !== 1
      ) {
        setTimeout(async () => {
          await refreshBalance();
          loadTransactionHistory(true);
        }, 1000);
      }
    };

    window.addEventListener('storage', handleStorageChange);

    const unsubscribeSparkEvents = onSparkEvent(async (event) => {
      if (
        event.type === 'paymentSucceeded' ||
        event.type === 'paymentFailed' ||
        event.type === 'synced'
      ) {
        await refreshBalance();
        loadTransactionHistory(true);

        if (event.type === 'paymentSucceeded' && generatedInvoice && !invoicePaid) {
          const payment = event.payment;
          const isReceived =
            payment?.paymentType === 'receive' || payment?.paymentType === 'received';
          if (isReceived) {
            invoicePaid = true;
            stopInvoicePolling();
            successMessage = `Payment received: ${receiveAmount.toLocaleString()} sats!`;
            setTimeout(() => {
              showReceiveModal = false;
              resetReceiveModal();
            }, 2000);
          }
        }
      }
    });

    const fallbackPollInterval = setInterval(async () => {
      if ($walletConnected && $activeWallet?.kind === 4) {
        await refreshBalance();
      }
    }, 30000);

    let previousRecentCount = 0;
    const unsubscribeRecentPayments = recentSparkPayments.subscribe((recent) => {
      if (recent.length > previousRecentCount && $walletConnected && $activeWallet?.kind === 4) {
        loadTransactionHistory(true);
      }
      previousRecentCount = recent.length;
    });

    // panelScrollEl is bound to .wallet-scroll via bind:this in the
    // template; attach the listener once it's available.

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      unsubscribeSparkEvents();
      unsubscribeRecentPayments();
      clearInterval(fallbackPollInterval);
      attachedScrollEl?.removeEventListener('scroll', handlePanelScroll);
    };
  });

  function handlePanelScroll() {
    if (!panelScrollEl) return;
    isPanelScrolled = panelScrollEl.scrollTop > 4;
  }

  // Clicking the compact (sticky) balance card scrolls the wallet
  // panel back to the top, restoring the full balance card with
  // Send/Receive buttons. Clicks on inner controls (eye, refresh) are
  // ignored so their own actions still fire normally.
  function handleBalanceCardClick(e: MouseEvent | KeyboardEvent) {
    if (!isPanelScrolled || !panelScrollEl) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button')) return;
    panelScrollEl.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleBalanceCardKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button')) return;
    e.preventDefault();
    handleBalanceCardClick(e);
  }

  // Tap the balance amount / fiat sub-line to cycle SATS ↔ preferred
  // fiat. Mirrors the earlier header-pill behavior, kept here because
  // the wallet modal centers the balance as the primary UI element.
  // For the embedded card, the wrapper only carries these handlers
  // when !isPanelScrolled — in compact mode the outer card already
  // owns taps (scroll-to-top).
  function handleBalanceAmountTap(e: MouseEvent) {
    e.stopPropagation();
    displayCurrency.cycleSatsFiat();
  }
  function handleBalanceAmountKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    displayCurrency.cycleSatsFiat();
  }

  // Attach/detach the scroll listener whenever .wallet-scroll mounts or
  // unmounts (e.g. when the user toggles between picker and dashboard).
  let attachedScrollEl: HTMLElement | null = null;
  $: if (panelScrollEl !== attachedScrollEl) {
    attachedScrollEl?.removeEventListener('scroll', handlePanelScroll);
    attachedScrollEl = panelScrollEl;
    if (attachedScrollEl) {
      attachedScrollEl.addEventListener('scroll', handlePanelScroll, { passive: true });
      handlePanelScroll();
    } else {
      isPanelScrolled = false;
    }
  }

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
          if (
            !latestEvent ||
            (event.created_at &&
              latestEvent.created_at &&
              event.created_at > latestEvent.created_at)
          ) {
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

  // Load unclaimed deposits when Spark wallet connects
  $: if ($walletConnected && $activeWallet?.kind === 4 && $sparkWalletInitialized) {
    loadUnclaimedDeposits();
  }

  // Auto-refresh transaction history when a payment completes (signaled by transactionsNeedRefresh)
  $: if (
    $transactionsNeedRefresh > 0 &&
    $walletConnected &&
    $activeWallet &&
    $activeWallet.kind !== 1
  ) {
    // Small delay to allow the payment to be indexed
    setTimeout(async () => {
      await refreshBalance(); // AWAIT this first
      loadTransactionHistory(true); // THEN load transactions
    }, 1000);
  }

  // Refresh both balance and transaction history in one call. Wired to
  // the unified refresh button in the dashboard header.
  async function refreshAll() {
    if (!$walletConnected || !$activeWallet) return;
    try {
      await refreshBalance();
      if ($activeWallet.kind !== 1) {
        await loadTransactionHistory(true);
      }
    } catch (error) {
      console.error('[Wallet] Refresh error:', error);
    }
  }

  async function loadTransactionHistory(reset = false) {
    if (isLoadingHistory) return;
    isLoadingHistory = true;
    try {
      // Build existing IDs set for deduplication
      const existingIds = reset ? new Set<string>() : new Set(transactions.map((tx) => tx.id));

      // For pagination: use toTimestamp (oldest - 1) to fetch older payments
      // For reset: no toTimestamp to get newest payments
      const toTimestamp = reset
        ? undefined
        : oldestTransactionTimestamp
          ? oldestTransactionTimestamp - 1
          : undefined;

      // For NWC, we still use offset-based pagination
      const offset = reset ? 0 : transactions.length;

      const result = await getPaymentHistory({
        limit: TRANSACTIONS_PER_PAGE,
        offset,
        toTimestamp,
        existingIds
      });

      if (reset) {
        transactions = result.transactions;
        oldestTransactionTimestamp = undefined; // Reset cursor
      } else {
        // Append new transactions, filtering duplicates
        const newTxs = result.transactions.filter((tx) => !existingIds.has(tx.id));
        transactions = [...transactions, ...newTxs];
      }

      hasMoreTransactions = result.hasMore;

      // Update oldest timestamp cursor for next pagination
      if (result.oldestTimestamp !== undefined) {
        oldestTransactionTimestamp = result.oldestTimestamp;
      } else if (transactions.length > 0) {
        // Fallback: calculate from transactions
        oldestTransactionTimestamp = Math.min(...transactions.map((tx) => tx.timestamp));
      }

      // Deduplicate transactions by ID (safety net)
      const seenIds = new Set<string>();
      transactions = transactions.filter((tx) => {
        if (seenIds.has(tx.id)) return false;
        seenIds.add(tx.id);
        return true;
      });

      // Remove pending transactions that now appear in real history
      const pending = $pendingTransactions;
      const now = Math.floor(Date.now() / 1000);

      // Match window for migrating pending tx metadata onto the SDK
      // history row. Has to be wide enough that an SDK timestamp that
      // drifts a bit from when we sent still matches. Orphan cleanup
      // uses the same window so a completed pending tx that never gets
      // an SDK counterpart eventually drops out instead of lingering
      // forever. Kept in sync with PENDING_TX_TTL_SECS in walletManager.
      const PENDING_MIGRATION_WINDOW_SECS = 30 * 60;

      for (const pendingTx of pending) {
        if (pendingTx.status === 'completed') {
          const matchingRealIndex = transactions.findIndex(
            (tx) =>
              tx.amount === pendingTx.amount &&
              tx.type === 'outgoing' &&
              Math.abs(tx.timestamp - pendingTx.timestamp) < PENDING_MIGRATION_WINDOW_SECS
          );

          if (matchingRealIndex >= 0) {
            const matchingReal = transactions[matchingRealIndex];
            // Transfer description, pubkey, and comment from pending to real transaction
            transactions[matchingRealIndex] = {
              ...matchingReal,
              description: pendingTx.description || matchingReal.description,
              pubkey: pendingTx.pubkey || matchingReal.pubkey,
              comment: pendingTx.comment || matchingReal.comment
            };
            // Save metadata for persistence (keyed by real transaction ID)
            saveTransactionMetadata(matchingReal.id, {
              description: pendingTx.description,
              pubkey: pendingTx.pubkey,
              comment: pendingTx.comment
            });
            removePendingTransaction(pendingTx.id);
          } else if (now - pendingTx.timestamp > PENDING_MIGRATION_WINDOW_SECS) {
            removePendingTransaction(pendingTx.id);
          }
        } else if (pendingTx.status === 'pending' && now - pendingTx.timestamp > 1800) {
          removePendingTransaction(pendingTx.id);
        }
      }

      // Apply any saved metadata to transactions (description, pubkey, comment)
      transactions = transactions.map((tx) => {
        const savedMeta = getTransactionMetadata(tx.id);
        if (savedMeta) {
          return {
            ...tx,
            description:
              savedMeta.description &&
              (!tx.description || tx.description === 'Sent' || tx.description === 'Received')
                ? savedMeta.description
                : tx.description,
            pubkey: savedMeta.pubkey || tx.pubkey,
            comment: savedMeta.comment || tx.comment
          };
        }
        return tx;
      });

      // Enrich transactions with zap info (async, updates UI as profiles load)
      enrichTransactionsWithZapInfo();
    } catch (e) {
      console.error('Failed to load transaction history:', e);
    } finally {
      isLoadingHistory = false;
    }
  }

  /**
   * Enrich transactions with zap sender/recipient names
   * Runs asynchronously to not block UI
   */
  async function enrichTransactionsWithZapInfo() {
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];

      // Skip if already has a good description (not generic) and no comment needed
      const needsEnrichment =
        !tx.description ||
        tx.description === 'Sent' ||
        tx.description === 'Received' ||
        tx.description.startsWith('lnbc');

      // Check if transaction description contains zap info
      const zapInfo = parseZapFromDescription(tx.description || '', tx.type === 'incoming');

      if (zapInfo?.isZap && zapInfo.pubkey) {
        // Try to get profile name
        const profileName = await getProfileName(zapInfo.pubkey);
        const displayName = profileName || formatPubkeyShort(zapInfo.pubkey);

        // Update transaction with zap description and comment
        const zapDescription =
          tx.type === 'incoming' ? `⚡ Zap from ${displayName}` : `⚡ Zap to ${displayName}`;

        // Update the transaction in place (always update to capture comment and pubkey)
        transactions[i] = {
          ...tx,
          description: needsEnrichment ? zapDescription : tx.description,
          comment: zapInfo.comment,
          pubkey: zapInfo.pubkey
        };
        // Trigger Svelte reactivity
        transactions = transactions;

        // Save to metadata for persistence (always save pubkey and comment)
        saveTransactionMetadata(tx.id, {
          description: needsEnrichment ? zapDescription : tx.description,
          pubkey: zapInfo.pubkey,
          comment: zapInfo.comment
        });
      }
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

  function formatAmount(amount: number): string {
    if (amount >= 1000) {
      return (amount / 1000).toLocaleString() + 'k';
    }
    return amount.toLocaleString();
  }

  // Copy text to clipboard
  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      console.error('Failed to copy:', e);
      return false;
    }
  }

  // Reset send modal state
  function resetSendModal() {
    sendInput = '';
    sendAmount = 0;
    sendComment = '';
    sendError = '';
    sendSuccess = '';
    isSending = false;
    qrScanError = '';
    stopQrCamera();
    // Reset on-chain state
    resetOnchainSendState();
  }

  async function startQrCamera() {
    qrScanError = '';
    showQrCamera = true;
    await tick();
    try {
      if (!jsQRModule) jsQRModule = (await import('jsqr')).default;
      qrCameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      qrVideoElement.srcObject = qrCameraStream;
      await qrVideoElement.play();
      scanQrFrame();
    } catch {
      stopQrCamera();
      qrScanError = 'Camera access denied.';
    }
  }

  let qrCanvas: HTMLCanvasElement | null = null;
  let qrCtx: CanvasRenderingContext2D | null = null;

  function scanQrFrame() {
    if (!showQrCamera || !qrVideoElement || !jsQRModule) return;
    if (qrVideoElement.readyState === qrVideoElement.HAVE_ENOUGH_DATA) {
      const w = qrVideoElement.videoWidth;
      const h = qrVideoElement.videoHeight;
      if (!qrCanvas) {
        qrCanvas = document.createElement('canvas');
        qrCtx = qrCanvas.getContext('2d')!;
      }
      if (qrCanvas.width !== w) qrCanvas.width = w;
      if (qrCanvas.height !== h) qrCanvas.height = h;
      qrCtx!.drawImage(qrVideoElement, 0, 0);
      const imageData = qrCtx!.getImageData(0, 0, w, h);
      const result = jsQRModule(imageData.data, imageData.width, imageData.height);
      if (result) {
        const raw = result.data.trim();
        let decoded = raw;
        let shouldAutoVerify = false;

        if (decoded.toLowerCase().startsWith('lightning:')) {
          decoded = decoded.slice('lightning:'.length);
          shouldAutoVerify = true;
        } else if (decoded.toLowerCase().startsWith('bitcoin:')) {
          const withoutPrefix = decoded.slice('bitcoin:'.length);
          const params = new URLSearchParams(
            withoutPrefix.includes('?') ? withoutPrefix.split('?')[1] : ''
          );
          if (params.has('branta_id') && params.has('branta_secret')) {
            shouldAutoVerify = true;
          }
          decoded = withoutPrefix.split('?')[0];
        }

        sendInput = decoded;
        rawQrText = shouldAutoVerify ? raw : '';
        sendingMaxBalance = false;
        brantaVerifyTriggered = shouldAutoVerify;
        if (onchainFeeQuote) {
          onchainFeeQuote = null;
          onchainPrepareResponse = null;
        }
        stopQrCamera();
        return;
      }
    }
    qrAnimFrame = requestAnimationFrame(scanQrFrame);
  }

  function stopQrCamera() {
    showQrCamera = false;
    if (qrAnimFrame) {
      cancelAnimationFrame(qrAnimFrame);
      qrAnimFrame = null;
    }
    if (qrCameraStream) {
      qrCameraStream.getTracks().forEach((t) => t.stop());
      qrCameraStream = null;
    }
    qrCanvas = null;
    qrCtx = null;
  }

  // Reset on-chain send state (defined above resetSendModal call)
  function resetOnchainSendState() {
    onchainFeeQuote = null;
    onchainPrepareResponse = null;
    selectedFeeSpeed = 'medium';
    isPreparingOnchain = false;
    isSendingOnchain = false;
    showOnchainConfirmation = false;
    sendingMaxBalance = false;
  }

  // Format Bitcoin address into segments for easier verification
  function formatAddressSegments(address: string): string[] {
    const segmentSize = 4;
    const segments: string[] = [];
    for (let i = 0; i < address.length; i += segmentSize) {
      segments.push(address.slice(i, i + segmentSize));
    }
    return segments;
  }

  // Register a payment address/invoice with Branta Guardrail
  async function registerWithBranta(
    paymentString: string,
    description?: string,
    destinationType?: string
  ): Promise<{ secret?: string; encryptedDestination?: string; verifyUrl?: string }> {
    try {
      const res = await fetch('/api/branta/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentString,
          description,
          ttl: 86400, // 24 hours
          destinationType
        })
      });
      if (!res.ok) {
        console.warn('[Branta] Registration returned non-OK status:', res.status);
        return {};
      }
      const data = await res.json().catch(() => ({}));
      if (data?.success !== true) {
        console.warn('[Branta] Registration unsuccessful:', data?.error);
        return {};
      }
      return {
        secret: data.secret,
        encryptedDestination: data.encryptedDestination,
        verifyUrl: data.verifyUrl
      };
    } catch (e) {
      // Silent fail - Branta registration is optional
      console.warn('[Branta] Registration failed:', e);
    }
    return {};
  }

  // Reset receive modal state
  function resetReceiveModal() {
    stopInvoicePolling();
    receiveAmount = 0;
    customReceiveAmount = '';
    generatedInvoice = '';
    generatedPaymentHash = '';
    invoicePaid = false;
    generatedInvoiceBrantaSecret = '';
    generatedInvoiceBrantaEncryptedDestination = '';
    onchainAddressBrantaSecret = '';
    onchainAddressBrantaEncryptedDestination = '';
    receiveError = '';
    isGeneratingInvoice = false;
    balanceBeforeInvoice = null;
    invoiceCreatedAt = 0;
    // Reset on-chain state
    receiveMode = 'lightning';
    onchainAddress = null;
  }

  // Generate on-chain Bitcoin address for receiving
  async function handleGenerateOnchainAddress() {
    if ($activeWallet?.kind !== 4) return;

    isGeneratingOnchainAddress = true;
    receiveError = '';

    try {
      const result = await receiveOnchain();
      // Register with Branta (ZK for on-chain addresses)
      const brantaResult = await registerWithBranta(
        result.address,
        'zap.cooking Bitcoin deposit address',
        'bitcoin_address'
      );
      onchainAddressBrantaSecret = brantaResult.secret ?? '';
      onchainAddressBrantaEncryptedDestination = brantaResult.encryptedDestination ?? '';
      onchainAddress = result.address;
      // Also load any pending deposits
      await loadUnclaimedDeposits();
    } catch (e) {
      receiveError = e instanceof Error ? e.message : 'Failed to generate Bitcoin address';
    } finally {
      isGeneratingOnchainAddress = false;
    }
  }

  // Load unclaimed on-chain deposits
  async function loadUnclaimedDeposits() {
    if ($activeWallet?.kind !== 4) return;

    isLoadingDeposits = true;
    try {
      unclaimedDeposits = await listUnclaimedDeposits();
    } catch (e) {
      console.error('Failed to load unclaimed deposits:', e);
    } finally {
      isLoadingDeposits = false;
    }
  }

  // Claim an on-chain deposit (uses network-recommended fee by default)
  async function handleClaimDeposit(txid: string, vout: number, maxFeeSats?: number) {
    isClaimingDeposit = true;
    claimingTxid = txid;

    try {
      // If no max fee specified, use network-recommended fee with 2 sat/vbyte leeway
      if (maxFeeSats !== undefined) {
        await claimDeposit(txid, vout, maxFeeSats);
      } else {
        await claimDepositWithNetworkFee(txid, vout, 2);
      }
      successMessage = 'Deposit claimed successfully!';
      // Refresh deposits list
      await loadUnclaimedDeposits();
      await refreshBalance();
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Failed to claim deposit';
    } finally {
      isClaimingDeposit = false;
      claimingTxid = null;
    }
  }

  // Refund modal state
  let showRefundModal = false;
  let refundDeposit_: UnclaimedDeposit | null = null;
  let refundAddress = '';
  let refundFeeRate = 10; // Default 10 sat/vbyte
  let isRefunding = false;

  function openRefundModal(deposit: UnclaimedDeposit) {
    refundDeposit_ = deposit;
    refundAddress = '';
    // Use medium fee from mempool if available, otherwise default to 10
    refundFeeRate = mempoolFees?.halfHourFee || 10;
    showRefundModal = true;
    // Fetch latest fees
    fetchMempoolFees();
  }

  async function handleRefundDeposit() {
    if (!refundDeposit_) return;
    if (!refundAddress.trim()) {
      errorMessage = 'Please enter a Bitcoin address for the refund';
      return;
    }
    if (!isBitcoinAddress(refundAddress.trim())) {
      errorMessage = 'Invalid Bitcoin address';
      return;
    }

    isRefunding = true;
    try {
      await refundDeposit(
        refundDeposit_.txid,
        refundDeposit_.vout,
        refundAddress.trim(),
        refundFeeRate
      );
      successMessage = 'Deposit refunded successfully!';
      showRefundModal = false;
      refundDeposit_ = null;
      // Refresh deposits list
      await loadUnclaimedDeposits();
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Failed to refund deposit';
    } finally {
      isRefunding = false;
    }
  }

  // Prepare on-chain send (get fee quotes)
  async function handlePrepareOnchainSend() {
    if (!sendInput.trim() || sendAmount <= 0) {
      sendError = 'Please enter a Bitcoin address and amount';
      return;
    }

    isPreparingOnchain = true;
    sendError = '';
    onchainFeeQuote = null;
    onchainPrepareResponse = null;

    try {
      if (sendingMaxBalance) {
        if ($walletBalance === null) {
          sendError = 'Wallet balance unavailable';
          return;
        }

        const balanceSats = Number($walletBalance);
        if (balanceSats <= 0) {
          sendError = 'Balance is too low to cover the network fee';
          return;
        }

        const address = sendInput.trim();
        const probeAmount = Math.min(balanceSats, 1000);
        let result = await prepareOnchainSend(address, probeAmount);
        let feeSats = result.feeQuote.fast.feeSats;
        let maxSendable = balanceSats - feeSats;

        if (maxSendable <= 0) {
          sendError = 'Balance is too low to cover the network fee';
          return;
        }

        result = await prepareOnchainSend(address, maxSendable);
        feeSats = result.feeQuote.fast.feeSats;
        const adjustedAmount = balanceSats - feeSats;

        if (adjustedAmount <= 0) {
          sendError = 'Balance is too low to cover the network fee';
          return;
        }

        if (adjustedAmount !== maxSendable) {
          result = await prepareOnchainSend(address, adjustedAmount);
          feeSats = result.feeQuote.fast.feeSats;
          maxSendable = balanceSats - feeSats;
          if (maxSendable <= 0) {
            sendError = 'Balance is too low to cover the network fee';
            return;
          }
        } else {
          maxSendable = adjustedAmount;
        }

        onchainFeeQuote = result.feeQuote;
        onchainPrepareResponse = result.prepareResponse;
        // Don't modify sendAmount - keep it at full balance for display
        // The prepareResponse already has the correct net amount for the transaction
      } else {
        const result = await prepareOnchainSend(sendInput.trim(), sendAmount);
        onchainFeeQuote = result.feeQuote;
        onchainPrepareResponse = result.prepareResponse;
      }
    } catch (e) {
      sendError = e instanceof Error ? e.message : 'Failed to prepare on-chain payment';
    } finally {
      isPreparingOnchain = false;
    }
  }

  // Send on-chain payment
  async function handleSendOnchain() {
    if (!onchainPrepareResponse) {
      sendError = 'Please prepare the payment first';
      return;
    }

    isSendingOnchain = true;
    sendError = '';
    const pendingId =
      $activeWallet?.id !== undefined
        ? addPendingTransaction({
            id: `pending-${Date.now()}-${Math.random().toString(36).substring(7)}`,
            type: 'outgoing',
            amount: sendAmount,
            description: 'Sending on-chain payment...',
            timestamp: Math.floor(Date.now() / 1000),
            walletId: $activeWallet.id
          })
        : null;

    try {
      // Always use 'fast' speed - Spark cooperative exits currently have fixed fees
      const payment = await sendOnchain(onchainPrepareResponse, 'fast');
      const txid =
        payment?.txid ||
        payment?.txId ||
        payment?.tx_id ||
        payment?.txHash ||
        payment?.tx_hash ||
        payment?.transactionId ||
        payment?.transaction_id ||
        payment?.onchainTxid ||
        payment?.onchain_txid ||
        payment?.onchain?.txid ||
        payment?.onchain?.txId ||
        payment?.paymentMethod?.txid ||
        payment?.paymentMethod?.txId ||
        payment?.paymentMethod?.transactionId ||
        payment?.paymentMethod?.transaction_id ||
        payment?.paymentMethod?.txHash ||
        payment?.paymentMethod?.tx_hash;
      const paymentId =
        payment?.id || payment?.paymentHash || payment?.payment_hash || txid || null;

      if (pendingId) {
        updatePendingTransaction(pendingId, {
          status: 'completed',
          txid: txid || undefined
        });
      }

      if (paymentId && txid) {
        saveTransactionMetadata(paymentId, { txid });
      }
      sendSuccess = 'On-chain payment sent!';
      await refreshBalance();
      loadTransactionHistory(true);
      setTimeout(() => {
        showSendModal = false;
        resetSendModal();
      }, 1500);
    } catch (e) {
      sendError = e instanceof Error ? e.message : 'Failed to send on-chain payment';
      if (pendingId) {
        removePendingTransaction(pendingId);
      }
    } finally {
      isSendingOnchain = false;
    }
  }

  // Handle sending payment
  async function handleSend() {
    if (!sendInput.trim()) {
      sendError = 'Please enter an invoice or Lightning address';
      return;
    }

    // CLINK noffer offer string: run the kind-21001 RPC to fetch a bolt11,
    // then pay that. Handled in a dedicated path because it requires a
    // round-trip to the offer's relay before there's anything to pay.
    if (isNoffer) {
      await handleSendNoffer();
      return;
    }

    // For Lightning addresses, require amount
    if (isLightningAddress && sendAmount <= 0) {
      sendError = 'Please enter an amount for Lightning address';
      return;
    }

    isSending = true;
    sendError = '';
    sendSuccess = '';

    try {
      // For Lightning addresses, we need to pass the amount
      // For invoices, amount is encoded in the invoice
      const invoice = sendInput.trim();

      // Note: Pending transactions are managed by walletManager.sendPayment
      const result = await sendPayment(invoice, {
        amount: isLightningAddress ? sendAmount : undefined,
        description: isLightningAddress ? `Payment to ${sendInput}` : undefined,
        comment: isLightningAddress && sendComment ? sendComment : undefined
      });

      if (result.success) {
        sendSuccess = 'Payment sent successfully!';
        await refreshBalance();
        loadTransactionHistory(true);
        // Close modal after short delay
        setTimeout(() => {
          showSendModal = false;
          resetSendModal();
        }, 1500);
      } else {
        sendError = result.error || 'Payment failed';
      }
    } catch (e) {
      sendError = e instanceof Error ? e.message : 'Payment failed';
    } finally {
      isSending = false;
    }
  }

  // Pay a CLINK noffer1… offer string pasted (or QR-scanned) into the
  // Send field. Decodes the offer, runs the kind-21001 RPC against the
  // offer's relay to obtain a bolt11, then pays it via the active wallet.
  async function handleSendNoffer() {
    let data: NofferData;
    try {
      data = decodeNoffer(sendInput);
    } catch (e) {
      sendError = e instanceof Error ? e.message : "Couldn't read this offer";
      return;
    }

    const needsAmount = data.pricingType !== 'fixed';
    if (needsAmount && sendAmount <= 0) {
      sendError = 'Please enter an amount for this offer';
      return;
    }

    isSending = true;
    sendError = '';
    sendSuccess = '';

    try {
      const { bolt11 } = await requestInvoice(data, {
        amountSats: needsAmount && sendAmount > 0 ? sendAmount : undefined,
        description: `Offer: ${data.offerId}`
      });

      // The service's bolt11 is the source of truth for the amount —
      // the offer's TLV-4 price can be stale for Fixed offers, and
      // Spark treats metadata.amount as an explicit amount override
      // when paying a bolt11, which must match the invoice. Fall back
      // to the entered/TLV amount only when the invoice is amountless
      // (Spark needs an explicit amount to pay those).
      let invoiceAmountSats = 0;
      try {
        const decoded = decodeBolt11(bolt11);
        const amountSection = decoded.sections.find(
          (s: { name: string; value?: unknown }) => s.name === 'amount'
        );
        if (amountSection?.value) {
          invoiceAmountSats = Math.floor(Number(amountSection.value) / 1000);
        }
      } catch {
        // Undecodable amount section — fall back below.
      }
      const paidAmount =
        invoiceAmountSats > 0 ? invoiceAmountSats : needsAmount ? sendAmount : (data.price ?? 0);

      const result = await sendPayment(bolt11, {
        amount: paidAmount,
        description: `CLINK offer: ${data.offerId}`,
        pubkey: data.pubkey
      });

      if (result.success) {
        sendSuccess = 'Payment sent successfully!';
        await refreshBalance();
        loadTransactionHistory(true);
        setTimeout(() => {
          showSendModal = false;
          resetSendModal();
        }, 1500);
      } else {
        sendError = result.error || 'Payment failed';
      }
    } catch (e) {
      // Map the most common CLINK failures to friendly copy; fall back to
      // the raw message otherwise.
      if (e instanceof NofferError) {
        switch (e.code) {
          case 1:
            sendError = 'This offer is no longer valid.';
            break;
          case 2:
            sendError = "The service couldn't complete the request. Try again in a moment.";
            break;
          case 3:
            sendError = e.latest
              ? 'This offer has a newer version. Ask the recipient for an updated offer.'
              : 'This offer has been retired by the recipient.';
            break;
          case 4:
            sendError = "The service doesn't support this kind of payment request.";
            break;
          case 5:
            sendError = e.range
              ? `Pick an amount between ${e.range.min.toLocaleString()} and ${e.range.max.toLocaleString()} sats.`
              : "The amount is outside the offer's allowed range.";
            break;
          default:
            sendError = e.message;
        }
      } else {
        const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
        if (msg.includes('timed out') || msg.includes('timeout')) {
          sendError = "The service didn't respond in time. Check your connection and try again.";
        } else if (msg.includes('sign in')) {
          sendError = 'Sign in to pay an offer.';
        } else {
          sendError = e instanceof Error ? e.message : 'Payment failed';
        }
      }
    } finally {
      isSending = false;
    }
  }

  // Handle generating invoice for receiving
  async function handleGenerateInvoice(amount?: number) {
    const amountToUse = amount || parseInt(customReceiveAmount) || 0;

    if (amountToUse <= 0) {
      receiveError = 'Please enter a valid amount';
      return;
    }

    isGeneratingInvoice = true;
    receiveError = '';
    generatedInvoice = '';
    generatedPaymentHash = '';
    invoicePaid = false;
    receiveAmount = amountToUse;

    balanceBeforeInvoice = $walletBalance;
    invoiceCreatedAt = Math.floor(Date.now() / 1000);

    try {
      const result = await createInvoice(amountToUse, 'Payment via zap.cooking');
      if (!result || !result.invoice) {
        throw new Error('Failed to generate invoice - no invoice returned');
      }
      generatedPaymentHash = result.paymentHash || '';
      // Register with Branta (bolt11 type for Lightning invoices)
      const brantaInvoiceResult = await registerWithBranta(
        result.invoice,
        `zap.cooking invoice for ${amountToUse} sats`,
        'bolt11'
      );
      generatedInvoiceBrantaSecret = brantaInvoiceResult.secret ?? '';
      generatedInvoiceBrantaEncryptedDestination = brantaInvoiceResult.encryptedDestination ?? '';
      generatedInvoice = result.invoice;

      setTimeout(() => {
        if (generatedInvoice && !invoicePaid) startInvoicePolling();
      }, 2000);
    } catch (e) {
      receiveError = e instanceof Error ? e.message : 'Failed to generate invoice';
    } finally {
      isGeneratingInvoice = false;
    }
  }

  function startInvoicePolling() {
    stopInvoicePolling();

    invoicePollInterval = setInterval(async () => {
      if (invoicePaid) {
        stopInvoicePolling();
        return;
      }

      try {
        if ($activeWallet?.kind === 4) {
          const { transactions: latestTxs } = await getPaymentHistory({ limit: 5, offset: 0 });
          const matchingTx = latestTxs.find(
            (tx) =>
              tx.type === 'incoming' &&
              tx.amount === receiveAmount &&
              tx.timestamp > (invoiceCreatedAt || 0)
          );

          if (matchingTx) {
            invoicePaid = true;
            stopInvoicePolling();
            successMessage = `Payment received: ${receiveAmount.toLocaleString()} sats!`;
            await refreshBalance();
            loadTransactionHistory(true);
            setTimeout(() => {
              showReceiveModal = false;
              resetReceiveModal();
            }, 2000);
            return;
          }
        } else if (generatedPaymentHash) {
          const result = await lookupInvoice(generatedPaymentHash);
          if (result.paid) {
            invoicePaid = true;
            stopInvoicePolling();
            successMessage = `Payment received: ${receiveAmount.toLocaleString()} sats!`;
            await refreshBalance();
            await loadTransactionHistory();
            setTimeout(() => {
              showReceiveModal = false;
              resetReceiveModal();
            }, 2000);
          }
        }
      } catch {}
    }, 3000);
  }

  function stopInvoicePolling() {
    if (invoicePollInterval) {
      clearInterval(invoicePollInterval);
      invoicePollInterval = null;
    }
  }

  // Get Lightning address for display in receive modal
  function getReceiveLightningAddress(): string | null {
    if (!$activeWallet) return null;

    if ($activeWallet.kind === 4) {
      // Spark wallet - use wallet's registered address
      return $sparkLightningAddressStore;
    } else if ($activeWallet.kind === 3) {
      // NWC wallet - prefer lud16 from connection string, fall back to profile's lud16
      const nwcLud16 = $activeWallet.data ? getNwcLud16($activeWallet.data) : null;
      return nwcLud16 || profileLud16;
    }

    return null;
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

  async function handleConnectBitcoinConnect() {
    // Initialize Bitcoin Connect and open connection modal
    try {
      await lightningService.init();
      // Import and request provider - this opens the BC modal
      const { requestProvider } = await import('@getalby/bitcoin-connect');
      const provider = await requestProvider();
      if (provider) {
        enableBitcoinConnect();
        showAddWallet = false;
        successMessage = 'External wallet connected via Bitcoin Connect!';
      }
    } catch (e) {
      // User cancelled or connection failed
      console.warn('[Wallet] Bitcoin Connect cancelled or failed:', e);
    }
  }

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

  async function handleConnectWebln() {
    // Connect to browser's WebLN provider
    isConnecting = true;
    errorMessage = '';
    try {
      const result = await enableWebln();
      if (result.success) {
        showAddWallet = false;
        successMessage = `Connected to ${result.walletName}!`;
        // Refresh balance from WebLN
        await refreshWeblnBalance();
      } else {
        errorMessage = result.error || 'Failed to connect WebLN wallet';
      }
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Failed to connect WebLN wallet';
      console.warn('[Wallet] WebLN connection failed:', e);
    } finally {
      isConnecting = false;
    }
  }

  async function handleDisconnectWebln() {
    disableWebln();
    weblnBalance = null;
    successMessage = 'Browser wallet disconnected';
  }

  function handleDisableBitcoinConnect() {
    disableBitcoinConnect();
    successMessage = 'Bitcoin Connect disabled.';
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
      const newMnemonic = await createSparkWallet($userPublickey, BREEZ_API_KEY);
      successMessage = 'Spark wallet created!';
      showBackupReminder = true;
      showAddWallet = false;
      selectedWalletType = null;

      // Register in wallet store with walletId so deletion can target the right relay backup
      await connectWallet(4, getSparkWalletId(newMnemonic));

      // Fetch initial balance (will be 0 for new wallet)
      await refreshBalance();
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Failed to create Breez Spark wallet';
    } finally {
      isConnecting = false;
      sparkLoadingMessage = '';
    }
  }

  function handleSparkCreateRequest() {
    if (sparkBackupExists) {
      showSparkCreateConfirmModal = true;
      return;
    }

    handleCreateSparkWallet();
  }

  function formatSparkBackupLabel(backup: SparkBackupEntry): string {
    if (!backup.createdAt) return 'Backup (unknown date)';
    return new Date(backup.createdAt * 1000).toLocaleString();
  }

  function getSelectedSparkBackup(): SparkBackupEntry | null {
    return sparkBackupOptions.find((backup) => backup.id === selectedSparkBackupId) || null;
  }

  async function restoreSelectedSparkBackup(backup: SparkBackupEntry) {
    const mnemonic = await restoreSparkBackup($userPublickey, BREEZ_API_KEY, backup);
    if (mnemonic) {
      // Register in wallet store with walletId so deletion can target the right relay backup
      await connectWallet(4, getSparkWalletId(mnemonic));

      // Actively fetch balance and transaction history
      await refreshBalance();
      loadTransactionHistory(true);

      // Close modal after successful registration
      successMessage = 'Breez Spark wallet restored from Nostr backup!';
      showAddWallet = false;
      selectedWalletType = null;
      sparkRestoreMode = 'options';
      sparkBackupOptions = [];
      selectedSparkBackupId = '';
    } else {
      errorMessage = 'No backup found on Nostr relays.';
    }
  }

  async function handleRestoreFromNostr() {
    if (!BREEZ_API_KEY) {
      errorMessage = 'Breez API key not configured. Please contact support.';
      return;
    }

    isConnecting = true;
    sparkLoadingMessage = 'Checking for Nostr backups...';
    errorMessage = '';

    try {
      const backups = await listSparkBackups($userPublickey);
      if (!backups.length) {
        errorMessage = 'No backup found on Nostr relays.';
        return;
      }

      if (backups.length === 1) {
        await restoreSelectedSparkBackup(backups[0]);
      } else {
        sparkBackupOptions = backups;
        selectedSparkBackupId = backups[0].id;
        sparkRestoreMode = 'nostr-select';
      }
    } catch (e) {
      errorMessage = getSignerErrorMessage(e, 'Failed to restore from Nostr');
    } finally {
      isConnecting = false;
      sparkLoadingMessage = '';
    }
  }

  async function handleRestoreSelectedSparkBackup() {
    if (!BREEZ_API_KEY) {
      errorMessage = 'Breez API key not configured. Please contact support.';
      return;
    }

    const backup = getSelectedSparkBackup();
    if (!backup) {
      errorMessage = 'Please select a backup to restore.';
      return;
    }

    isConnecting = true;
    sparkLoadingMessage = 'Restoring from Nostr backup...';
    errorMessage = '';

    try {
      await restoreSelectedSparkBackup(backup);
    } catch (e) {
      errorMessage = getSignerErrorMessage(e, 'Failed to restore from Nostr');
    } finally {
      isConnecting = false;
      sparkLoadingMessage = '';
    }
  }

  // Helper to provide friendlier error messages for known signer extension issues
  function getSignerErrorMessage(error: unknown, fallback: string): string {
    const message = error instanceof Error ? error.message : String(error);

    // NIP-46 remote signer permission errors - encryption not allowed
    if (
      message.includes('kind 24133') ||
      message.includes('not allowed') ||
      message.includes('blocked')
    ) {
      return 'Your signer has not granted encryption permissions. Please grant encryption permissions in your signer app to enable backup.';
    }

    // NIP-46 ephemeral event expired - connection timing issue
    if (message.includes('ephemeral event expired')) {
      return 'Connection to your remote signer timed out. Please try again or check that your signer app is open.';
    }

    // Base64 decoding errors (encryption format mismatch)
    if (message.includes('invalid base64') || message.includes('Unknown letter')) {
      return 'Failed to decrypt backup - the encryption format may not be compatible. Please try restoring from the wallet seed phrase.';
    }

    // Generic extension errors
    if (message.includes('does not support')) {
      return message; // Already a good message from our code
    }

    return error instanceof Error ? error.message : fallback;
  }

  async function handleRestoreFromMnemonic() {
    if (!BREEZ_API_KEY) {
      errorMessage = 'Breez API key not configured. Please contact support.';
      return;
    }

    const mnemonic = restoreMnemonicInput.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!mnemonic) {
      errorMessage = 'Please enter your recovery phrase';
      return;
    }

    const words = mnemonic.split(' ');
    if (![12, 15, 18, 21, 24].includes(words.length)) {
      errorMessage = `Recovery phrases must be 12, 15, 18, 21, or 24 words (you entered ${words.length})`;
      return;
    }
    if (!words.every((w) => /^[a-z]+$/.test(w))) {
      errorMessage = 'Recovery phrase contains invalid characters — enter BIP-39 words only';
      return;
    }

    isConnecting = true;
    sparkLoadingMessage = 'Restoring from recovery phrase...';
    errorMessage = '';

    try {
      const success = await restoreFromMnemonic($userPublickey, mnemonic, BREEZ_API_KEY);
      if (success) {
        // Register in wallet store with walletId so deletion can target the right relay backup
        await connectWallet(4, getSparkWalletId(mnemonic));

        // Actively fetch balance and transaction history
        await refreshBalance();
        loadTransactionHistory(true);

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

      // Decrypt using the unified encryption service
      const decryptFn = async (ciphertext: string, senderPubkey: string): Promise<string> => {
        // Check encryption support
        if (!hasEncryptionSupport()) {
          throw new Error(
            'No decryption method available. Please ensure you are logged in with a signer.'
          );
        }

        // Determine encryption method (compatible with Yakihonne/Primal/Jumble backups)
        // Priority: 1) explicit encryption field, 2) detect from format, 3) assume based on version
        let method: EncryptionMethod;
        if (backup.encryption === 'nip44' || backup.encryption === 'nip04') {
          // Explicit encryption field (v2 backups from zap.cooking, Primal)
          method = backup.encryption;
        } else {
          // Detect from ciphertext format or default based on version
          method = detectEncryptionMethod(ciphertext);
          // Override for v1 backups that don't have explicit field
          if (backup.version === 1 && !ciphertext.includes('?iv=')) {
            method = 'nip04';
          }
        }

        const decrypted = await encryptionServiceDecrypt(senderPubkey, ciphertext, method);
        if (decrypted) return decrypted;

        throw new Error(
          'Decryption failed. Make sure you are using the same Nostr key that created this backup.'
        );
      };

      sparkLoadingMessage = 'Connecting to Spark network...';

      const success = await restoreFromBackup($userPublickey, backup, BREEZ_API_KEY, decryptFn);
      if (success) {
        // Register in wallet store with walletId so deletion can target the right relay backup
        const restoredMnemonic = await loadMnemonic($userPublickey);
        await connectWallet(4, restoredMnemonic ? getSparkWalletId(restoredMnemonic) : 'spark');

        // Actively fetch balance and transaction history
        await refreshBalance();
        loadTransactionHistory(true);

        // Close modal after successful registration
        successMessage = 'Breez Spark wallet restored from backup file!';
        showAddWallet = false;
        selectedWalletType = null;
        sparkRestoreMode = 'options';
      } else {
        errorMessage = 'Failed to restore wallet from backup file';
      }
    } catch (e) {
      errorMessage = getSignerErrorMessage(e, 'Failed to restore from backup file');
    } finally {
      isConnecting = false;
      sparkLoadingMessage = '';
      // Reset file input
      if (input) input.value = '';
    }
  }

  async function handleDisconnectWallet(walletId: number) {
    await disconnectWallet(walletId);

    // Clear transaction history immediately
    transactions = [];
    hasMoreTransactions = false;

    // If there's a remaining wallet that's now active, refresh its data
    if ($activeWallet) {
      await refreshBalance();
      await loadTransactionHistory(true);
    }

    successMessage = 'Wallet disconnected';
  }

  async function handleSetActive(walletId: number) {
    setActiveWallet(walletId);
    await refreshBalance();
  }

  function closeMnemonicModal() {
    showMnemonic = false;
    sparkMnemonic = '';
    mnemonicVisible = false;
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
        mnemonicVisible = false;
      } else {
        errorMessage = 'Could not load recovery phrase';
      }
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Failed to load recovery phrase';
    }
  }

  function closeRevealMnemonicModal() {
    revealedMnemonic = null;
    mnemonicVisible = false;
  }

  async function handleDownloadBackup() {
    isBackingUp = true;
    errorMessage = '';

    try {
      // Check encryption support
      if (!hasEncryptionSupport()) {
        throw new Error(
          'No encryption method available. Encryption is supported when logged in with a private key (nsec), NIP-07 extension, or NIP-46 remote signer with encryption permissions.'
        );
      }

      // Use the encryption service - it will pick the best method
      let usedMethod: EncryptionMethod = null;
      const encryptFn = async (plaintext: string, recipientPubkey: string): Promise<string> => {
        const result = await encryptionServiceEncrypt(recipientPubkey, plaintext);
        usedMethod = result.method;
        return result.ciphertext;
      };

      const backup = await createBackup(
        $userPublickey,
        encryptFn,
        getBestEncryptionMethod() || 'nip44'
      );

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

      successMessage =
        usedMethod === 'nip04'
          ? 'Backup file downloaded! (encrypted with NIP-04)'
          : 'Backup file downloaded!';
    } catch (e) {
      errorMessage = getSignerErrorMessage(e, 'Failed to create backup');
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
      saveBackupStatus('nostr');
      showBackupReminder = false;
    } catch (e) {
      errorMessage = getSignerErrorMessage(e, 'Failed to backup to Nostr');
    } finally {
      isBackingUp = false;
    }
  }

  // Backup reminder helpers
  const BACKUP_STATUS_KEY = 'spark_backup_status';

  function getBackupStatusKey(): string {
    return `${BACKUP_STATUS_KEY}_${$userPublickey}`;
  }

  function loadBackupStatus() {
    if (!browser || !$userPublickey) return;
    const status = localStorage.getItem(getBackupStatusKey());
    if (status) {
      backupReminderDismissed = true;
    }
  }

  function saveBackupStatus(method: string) {
    if (!browser || !$userPublickey) return;
    localStorage.setItem(getBackupStatusKey(), method);
    backupReminderDismissed = true;
  }

  function dismissBackupReminder() {
    showBackupReminder = false;
    backupReminderDismissed = true;
  }

  function handleShowPaperBackup() {
    showPaperBackupInline = true;
    handleRevealMnemonic();
  }

  function handlePaperBackupDone() {
    showPaperBackupInline = false;
    revealedMnemonic = null;
    mnemonicVisible = false;
    saveBackupStatus('paper');
    showBackupReminder = false;
    successMessage = 'Recovery phrase backed up!';
  }

  async function handleNwcBackupToNostr(wallet: { data: string }) {
    isBackingUp = true;
    errorMessage = '';

    try {
      await backupNwcToNostr($userPublickey, wallet.data);
      successMessage = 'NWC connection backed up to Nostr relays!';
    } catch (e) {
      errorMessage = getSignerErrorMessage(e, 'Failed to backup to Nostr');
    } finally {
      isBackingUp = false;
    }
  }

  async function handleRestoreNwcFromNostr() {
    isConnecting = true;
    errorMessage = '';
    console.log('[Wallet Page] Starting NWC restore from Nostr...');

    try {
      const connectionString = await restoreNwcFromNostr($userPublickey);
      console.log(
        '[Wallet Page] restoreNwcFromNostr returned:',
        connectionString ? 'connection string (' + connectionString.length + ' chars)' : 'null'
      );

      if (connectionString) {
        // Use the restored connection string to connect
        nwcConnectionString = connectionString;
        console.log('[Wallet Page] Calling connectWallet(3, connectionString)...');
        const result = await connectWallet(3, connectionString);
        console.log('[Wallet Page] connectWallet result:', result);

        if (result.success) {
          successMessage = 'NWC wallet restored from Nostr backup!';
          showAddWallet = false;
          selectedWalletType = null;
          nwcConnectionString = '';
          console.log('[Wallet Page] NWC restore complete, wallet connected');
        } else {
          errorMessage = result.error || 'Failed to connect restored NWC wallet';
          console.error('[Wallet Page] connectWallet failed:', result.error);
        }
      } else {
        errorMessage = 'No NWC backup found on Nostr relays.';
        console.log('[Wallet Page] No backup found');
      }
    } catch (e) {
      console.error('[Wallet Page] NWC restore error:', e);
      errorMessage = getSignerErrorMessage(e, 'Failed to restore from Nostr');
    } finally {
      isConnecting = false;
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

  async function handleViewSparkInfo() {
    if (!$userPublickey) return;

    isLoadingSparkInfo = true;
    errorMessage = '';

    try {
      const info = await getSparkWalletInfo($userPublickey);
      if (info) {
        sparkWalletInfo = info;
      } else {
        throw new Error('Could not load wallet info');
      }
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Failed to get wallet info';
    } finally {
      isLoadingSparkInfo = false;
    }
  }

  function closeSparkInfoModal() {
    sparkWalletInfo = null;
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

  async function handleNwcSyncToProfile() {
    if (!nwcLud16) return;

    isSyncingProfile = true;
    errorMessage = '';

    try {
      await syncLightningAddressToProfile(nwcLud16, $userPublickey, $ndk);
      successMessage = 'Lightning address synced to your Nostr profile!';
      showNwcSyncConfirmModal = false;

      // Refresh profile lud16 to update the sync status
      await fetchProfileLud16();
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Failed to sync to profile';
    } finally {
      isSyncingProfile = false;
    }
  }
</script>

<div class="max-w-2xl mx-auto py-8 px-4 wallet-panel-root">
  <!-- Error/Success Messages - Fixed at top, above all modals -->
  {#if errorMessage && portalTarget}
    <div use:portal={portalTarget}>
      <div
        class="wallet-toast fixed top-4 left-4 right-4 mx-auto p-4 rounded-lg flex items-center gap-3 shadow-xl border z-[9999]"
        style="background-color: var(--color-bg-primary); border-color: #ef4444; color: #ef4444;"
      >
        <WarningIcon size={20} class="flex-shrink-0" />
        <span class="flex-1 min-w-0 break-words text-sm">{errorMessage}</span>
        <button
          class="text-sm underline flex-shrink-0 hover:opacity-80"
          on:click={() => (errorMessage = '')}>Dismiss</button
        >
      </div>
    </div>
  {/if}

  {#if successMessage && portalTarget}
    <div use:portal={portalTarget}>
      <div
        class="wallet-toast fixed top-4 left-4 right-4 mx-auto p-4 rounded-lg flex items-center gap-3 shadow-xl border z-[9999]"
        style="background-color: var(--color-bg-primary); border-color: #22c55e; color: #22c55e;"
      >
        <CheckCircleIcon size={20} class="flex-shrink-0" />
        <span class="flex-1 min-w-0 break-words text-sm">{successMessage}</span>
        <button
          class="text-sm underline flex-shrink-0 hover:opacity-80"
          on:click={() => (successMessage = '')}>Dismiss</button
        >
      </div>
    </div>
  {/if}

  {#if !showPicker}
    <!-- WebLN Balance Overview — mx-4 keeps the card at the same 2rem
         inset as the non-WebLN balance frame and the inner wallet-scroll
         content below, so widths line up consistently. -->
    {#if $weblnConnected}
      <div class="mt-8 mb-8 mx-4 p-6 rounded-2xl bg-input border border-input">
        <div class="flex items-start justify-between gap-3 mb-2 balance-row">
          <div class="flex-1 min-w-0">
            <div
              class="inline-block max-w-full rounded-lg -mx-3 px-3 -my-1.5 py-1.5 cursor-pointer select-none hover:bg-white/5 transition-colors"
              role="button"
              tabindex="0"
              aria-label="Toggle SATS / fiat display"
              on:click={handleBalanceAmountTap}
              on:keydown={handleBalanceAmountKeydown}
            >
              <div class="text-4xl font-bold text-primary-color flex items-center gap-3 min-w-0">
                <LightningIcon size={32} weight="fill" class="text-amber-500 flex-shrink-0" />
                {#if weblnBalance === null && weblnBalanceLoading}
                  <span
                    class="inline-block w-32 h-9 rounded-lg animate-pulse"
                    style="background: var(--color-input-bg);"
                  ></span>
                {:else if weblnBalance === null}
                  <span class="text-2xl text-caption">Balance not available</span>
                {:else}
                  <span class:balance-refreshing={weblnBalanceLoading}>
                    <DenominatedBalance
                      sats={weblnBalance}
                      visible={$balanceVisible}
                      compact={false}
                    />
                  </span>
                {/if}
              </div>
              <!-- Sub-line: sats counterpart when fiat is primary, invisible
                   placeholder when SATS is primary (preserves card height
                   across toggles). -->
              <div class="ml-11 text-sm text-caption">
                {#if $displayCurrency === 'SATS' || weblnBalance === null}
                  &nbsp;
                {:else if !$balanceVisible}
                  ***
                {:else}
                  {formatBalance(weblnBalance)} sats
                {/if}
              </div>
            </div>
          </div>
          <div class="flex items-center gap-3 flex-shrink-0">
            <CurrencySelector compact />
            <button
              class="flex items-center justify-center text-caption hover:text-primary transition-colors cursor-pointer min-w-[44px] min-h-[44px]"
              on:click={toggleBalanceVisibility}
              title={$balanceVisible ? 'Hide balance' : 'Show balance'}
              aria-label={$balanceVisible ? 'Hide balance' : 'Show balance'}
            >
              {#if $balanceVisible}
                <EyeClosedIcon size={18} weight="bold" />
              {:else}
                <EyeIcon size={18} weight="bold" />
              {/if}
            </button>
            <button
              class="flex items-center justify-center text-caption hover:text-primary transition-colors cursor-pointer disabled:opacity-50 min-w-[44px] min-h-[44px]"
              on:click={refreshWeblnBalance}
              disabled={weblnBalanceLoading}
              title="Refresh balance"
              aria-label="Refresh balance"
            >
              <span class:animate-spin={weblnBalanceLoading}>
                <ArrowClockwiseIcon size={18} weight="bold" />
              </span>
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- Bitcoin Connect Balance Overview — lifted outside the scroll
         container so the balance stays pinned at the top of the modal
         while the connection / disconnect card below it scrolls.
         Mirrors the WebLN sticky-balance pattern above. -->
    {#if $bitcoinConnectEnabled && $wallets.length === 0 && !$weblnConnected}
      <div class="mt-8 mb-8 mx-4 p-6 rounded-2xl bg-input border border-input">
        <div class="flex items-start justify-between gap-3 mb-2 balance-row">
          <div class="flex-1 min-w-0">
            <div
              class="inline-block max-w-full rounded-lg -mx-3 px-3 -my-1.5 py-1.5 cursor-pointer select-none hover:bg-white/5 transition-colors"
              role="button"
              tabindex="0"
              aria-label="Toggle SATS / fiat display"
              on:click={handleBalanceAmountTap}
              on:keydown={handleBalanceAmountKeydown}
            >
              <div
                class="text-4xl font-bold flex items-center gap-3 min-w-0"
                style="color: var(--color-text-primary)"
              >
                <LightningIcon size={32} weight="fill" class="text-amber-500 flex-shrink-0" />
                {#if $bitcoinConnectBalance === null && $bitcoinConnectBalanceLoading}
                  <span
                    class="inline-block w-32 h-9 rounded-lg animate-pulse"
                    style="background: var(--color-input-bg);"
                  ></span>
                {:else if $bitcoinConnectBalance !== null}
                  <span class:balance-refreshing={$bitcoinConnectBalanceLoading}>
                    <DenominatedBalance
                      sats={$bitcoinConnectBalance}
                      visible={$balanceVisible}
                      compact={false}
                    />
                  </span>
                {:else}
                  <span class="text-2xl text-caption">Balance unavailable</span>
                {/if}
              </div>
              <!-- Sub-line: sats counterpart when fiat is primary, invisible
                   placeholder when SATS is primary (preserves card height
                   across toggles). -->
              <div class="ml-11 text-sm text-caption">
                {#if $displayCurrency === 'SATS' || $bitcoinConnectBalance === null}
                  &nbsp;
                {:else if !$balanceVisible}
                  ***
                {:else}
                  {formatBalance($bitcoinConnectBalance)} sats
                {/if}
              </div>
            </div>
          </div>
          <div class="flex items-center gap-3 flex-shrink-0">
            <CurrencySelector compact />
            <button
              class="flex items-center justify-center text-caption hover:text-primary transition-colors cursor-pointer min-w-[44px] min-h-[44px]"
              on:click={toggleBalanceVisibility}
              title={$balanceVisible ? 'Hide balance' : 'Show balance'}
              aria-label={$balanceVisible ? 'Hide balance' : 'Show balance'}
            >
              {#if $balanceVisible}
                <EyeClosedIcon size={18} weight="bold" />
              {:else}
                <EyeIcon size={18} weight="bold" />
              {/if}
            </button>
            <button
              class="flex items-center justify-center text-caption hover:text-primary transition-colors cursor-pointer disabled:opacity-50 min-w-[44px] min-h-[44px]"
              on:click={refreshBitcoinConnectBalance}
              disabled={$bitcoinConnectBalanceLoading}
              title="Refresh balance"
              aria-label="Refresh balance"
            >
              <span class:animate-spin={$bitcoinConnectBalanceLoading}>
                <ArrowClockwiseIcon size={18} weight="bold" />
              </span>
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- Balance Overview -->
    {#if $walletConnected && $activeWallet && !$weblnConnected}
      <div class="balance-frame" class:balance-frame--compact={isPanelScrolled}>
        <div
          class="balance-card mb-8 rounded-2xl"
          class:balance-card--compact={isPanelScrolled}
          class:cursor-pointer={isPanelScrolled}
          style="background-color: var(--color-input-bg);"
          role={isPanelScrolled ? 'button' : 'presentation'}
          tabindex={isPanelScrolled ? 0 : -1}
          aria-label={isPanelScrolled ? 'Expand balance' : undefined}
          on:click={handleBalanceCardClick}
          on:keydown={handleBalanceCardKeydown}
        >
          <div
            class="flex justify-between gap-3 balance-row"
            class:items-start={!isPanelScrolled}
            class:items-center={isPanelScrolled}
          >
            <div class="flex-1 min-w-0">
              <div
                class="inline-block max-w-full rounded-lg transition-colors {!isPanelScrolled
                  ? '-mx-3 px-3 -my-1.5 py-1.5 cursor-pointer select-none hover:bg-white/5'
                  : ''}"
                role={!isPanelScrolled ? 'button' : undefined}
                tabindex={!isPanelScrolled ? 0 : -1}
                aria-label={!isPanelScrolled ? 'Toggle SATS / fiat display' : undefined}
                on:click={!isPanelScrolled ? handleBalanceAmountTap : undefined}
                on:keydown={!isPanelScrolled ? handleBalanceAmountKeydown : undefined}
              >
                <div
                  class="balance-amount font-bold text-primary-color flex items-center gap-3 min-w-0"
                  class:text-4xl={!isPanelScrolled}
                  class:text-2xl={isPanelScrolled}
                >
                  <LightningIcon
                    size={isPanelScrolled ? 22 : 32}
                    weight="fill"
                    class="text-amber-500 flex-shrink-0"
                  />
                  {#if $walletBalance === null}
                    <span
                      class="inline-block w-32 h-9 rounded-lg animate-pulse"
                      style="background: var(--color-input-bg);"
                    ></span>
                  {:else}
                    <span class:balance-refreshing={$walletLoading}>
                      <DenominatedBalance
                        sats={$walletBalance}
                        visible={$balanceVisible}
                        compact={false}
                      />
                    </span>
                  {/if}
                </div>
                {#if !isPanelScrolled}
                  <!-- Sub-line: sats counterpart when fiat is primary,
                       invisible placeholder when SATS is primary (preserves
                       card height across toggles). -->
                  <div class="ml-11 text-sm text-caption">
                    {#if $displayCurrency === 'SATS' || $walletBalance === null}
                      &nbsp;
                    {:else if !$balanceVisible}
                      ***
                    {:else}
                      {formatBalance($walletBalance)} sats
                    {/if}
                  </div>
                {/if}
              </div>
              <!-- Syncing indicator — shows whenever Spark is syncing,
                   regardless of balance, so it's the single source of
                   truth for the syncing state in the wallet UI. Kept
                   outside the tap-to-cycle button so tapping it doesn't
                   change currency. -->
              {#if !isPanelScrolled && $activeWallet?.kind === 4 && $sparkSyncing}
                <div class="text-xs text-caption flex items-center gap-1 mt-1 ml-11">
                  <ArrowClockwiseIcon size={12} weight="bold" class="animate-spin" />
                  Syncing wallet...
                </div>
              {/if}
            </div>
            <div class="flex items-center gap-3 flex-shrink-0">
              {#if !isPanelScrolled}
                <CurrencySelector compact />
              {/if}
              <button
                class="flex items-center justify-center text-caption hover:text-primary transition-colors cursor-pointer min-w-[44px] min-h-[44px]"
                on:click={toggleBalanceVisibility}
                title={$balanceVisible ? 'Hide balance' : 'Show balance'}
                aria-label={$balanceVisible ? 'Hide balance' : 'Show balance'}
              >
                {#if $balanceVisible}
                  <EyeClosedIcon size={18} weight="bold" />
                {:else}
                  <EyeIcon size={18} weight="bold" />
                {/if}
              </button>
              <button
                class="flex items-center justify-center text-caption hover:text-primary transition-colors cursor-pointer disabled:opacity-50 min-w-[44px] min-h-[44px]"
                on:click={refreshAll}
                disabled={$walletLoading || isLoadingHistory}
                title="Refresh wallet"
                aria-label="Refresh wallet"
              >
                <span class:animate-spin={$walletLoading || isLoadingHistory}>
                  <ArrowClockwiseIcon size={18} weight="bold" />
                </span>
              </button>
            </div>
          </div>

          <!-- Send/Receive buttons - only for NWC and Spark wallets, hidden
               in compact mode and while a send/receive view is active. -->
          {#if $activeWallet.kind !== 1 && !isPanelScrolled && dashboardView === 'home'}
            <div class="flex gap-3 mt-6">
              <button
                class="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-medium transition-colors"
                on:click={openSendView}
              >
                <ArrowUpIcon size={20} weight="bold" />
                Send
              </button>
              <button
                class="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-medium transition-colors"
                on:click={openReceiveView}
              >
                <ArrowDownIcon size={20} weight="bold" />
                Receive
              </button>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Inner scroll container — bounce / rubber-band happens here, NOT
           on the balance frame above, so the balance stays put when the
           user hits the top or bottom of the transaction list. The
           `dashboardView` swaps the home transactions for inline
           send/receive forms without a stacked sub-modal. -->
    {#if dashboardView === 'home'}
      <div class="wallet-scroll" bind:this={panelScrollEl}>
        <!-- Pending deposits alert -->
        {#if $activeWallet?.kind === 4 && unclaimedDeposits.length > 0}
          <div
            class="mb-4 p-3 rounded-xl flex items-center gap-2"
            style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3);"
          >
            <WarningIcon size={18} class="text-amber-500 flex-shrink-0" />
            <span class="text-sm font-medium" style="color: var(--color-text-primary);"
              >{unclaimedDeposits.length} pending deposit{unclaimedDeposits.length > 1 ? 's' : ''} to
              claim</span
            >
            <a
              href="#pending-deposits"
              class="ml-auto text-xs font-medium text-amber-500 hover:text-amber-400">View</a
            >
          </div>
        {/if}

        <!-- Backup Reminder Banner (Spark wallet only, after creation) -->
        {#if showBackupReminder && !backupReminderDismissed && $activeWallet?.kind === 4}
          <div
            class="mb-4 p-4 rounded-2xl"
            style="background-color: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.3);"
          >
            <div class="flex items-start gap-3">
              <ShieldCheckIcon size={22} class="text-amber-500 flex-shrink-0 mt-0.5" />
              <div class="flex-1">
                <p class="font-medium text-primary-color mb-1">Protect your wallet</p>
                <p class="text-sm text-caption mb-3">
                  Choose a backup method to secure your funds.
                </p>

                {#if showPaperBackupInline && revealedMnemonic}
                  <div class="mb-3">
                    <div
                      class="relative p-4 rounded-lg mb-3 font-mono text-sm"
                      style="background-color: var(--color-input-bg); color: var(--color-text-primary);"
                    >
                      {#if mnemonicVisible}
                        <span class="select-all">{revealedMnemonic}</span>
                      {:else}
                        <span class="blur-sm select-none" aria-hidden="true"
                          >{revealedMnemonic}</span
                        >
                      {/if}
                      <button
                        class="absolute top-3 right-3 p-1 rounded-lg opacity-70 hover:opacity-100 transition-opacity"
                        style="color: var(--color-text-primary);"
                        on:click={() => (mnemonicVisible = !mnemonicVisible)}
                        title={mnemonicVisible ? 'Hide' : 'Reveal'}
                      >
                        {#if mnemonicVisible}
                          <EyeSlashIcon size={18} />
                        {:else}
                          <EyeIcon size={18} />
                        {/if}
                      </button>
                    </div>
                    <button
                      class="w-full py-2 px-4 rounded-xl text-sm font-medium bg-amber-500 hover:bg-amber-600 text-white transition-colors"
                      on:click={handlePaperBackupDone}
                    >
                      I've written it down
                    </button>
                  </div>
                {:else}
                  <div class="flex flex-col gap-2">
                    <button
                      class="flex items-center gap-3 w-full py-2.5 px-4 rounded-xl text-sm font-medium text-left transition-colors hover:bg-white/5"
                      style="border: 1px solid var(--color-input-border);"
                      on:click={handleShowPaperBackup}
                    >
                      <PencilSimpleIcon size={18} class="text-amber-500 flex-shrink-0" />
                      <span class="text-primary-color">Write down recovery phrase</span>
                    </button>
                    {#if encryptionSupported && !isNip46User}
                      <button
                        class="flex items-center gap-3 w-full py-2.5 px-4 rounded-xl text-sm font-medium text-left transition-colors hover:bg-white/5 disabled:opacity-40"
                        style="border: 1px solid var(--color-input-border);"
                        on:click={handleBackupToNostr}
                        disabled={isBackingUp}
                      >
                        <CloudArrowUpIcon size={18} class="text-amber-500 flex-shrink-0" />
                        <span class="text-primary-color">
                          {isBackingUp ? 'Backing up...' : 'Backup to Nostr'}
                        </span>
                      </button>
                    {/if}
                  </div>
                {/if}

                <button
                  class="mt-3 text-xs text-caption hover:text-primary-color transition-colors cursor-pointer"
                  on:click={dismissBackupReminder}
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        {/if}

        <!-- Pending On-Chain Deposits (Spark wallet only) -->
        <div id="pending-deposits"></div>
        {#if $activeWallet?.kind === 4 && unclaimedDeposits.length > 0}
          <div
            class="mb-8 p-4 rounded-2xl"
            style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
          >
            <div class="flex items-center gap-2 mb-1">
              <h3 class="font-semibold text-primary-color">Pending Deposits</h3>
              <button
                class="ml-auto p-1 rounded hover:bg-amber-500/20 transition-colors"
                on:click={loadUnclaimedDeposits}
                disabled={isLoadingDeposits}
                title="Refresh deposits"
              >
                <ArrowClockwiseIcon
                  size={16}
                  weight="bold"
                  class="text-amber-500 {isLoadingDeposits ? 'animate-spin' : ''}"
                />
              </button>
            </div>
            <p class="text-xs text-caption mb-4">
              These on-chain deposits need manual approval to claim
            </p>

            <div class="space-y-4">
              {#each unclaimedDeposits as deposit}
                <div>
                  <div class="flex items-center gap-3 mb-2">
                    <BitcoinIcon size={24} className="text-amber-500" />
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center justify-between">
                        <span class="font-semibold text-primary-color">
                          {formatBalance(deposit.amountSats)} sats
                        </span>
                        <span class="text-xs text-amber-500 font-medium">Pending</span>
                      </div>
                      <a
                        href="https://mempool.space/tx/{deposit.txid}"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-xs text-caption font-mono hover:text-amber-500 transition-colors inline-flex items-center gap-1"
                      >
                        {deposit.txid.slice(0, 8)}...{deposit.txid.slice(-8)}
                        <LinkIcon size={12} />
                      </a>
                    </div>
                  </div>

                  {#if deposit.claimError && deposit.claimError.type !== 'maxDepositClaimFeeExceeded'}
                    <div class="mb-3 text-xs text-caption flex items-center gap-1.5">
                      <WarningIcon size={14} class="text-amber-500 flex-shrink-0" />
                      {#if deposit.claimError.type === 'missingUtxo'}
                        Transaction not yet confirmed. Please wait.
                      {:else}
                        {deposit.claimError.message}
                      {/if}
                    </div>
                  {/if}

                  <div class="flex gap-2">
                    <button
                      class="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-medium transition-colors disabled:opacity-50"
                      on:click={() => handleClaimDeposit(deposit.txid, deposit.vout)}
                      disabled={isClaimingDeposit}
                    >
                      {#if isClaimingDeposit && claimingTxid === deposit.txid}
                        <ArrowClockwiseIcon size={16} weight="bold" class="animate-spin" />
                        Claiming...
                      {:else}
                        <ArrowDownIcon size={16} />
                        Claim Now
                      {/if}
                    </button>
                    <button
                      class="py-2.5 px-4 rounded-xl border font-medium transition-colors disabled:opacity-50"
                      style="border-color: var(--color-input-border); color: var(--color-text-primary);"
                      on:click={() => openRefundModal(deposit)}
                      disabled={isClaimingDeposit || isRefunding}
                    >
                      Refund
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Connected Wallets -->
        <div class="mb-8">
          <!-- WebLN External Wallet Display -->
          {#if $weblnConnected}
            <div
              class="p-8 rounded-2xl text-center flex flex-col items-center mb-3"
              style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
            >
              <div
                class="w-16 h-16 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center mb-4"
              >
                <LightningIcon size={32} weight="fill" class="text-white" />
              </div>
              <p class="font-medium mb-1" style="color: var(--color-text-primary)">
                {$weblnWalletName || 'Browser Wallet'}
              </p>
              <p class="text-sm text-caption mb-4">Browser wallet connected via WebLN</p>
              <button
                class="px-5 py-3 min-h-[44px] rounded-full font-semibold text-sm text-caption hover:text-red-500 transition-colors cursor-pointer"
                style="border: 1px solid var(--color-input-border);"
                on:click={handleDisconnectWebln}
              >
                Disconnect Browser Wallet
              </button>
            </div>
          {/if}

          {#if $wallets.length === 0 && !$weblnConnected}
            <div class="flex flex-col items-center">
              {#if $bitcoinConnectEnabled}
                <!-- Bitcoin Connect connection card — mirrors the
                     WebLN connection card structure. The BC balance
                     card itself is rendered outside the scroll above,
                     mirroring the WebLN sticky-balance pattern. -->
                <div
                  class="w-full p-8 rounded-2xl text-center flex flex-col items-center mb-3"
                  style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
                >
                  <div
                    class="w-16 h-16 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center mb-4"
                  >
                    <BitcoinConnectLogo size={32} className="text-white" />
                  </div>
                  <p class="font-medium mb-1" style="color: var(--color-text-primary)">
                    {$bitcoinConnectWalletInfo.alias || 'External wallet'}
                  </p>
                  <p class="text-sm text-caption mb-1">
                    External wallet connected via Bitcoin Connect
                  </p>
                  {#if $bitcoinConnectWalletInfo.pubkey}
                    <p class="text-xs text-caption font-mono mb-4">
                      {$bitcoinConnectWalletInfo.pubkey.slice(
                        0,
                        8
                      )}...{$bitcoinConnectWalletInfo.pubkey.slice(-8)}
                    </p>
                  {:else}
                    <div class="mb-4"></div>
                  {/if}
                  <button
                    class="px-5 py-3 min-h-[44px] rounded-full font-semibold text-sm text-caption hover:text-red-500 transition-colors cursor-pointer"
                    style="border: 1px solid var(--color-input-border);"
                    on:click={handleDisableBitcoinConnect}
                  >
                    Disconnect Bitcoin Connect
                  </button>
                </div>
              {:else}
                <div
                  class="w-16 h-16 rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center mb-4"
                >
                  <WalletIcon size={32} class="text-amber-500" />
                </div>
                <h3 class="font-semibold mb-1" style="color: var(--color-text-primary)">
                  Zap Cooking is better with zaps!
                </h3>
                <p class="text-caption text-sm mb-4 max-w-xs">
                  Connect a Lightning wallet to send zaps, receive payments, and support creators.
                </p>
                <Button
                  on:click={() => {
                    showAddWallet = true;
                    selectedWalletType = null;
                  }}
                >
                  Connect Your First Wallet
                </Button>
              {/if}
            </div>
          {:else if $wallets.length > 0}
            <!-- WebLN active indicator when embedded wallets exist -->
            {#if $weblnConnected}
              <div
                class="p-3 rounded-xl mb-3 flex items-center gap-3"
                style="background-color: rgba(249, 115, 22, 0.1); border: 1px solid rgba(249, 115, 22, 0.3);"
              >
                <div
                  class="w-5 h-5 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center flex-shrink-0"
                >
                  <LightningIcon size={12} weight="fill" class="text-white" />
                </div>
                <div class="flex-1">
                  <span class="text-sm font-medium" style="color: var(--color-text-primary)"
                    >Browser wallet active</span
                  >
                  <span class="text-sm text-caption"> — embedded wallets below are paused</span>
                </div>
                <button
                  class="text-xs px-2 py-1 rounded-full text-caption hover:text-red-500 transition-colors cursor-pointer"
                  style="border: 1px solid var(--color-input-border);"
                  on:click={handleDisconnectWebln}
                >
                  Disconnect
                </button>
              </div>
            {/if}
            <div class="space-y-3">
              {#each $wallets.filter((w) => w.kind !== 1) as wallet}
                {@const isEffectivelyActive = wallet.active && !$weblnConnected}
                <div
                  class="rounded-lg overflow-hidden border"
                  style="border-color: {isEffectivelyActive
                    ? 'rgba(245, 158, 11, 0.5)'
                    : 'var(--color-input-border)'};"
                >
                  <div class="p-3 sm:p-4 flex items-center gap-2 sm:gap-4">
                    <!-- Wallet type icon -->
                    {#if wallet.kind === 4}
                      <SparkLogo size={24} className="text-orange-500 flex-shrink-0" />
                    {:else if wallet.kind === 3}
                      <NwcLogo size={24} className="text-purple-500 flex-shrink-0" />
                    {/if}
                    <div class="flex-1 min-w-0">
                      <div class="font-medium truncate" style="color: var(--color-text-primary)">
                        {wallet.name}
                      </div>
                      <div class="text-sm text-caption hidden sm:block">
                        {getWalletKindName(wallet.kind)}{#if wallet.kind === 3}{@const parsed =
                            parseNwcUrl(wallet.data)}{#if parsed}
                            · {parsed.pubkey.slice(0, 8)}...{/if}{/if}
                      </div>
                    </div>
                    {#if wallet.kind === 4 || wallet.kind === 3}
                      <button
                        class="relative flex items-center gap-0.5 sm:gap-1 p-1.5 sm:px-2 sm:py-1 rounded-lg text-caption hover:text-primary hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer transition-all flex-shrink-0"
                        on:click={() => toggleWalletOptions(wallet.id)}
                        title="Wallet options"
                      >
                        <GearIcon
                          size={18}
                          weight={expandedWalletId === wallet.id ? 'fill' : 'regular'}
                        />
                        <!-- Notification dot for Spark wallets without lightning address (only show after wallet is initialized) -->
                        {#if wallet.kind === 4 && $sparkWalletInitialized && !$sparkLightningAddressStore && expandedWalletId !== wallet.id}
                          <span
                            class="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-amber-500 rounded-full border-2"
                            style="border-color: var(--color-input-bg);"
                          ></span>
                        {/if}
                        <CaretDownIcon
                          size={14}
                          weight="bold"
                          class="transition-transform {expandedWalletId === wallet.id
                            ? 'rotate-180'
                            : ''}"
                        />
                      </button>
                    {/if}
                  </div>

                  <!-- Spark wallet backup options -->
                  {#if wallet.kind === 4 && expandedWalletId === wallet.id}
                    <div
                      class="px-4 pb-4 pt-2 border-t"
                      style="border-color: var(--color-input-border);"
                    >
                      <!-- Encryption not supported warning -->
                      {#if !encryptionSupported}
                        <!-- Encryption not supported warning (for other signer types) -->
                        <div
                          class="p-3 rounded-lg mb-3 text-sm"
                          style="background-color: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3);"
                        >
                          <div class="flex items-start gap-2">
                            <WarningIcon size={18} class="text-amber-500 flex-shrink-0 mt-0.5" />
                            <div>
                              <p class="text-caption">
                                Backups require a signer with encryption support. You can still use
                                "Recovery Phrase" to manually back up your wallet.
                              </p>
                            </div>
                          </div>
                        </div>
                      {/if}

                      <!-- Wallet Info -->
                      <div class="text-xs text-caption mb-2 uppercase tracking-wide">
                        Wallet Details
                      </div>
                      <div class="grid grid-cols-2 gap-2 mb-4">
                        <button
                          class="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer hover:bg-white/5 dark:hover:bg-white/5"
                          style="color: var(--color-text-secondary); border: 1px solid var(--color-input-border);"
                          on:click={handleViewSparkInfo}
                          disabled={isLoadingSparkInfo}
                        >
                          <InfoIcon size={16} />
                          <span class="truncate"
                            >{isLoadingSparkInfo ? 'Loading...' : 'Wallet Info'}</span
                          >
                        </button>
                      </div>

                      <!-- Backup & Recovery -->
                      <div class="text-xs text-caption mb-2 uppercase tracking-wide">
                        Backup & Recovery
                      </div>
                      <div class="grid grid-cols-2 gap-2">
                        <button
                          class="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer hover:bg-white/5 dark:hover:bg-white/5"
                          style="color: var(--color-text-secondary); border: 1px solid var(--color-input-border);"
                          on:click={handleRevealMnemonic}
                        >
                          <KeyIcon size={16} />
                          Recovery Phrase
                        </button>
                        {#if encryptionSupported && !isNip46User}
                          <button
                            class="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer hover:bg-white/5 dark:hover:bg-white/5"
                            style="color: var(--color-text-secondary); border: 1px solid var(--color-input-border);"
                            on:click={handleBackupToNostr}
                            disabled={isBackingUp}
                          >
                            <CloudArrowUpIcon size={16} />
                            {isBackingUp ? 'Backing up...' : 'Backup to Nostr'}
                          </button>
                        {/if}
                        <button
                          class="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer hover:bg-white/5 dark:hover:bg-white/5"
                          style="color: var(--color-text-secondary); border: 1px solid var(--color-input-border);"
                          on:click={() => {
                            checkRelayBackupsWalletType = 'spark';
                            showCheckRelayBackupsModal = true;
                          }}
                        >
                          <CloudCheckIcon size={16} />
                          Check Backups
                        </button>
                        <button
                          class="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer hover:bg-white/5 dark:hover:bg-white/5"
                          style="color: var(--color-text-secondary); border: 1px solid var(--color-input-border);"
                          on:click={() => (showRecoveryHelpModal = true)}
                        >
                          <LifebuoyIcon size={16} />
                          Recovery Help
                        </button>
                        <button
                          class="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer text-red-500 hover:bg-red-500/10"
                          style="border: 1px solid var(--color-input-border);"
                          on:click={() =>
                            (walletToDelete = {
                              id: wallet.id,
                              name: wallet.name,
                              kind: wallet.kind,
                              data: wallet.data
                            })}
                        >
                          <TrashIcon size={16} />
                          Remove Wallet
                        </button>
                      </div>

                      <!-- Lightning Address Section -->
                      <div
                        class="mt-4 pt-4 border-t"
                        style="border-color: var(--color-input-border);"
                      >
                        <div
                          class="text-xs text-caption mb-3 uppercase tracking-wide flex items-center gap-2"
                        >
                          <LightningIcon size={14} />
                          Lightning Address
                        </div>

                        {#if $sparkLightningAddressStore}
                          <!-- Has lightning address -->
                          <div class="mb-3">
                            <div class="text-sm text-caption mb-1">Your lightning address:</div>
                            <div class="font-medium text-primary-color flex items-center gap-2">
                              {$sparkLightningAddressStore}
                              <button
                                class="text-caption hover:text-primary transition-colors cursor-pointer"
                                title="Copy lightning address"
                                on:click={async () => {
                                  const copied = await copyToClipboard(
                                    $sparkLightningAddressStore || ''
                                  );
                                  if (copied) successMessage = 'Lightning address copied!';
                                }}
                              >
                                <CopyIcon size={16} />
                              </button>
                              {#if isLoadingProfileLud16}
                                <div
                                  class="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"
                                ></div>
                              {:else if isProfileSynced}
                                <span class="text-green-500" title="Synced to your Nostr profile">
                                  <CheckCircleIcon size={18} weight="fill" />
                                </span>
                              {:else}
                                <span
                                  class="text-amber-500"
                                  title="Not synced to your Nostr profile"
                                >
                                  <WarningIcon size={18} weight="fill" />
                                </span>
                              {/if}
                            </div>
                          </div>

                          <!-- Profile sync status -->
                          {#if !isLoadingProfileLud16}
                            {#if isProfileSynced}
                              <div
                                class="p-3 rounded-lg mb-3"
                                style="background-color: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3);"
                              >
                                <div class="text-sm text-green-600 flex items-center gap-2">
                                  <CheckCircleIcon size={16} weight="fill" />
                                  This address is set in your Nostr profile
                                </div>
                              </div>
                            {:else if profileLud16}
                              <div
                                class="p-3 rounded-lg mb-3"
                                style="background-color: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3);"
                              >
                                <div class="text-sm" style="color: var(--color-text-primary);">
                                  <div class="flex items-center gap-2 mb-1">
                                    <WarningIcon size={16} class="text-amber-500" />
                                    <span class="font-medium"
                                      >Profile uses a different address:</span
                                    >
                                  </div>
                                  <div class="text-caption font-mono text-xs ml-6">
                                    {profileLud16}
                                  </div>
                                </div>
                              </div>
                            {:else}
                              <div
                                class="p-3 rounded-lg mb-3"
                                style="background-color: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3);"
                              >
                                <div
                                  class="text-sm flex items-center gap-2"
                                  style="color: var(--color-text-primary);"
                                >
                                  <WarningIcon size={16} class="text-amber-500" />
                                  No lightning address in your Nostr profile yet
                                </div>
                              </div>
                            {/if}
                          {/if}

                          {#if wallet.active}
                            <div class="flex flex-wrap gap-2">
                              {#if !isProfileSynced}
                                <button
                                  class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer bg-amber-500 hover:bg-amber-600 text-white"
                                  on:click={() => (showSyncConfirmModal = true)}
                                >
                                  <UserCirclePlusIcon size={16} />
                                  Sync to Profile
                                </button>
                              {:else}
                                <button
                                  class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer hover:bg-white/5"
                                  style="border: 1px solid var(--color-input-border); color: var(--color-text-primary);"
                                  on:click={() => (showSyncConfirmModal = true)}
                                >
                                  <UserCirclePlusIcon size={16} />
                                  Sync to Profile
                                </button>
                              {/if}
                              <button
                                class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                                style="border: 1px solid var(--color-input-border);"
                                on:click={() => (showDeleteAddressConfirmModal = true)}
                              >
                                <TrashIcon size={16} />
                                Delete
                              </button>
                            </div>
                          {:else}
                            <p class="text-xs text-caption">
                              Activate this wallet to manage the lightning address.
                            </p>
                          {/if}
                        {:else}
                          <!-- No lightning address or still loading -->
                          {#if !$sparkWalletInitialized}
                            <!-- Wallet is still initializing -->
                            <div
                              class="p-3 rounded-lg"
                              style="border: 1px solid var(--color-input-border);"
                            >
                              <div class="flex items-center gap-2 text-sm text-caption">
                                <div
                                  class="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"
                                ></div>
                                Loading lightning address...
                              </div>
                            </div>
                          {:else if wallet.active}
                            <!-- Show registration form only when wallet is active and initialized -->
                            <div
                              class="p-3 rounded-lg mb-3"
                              style="background-color: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3);"
                            >
                              <div class="text-sm" style="color: var(--color-text-primary);">
                                Set up a lightning address to receive payments easily!
                              </div>
                            </div>
                            <div class="flex items-center gap-2 mb-3">
                              <div
                                class="flex-1 flex items-center rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-amber-500"
                                style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
                              >
                                <input
                                  type="text"
                                  class="flex-1 min-w-0 p-2 bg-transparent text-sm focus:outline-none"
                                  style="color: var(--color-text-primary);"
                                  placeholder="username"
                                  value={newLightningUsername}
                                  on:input={handleUsernameInput}
                                  disabled={isRegisteringAddress}
                                />
                                <span class="pr-2 text-sm text-caption whitespace-nowrap"
                                  >@sats.zap.cooking</span
                                >
                              </div>
                              {#if isCheckingAvailability}
                                <div class="w-6 h-6 flex items-center justify-center flex-shrink-0">
                                  <div
                                    class="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"
                                  ></div>
                                </div>
                              {:else if isUsernameAvailable === true}
                                <div
                                  class="w-6 h-6 flex items-center justify-center text-green-500 flex-shrink-0"
                                >
                                  <CheckIcon size={20} weight="bold" />
                                </div>
                              {:else if isUsernameAvailable === false}
                                <div
                                  class="w-6 h-6 flex items-center justify-center text-red-500 flex-shrink-0"
                                >
                                  <XIcon size={20} weight="bold" />
                                </div>
                              {:else}
                                <div class="w-6 h-6 flex-shrink-0"></div>
                              {/if}
                            </div>
                            {#if isUsernameAvailable === false}
                              <p class="text-xs text-red-500 mb-2">
                                This username is already taken
                              </p>
                            {/if}
                            <button
                              class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                              on:click={handleRegisterLightningAddress}
                              disabled={!isUsernameAvailable ||
                                isRegisteringAddress ||
                                newLightningUsername.length < 3}
                            >
                              <LightningIcon size={16} />
                              {isRegisteringAddress ? 'Registering...' : 'Register Address'}
                            </button>
                          {:else}
                            <p class="text-sm text-caption">
                              No lightning address registered. Activate this wallet to set one up.
                            </p>
                          {/if}
                        {/if}
                      </div>
                    </div>
                  {/if}

                  <!-- NWC wallet options -->
                  {#if wallet.kind === 3 && expandedWalletId === wallet.id}
                    <div
                      class="px-4 pb-4 pt-2 border-t"
                      style="border-color: var(--color-input-border);"
                    >
                      <!-- Connection -->
                      <div class="text-xs text-caption mb-2 uppercase tracking-wide">
                        Wallet Details
                      </div>
                      <div class="grid grid-cols-2 gap-2 mb-4">
                        <button
                          class="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer hover:bg-white/5 dark:hover:bg-white/5"
                          style="color: var(--color-text-secondary); border: 1px solid var(--color-input-border);"
                          on:click={() => handleViewNwcInfo(wallet)}
                          disabled={isLoadingNwcInfo}
                        >
                          <InfoIcon size={16} />
                          <span class="truncate"
                            >{isLoadingNwcInfo ? 'Loading...' : 'Wallet Info'}</span
                          >
                        </button>
                        <button
                          class="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer hover:bg-white/5 dark:hover:bg-white/5"
                          style="color: var(--color-text-secondary); border: 1px solid var(--color-input-border);"
                          on:click={() => handleCopyNwcConnection(wallet)}
                        >
                          <CopyIcon size={16} />
                          <span class="truncate">Copy Connection</span>
                        </button>
                      </div>

                      <!-- Backup & Recovery -->
                      <div class="text-xs text-caption mb-2 uppercase tracking-wide">
                        Backup & Recovery
                      </div>
                      <div class="grid grid-cols-2 gap-2">
                        {#if encryptionSupported && !isNip46User}
                          <button
                            class="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer hover:bg-white/5"
                            style="background-color: transparent; color: var(--color-text-secondary); border: 1px solid var(--color-input-border);"
                            on:click={() => handleNwcBackupToNostr(wallet)}
                            disabled={isBackingUp}
                          >
                            <CloudArrowUpIcon size={16} />
                            <span class="truncate"
                              >{isBackingUp ? 'Backing up...' : 'Backup to Nostr'}</span
                            >
                          </button>
                        {/if}
                        <button
                          class="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer hover:bg-white/5 dark:hover:bg-white/5"
                          style="color: var(--color-text-secondary); border: 1px solid var(--color-input-border);"
                          on:click={() => handleDownloadNwcBackup(wallet)}
                        >
                          <DownloadSimpleIcon size={16} />
                          <span class="truncate">Download</span>
                        </button>
                        <button
                          class="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer hover:bg-white/5 dark:hover:bg-white/5"
                          style="color: var(--color-text-secondary); border: 1px solid var(--color-input-border);"
                          on:click={() => {
                            checkRelayBackupsWalletType = 'nwc';
                            showCheckRelayBackupsModal = true;
                          }}
                        >
                          <CloudCheckIcon size={16} />
                          <span class="truncate">Check Backups</span>
                        </button>
                        <button
                          class="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer text-red-500 hover:bg-red-500/10"
                          style="background-color: transparent; border: 1px solid var(--color-input-border);"
                          on:click={() =>
                            (walletToDelete = {
                              id: wallet.id,
                              name: wallet.name,
                              kind: wallet.kind,
                              data: wallet.data
                            })}
                        >
                          <TrashIcon size={16} />
                          <span class="truncate">Remove Wallet</span>
                        </button>
                      </div>

                      <!-- NWC Lightning Address Section -->
                      {#if wallet.data}
                        {@const walletNwcLud16 = getNwcLud16(wallet.data)}
                        {#if walletNwcLud16}
                          <div
                            class="mt-4 pt-4 border-t"
                            style="border-color: var(--color-input-border);"
                          >
                            <div
                              class="text-xs text-caption mb-3 uppercase tracking-wide flex items-center gap-2"
                            >
                              <LightningIcon size={14} />
                              Lightning Address
                            </div>

                            <div
                              class="p-3 rounded-lg mb-3"
                              style="border: 1px solid var(--color-input-border);"
                            >
                              <div class="text-sm text-caption mb-1">From NWC connection:</div>
                              <div class="font-medium text-primary-color flex items-center gap-2">
                                {walletNwcLud16}
                                <button
                                  class="text-caption hover:text-primary transition-colors cursor-pointer"
                                  title="Copy lightning address"
                                  on:click={async () => {
                                    const copied = await copyToClipboard(walletNwcLud16);
                                    if (copied) successMessage = 'Lightning address copied!';
                                  }}
                                >
                                  <CopyIcon size={16} />
                                </button>
                                {#if isLoadingProfileLud16}
                                  <div
                                    class="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"
                                  ></div>
                                {:else if profileLud16 && walletNwcLud16
                                    .toLowerCase()
                                    .trim() === profileLud16.toLowerCase().trim()}
                                  <span class="text-green-500" title="Synced to your Nostr profile">
                                    <CheckCircleIcon size={18} weight="fill" />
                                  </span>
                                {:else}
                                  <span
                                    class="text-amber-500"
                                    title="Not synced to your Nostr profile"
                                  >
                                    <WarningIcon size={18} weight="fill" />
                                  </span>
                                {/if}
                              </div>
                            </div>

                            <!-- Profile sync status -->
                            {#if !isLoadingProfileLud16}
                              {@const isNwcSynced =
                                profileLud16 &&
                                walletNwcLud16.toLowerCase().trim() ===
                                  profileLud16.toLowerCase().trim()}
                              {#if isNwcSynced}
                                <div
                                  class="p-3 rounded-lg mb-3"
                                  style="background-color: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3);"
                                >
                                  <div class="text-sm text-green-600 flex items-center gap-2">
                                    <CheckCircleIcon size={16} weight="fill" />
                                    This address is set in your Nostr profile
                                  </div>
                                </div>
                              {:else if profileLud16}
                                <div
                                  class="p-3 rounded-lg mb-3"
                                  style="background-color: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3);"
                                >
                                  <div class="text-sm" style="color: var(--color-text-primary);">
                                    <div class="flex items-center gap-2 mb-1">
                                      <WarningIcon size={16} class="text-amber-500" />
                                      <span class="font-medium"
                                        >Profile uses a different address:</span
                                      >
                                    </div>
                                    <div class="text-caption font-mono text-xs ml-6">
                                      {profileLud16}
                                    </div>
                                  </div>
                                </div>
                              {:else}
                                <div
                                  class="p-3 rounded-lg mb-3"
                                  style="background-color: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3);"
                                >
                                  <div
                                    class="text-sm flex items-center gap-2"
                                    style="color: var(--color-text-primary);"
                                  >
                                    <WarningIcon size={16} class="text-amber-500" />
                                    No lightning address in your Nostr profile yet
                                  </div>
                                </div>
                              {/if}

                              {#if !isNwcSynced && wallet.active}
                                <button
                                  class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer bg-amber-500 hover:bg-amber-600 text-white"
                                  on:click={() => (showNwcSyncConfirmModal = true)}
                                >
                                  <UserCirclePlusIcon size={16} />
                                  Sync to Profile
                                </button>
                              {:else if !isNwcSynced}
                                <p class="text-xs text-caption">
                                  Activate this wallet to sync the lightning address.
                                </p>
                              {/if}
                            {/if}
                          </div>
                        {:else}
                          <div
                            class="mt-4 pt-4 border-t"
                            style="border-color: var(--color-input-border);"
                          >
                            <div
                              class="text-xs text-caption mb-3 uppercase tracking-wide flex items-center gap-2"
                            >
                              <LightningIcon size={14} />
                              Lightning Address
                            </div>
                            <p class="text-sm text-caption">
                              No lightning address found in the NWC connection string.
                            </p>
                          </div>
                        {/if}
                      {/if}
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
            {:else if isLoadingHistory && transactions.length === 0 && filteredPendingTransactions.length === 0}
              <div class="py-8 text-center">
                <div class="animate-pulse text-caption">Loading transactions...</div>
              </div>
            {:else if transactions.length === 0 && filteredPendingTransactions.length === 0}
              <div class="py-8 text-center">
                <ClockIcon size={48} class="mx-auto mb-4 text-caption" />
                <p class="text-caption">No transactions yet</p>
              </div>
            {:else}
              <div>
                <!-- Pending/completed transactions shown first (filtered to active wallet) -->
                {#each filteredPendingTransactions as tx (tx.id)}
                  {#if tx.status === 'completed'}
                    <!-- Completed but not yet in history (outgoing = orange) -->
                    <div
                      class="py-4 flex items-center gap-4 border-b border-l-2 border-orange-500/50 pl-3"
                      style="border-bottom-color: var(--color-input-border);"
                    >
                      {#if tx.pubkey}
                        <a href="/user/{nip19.npubEncode(tx.pubkey)}" class="flex-shrink-0">
                          <CustomAvatar pubkey={tx.pubkey} size={40} />
                        </a>
                      {:else}
                        <div
                          class="w-10 h-10 rounded-full flex items-center justify-center bg-orange-500/20"
                        >
                          <ArrowUpIcon size={20} class="text-orange-500" />
                        </div>
                      {/if}
                      <div class="flex-1 min-w-0">
                        <div class="font-medium truncate text-primary-color">
                          {#if tx.pubkey}
                            <span class="text-orange-500">⚡ to</span>
                            <a href="/user/{nip19.npubEncode(tx.pubkey)}" class="hover:underline">
                              <CustomName pubkey={tx.pubkey} />
                            </a>
                          {:else}
                            {tx.description || 'Payment sent'}
                          {/if}
                        </div>
                        {#if tx.comment}
                          <div class="text-sm text-primary-color italic truncate">
                            "{tx.comment}"
                          </div>
                        {/if}
                        <div class="text-sm text-orange-500">✓ Payment sent</div>
                      </div>
                      <div class="text-right">
                        <div class="font-semibold text-orange-500">
                          {#if $balanceVisible}
                            -{tx.amount.toLocaleString()} sats
                          {:else}
                            -*** sats
                          {/if}
                        </div>
                      </div>
                    </div>
                  {:else}
                    <!-- Still pending -->
                    <div
                      class="py-4 flex items-center gap-4 border-b border-l-2 border-amber-500/50 pl-3 animate-pulse"
                      style="border-bottom-color: var(--color-input-border);"
                    >
                      {#if tx.pubkey}
                        <a href="/user/{nip19.npubEncode(tx.pubkey)}" class="flex-shrink-0">
                          <CustomAvatar pubkey={tx.pubkey} size={40} />
                        </a>
                      {:else}
                        <div
                          class="w-10 h-10 rounded-full flex items-center justify-center bg-amber-500/20"
                        >
                          <ArrowUpIcon size={20} class="text-amber-500" />
                        </div>
                      {/if}
                      <div class="flex-1 min-w-0">
                        <div class="font-medium truncate text-primary-color">
                          {#if tx.pubkey}
                            <span class="text-amber-500">⚡ to</span>
                            <a href="/user/{nip19.npubEncode(tx.pubkey)}" class="hover:underline">
                              <CustomName pubkey={tx.pubkey} />
                            </a>
                          {:else}
                            {tx.description || 'Sending...'}
                          {/if}
                        </div>
                        {#if tx.comment}
                          <div class="text-sm text-primary-color italic truncate">
                            "{tx.comment}"
                          </div>
                        {/if}
                        <div class="text-sm text-amber-500">Sending payment...</div>
                      </div>
                      <div class="text-right">
                        <div class="font-semibold text-amber-500">
                          {#if $balanceVisible}
                            -{tx.amount.toLocaleString()} sats
                          {:else}
                            -*** sats
                          {/if}
                        </div>
                      </div>
                    </div>
                  {/if}
                {/each}

                <!-- Transactions from SDK (includes pending) -->
                {#each transactions as tx (tx.id)}
                  {#if tx.status === 'pending'}
                    <!-- Pending transaction from SDK -->
                    <div
                      class="py-4 flex items-center gap-4 border-b border-l-2 border-amber-500/50 pl-3 animate-pulse"
                      style="border-bottom-color: var(--color-input-border);"
                    >
                      {#if tx.pubkey}
                        <a href="/user/{nip19.npubEncode(tx.pubkey)}" class="flex-shrink-0">
                          <CustomAvatar pubkey={tx.pubkey} size={40} />
                        </a>
                      {:else}
                        <div
                          class="w-10 h-10 rounded-full flex items-center justify-center bg-amber-500/20"
                        >
                          {#if tx.type === 'incoming'}
                            <ArrowDownIcon size={20} class="text-amber-500" />
                          {:else}
                            <ArrowUpIcon size={20} class="text-amber-500" />
                          {/if}
                        </div>
                      {/if}
                      <div class="flex-1 min-w-0">
                        <div class="font-medium truncate text-primary-color">
                          {#if tx.pubkey}
                            <span class="text-amber-500">
                              {tx.type === 'incoming' ? '⚡ from' : '⚡ to'}
                            </span>
                            <a href="/user/{nip19.npubEncode(tx.pubkey)}" class="hover:underline">
                              <CustomName pubkey={tx.pubkey} />
                            </a>
                          {:else}
                            {tx.description ||
                              (tx.type === 'incoming' ? 'Receiving...' : 'Sending...')}
                          {/if}
                        </div>
                        {#if tx.comment}
                          <div class="text-sm text-primary-color italic truncate">
                            "{tx.comment}"
                          </div>
                        {/if}
                        <div class="text-sm text-amber-500">
                          {tx.type === 'incoming' ? 'Receiving payment...' : 'Sending payment...'}
                        </div>
                      </div>
                      <div class="text-right">
                        <div class="font-semibold text-amber-500">
                          {#if $balanceVisible}
                            {tx.type === 'incoming' ? '+' : '-'}{tx.amount.toLocaleString()} sats
                          {:else}
                            {tx.type === 'incoming' ? '+' : '-'}*** sats
                          {/if}
                        </div>
                      </div>
                    </div>
                  {:else}
                    <!-- Completed transaction -->
                    <div
                      class="py-4 flex items-center gap-4 border-b"
                      style="border-color: var(--color-input-border);"
                    >
                      {#if tx.pubkey}
                        <a href="/user/{nip19.npubEncode(tx.pubkey)}" class="flex-shrink-0">
                          <CustomAvatar pubkey={tx.pubkey} size={40} />
                        </a>
                      {:else}
                        <div
                          class="w-10 h-10 rounded-full flex items-center justify-center {tx.type ===
                          'incoming'
                            ? 'bg-green-500/20'
                            : 'bg-orange-500/20'}"
                        >
                          {#if tx.type === 'incoming'}
                            <ArrowDownIcon size={20} class="text-green-500" />
                          {:else}
                            <ArrowUpIcon size={20} class="text-orange-500" />
                          {/if}
                        </div>
                      {/if}
                      <div class="flex-1 min-w-0">
                        <div class="font-medium truncate text-primary-color">
                          {#if tx.pubkey}
                            <span
                              class={tx.type === 'incoming' ? 'text-green-500' : 'text-orange-500'}
                            >
                              {tx.type === 'incoming' ? '⚡ from' : '⚡ to'}
                            </span>
                            <a href="/user/{nip19.npubEncode(tx.pubkey)}" class="hover:underline">
                              <CustomName pubkey={tx.pubkey} />
                            </a>
                          {:else}
                            {tx.description || (tx.type === 'incoming' ? 'Received' : 'Sent')}
                          {/if}
                        </div>
                        {#if tx.comment}
                          <div class="text-sm text-primary-color italic truncate">
                            "{tx.comment}"
                          </div>
                        {/if}
                        <div class="text-sm text-caption">
                          {formatTransactionDate(tx.timestamp)}
                          {#if tx.fees && $balanceVisible}
                            <span class="ml-2">• Fee: {tx.fees} sats</span>
                          {/if}
                        </div>
                      </div>
                      <div class="text-right">
                        <div
                          class="font-semibold {tx.type === 'incoming'
                            ? 'text-green-500'
                            : 'text-orange-500'}"
                        >
                          {#if $balanceVisible}
                            {tx.type === 'incoming' ? '+' : '-'}{tx.amount.toLocaleString()} sats
                          {:else}
                            {tx.type === 'incoming' ? '+' : '-'}*** sats
                          {/if}
                        </div>
                      </div>
                    </div>
                  {/if}
                {/each}
              </div>

              {#if hasMoreTransactions}
                <div class="mt-4 text-center">
                  <Button
                    on:click={() => loadTransactionHistory(false)}
                    disabled={isLoadingHistory}
                  >
                    {isLoadingHistory ? 'Loading...' : 'Load More'}
                  </Button>
                </div>
              {:else if transactions.length > 0}
                <p class="mt-4 text-center text-xs text-caption">End of transaction history</p>
              {/if}
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  {/if}

  <!-- Wallet picker (inline; combines empty-state and add-wallet flow) -->
  {#if showPicker}
    <div
      class="wallet-scroll picker-view"
      class:picker-view--connect-step={selectedWalletType !== null}
    >
      {#if selectedWalletType !== null}
        <!-- Sub-screen back-bar — returns to picker home (wallet type
             selection) rather than dismissing the picker entirely. -->
        <div class="flex items-center gap-2 mb-6">
          <button
            type="button"
            class="p-2 rounded-full hover:bg-input transition-colors cursor-pointer flex items-center justify-center min-w-[44px] min-h-[44px]"
            on:click={backToPickerHome}
            aria-label="Back to wallet selection"
          >
            <CaretDownIcon size={22} class="rotate-90 text-caption" />
          </button>
          <h2 class="text-xl font-bold" style="color: var(--color-text-primary)">
            {#if selectedWalletType === 4}
              Breez Spark
            {:else if selectedWalletType === 3}
              NWC Wallet
            {:else}
              Add Wallet
            {/if}
          </h2>
        </div>
      {:else if !hasAnyWallet}
        <div class="text-center mb-6">
          <div
            class="welcome-bolt w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center mb-6"
          >
            <LightningIcon size={32} weight="fill" class="text-amber-500" />
          </div>
          <h2 class="text-2xl font-bold mb-4" style="color: var(--color-text-primary)">
            Zap Cooking is better with zaps!
          </h2>
          <div class="text-sm text-caption max-w-md mx-auto leading-relaxed space-y-2 text-left">
            <p>
              Connect a Lightning wallet to send value directly to creators and help
              <span class="font-semibold text-orange-500">#Nostrichefs</span>
              keep publishing great recipes, tips, and stories.
            </p>
            <p>If you don't have a wallet yet, you can create your first one right now.</p>
          </div>
        </div>
      {:else}
        <div class="flex items-center gap-2 mb-6">
          <button
            type="button"
            class="p-2 rounded-full hover:bg-input transition-colors cursor-pointer"
            on:click={dismissPicker}
            aria-label="Back to wallet"
          >
            <CaretDownIcon size={22} class="rotate-90 text-caption" />
          </button>
          <h2 class="text-xl font-bold" style="color: var(--color-text-primary)">Add Wallet</h2>
        </div>
      {/if}

      {#if !selectedWalletType}
        <!-- Wallet type selection -->
        <div class="space-y-4">
          <!-- Embedded wallet options - disabled when external wallet (WebLN) is connected -->
          <div class="flex items-center gap-3 my-6">
            <div class="flex-1 border-t" style="border-color: var(--color-input-border);"></div>
            <span class="text-xs text-caption uppercase tracking-wide">Embedded Wallets</span>
            <div class="flex-1 border-t" style="border-color: var(--color-input-border);"></div>
          </div>

          {#if $weblnConnected}
            <div
              class="p-4 rounded-xl text-center"
              style="border: 1px solid var(--color-input-border);"
            >
              <p class="text-sm text-caption">
                Disconnect your browser wallet to add embedded wallets
              </p>
            </div>
          {:else}
            <button
              class="w-full p-4 rounded-xl text-left flex items-center gap-4 transition-colors"
              class:spark-glow={!hasExistingSparkWallet}
              class:cursor-pointer={!hasExistingSparkWallet}
              class:cursor-not-allowed={hasExistingSparkWallet}
              class:opacity-50={hasExistingSparkWallet}
              style="border: 1px solid var(--color-input-border);"
              on:click={() => !hasExistingSparkWallet && (selectedWalletType = 4)}
              disabled={hasExistingSparkWallet}
            >
              <div
                class="w-10 h-10 flex-shrink-0 rounded-full bg-orange-500/20 flex items-center justify-center"
              >
                <SparkLogo size={24} className="text-orange-500" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="font-medium" style="color: var(--color-text-primary)">
                  Breez Spark (Self-Custodial)
                </div>
                {#if hasExistingSparkWallet}
                  <div class="text-sm text-amber-500">
                    You already have a Spark wallet connected
                  </div>
                {:else}
                  <div class="text-sm text-caption">Built-in wallet – simplest for new users</div>
                {/if}
              </div>
            </button>

            <button
              class="w-full p-4 rounded-xl text-left flex items-center gap-4 transition-colors"
              class:cursor-pointer={!hasExistingNwcWallet}
              class:cursor-not-allowed={hasExistingNwcWallet}
              class:opacity-50={hasExistingNwcWallet}
              style="border: 1px solid var(--color-input-border);"
              on:click={() => !hasExistingNwcWallet && (selectedWalletType = 3)}
              disabled={hasExistingNwcWallet}
            >
              <div
                class="w-10 h-10 flex-shrink-0 rounded-full bg-amber-500/20 flex items-center justify-center"
              >
                <NwcLogo size={28} />
              </div>
              <div class="flex-1 min-w-0">
                <div class="font-medium" style="color: var(--color-text-primary)">
                  NWC (Nostr Wallet Connect)
                </div>
                {#if hasExistingNwcWallet}
                  <div class="text-sm text-amber-500">You already have an NWC wallet connected</div>
                {:else}
                  <div class="text-sm text-caption">Connect any NWC-compatible wallet</div>
                {/if}
              </div>
            </button>
          {/if}

          <!-- External wallet options (WebLN, Bitcoin Connect) - only when no embedded wallets -->
          <div class="flex items-center gap-3 my-6">
            <div class="flex-1 border-t" style="border-color: var(--color-input-border);"></div>
            <span class="text-xs text-caption uppercase tracking-wide"
              >External / Browser Wallets</span
            >
            <div class="flex-1 border-t" style="border-color: var(--color-input-border);"></div>
          </div>

          {#if $wallets.length > 0}
            <div
              class="p-4 rounded-xl text-center"
              style="border: 1px solid var(--color-input-border);"
            >
              <p class="text-sm text-caption">
                Backup and remove all embedded wallets if you want to connect a browser/external
                wallet
              </p>
            </div>
          {:else}
            <!-- Bitcoin Connect option -->
            <button
              class="w-full p-4 rounded-xl text-left flex items-center gap-4 transition-colors"
              class:cursor-pointer={!$bitcoinConnectEnabled && !$weblnConnected}
              class:cursor-not-allowed={$bitcoinConnectEnabled || $weblnConnected}
              class:opacity-50={$bitcoinConnectEnabled || $weblnConnected}
              style="border: 1px solid var(--color-input-border);"
              on:click={handleConnectBitcoinConnect}
              disabled={$bitcoinConnectEnabled || $weblnConnected}
            >
              <div
                class="w-10 h-10 flex-shrink-0 rounded-full bg-orange-500 flex items-center justify-center"
              >
                <BitcoinConnectLogo size={20} className="text-white" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="font-medium" style="color: var(--color-text-primary)">
                  Bitcoin Connect
                </div>
                {#if $bitcoinConnectEnabled}
                  <div class="text-sm text-amber-500">External wallet connected</div>
                {:else if $weblnConnected}
                  <div class="text-sm text-caption">Disconnect WebLN to use Bitcoin Connect</div>
                {:else}
                  <div class="text-sm text-caption">Connect any Bitcoin Connect wallet</div>
                {/if}
              </div>
            </button>

            <!-- WebLN option - only show if browser has WebLN provider -->
            {#if isWeblnAvailable()}
              <button
                class="w-full p-4 rounded-xl text-left flex items-center gap-4 transition-colors"
                class:cursor-pointer={!$weblnConnected}
                class:cursor-not-allowed={$weblnConnected}
                class:opacity-50={$weblnConnected}
                style="border: 1px solid var(--color-input-border);"
                on:click={handleConnectWebln}
                disabled={$weblnConnected}
              >
                <div
                  class="w-10 h-10 flex-shrink-0 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center"
                >
                  <LightningIcon size={24} weight="fill" class="text-white" />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="font-medium" style="color: var(--color-text-primary)">
                    Browser Wallet (WebLN)
                  </div>
                  {#if $weblnConnected}
                    <div class="text-sm text-amber-500">
                      Already connected: {$weblnWalletName}
                    </div>
                  {:else}
                    <div class="text-sm text-caption">Use your Lightning wallet extension</div>
                  {/if}
                </div>
              </button>
            {/if}
          {/if}

          <!-- Picker-home prompt for users curious about non-bitcoin chains. -->
          <div class="mt-4 text-center">
            <button
              type="button"
              class="text-xs text-caption hover:text-orange-500 transition-colors cursor-pointer underline decoration-dotted underline-offset-4 bg-transparent border-0 p-0"
              on:click={() => (showAltcoinReply = !showAltcoinReply)}
            >
              Looking for Ethereum, Solana, XRP, Cardano or other coins?
            </button>
            {#if showAltcoinReply}
              <p
                class="mt-3 text-sm font-medium"
                style="color: var(--color-text-primary)"
              >
                Just kidding, Zap Cooking is bitcoin only!
              </p>
              <!-- svelte-ignore a11y-media-has-caption -->
              <video
                class="mt-3 mx-auto rounded-lg w-full max-w-sm"
                src="https://video.nostr.build/ab7659486ab83bf66fe446251687ede7a3b5779cc16afbadbdb21be60bc596bb.mp4"
                autoplay
                loop
                muted
                playsinline
                controls
              ></video>
            {/if}
          </div>
        </div>
      {:else if selectedWalletType === 3}
        <!-- NWC connection -->
        <div>
          {#if canCheckNwcBackup && nwcBackupChecking}
            <div
              class="mb-4 p-3 rounded-lg border text-sm"
              style="border-color: var(--color-input-border); color: var(--color-text-primary);"
            >
              Checking for Nostr backup...
            </div>
          {:else if canCheckNwcBackup && nwcBackupExists}
            <div
              class="mb-4 p-3 rounded-lg border text-sm"
              style="border-color: var(--color-input-border); color: var(--color-text-primary);"
            >
              Backup found on Nostr. You can restore it below.
            </div>
          {/if}
          <p class="text-caption mb-4">
            NWC lets you connect any Nostr Wallet Connect–compatible wallet to zap.cooking.
          </p>
          <div class="mb-4">
            <input
              type="text"
              class="w-full p-3 rounded-lg input"
              placeholder="nostr+walletconnect://..."
              bind:value={nwcConnectionString}
              on:paste={() => {
                // Clean pasted content immediately
                setTimeout(() => {
                  nwcConnectionString = nwcConnectionString.trim().replace(/[\r\n\t]/g, '');
                }, 0);
              }}
            />
          </div>
          <Button
            on:click={handleConnectNWC}
            disabled={isConnecting || !nwcConnectionString}
            class="w-full"
          >
            {isConnecting ? 'Connecting...' : 'Connect NWC'}
          </Button>

          {#if canCheckNwcBackup}
            <div class="flex items-center gap-3 my-8" aria-hidden="true">
              <div class="flex-1 border-t" style="border-color: var(--color-input-border);"></div>
              <span class="text-xs text-caption uppercase tracking-wide"
                >Restore Existing Wallet</span
              >
              <div class="flex-1 border-t" style="border-color: var(--color-input-border);"></div>
            </div>
            <button
              class="flex items-center justify-center gap-2 w-full px-3 py-3.5 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 hover:bg-white/5"
              class:spark-glow={nwcBackupExists}
              style="border: 1px solid var(--color-input-border); background-color: transparent; color: var(--color-text-primary);"
              on:click={handleRestoreNwcFromNostr}
              disabled={isConnecting}
            >
              <CloudArrowDownIcon size={16} />
              Restore from Nostr Backup
            </button>
            {#if nwcBackupExists === false}
              <p class="mt-4 text-xs text-caption text-center">No backup found on relays.</p>
            {/if}
          {/if}
        </div>
      {:else if selectedWalletType === 4}
        <!-- Spark wallet options -->
        <div>
          {#if canCheckSparkBackup && sparkBackupChecking}
            <div
              class="mb-4 p-3 rounded-lg border text-sm"
              style="border-color: var(--color-input-border); color: var(--color-text-primary);"
            >
              Checking for Nostr backup...
            </div>
          {:else if canCheckSparkBackup && sparkBackupExists}
            <div
              class="mb-4 p-3 rounded-lg border text-sm"
              style="border-color: var(--color-input-border); color: var(--color-text-primary);"
            >
              Backup found on Nostr. You can restore it below.
            </div>
          {/if}
          {#if sparkRestoreMode === 'options'}
            <p class="text-caption mb-4">
              Breez Spark is a self-custodial Lightning wallet built into zap.cooking.
            </p>

            {#if isConnecting && sparkLoadingMessage}
              <!-- Show loading state -->
              <div
                class="p-8 rounded-xl text-center"
                style="border: 1px solid var(--color-input-border);"
              >
                <div
                  class="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full mx-auto mb-4"
                ></div>
                <p class="text-primary-color font-medium">{sparkLoadingMessage}</p>
                <p class="text-caption text-sm mt-2">This may take a moment...</p>
              </div>
            {:else}
              <div class="mb-4">
                <Button on:click={handleSparkCreateRequest} disabled={isConnecting} class="w-full">
                  Create New Wallet
                </Button>
                <div class="flex items-center gap-3 my-8" aria-hidden="true">
                  <div
                    class="flex-1 border-t"
                    style="border-color: var(--color-input-border);"
                  ></div>
                  <span class="text-xs text-caption uppercase tracking-wide"
                    >Restore Existing Wallet</span
                  >
                  <div
                    class="flex-1 border-t"
                    style="border-color: var(--color-input-border);"
                  ></div>
                </div>
                <div class="space-y-4">
                  {#if canCheckSparkBackup}
                    <button
                      class="flex items-center justify-center gap-2 w-full px-3 py-3.5 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 hover:bg-white/5"
                      class:spark-glow={sparkBackupExists}
                      style="border: 1px solid var(--color-input-border); background-color: transparent; color: var(--color-text-primary);"
                      on:click={handleRestoreFromNostr}
                      disabled={isConnecting}
                    >
                      <CloudArrowDownIcon size={16} />
                      Restore from Nostr Backup
                    </button>
                  {/if}
                  <button
                    class="flex items-center justify-center gap-2 w-full px-3 py-3.5 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 hover:bg-white/5"
                    style="border: 1px solid var(--color-input-border); background-color: transparent; color: var(--color-text-primary);"
                    on:click={() => (sparkRestoreMode = 'mnemonic')}
                    disabled={isConnecting}
                  >
                    <KeyIcon size={16} />
                    Restore from Recovery Phrase
                  </button>
                </div>
                {#if canCheckSparkBackup && sparkBackupExists === false}
                  <p class="text-xs text-caption text-center mt-4">No backup found on relays.</p>
                {/if}
              </div>
            {/if}
          {:else if sparkRestoreMode === 'nostr-select'}
            <p class="text-caption mb-4">Choose a backup to restore:</p>
            <div class="space-y-2 mb-4">
              {#each sparkBackupOptions as backup}
                <button
                  class={`w-full p-3 rounded-lg text-left transition-colors hover:bg-accent-gray ${
                    selectedSparkBackupId === backup.id ? 'border-amber-500 bg-amber-500/10' : ''
                  }`}
                  style="border: 1px solid var(--color-input-border);"
                  on:click={() => (selectedSparkBackupId = backup.id)}
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="text-sm font-medium" style="color: var(--color-text-primary)">
                      {formatSparkBackupLabel(backup)}
                    </div>
                  </div>
                  <div class="text-xs text-caption mt-1">
                    {#if backup.walletId}
                      Wallet ID:
                      <span class="font-mono">{backup.walletId}</span>
                    {:else if backup.isLegacy}
                      Legacy Spark wallet
                    {:else}
                      Spark wallet backup
                    {/if}
                  </div>
                </button>
              {/each}
            </div>
            <Button
              on:click={handleRestoreSelectedSparkBackup}
              disabled={isConnecting}
              class="w-full"
            >
              Restore selected backup
            </Button>
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
              <Button
                on:click={() => {
                  sparkRestoreMode = 'options';
                  restoreMnemonicInput = '';
                }}
                disabled={isConnecting}>Back</Button
              >
              <Button on:click={handleRestoreFromMnemonic} disabled={isConnecting}>
                {isConnecting ? 'Restoring...' : 'Restore Wallet'}
              </Button>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Welcome card / soft exit for first-time users who land here
           with no wallet yet. Frames the wallet as optional and gives a
           clear "explore the rest of the app" CTA. Hidden when a
           wallet type has been selected (sub-screens have their own
           back-bar) or when the user is just adding another wallet. -->
      {#if !hasAnyWallet && !selectedWalletType}
        <div
          class="mt-6 p-3 rounded-2xl text-center"
          style="background-color: rgba(245, 158, 11, 0.05); border: 1px solid rgba(245, 158, 11, 0.2);"
        >
          <p class="text-sm text-caption mb-2 leading-snug">
            Not ready for a wallet? You can explore Zap Cooking and come back anytime.
          </p>
          <button
            type="button"
            class="explore-prompt-cta inline-flex items-center gap-1 px-5 py-2 rounded-full text-sm font-semibold cursor-pointer transition-colors"
            style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border); color: var(--color-text-primary);"
            on:click={dismissPicker}
          >
            Explore Zap Cooking →
          </button>
        </div>
      {/if}
      <!-- Real DOM spacer so the picker can scroll flush to the bottom.
           A scoped CSS ::after on .wallet-scroll.picker-view got pruned
           by Svelte's CSS scoping; a real element is reliably included
           in scrollHeight. -->
      <div aria-hidden="true" style="height: 3rem; flex-shrink: 0;"></div>
    </div>
  {/if}

  <!-- Mnemonic Display Modal removed - replaced by backup reminder banner -->

  <!-- Reveal Mnemonic Modal - higher z-index to appear above other modals -->
  {#if revealedMnemonic && portalTarget}
    <div use:portal={portalTarget}>
      <div
        class="fixed inset-0 bg-black/50 flex z-[60] p-4"
        style="display: flex; align-items: center; justify-content: center;"
      >
        <div
          class="rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto"
          style="background-color: var(--color-bg-primary);"
        >
          <h2 class="text-xl font-bold mb-4" style="color: var(--color-text-primary)">
            Recovery Phrase
          </h2>
          <div
            class="mb-4 p-4 rounded-lg"
            style="background-color: rgba(239, 68, 68, 0.1); color: #ef4444;"
          >
            <WarningIcon size={20} class="inline mr-2" />
            Never share this phrase with anyone. Anyone with these words can access your funds.
          </div>
          <div
            class="relative p-4 rounded-lg mb-4 font-mono text-sm"
            style="background-color: var(--color-input-bg); color: var(--color-text-primary);"
          >
            {#if mnemonicVisible}
              <span class="select-all">{revealedMnemonic}</span>
            {:else}
              <span class="blur-sm select-none" aria-hidden="true">{revealedMnemonic}</span>
            {/if}
            <button
              class="absolute top-3 right-3 p-1 rounded-lg opacity-70 hover:opacity-100 transition-opacity"
              style="color: var(--color-text-primary);"
              on:click={() => (mnemonicVisible = !mnemonicVisible)}
              title={mnemonicVisible ? 'Hide recovery phrase' : 'Reveal recovery phrase'}
            >
              {#if mnemonicVisible}
                <EyeSlashIcon size={20} />
              {:else}
                <EyeIcon size={20} />
              {/if}
            </button>
          </div>
          <Button on:click={closeRevealMnemonicModal} class="w-full">Close</Button>
        </div>
      </div>
    </div>
  {/if}

  <!-- NWC Wallet Info — inline view -->
  {#if dashboardView === 'wallet-info' && nwcWalletInfo}
    <div class="wallet-scroll wallet-info-view">
      <div class="flex items-center gap-2 mb-6">
        <button
          type="button"
          class="p-2 rounded-full hover:bg-input transition-colors cursor-pointer"
          on:click={closeOverlayView}
          aria-label="Back to wallet"
        >
          <CaretDownIcon size={22} class="rotate-90 text-caption" />
        </button>
        <h2 class="text-xl font-bold" style="color: var(--color-text-primary)">Wallet Info</h2>
      </div>

      <div class="space-y-4">
        {#if nwcWalletInfo.alias}
          <div>
            <div class="text-xs text-caption uppercase tracking-wide mb-1">Wallet Name</div>
            <div class="font-medium" style="color: var(--color-text-primary)">
              {nwcWalletInfo.alias}
            </div>
          </div>
        {/if}

        <div>
          <div class="text-xs text-caption uppercase tracking-wide mb-1">Relay</div>
          <div class="text-sm font-mono break-all" style="color: var(--color-text-primary)">
            {nwcWalletInfo.relay}
          </div>
        </div>

        <div>
          <div class="text-xs text-caption uppercase tracking-wide mb-1">Wallet Pubkey</div>
          <div class="text-sm font-mono break-all" style="color: var(--color-text-primary)">
            {nwcWalletInfo.pubkey}
          </div>
        </div>

        <div>
          <div class="text-xs text-caption uppercase tracking-wide mb-1">Supported Methods</div>
          <div class="flex flex-wrap gap-1 mt-1">
            {#each nwcWalletInfo.methods as method}
              <span
                class="text-xs px-2 py-1 rounded-full"
                style="background-color: var(--color-input-bg); color: var(--color-text-primary);"
              >
                {method}
              </span>
            {/each}
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Spark Wallet Info — inline view -->
  {#if dashboardView === 'wallet-info' && sparkWalletInfo}
    <div class="wallet-scroll wallet-info-view">
      <div class="flex items-center gap-2 mb-6">
        <button
          type="button"
          class="p-2 rounded-full hover:bg-input transition-colors cursor-pointer"
          on:click={closeOverlayView}
          aria-label="Back to wallet"
        >
          <CaretDownIcon size={22} class="rotate-90 text-caption" />
        </button>
        <h2 class="text-xl font-bold" style="color: var(--color-text-primary)">
          Spark Wallet Info
        </h2>
      </div>

      <div class="space-y-4">
        <div>
          <div class="text-xs text-caption uppercase tracking-wide mb-1">Wallet ID</div>
          <div class="text-sm font-mono break-all" style="color: var(--color-text-primary)">
            {sparkWalletInfo.walletId}
          </div>
        </div>

        {#if sparkWalletInfo.sparkAddress}
          <div>
            <div class="text-xs text-caption uppercase tracking-wide mb-1">Spark Address</div>
            <div class="text-sm font-mono break-all" style="color: var(--color-text-primary)">
              {sparkWalletInfo.sparkAddress}
            </div>
          </div>
        {/if}

        <div>
          <div class="text-xs text-caption uppercase tracking-wide mb-1">Network</div>
          <div class="font-medium capitalize" style="color: var(--color-text-primary)">
            {sparkWalletInfo.network}
          </div>
        </div>

        {#if sparkWalletInfo.createdBy}
          <div>
            <div class="text-xs text-caption uppercase tracking-wide mb-1">Created By</div>
            <div class="font-medium" style="color: var(--color-text-primary)">
              {sparkWalletInfo.createdBy}
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Spark create confirmation modal -->
  {#if showSparkCreateConfirmModal && portalTarget}
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
            Create new wallet?
          </h2>
          <p class="text-caption mb-4">
            A wallet backup already exists on Nostr. Creating a new wallet won't delete it—each
            wallet is backed up separately and can be restored individually.
          </p>
          <div class="flex flex-col gap-3">
            <Button
              on:click={() => (showSparkCreateConfirmModal = false)}
              disabled={isConnecting}
              class="w-full"
            >
              Cancel
            </Button>
            <button
              class="w-full px-4 py-2 rounded-full bg-amber-500 hover:bg-amber-600 text-white font-medium transition-colors cursor-pointer disabled:opacity-50"
              on:click={() => {
                showSparkCreateConfirmModal = false;
                handleCreateSparkWallet();
              }}
              disabled={isConnecting}
            >
              Create New Wallet
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Remove Wallet — inline view -->
  {#if dashboardView === 'remove-wallet' && walletToDelete}
    <div class="wallet-scroll remove-wallet-view">
      <div class="flex items-center gap-2 mb-6">
        <button
          type="button"
          class="p-2 rounded-full hover:bg-input transition-colors cursor-pointer"
          on:click={closeOverlayView}
          disabled={isDeletingWallet}
          aria-label="Back to wallet"
        >
          <CaretDownIcon size={22} class="rotate-90 text-caption" />
        </button>
        <h2 class="text-xl font-bold" style="color: var(--color-text-primary)">Remove Wallet</h2>
      </div>

      <p class="text-caption mb-4">
        Are you sure you want to remove
        <strong class="text-primary-color">{walletToDelete.name}</strong>?
      </p>

      {#if walletToDelete.kind === 4 || walletToDelete.kind === 3}
        <!-- Backup warning -->
        <div
          class="flex items-center gap-2 mb-3 pb-3 border-b"
          style="border-color: var(--color-input-border);"
        >
          <WarningIcon size={18} class="text-amber-500 flex-shrink-0" />
          <span class="text-sm text-amber-500">Back up your wallet before removing</span>
        </div>

        <div
          class="grid gap-2 mb-4"
          class:grid-cols-2={encryptionSupported && !isNip46User}
          class:grid-cols-1={!(encryptionSupported && !isNip46User)}
        >
          {#if walletToDelete.kind === 4}
            <button
              class="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer hover:bg-white/5"
              style="border: 1px solid var(--color-input-border); color: var(--color-text-primary);"
              on:click={handleRevealMnemonic}
            >
              <KeyIcon size={16} class="text-amber-500" />
              Recovery Phrase
            </button>
          {:else}
            <button
              class="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer hover:bg-white/5"
              style="border: 1px solid var(--color-input-border); color: var(--color-text-primary);"
              on:click={() => walletToDelete && handleDownloadNwcBackup(walletToDelete)}
              disabled={isBackingUp}
            >
              <DownloadSimpleIcon size={16} class="text-amber-500" />
              Download
            </button>
          {/if}
          {#if encryptionSupported && !isNip46User}
            <button
              class="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer hover:bg-white/5"
              style="border: 1px solid var(--color-input-border); color: var(--color-text-primary);"
              on:click={() =>
                walletToDelete?.kind === 4
                  ? handleBackupToNostr()
                  : walletToDelete
                    ? handleNwcBackupToNostr(walletToDelete)
                    : undefined}
              disabled={isBackingUp}
            >
              <CloudArrowUpIcon size={16} class="text-amber-500" />
              {isBackingUp ? 'Saving...' : 'Backup to Nostr'}
            </button>
          {/if}
        </div>

        <!-- Delete relay backup toggle -->
        <label
          class="flex items-center gap-2 mb-6 cursor-pointer text-sm"
          style="color: var(--color-text-secondary);"
        >
          <input type="checkbox" bind:checked={deleteRelayBackups} class="accent-red-500" />
          Also delete relay backup
        </label>
      {:else}
        <p class="text-caption text-sm mb-6">You can reconnect it later.</p>
      {/if}

      <div class="flex gap-3">
        <button
          class="flex-1 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors cursor-pointer hover:bg-white/5"
          style="border: 1px solid var(--color-input-border); color: var(--color-text-primary);"
          on:click={closeOverlayView}
          disabled={isDeletingWallet}
        >
          Cancel
        </button>
        <button
          class="flex-1 px-4 py-2.5 rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium text-sm transition-colors cursor-pointer disabled:opacity-50"
          disabled={isDeletingWallet}
          on:click={async () => {
            if (walletToDelete) {
              isDeletingWallet = true;
              try {
                // Delete relay backups if checkbox is checked
                if (deleteRelayBackups && $userPublickey) {
                  try {
                    if (walletToDelete.kind === 4) {
                      // Legacy backups (d-tag 'spark-wallet-backup' with no
                      // walletId suffix) predate the per-wallet d-tag scheme
                      // and can't be targeted by our delete flow. Surface a
                      // toast instead of silently no-op'ing.
                      const backups = await listSparkBackups($userPublickey);
                      if (backups.some((b) => b.isLegacy)) {
                        errorMessage = "Legacy wallet backups can't be deleted by Zap Cooking.";
                      } else {
                        const sparkWalletId =
                          walletToDelete.data !== 'spark' ? walletToDelete.data : undefined;
                        await deleteSparkBackupFromNostr($userPublickey, sparkWalletId);
                      }
                    } else if (walletToDelete.kind === 3) {
                      await deleteNwcBackupFromNostr($userPublickey);
                    }
                  } catch (e) {
                    console.error('Failed to delete relay backups:', e);
                    // Continue with wallet removal even if backup deletion fails
                  }
                }
                await handleDisconnectWallet(walletToDelete.id);
                walletToDelete = null;
                deleteRelayBackups = false;
              } finally {
                isDeletingWallet = false;
              }
            }
          }}
        >
          {isDeletingWallet ? 'Removing...' : 'Remove'}
        </button>
      </div>
    </div>
  {/if}

  <!-- Sync Lightning Address to Profile Confirmation Modal (Spark) -->
  {#if showSyncConfirmModal && portalTarget}
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
            Sync to Profile
          </h2>
          <p class="text-caption mb-4">
            This will update your Nostr profile (kind 0) to include your lightning address:
          </p>
          <div
            class="p-3 rounded-lg mb-4 font-mono text-sm"
            style="background-color: var(--color-input-bg); color: var(--color-text-primary);"
          >
            {$sparkLightningAddressStore}
          </div>
          <p class="text-caption text-sm mb-6">
            Your profile's <strong>lud16</strong> field will be updated. All other profile fields (name,
            bio, picture, etc.) will be preserved.
          </p>
          <div class="flex gap-3">
            <Button
              on:click={() => (showSyncConfirmModal = false)}
              disabled={isSyncingProfile}
              class="flex-1"
            >
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
    </div>
  {/if}

  <!-- Sync NWC Lightning Address to Profile Confirmation Modal -->
  {#if showNwcSyncConfirmModal && portalTarget}
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
            Sync to Profile
          </h2>
          <p class="text-caption mb-4">
            This will update your Nostr profile (kind 0) to include the lightning address from your
            NWC wallet:
          </p>
          <div
            class="p-3 rounded-lg mb-4 font-mono text-sm"
            style="background-color: var(--color-input-bg); color: var(--color-text-primary);"
          >
            {nwcLud16}
          </div>
          <p class="text-caption text-sm mb-6">
            Your profile's <strong>lud16</strong> field will be updated. All other profile fields (name,
            bio, picture, etc.) will be preserved.
          </p>
          <div class="flex gap-3">
            <Button
              on:click={() => (showNwcSyncConfirmModal = false)}
              disabled={isSyncingProfile}
              class="flex-1"
            >
              Cancel
            </Button>
            <button
              class="flex-1 px-4 py-2 rounded-full bg-amber-500 hover:bg-amber-600 text-white font-medium transition-colors cursor-pointer disabled:opacity-50"
              on:click={handleNwcSyncToProfile}
              disabled={isSyncingProfile}
            >
              {isSyncingProfile ? 'Syncing...' : 'Sync'}
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Remove Bitcoin Connect Confirmation Modal -->
  <!-- Remove External Wallet confirmation modal removed — Bitcoin
       Connect disconnect now fires directly from the connection card
       (matches the WebLN disconnect flow). -->

  <!-- Delete Lightning Address Confirmation Modal -->
  {#if showDeleteAddressConfirmModal && portalTarget}
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
            Delete Lightning Address
          </h2>
          <p class="text-caption mb-4">Are you sure you want to delete your lightning address?</p>
          <div
            class="p-3 rounded-lg mb-4 font-mono text-sm"
            style="background-color: var(--color-input-bg); color: var(--color-text-primary);"
          >
            {$sparkLightningAddressStore}
          </div>
          <p class="text-caption text-sm mb-6">
            This will remove the address from your Breez Spark wallet. Payments sent to this address
            will no longer reach you. Your Nostr profile will not be changed.
          </p>
          <div class="flex gap-3">
            <Button
              on:click={() => (showDeleteAddressConfirmModal = false)}
              disabled={isDeletingAddress}
              class="flex-1"
            >
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
    </div>
  {/if}

  <!-- Send Modal -->
  {#if dashboardView === 'send'}
    <div class="wallet-scroll send-view">
      <div class="flex items-center gap-2 mb-6">
        <button
          type="button"
          class="p-2 rounded-full hover:bg-input transition-colors cursor-pointer"
          on:click={closeSendReceive}
          aria-label="Back to wallet"
        >
          <CaretDownIcon size={22} class="rotate-90 text-caption" />
        </button>
        <h2
          class="text-xl font-bold flex items-center gap-2"
          style="color: var(--color-text-primary)"
        >
          <ArrowUpIcon size={22} weight="bold" class="text-amber-500" />
          Send Payment
        </h2>
      </div>

      {#if sendSuccess}
        <div
          class="mb-4 p-4 rounded-lg flex items-center gap-2"
          style="background-color: rgba(34, 197, 94, 0.1); color: #22c55e;"
        >
          <CheckCircleIcon size={20} />
          <span>{sendSuccess}</span>
        </div>
      {/if}

      {#if sendError}
        <div
          class="mb-4 p-4 rounded-lg flex items-center gap-2"
          style="background-color: rgba(239, 68, 68, 0.1); color: #ef4444;"
        >
          <WarningIcon size={20} />
          <span>{sendError}</span>
        </div>
      {/if}

      <div class="space-y-4">
        {#if !showOnchainConfirmation}
          <div>
            <label class="block text-sm font-medium mb-2 text-caption">
              {#if $activeWallet?.kind === 4}
                Invoice, Lightning Address, Bitcoin Address, or CLINK Offer
              {:else}
                Invoice, Lightning Address, or CLINK Offer
              {/if}
            </label>
            <textarea
              bind:value={sendInput}
              placeholder={$activeWallet?.kind === 4
                ? 'lnbc..., user@example.com, bc1..., or noffer1...'
                : 'lnbc..., user@example.com, or noffer1...'}
              class="w-full p-3 rounded-lg bg-input border border-input text-primary-color placeholder-caption resize-none focus:outline-none focus:ring-2 focus:ring-amber-500"
              rows="3"
              disabled={isSending || isSendingOnchain}
              on:input={() => {
                // Reset on-chain state when input changes
                sendingMaxBalance = false;
                brantaVerifyTriggered = false;
                rawQrText = '';
                if (onchainFeeQuote) {
                  onchainFeeQuote = null;
                  onchainPrepareResponse = null;
                }
              }}
            />
            <button
              type="button"
              class="mt-2 w-full min-h-[44px] px-3 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              style="background: var(--color-input-bg); color: var(--color-text-secondary); border: 1px solid var(--color-input-border);"
              on:click={startQrCamera}
              disabled={isSending || isSendingOnchain || showQrCamera}
              title="Scan QR code"
              aria-label="Scan QR code"
            >
              <QrCodeIcon size={18} />
              Scan QR code
            </button>
            {#if isBtcAddress && $activeWallet?.kind === 4}
              <div class="mt-1 text-xs text-amber-500 flex items-center gap-1">
                ₿ Bitcoin address detected - on-chain payment
              </div>
            {:else if isNoffer}
              <div class="mt-1 text-xs text-amber-500 flex items-center gap-1">
                <LightningIcon size={12} weight="fill" />
                {#if nofferData}
                  CLINK offer detected{nofferData.pricingType === 'fixed' &&
                  nofferData.price != null
                    ? ` · ${nofferData.price.toLocaleString()} sats`
                    : ''}
                {:else}
                  CLINK offer detected
                {/if}
              </div>
            {/if}
            <div class="mt-1">
              {#if sendInput.trim() && !isNoffer}
                {#if brantaVerifyTriggered}
                  <BrantaBadge paymentString={sendInput.trim()} {rawQrText} />
                {:else}
                  <button
                    type="button"
                    class="flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border border-input text-caption hover:text-primary-color transition-colors"
                    on:click={() => (brantaVerifyTriggered = true)}
                  >
                    <ShieldCheckIcon size={14} />
                    Verify with Branta
                  </button>
                {/if}
              {/if}
            </div>
            {#if qrScanError}
              <div class="mt-1 text-xs text-red-400 flex items-center gap-1">
                <WarningIcon size={12} />
                {qrScanError}
              </div>
            {/if}
          </div>

          {#if isLightningAddress || isBtcAddress || (isNoffer && nofferNeedsAmount)}
            <div>
              <div class="flex items-center justify-between mb-2">
                <label class="block text-sm font-medium text-caption">Amount (sats)</label>
                {#if isBtcAddress && $activeWallet?.kind === 4 && $walletBalance !== null && $walletBalance > 0}
                  <button
                    type="button"
                    class="text-xs text-amber-500 hover:text-amber-400 font-medium"
                    on:click={() => {
                      sendAmount = Number($walletBalance);
                      sendingMaxBalance = true;
                      // Reset fee quote when amount changes
                      if (onchainFeeQuote) {
                        onchainFeeQuote = null;
                        onchainPrepareResponse = null;
                      }
                    }}
                  >
                    Use All ({formatBalance(Number($walletBalance))} sats)
                  </button>
                {/if}
              </div>
              <input
                type="number"
                bind:value={sendAmount}
                placeholder="Enter amount in sats"
                class="w-full p-3 rounded-lg bg-input border border-input text-primary-color placeholder-caption focus:outline-none focus:ring-2 focus:ring-amber-500"
                disabled={isSending || isSendingOnchain}
                min="1"
                on:input={() => {
                  // Reset fee quote when amount changes
                  sendingMaxBalance = false;
                  if (onchainFeeQuote) {
                    onchainFeeQuote = null;
                    onchainPrepareResponse = null;
                  }
                }}
              />
            </div>
          {/if}

          {#if isLightningAddress && !isBtcAddress}
            <div>
              <label class="block text-sm font-medium mb-2 text-caption">Message (optional)</label>
              <input
                type="text"
                bind:value={sendComment}
                placeholder="Add a note to your payment"
                class="w-full p-3 rounded-lg bg-input border border-input text-primary-color placeholder-caption focus:outline-none focus:ring-2 focus:ring-amber-500"
                disabled={isSending}
                maxlength="144"
              />
            </div>
          {/if}
        {/if}

        <!-- On-chain fee selection -->
        {#if isBtcAddress && $activeWallet?.kind === 4}
          {#if !onchainFeeQuote}
            <button
              class="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors flex items-center justify-center gap-2"
              on:click={handlePrepareOnchainSend}
              disabled={isPreparingOnchain || !sendInput.trim() || sendAmount <= 0}
            >
              {#if isPreparingOnchain}
                <span class="animate-spin"><ArrowClockwiseIcon size={20} weight="bold" /></span>
                Getting fees...
              {:else}
                Get Fee Quote
              {/if}
            </button>
          {:else if !showOnchainConfirmation}
            <!-- Fee Display (Spark cooperative exits have fixed fees) -->
            <div class="p-3 rounded-lg bg-input">
              {#if sendingMaxBalance}
                <div class="mb-2 text-xs text-amber-500">
                  Using full balance. Network fee is deducted from the amount.
                </div>
                <div class="flex justify-between items-center">
                  <span class="text-caption">Recipient gets</span>
                  <span class="text-primary-color"
                    >{formatBalance(sendAmount - onchainFeeQuote.fast.feeSats)} sats</span
                  >
                </div>
                <div class="flex justify-between items-center mt-1">
                  <span class="text-caption">Network Fee</span>
                  <span class="text-primary-color"
                    >{formatBalance(onchainFeeQuote.fast.feeSats)} sats</span
                  >
                </div>
                <div
                  class="flex justify-between items-center mt-2 pt-2 border-t"
                  style="border-color: var(--color-input-border);"
                >
                  <span class="font-medium text-primary-color">Total</span>
                  <span class="font-medium text-amber-500">{formatBalance(sendAmount)} sats</span>
                </div>
              {:else}
                <div class="flex justify-between items-center">
                  <span class="text-caption">Amount</span>
                  <span class="text-primary-color">{formatBalance(sendAmount)} sats</span>
                </div>
                <div class="flex justify-between items-center mt-1">
                  <span class="text-caption">Network Fee</span>
                  <span class="text-primary-color"
                    >{formatBalance(onchainFeeQuote.fast.feeSats)} sats</span
                  >
                </div>
                <div
                  class="flex justify-between items-center mt-2 pt-2 border-t"
                  style="border-color: var(--color-input-border);"
                >
                  <span class="font-medium text-primary-color">Total</span>
                  <span class="font-medium text-amber-500"
                    >{formatBalance(sendAmount + onchainFeeQuote.fast.feeSats)} sats</span
                  >
                </div>
              {/if}
            </div>

            <button
              class="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors flex items-center justify-center gap-2"
              on:click={() => (showOnchainConfirmation = true)}
            >
              <ArrowUpIcon size={20} weight="bold" />
              Continue
            </button>
          {:else}
            <!-- Address Verification Step -->
            <div class="space-y-4">
              <!-- Amount display (read-only) -->
              <div class="text-center">
                {#if sendingMaxBalance}
                  <div class="text-3xl font-bold text-amber-500">
                    {formatBalance(sendAmount - onchainFeeQuote.fast.feeSats)} sats
                  </div>
                  <div class="text-xs text-caption mt-1">
                    Recipient gets (from {formatBalance(sendAmount)} total)
                  </div>
                  <div class="text-sm text-caption mt-1">
                    {formatBalance(onchainFeeQuote.fast.feeSats)} sats fee deducted
                  </div>
                {:else}
                  <div class="text-3xl font-bold text-amber-500">
                    {formatBalance(sendAmount)} sats
                  </div>
                  <div class="text-sm text-caption mt-1">
                    + {formatBalance(onchainFeeQuote.fast.feeSats)} sats fee
                  </div>
                {/if}
              </div>

              <!-- Segmented address display -->
              <div class="p-4 rounded-lg bg-input">
                <p class="text-xs text-caption mb-2 text-center">Sending to:</p>
                <div
                  class="font-mono text-sm text-primary-color flex flex-wrap justify-center gap-x-2 gap-y-1"
                >
                  {#each formatAddressSegments(sendInput.trim()) as segment, i}
                    <span class={i % 2 === 0 ? 'text-primary-color' : 'text-amber-500'}
                      >{segment}</span
                    >
                  {/each}
                </div>
              </div>

              <!-- Warning text -->
              <div class="text-center">
                <p class="text-sm text-amber-500 font-medium">
                  Bitcoin transactions cannot be reversed. Please verify the address is correct.
                </p>
              </div>

              <div class="flex gap-3">
                <button
                  class="flex-1 py-3 px-4 rounded-xl border border-input text-caption hover:text-primary-color transition-colors"
                  on:click={() => (showOnchainConfirmation = false)}
                  disabled={isSendingOnchain}
                >
                  Back
                </button>
                <button
                  class="flex-1 py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors flex items-center justify-center gap-2"
                  on:click={handleSendOnchain}
                  disabled={isSendingOnchain}
                >
                  {#if isSendingOnchain}
                    <span class="animate-spin"><ArrowClockwiseIcon size={20} weight="bold" /></span>
                    Sending...
                  {:else}
                    Confirm Send
                  {/if}
                </button>
              </div>
            </div>
          {/if}
        {:else}
          <!-- Lightning payment button -->
          <button
            class="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors flex items-center justify-center gap-2"
            on:click={handleSend}
            disabled={isSending ||
              !sendInput.trim() ||
              (isLightningAddress && sendAmount <= 0) ||
              (isNoffer && !nofferData) ||
              (isNoffer && nofferNeedsAmount && sendAmount <= 0)}
          >
            {#if isSending}
              <span class="animate-spin"><ArrowClockwiseIcon size={20} weight="bold" /></span>
              {isNoffer ? 'Paying offer...' : 'Sending...'}
            {:else}
              <ArrowUpIcon size={20} weight="bold" />
              {isNoffer ? 'Pay Offer' : 'Send Payment'}
            {/if}
          </button>
        {/if}
      </div>
    </div>
  {/if}

  <!-- QR camera overlay — portal'd full-screen scanner used by the
       inline send view. Lives outside the send view's flex slot so
       `position: fixed` is relative to the viewport, not the dialog. -->
  {#if showQrCamera && portalTarget}
    <div use:portal={portalTarget}>
      <div class="fixed inset-0 bg-black z-[60] flex flex-col">
        <div class="flex items-center justify-between p-4">
          <span class="text-white text-sm font-medium">Point camera at QR code</span>
          <button
            type="button"
            class="text-white p-1"
            on:click={stopQrCamera}
            aria-label="Close QR scanner"
          >
            <XIcon size={24} />
          </button>
        </div>
        <div class="flex-1 flex items-center justify-center overflow-hidden">
          <!-- svelte-ignore a11y-media-has-caption -->
          <video bind:this={qrVideoElement} class="w-full h-full object-cover" playsinline />
        </div>
        <div class="p-4 text-center text-white/50 text-sm">Scanning for QR code...</div>
      </div>
    </div>
  {/if}

  <!-- Receive Modal -->
  {#if dashboardView === 'receive'}
    <div class="wallet-scroll receive-view">
      <div class="flex items-center gap-2 mb-6">
        {#if !invoicePaid}
          <button
            type="button"
            class="p-2 rounded-full hover:bg-input transition-colors cursor-pointer"
            on:click={closeSendReceive}
            aria-label="Back to wallet"
          >
            <CaretDownIcon size={22} class="rotate-90 text-caption" />
          </button>
        {/if}
        <h2
          class="text-xl font-bold flex items-center gap-2"
          style="color: var(--color-text-primary)"
        >
          <ArrowDownIcon size={22} weight="bold" class="text-amber-500" />
          Receive Payment
        </h2>
      </div>

      {#if receiveError}
        <div
          class="mb-4 p-4 rounded-lg flex items-center gap-2"
          style="background-color: rgba(239, 68, 68, 0.1); color: #ef4444;"
        >
          <WarningIcon size={20} />
          <span>{receiveError}</span>
        </div>
      {/if}

      <!-- Lightning / On-Chain Toggle (only for Spark wallets) -->
      {#if $activeWallet?.kind === 4 && !generatedInvoice && !onchainAddress}
        <div class="flex rounded-lg p-1 mb-4" style="background-color: var(--color-input-bg);">
          <button
            class="flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors"
            class:bg-amber-500={receiveMode === 'lightning'}
            class:text-white={receiveMode === 'lightning'}
            class:text-caption={receiveMode !== 'lightning'}
            on:click={() => (receiveMode = 'lightning')}
          >
            ⚡ Lightning
          </button>
          <button
            class="flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-1"
            class:bg-amber-500={receiveMode === 'onchain'}
            class:text-white={receiveMode === 'onchain'}
            class:text-caption={receiveMode !== 'onchain'}
            on:click={() => {
              receiveMode = 'onchain';
              fetchMempoolFees();
            }}
          >
            <BitcoinIcon size={16} /> On-Chain
          </button>
        </div>
      {/if}

      {#if receiveMode === 'onchain' && $activeWallet?.kind === 4}
        <!-- On-Chain Receive -->
        {#if !onchainAddress}
          <div class="space-y-4 text-center">
            <p class="text-caption text-sm">
              Generate a Bitcoin address to receive on-chain payments. Funds will need to be claimed
              after confirmation.
            </p>

            <!-- Current Network Fees -->
            <div
              class="p-3 rounded-lg text-left"
              style="border: 1px solid var(--color-input-border);"
            >
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs font-medium text-caption">Current Network Fees</span>
                <a
                  href="https://mempool.space"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-xs text-amber-500 hover:underline"
                >
                  mempool.space
                </a>
              </div>
              {#if isLoadingMempoolFees}
                <div class="text-xs text-caption">Loading...</div>
              {:else if mempoolFees}
                <div class="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div class="text-xs text-caption">Fast</div>
                    <div class="text-sm font-medium text-primary-color">
                      {mempoolFees.fastestFee} sat/vB
                    </div>
                    <div class="text-xs text-caption">~10 min</div>
                  </div>
                  <div>
                    <div class="text-xs text-caption">Medium</div>
                    <div class="text-sm font-medium text-primary-color">
                      {mempoolFees.halfHourFee} sat/vB
                    </div>
                    <div class="text-xs text-caption">~30 min</div>
                  </div>
                  <div>
                    <div class="text-xs text-caption">Slow</div>
                    <div class="text-sm font-medium text-primary-color">
                      {mempoolFees.hourFee} sat/vB
                    </div>
                    <div class="text-xs text-caption">~1 hour</div>
                  </div>
                </div>
              {:else}
                <div class="text-xs text-caption">
                  Check <a
                    href="https://mempool.space"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-amber-500 hover:underline">mempool.space</a
                  > for current fees
                </div>
              {/if}
            </div>

            <p class="text-caption text-xs">
              On-chain transactions typically take up to 60 minutes for final settlement. The
              sender's fee rate affects confirmation time.
            </p>

            <Button
              on:click={handleGenerateOnchainAddress}
              disabled={isGeneratingOnchainAddress}
              class="w-full"
            >
              {#if isGeneratingOnchainAddress}
                <span class="animate-spin mr-2"><ArrowClockwiseIcon size={16} weight="bold" /></span
                >
                Generating...
              {:else}
                Generate Bitcoin Address
              {/if}
            </Button>
          </div>
        {:else}
          <!-- Show Bitcoin Address with QR -->
          <div class="space-y-4 text-center">
            <div class="text-sm text-caption mb-2">Send only Bitcoin to this address:</div>

            <!-- QR Code -->
            <div class="qr-wrapper mx-auto p-4 rounded-xl bg-white max-w-xs w-full">
              <svg
                class="w-full"
                use:qr={{
                  data: `bitcoin:${onchainAddress}`,
                  shape: 'circle'
                }}
              />
            </div>

            <!-- Branta Verification Badge -->
            <div class="flex justify-center">
              <BrantaBadge
                paymentString={onchainAddress}
                secret={onchainAddressBrantaSecret}
                encryptedDestination={onchainAddressBrantaEncryptedDestination}
              />
            </div>

            <!-- Address (segmented for easier verification) -->
            <div class="p-4 rounded-lg bg-input">
              <p class="text-xs text-caption mb-2 text-center">Bitcoin Address</p>
              <div
                class="font-mono text-sm text-primary-color flex flex-wrap justify-center gap-x-2 gap-y-1"
              >
                {#each formatAddressSegments(onchainAddress) as segment, i}
                  <span class={i % 2 === 0 ? 'text-primary-color' : 'text-amber-500'}
                    >{segment}</span
                  >
                {/each}
              </div>
            </div>

            <!-- Copy Button -->
            <button
              class="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-medium transition-colors flex items-center justify-center gap-2"
              on:click={async () => {
                if (onchainAddress) {
                  await navigator.clipboard.writeText(onchainAddress);
                  successMessage = 'Address copied!';
                }
              }}
            >
              <CopyIcon size={18} />
              Copy Address
            </button>

            <!-- Pending Deposits -->
            {#if unclaimedDeposits.length > 0}
              <div class="mt-4 pt-4 border-t" style="border-color: var(--color-input-border);">
                <div class="text-sm font-medium text-primary-color mb-2">Pending Deposits</div>
                <div class="space-y-2">
                  {#each unclaimedDeposits as deposit}
                    <div class="p-3 rounded-lg bg-input">
                      <div class="flex items-center justify-between">
                        <div>
                          <div class="text-sm font-medium text-primary-color">
                            {formatBalance(deposit.amountSats)} sats
                          </div>
                          <div class="text-xs text-caption font-mono truncate max-w-[150px]">
                            {deposit.txid.slice(0, 8)}...{deposit.txid.slice(-8)}
                          </div>
                        </div>
                        <div class="flex gap-2">
                          <button
                            class="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
                            on:click={() => handleClaimDeposit(deposit.txid, deposit.vout)}
                            disabled={isClaimingDeposit}
                          >
                            {#if isClaimingDeposit && claimingTxid === deposit.txid}
                              Claiming...
                            {:else}
                              Claim
                            {/if}
                          </button>
                          <button
                            class="px-3 py-1 rounded-lg border border-input hover:bg-input text-caption text-sm font-medium transition-colors disabled:opacity-50"
                            on:click={() => openRefundModal(deposit)}
                            disabled={isClaimingDeposit || isRefunding}
                            title="Refund to external Bitcoin address"
                          >
                            Refund
                          </button>
                        </div>
                      </div>
                      {#if deposit.claimError && deposit.claimError.type !== 'maxDepositClaimFeeExceeded'}
                        <div class="mt-2 text-xs text-red-500 flex items-start gap-1">
                          <WarningIcon size={14} class="flex-shrink-0 mt-0.5" />
                          <span>
                            {#if deposit.claimError.type === 'missingUtxo'}
                              Transaction not yet confirmed. Please wait.
                            {:else}
                              {deposit.claimError.message}
                            {/if}
                          </span>
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {:else if isLoadingDeposits}
              <div class="text-center text-caption text-sm mt-4">Loading deposits...</div>
            {/if}

            <button
              class="w-full py-3 px-4 rounded-xl border border-input hover:bg-input text-primary-color font-medium transition-colors"
              on:click={() => {
                onchainAddress = null;
                onchainAddressBrantaSecret = '';
                onchainAddressBrantaEncryptedDestination = '';
                receiveMode = 'lightning';
              }}
            >
              Done
            </button>
          </div>
        {/if}
      {:else if !generatedInvoice}
        <!-- Lightning Amount Selection -->
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-3 text-caption">Select Amount</label>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {#each RECEIVE_PRESETS as preset}
                <button
                  class="min-h-[44px] py-3 px-2 rounded-lg border border-input hover:border-amber-500 hover:bg-amber-500/10 text-primary-color font-medium transition-colors"
                  on:click={() => handleGenerateInvoice(preset)}
                  disabled={isGeneratingInvoice}
                >
                  {formatAmount(preset)}
                </button>
              {/each}
            </div>
          </div>

          <div class="flex items-center gap-3 text-caption text-sm">
            <div class="flex-1 h-px bg-input"></div>
            <span>or enter custom amount</span>
            <div class="flex-1 h-px bg-input"></div>
          </div>

          <div class="flex flex-col gap-2 sm:flex-row">
            <input
              type="number"
              bind:value={customReceiveAmount}
              placeholder="Custom amount in sats"
              class="flex-1 p-3 rounded-lg bg-input border border-input text-primary-color placeholder-caption focus:outline-none focus:ring-2 focus:ring-amber-500"
              disabled={isGeneratingInvoice}
              min="1"
            />
            <button
              class="min-h-[44px] py-3 px-4 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors"
              on:click={() => handleGenerateInvoice()}
              disabled={isGeneratingInvoice ||
                !customReceiveAmount ||
                parseInt(customReceiveAmount) <= 0}
            >
              {#if isGeneratingInvoice}
                <span class="animate-spin"><ArrowClockwiseIcon size={20} weight="bold" /></span>
              {:else}
                Generate
              {/if}
            </button>
          </div>

          <!-- Lightning Address Section -->
          {#if $activeWallet?.kind === 3}
            <!-- NWC wallet -->
            {#if nwcLud16}
              <div class="mt-6">
                <div class="flex items-center gap-3 text-caption text-sm mb-4">
                  <div class="flex-1 h-px bg-input"></div>
                  <span>or receive via Lightning Address</span>
                  <div class="flex-1 h-px bg-input"></div>
                </div>

                <div class="p-4 rounded-lg bg-input flex items-center justify-between gap-3">
                  <div class="flex items-center gap-2 min-w-0">
                    <LightningIcon size={20} class="text-amber-500 flex-shrink-0" />
                    <span class="text-primary-color font-mono text-sm truncate">{nwcLud16}</span>
                  </div>
                  <div class="flex items-center gap-1">
                    <button
                      class="flex-shrink-0 p-2 rounded-lg hover:bg-primary/10 transition-colors"
                      on:click={async () => {
                        const wasHidden = showLightningAddressQr !== nwcLud16;
                        if (wasHidden && nwcLud16) {
                          const r = await registerWithBranta(
                            nwcLud16,
                            'NWC Lightning Address',
                            'ln_address'
                          );
                          nwcLud16BrantaSecret = r.secret ?? '';
                          nwcLud16BrantaEncryptedDestination = r.encryptedDestination ?? '';
                          showLightningAddressQr = nwcLud16;
                        } else {
                          showLightningAddressQr = null;
                        }
                      }}
                      title="Show QR code"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="18"
                        height="18"
                        viewBox="0 0 256 256"
                        class="text-caption hover:text-amber-500"
                        ><path
                          fill="currentColor"
                          d="M104 40H56a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h48a16 16 0 0 0 16-16V56a16 16 0 0 0-16-16Zm0 64H56V56h48v48Zm0 32H56a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h48a16 16 0 0 0 16-16v-48a16 16 0 0 0-16-16Zm0 64H56v-48h48v48Zm96-160h-48a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h48a16 16 0 0 0 16-16V56a16 16 0 0 0-16-16Zm0 64h-48V56h48v48Zm-64 72v-8a8 8 0 0 1 16 0v8a8 8 0 0 1-16 0Zm80-24h-24v-8a8 8 0 0 1 16 0v8h8a8 8 0 0 1 0 16Zm0 48a8 8 0 0 1-8 8h-16v8a8 8 0 0 1-16 0v-16a8 8 0 0 1 8-8h24a8 8 0 0 1 8 8Zm-48 24a8 8 0 0 1-8 8h-8a8 8 0 0 1 0-16h8a8 8 0 0 1 8 8Zm48-48v16a8 8 0 0 1-16 0v-16a8 8 0 0 1 16 0Z"
                        /></svg
                      >
                    </button>
                    <button
                      class="flex-shrink-0 p-2 rounded-lg hover:bg-primary/10 transition-colors"
                      on:click={async () => {
                        const copied = await copyToClipboard(nwcLud16);
                        if (copied) {
                          successMessage = 'Lightning address copied!';
                          setTimeout(() => (successMessage = ''), 2000);
                        }
                      }}
                      title="Copy Lightning address"
                    >
                      <CopyIcon size={18} class="text-caption hover:text-amber-500" />
                    </button>
                  </div>
                </div>

                {#if showLightningAddressQr === nwcLud16}
                  <div
                    class="mt-4 p-4 rounded-lg bg-white flex flex-col items-center"
                    style="color: #000000;"
                  >
                    <svg
                      use:qr={{ data: nwcLud16, shape: 'circle' }}
                      class="w-48 sm:w-56 max-w-full h-auto"
                    />
                  </div>
                  <!-- Branta Verification Badge -->
                  <div class="flex justify-center mt-2">
                    <BrantaBadge
                      paymentString={nwcLud16}
                      secret={nwcLud16BrantaSecret}
                      encryptedDestination={nwcLud16BrantaEncryptedDestination}
                    />
                  </div>
                {/if}
              </div>
            {:else}
              <!-- NWC without lud16 - show disclaimer -->
              <div class="mt-6">
                <div class="p-4 rounded-lg bg-input/50 text-center">
                  <InfoIcon size={24} class="text-caption mx-auto mb-2" />
                  <p class="text-sm text-caption">
                    Your NWC connection doesn't include a Lightning address. Generate an invoice
                    above to receive payments.
                  </p>
                </div>
              </div>
            {/if}
          {:else if $activeWallet?.kind === 4}
            <!-- Spark wallet -->
            {#if $sparkLightningAddressStore}
              <div class="mt-6">
                <div class="flex items-center gap-3 text-caption text-sm mb-4">
                  <div class="flex-1 h-px bg-input"></div>
                  <span>or receive via Lightning Address</span>
                  <div class="flex-1 h-px bg-input"></div>
                </div>

                <div class="p-4 rounded-lg bg-input flex items-center justify-between gap-3">
                  <div class="flex items-center gap-2 min-w-0">
                    <LightningIcon size={20} class="text-amber-500 flex-shrink-0" />
                    <span class="text-primary-color font-mono text-sm truncate"
                      >{$sparkLightningAddressStore}</span
                    >
                  </div>
                  <div class="flex items-center gap-1">
                    <button
                      class="flex-shrink-0 p-2 rounded-lg hover:bg-primary/10 transition-colors"
                      on:click={async () => {
                        const wasHidden = showLightningAddressQr !== $sparkLightningAddressStore;
                        if (wasHidden && $sparkLightningAddressStore) {
                          const r = await registerWithBranta(
                            $sparkLightningAddressStore,
                            'Spark Lightning Address',
                            'ln_address'
                          );
                          sparkLightningAddressBrantaSecret = r.secret ?? '';
                          sparkLightningAddressBrantaEncryptedDestination =
                            r.encryptedDestination ?? '';
                          showLightningAddressQr = $sparkLightningAddressStore;
                        } else {
                          showLightningAddressQr = null;
                        }
                      }}
                      title="Show QR code"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="18"
                        height="18"
                        viewBox="0 0 256 256"
                        class="text-caption hover:text-amber-500"
                        ><path
                          fill="currentColor"
                          d="M104 40H56a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h48a16 16 0 0 0 16-16V56a16 16 0 0 0-16-16Zm0 64H56V56h48v48Zm0 32H56a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h48a16 16 0 0 0 16-16v-48a16 16 0 0 0-16-16Zm0 64H56v-48h48v48Zm96-160h-48a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h48a16 16 0 0 0 16-16V56a16 16 0 0 0-16-16Zm0 64h-48V56h48v48Zm-64 72v-8a8 8 0 0 1 16 0v8a8 8 0 0 1-16 0Zm80-24h-24v-8a8 8 0 0 1 16 0v8h8a8 8 0 0 1 0 16Zm0 48a8 8 0 0 1-8 8h-16v8a8 8 0 0 1-16 0v-16a8 8 0 0 1 8-8h24a8 8 0 0 1 8 8Zm-48 24a8 8 0 0 1-8 8h-8a8 8 0 0 1 0-16h8a8 8 0 0 1 8 8Zm48-48v16a8 8 0 0 1-16 0v-16a8 8 0 0 1 16 0Z"
                        /></svg
                      >
                    </button>
                    <button
                      class="flex-shrink-0 p-2 rounded-lg hover:bg-primary/10 transition-colors"
                      on:click={async () => {
                        const copied = await copyToClipboard($sparkLightningAddressStore || '');
                        if (copied) {
                          successMessage = 'Lightning address copied!';
                          setTimeout(() => (successMessage = ''), 2000);
                        }
                      }}
                      title="Copy Lightning address"
                    >
                      <CopyIcon size={18} class="text-caption hover:text-amber-500" />
                    </button>
                  </div>
                </div>

                {#if showLightningAddressQr === $sparkLightningAddressStore}
                  <div
                    class="mt-4 p-4 rounded-lg bg-white flex flex-col items-center"
                    style="color: #000000;"
                  >
                    <svg
                      use:qr={{ data: $sparkLightningAddressStore, shape: 'circle' }}
                      class="w-48 sm:w-56 max-w-full h-auto"
                    />
                  </div>
                  <!-- Branta Verification Badge -->
                  <div class="flex justify-center mt-2">
                    <BrantaBadge
                      paymentString={$sparkLightningAddressStore}
                      secret={sparkLightningAddressBrantaSecret}
                      encryptedDestination={sparkLightningAddressBrantaEncryptedDestination}
                    />
                  </div>
                {/if}
              </div>
            {:else}
              <div class="mt-6">
                <p class="text-sm text-caption text-center">
                  Register a Lightning address in your wallet settings to receive payments easily.
                </p>
              </div>
            {/if}
          {/if}
        </div>
      {:else}
        <!-- Invoice Generated - Show QR and copy options -->
        <div class="space-y-4 text-center">
          {#if invoicePaid}
            <!-- Payment received! -->
            <div class="py-8">
              <div
                class="w-20 h-20 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center"
              >
                <CheckCircleIcon size={48} class="text-green-500" weight="fill" />
              </div>
              <div class="text-xl font-bold text-green-500 mb-2">Payment Received!</div>
              <div class="text-lg text-primary-color">
                {formatBalance(receiveAmount)} sats
              </div>
            </div>
          {:else}
            <div class="text-lg font-medium text-primary-color">
              Invoice for {formatBalance(receiveAmount)} sats
            </div>

            <!-- QR Code -->
            {#if generatedInvoice && generatedInvoice.length > 0}
              <div class="qr-wrapper mx-auto p-4 rounded-xl bg-white max-w-xs w-full">
                <svg
                  class="w-full"
                  use:qr={{
                    data: generatedInvoice,
                    shape: 'circle'
                  }}
                />
              </div>
              <!-- Branta Verification Badge -->
              <div class="flex justify-center mt-2">
                <BrantaBadge
                  paymentString={generatedInvoice}
                  secret={generatedInvoiceBrantaSecret}
                  encryptedDestination={generatedInvoiceBrantaEncryptedDestination}
                />
              </div>
            {/if}

            <div class="p-3 rounded-lg bg-input">
              <div class="text-xs text-caption mb-2">Invoice</div>
              <div class="font-mono text-xs text-primary-color break-all max-h-24 overflow-y-auto">
                {generatedInvoice}
              </div>
            </div>

            <div class="flex gap-2">
              <button
                class="flex-1 py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-medium transition-colors flex items-center justify-center gap-2"
                on:click={async () => {
                  const copied = await copyToClipboard(generatedInvoice);
                  if (copied) {
                    successMessage = 'Invoice copied!';
                    setTimeout(() => (successMessage = ''), 2000);
                  }
                }}
              >
                <CopyIcon size={20} />
                Copy Invoice
              </button>
              <button
                class="py-3 px-4 rounded-xl border border-input hover:bg-input text-primary-color font-medium transition-colors"
                on:click={() => {
                  showReceiveModal = false;
                  resetReceiveModal();
                }}
              >
                New Invoice
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<!-- Wallet Recovery Help Modal -->
<WalletRecoveryHelpModal bind:open={showRecoveryHelpModal} />

<!-- Check Relay Backups Modal -->
<CheckRelayBackupsModal
  bind:open={showCheckRelayBackupsModal}
  pubkey={$userPublickey}
  walletType={checkRelayBackupsWalletType}
/>

<!-- Refund Deposit Modal -->
{#if showRefundModal && refundDeposit_}
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
    on:click|self={() => (showRefundModal = false)}
    on:keydown={(e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        showRefundModal = false;
      }
    }}
    role="dialog"
    aria-modal="true"
  >
    <div
      class="rounded-2xl p-6 max-w-md w-full"
      style="background-color: var(--color-bg); border: 1px solid var(--color-input-border);"
    >
      <h3 class="text-lg font-semibold text-primary-color mb-4">Refund Deposit</h3>

      <div class="space-y-4">
        <div class="p-3 rounded-lg bg-input">
          <div class="text-sm text-caption">Amount</div>
          <div class="text-lg font-semibold text-primary-color">
            {formatBalance(refundDeposit_.amountSats)} sats
          </div>
          <div class="text-xs text-caption font-mono mt-1">
            {refundDeposit_.txid}
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-caption mb-2">
            Destination Bitcoin Address
          </label>
          <input
            type="text"
            bind:value={refundAddress}
            placeholder="bc1q... or 1... or 3..."
            class="w-full px-4 py-3 rounded-xl bg-input border border-input text-primary-color placeholder:text-caption font-mono text-sm"
          />
          <p class="text-xs text-caption mt-1">
            The deposit will be sent to this address minus the network fee.
          </p>
        </div>

        <div>
          <label class="block text-sm font-medium text-caption mb-2"> Fee Rate (sat/vB) </label>
          <input
            type="number"
            bind:value={refundFeeRate}
            min="1"
            max="500"
            class="w-full px-4 py-3 rounded-xl bg-input border border-input text-primary-color"
          />
          {#if refundDeposit_ && refundFeeRate}
            {#await Promise.resolve(refundFeeRate * 200) then estRefundFee}
              <p class="text-xs text-caption mt-1">
                Estimated refund network fee (approx. 200 vB): {formatBalance(estRefundFee)} sats.
              </p>
              {#if estRefundFee > refundDeposit_.amountSats * 0.5}
                <p class="text-xs text-red-500 mt-1">
                  Warning: The estimated network fee is more than 50% of your deposit. Consider
                  using a lower fee rate.
                </p>
              {/if}
            {/await}
          {/if}
          {#if mempoolFees}
            <div class="flex gap-2 mt-2">
              <button
                type="button"
                class="flex-1 py-1.5 px-2 rounded text-xs border border-input hover:bg-input transition-colors"
                class:bg-amber-500={refundFeeRate === mempoolFees.fastestFee}
                class:text-white={refundFeeRate === mempoolFees.fastestFee}
                class:border-amber-500={refundFeeRate === mempoolFees.fastestFee}
                on:click={() => (refundFeeRate = mempoolFees?.fastestFee || 10)}
              >
                Fast ({mempoolFees.fastestFee})
              </button>
              <button
                type="button"
                class="flex-1 py-1.5 px-2 rounded text-xs border border-input hover:bg-input transition-colors"
                class:bg-amber-500={refundFeeRate === mempoolFees.halfHourFee}
                class:text-white={refundFeeRate === mempoolFees.halfHourFee}
                class:border-amber-500={refundFeeRate === mempoolFees.halfHourFee}
                on:click={() => (refundFeeRate = mempoolFees?.halfHourFee || 5)}
              >
                Medium ({mempoolFees.halfHourFee})
              </button>
              <button
                type="button"
                class="flex-1 py-1.5 px-2 rounded text-xs border border-input hover:bg-input transition-colors"
                class:bg-amber-500={refundFeeRate === mempoolFees.hourFee}
                class:text-white={refundFeeRate === mempoolFees.hourFee}
                class:border-amber-500={refundFeeRate === mempoolFees.hourFee}
                on:click={() => (refundFeeRate = mempoolFees?.hourFee || 2)}
              >
                Slow ({mempoolFees.hourFee})
              </button>
            </div>
            <p class="text-xs text-caption mt-1">
              Current rates from <a
                href="https://mempool.space"
                target="_blank"
                rel="noopener noreferrer"
                class="text-amber-500 hover:underline">mempool.space</a
              >
            </p>
          {:else}
            <p class="text-xs text-caption mt-1">
              Higher fee = faster confirmation. Check <a
                href="https://mempool.space"
                target="_blank"
                rel="noopener noreferrer"
                class="text-amber-500 hover:underline">mempool.space</a
              > for current rates.
            </p>
          {/if}
        </div>

        <div class="flex gap-3 pt-2">
          <button
            class="flex-1 py-3 px-4 rounded-xl border border-input hover:bg-input text-primary-color font-medium transition-colors"
            on:click={() => (showRefundModal = false)}
            disabled={isRefunding}
          >
            Cancel
          </button>
          <button
            class="flex-1 py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-medium transition-colors disabled:opacity-50"
            on:click={handleRefundDeposit}
            disabled={isRefunding || !refundAddress.trim()}
          >
            {#if isRefunding}
              Refunding...
            {:else}
              Refund
            {/if}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Static balance header. Lives ABOVE the inner scroll container
     (.wallet-scroll), so it doesn't bounce with the rubber-band when
     the user hits the top or bottom of the transaction list. */
  .balance-frame {
    flex-shrink: 0;
    background-color: var(--color-bg-secondary);
    /* 1rem horizontal padding gives a visible bg-secondary "border"
       around the balance card on both sides, matching the inner
       scroll container's padding so balance and history align. The
       2rem top padding replaces the buffer we used to get from
       wallet-modal-body's padding-top (now zeroed to avoid the
       flex + padding overlap bug on the scroll child below). */
    padding: 2rem 1rem 0;
    transition: padding-bottom 0.18s ease-out;
    /* Keep the frame above the scrolling content so its solid bg masks
       transactions briefly visible at the card's rounded corners. */
    position: relative;
    z-index: 10;
  }
  /* The inner scrollable area — this is the only element that bounces.
     Horizontal padding matches .balance-frame so transactions sit at
     the same inset as the balance card. */
  .wallet-scroll {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 1rem;
  }
  /* Inline send / receive / picker / wallet-info / remove-wallet views
     reuse .wallet-scroll for sizing but want a bit of vertical
     breathing room since they don't have a sticky balance bar
     pinning the top. */
  .wallet-scroll.send-view,
  .wallet-scroll.receive-view,
  .wallet-scroll.picker-view,
  .wallet-scroll.wallet-info-view,
  .wallet-scroll.remove-wallet-view {
    /* Top buffer lives here (not on wallet-modal-body) because the
       flex container's padding bleeds bg-secondary over the top of
       the scrollable content. */
    padding-top: 2rem;
    padding-bottom: 1.5rem;
  }
  @media (min-width: 768px) {
    .wallet-scroll.send-view,
    .wallet-scroll.receive-view,
    .wallet-scroll.picker-view,
    .wallet-scroll.wallet-info-view,
    .wallet-scroll.remove-wallet-view {
      padding-left: 1.5rem;
      padding-right: 1.5rem;
      padding-top: 2rem;
      padding-bottom: 2rem;
    }
  }
  /* Panel root becomes a flex column filling the modal body so the
     balance frame and inner scroll layout correctly. */
  .wallet-panel-root {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-height: 0;
    /* In a flex column container, mx-auto on a flex item collapses
       its cross-axis size to its content width. Force full width so
       max-w-2xl actually caps it instead of intrinsic sizing. */
    width: 100%;
  }
  .balance-frame--compact {
    /* Compact mode just adds the bottom buffer; horizontal "border" is
       already on the base .balance-frame so balance and history align. */
    padding-bottom: 20px;
  }
  .balance-card {
    padding: 1.25rem;
    transition:
      padding 0.18s ease-out,
      margin-bottom 0.18s ease-out,
      border-radius 0.18s ease-out,
      box-shadow 0.18s ease-out;
  }
  .balance-card--compact {
    padding: 0.6rem 1rem;
    margin-bottom: 0 !important;
    border-radius: 1.5rem !important;
    box-shadow: 0 4px 10px -6px rgba(0, 0, 0, 0.4);
  }
  .balance-card .balance-amount {
    transition:
      font-size 0.18s ease-out,
      gap 0.18s ease-out;
  }
  /* On mobile, stack the controls row (currency selector + eye +
     refresh) below the balance amount + fiat so they don't collide
     with the balance text at narrow widths. The compact-scrolled
     state (.items-center) keeps its single horizontal row since
     the balance is small and the currency selector is hidden. */
  @media (max-width: 767.98px) {
    .balance-row.items-start {
      flex-direction: column;
    }
    .balance-row.items-start > :last-child {
      align-self: flex-end;
    }
  }
  /* Gentle pulse on the balance number itself when a refresh is in
     flight — keeps the value readable instead of replacing it with a
     skeleton. */
  :global(.balance-refreshing) {
    animation: balance-refresh-pulse 1.4s ease-in-out infinite;
  }
  @keyframes balance-refresh-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.balance-refreshing) {
      animation: none;
    }
  }

  /* Welcome bolt — single diagonal shine sweep across the icon. Kept
     deliberately simple to avoid layered animations in the same area. */
  .welcome-bolt {
    position: relative;
    overflow: hidden;
    isolation: isolate;
  }
  .welcome-bolt::after {
    content: '';
    position: absolute;
    inset: -25%;
    background: linear-gradient(
      120deg,
      transparent 0%,
      transparent 40%,
      rgba(255, 255, 255, 0.22) 50%,
      transparent 60%,
      transparent 100%
    );
    transform: translateX(-110%);
    animation: bolt-shine 2.8s ease-in-out infinite;
    pointer-events: none;
    will-change: transform;
  }
  @keyframes bolt-shine {
    0% {
      transform: translateX(-110%);
    }
    55%,
    100% {
      transform: translateX(110%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .welcome-bolt::after {
      animation: none;
    }
  }

  /* Hover state for the "Explore Zap Cooking" exit card CTA. Layout,
     colors, and base chrome live as inline styles on the markup to
     stay above the wallet-modal-body :global() rules that strip
     button backgrounds otherwise. */
  .explore-prompt-cta:hover {
    background-color: rgba(255, 255, 255, 0.05) !important;
    border-color: rgba(245, 158, 11, 0.5) !important;
  }

  /* :global() so the rule reaches buttons rendered by child components
     (e.g. <Button>) too — Svelte's scoped CSS hash isn't applied to
     children's elements, so without :global() the glow only attached
     to elements rendered directly inside WalletPanel. */
  :global(.spark-glow) {
    box-shadow:
      0 0 15px rgba(251, 191, 36, 0.25),
      0 0 30px rgba(251, 191, 36, 0.12);
    border: 1px solid rgba(251, 191, 36, 0.3) !important;
    animation: spark-pulse 4s ease-in-out infinite;
  }

  @keyframes spark-pulse {
    0%,
    100% {
      box-shadow:
        0 0 15px rgba(251, 191, 36, 0.25),
        0 0 30px rgba(251, 191, 36, 0.12);
    }
    50% {
      box-shadow:
        0 0 20px rgba(251, 191, 36, 0.35),
        0 0 40px rgba(251, 191, 36, 0.18);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.spark-glow) {
      animation: none;
    }
  }
</style>
