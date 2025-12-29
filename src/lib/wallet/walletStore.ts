import { writable, derived, get } from 'svelte/store'
import { browser } from '$app/environment'

// Wallet types using kind system (matching sparkihonne)
export type WalletKind = 1 | 3 | 4 // 1=WebLN, 3=NWC, 4=Spark

export interface Wallet {
	id: number
	kind: WalletKind
	name: string
	active: boolean
	data: string // NWC connection string, 'webln', or 'spark'
}

const STORAGE_KEY = 'zapcooking_wallets'

// Load wallets from localStorage
function loadWallets(): Wallet[] {
	if (!browser) return []
	try {
		const stored = localStorage.getItem(STORAGE_KEY)
		if (stored) {
			return JSON.parse(stored)
		}
	} catch (e) {
		console.error('[WalletStore] Failed to load wallets:', e)
	}
	return []
}

// Save wallets to localStorage
function saveWallets(wallets: Wallet[]): void {
	if (!browser) return
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets))
	} catch (e) {
		console.error('[WalletStore] Failed to save wallets:', e)
	}
}

// --- Stores ---

// All connected wallets - initialize empty to match SSR, load on client
export const wallets = writable<Wallet[]>([])

// Track if we've loaded from storage (to avoid clearing on initial SSR)
let hasLoadedFromStorage = false

// Load wallets from localStorage on client (after hydration)
if (browser) {
	// Use setTimeout to defer loading until after hydration
	setTimeout(() => {
		const saved = loadWallets()
		hasLoadedFromStorage = true
		if (saved.length > 0) {
			wallets.set(saved)
		}
	}, 0)
}

// Subscribe to persist changes
wallets.subscribe((value) => {
	if (browser && hasLoadedFromStorage) {
		saveWallets(value)
	}
})

// Currently active wallet
export const activeWallet = derived(wallets, ($wallets) => $wallets.find((w) => w.active) || null)

// Wallet balance in sats (updated by wallet manager)
export const walletBalance = writable<number | null>(null)

// Whether any wallet is connected and ready
export const walletConnected = derived(activeWallet, ($active) => $active !== null)

// Loading state for balance fetching
export const walletLoading = writable<boolean>(false)

// Last sync timestamp
export const walletLastSync = writable<number | null>(null)

// Balance visibility (privacy feature)
const BALANCE_VISIBLE_KEY = 'zapcooking_balance_visible'

function loadBalanceVisibility(): boolean {
	if (!browser) return true
	try {
		const stored = localStorage.getItem(BALANCE_VISIBLE_KEY)
		return stored !== 'false' // Default to visible
	} catch {
		return true
	}
}

export const balanceVisible = writable<boolean>(true)

// Initialize on client
if (browser) {
	setTimeout(() => {
		balanceVisible.set(loadBalanceVisibility())
	}, 0)
}

// Persist changes
balanceVisible.subscribe((visible) => {
	if (browser) {
		try {
			localStorage.setItem(BALANCE_VISIBLE_KEY, String(visible))
		} catch {
			// Ignore storage errors
		}
	}
})

/**
 * Toggle balance visibility
 */
export function toggleBalanceVisibility(): void {
	balanceVisible.update((v) => !v)
}

// --- Wallet Operations ---

/**
 * Add a new wallet
 */
export function addWallet(kind: WalletKind, name: string, data: string): Wallet {
	const newWallet: Wallet = {
		id: Date.now(),
		kind,
		name,
		active: false,
		data
	}

	wallets.update((current) => {
		// If this is the first wallet, make it active
		if (current.length === 0) {
			newWallet.active = true
		}
		return [...current, newWallet]
	})

	console.log('[WalletStore] Added wallet:', newWallet.name, 'kind:', kind)
	return newWallet
}

/**
 * Remove a wallet by ID
 */
export function removeWallet(id: number): void {
	wallets.update((current) => {
		const filtered = current.filter((w) => w.id !== id)

		// If we removed the active wallet, activate the first remaining one
		if (!filtered.some((w) => w.active) && filtered.length > 0) {
			filtered[0].active = true
		}

		return filtered
	})

	console.log('[WalletStore] Removed wallet:', id)
}

/**
 * Set the active wallet
 */
export function setActiveWallet(id: number): void {
	wallets.update((current) =>
		current.map((w) => ({
			...w,
			active: w.id === id
		}))
	)

	// Reset balance when switching wallets
	walletBalance.set(null)
	walletLastSync.set(null)

	console.log('[WalletStore] Set active wallet:', id)
}

/**
 * Update wallet name
 */
export function updateWalletName(id: number, name: string): void {
	wallets.update((current) => current.map((w) => (w.id === id ? { ...w, name } : w)))
}

/**
 * Get wallet by kind (useful for checking if a wallet type is already connected)
 */
export function getWalletByKind(kind: WalletKind): Wallet | undefined {
	return get(wallets).find((w) => w.kind === kind)
}

/**
 * Check if a specific wallet type is connected
 */
export function hasWalletKind(kind: WalletKind): boolean {
	return get(wallets).some((w) => w.kind === kind)
}

/**
 * Get the currently active wallet
 */
export function getActiveWallet(): Wallet | null {
	return get(activeWallet)
}

/**
 * Clear all wallets
 */
export function clearAllWallets(): void {
	wallets.set([])
	walletBalance.set(null)
	walletLastSync.set(null)
	console.log('[WalletStore] Cleared all wallets')
}

/**
 * Get wallet kind display name
 */
export function getWalletKindName(kind: WalletKind): string {
	switch (kind) {
		case 1:
			return 'WebLN'
		case 3:
			return 'NWC'
		case 4:
			return 'Self-custodial'
		default:
			return 'Unknown'
	}
}
