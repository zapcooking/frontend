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
	getWalletKindName,
	setActiveWallet,
	addWallet,
	removeWallet,
	clearAllWallets,
	getActiveWallet,
	hasWalletKind,
	toggleBalanceVisibility
} from './walletStore'

// Export manager functions
export {
	connectWallet,
	disconnectWallet,
	refreshBalance,
	sendPayment,
	isWalletReady,
	getLightningAddress,
	getPaymentHistory,
	initializeWalletManager,
	isWeblnAvailable,
	isValidNwcUrl,
	type Transaction
} from './walletManager'
