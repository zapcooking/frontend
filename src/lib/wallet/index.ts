/**
 * Wallet Module
 *
 * Unified wallet system supporting multiple Lightning wallet types:
 * - Kind 1: WebLN (browser extensions like Alby)
 * - Kind 3: NWC (Nostr Wallet Connect)
 * - Kind 4: Spark (Breez SDK self-custodial)
 */

// Export stores
export {
  type Wallet,
  type WalletKind,
  wallets,
  activeWallet,
  walletBalance,
  walletConnected,
  walletLoading,
  walletLastSync,
  balanceVisible,
  navBalanceVisible,
  getWalletKindName,
  setActiveWallet,
  addWallet,
  removeWallet,
  clearAllWallets,
  getActiveWallet,
  hasWalletKind,
  toggleBalanceVisibility,
  setNavBalanceVisible
} from './walletStore';

// Export manager functions
export {
  connectWallet,
  disconnectWallet,
  refreshBalance,
  sendPayment,
  createInvoice,
  isWalletReady,
  getLightningAddress,
  getPaymentHistory,
  initializeWalletManager,
  isWeblnAvailable,
  isValidNwcUrl,
  pendingTransactions,
  addPendingTransaction,
  removePendingTransaction,
  updatePendingTransactionStatus,
  clearPendingTransactions,
  ensurePendingTransactionsLoaded,
  transactionsNeedRefresh,
  signalTransactionsRefresh,
  type Transaction
} from './walletManager';

// Export NWC functions that may be needed directly
export { getNwcInfo } from './nwc';

// Export Bitcoin Connect external wallet state
export {
  bitcoinConnectEnabled,
  enableBitcoinConnect,
  disableBitcoinConnect,
  isBitcoinConnectEnabled
} from './bitcoinConnect';
