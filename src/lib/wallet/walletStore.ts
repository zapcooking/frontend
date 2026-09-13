import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { ndk, userPublickey } from '$lib/nostr';
import {
  canCreateNostrBackup,
  encrypt,
  decrypt,
  type EncryptionMethod
} from '$lib/encryptionService';

// Wallet types using kind system (matching sparkihonne)
export type WalletKind = 1 | 3 | 4; // 1=WebLN, 3=NWC, 4=Spark

export interface Wallet {
  id: number;
  kind: WalletKind;
  name: string;
  active: boolean;
  data: string; // NWC connection string, 'webln', or 'spark'
}

/**
 * At-rest protection for NWC connection strings.
 *
 * A `nostr+walletconnect://…secret=…` string is a live payment
 * authorization: anyone who reads it from localStorage can spend from
 * the wallet from anywhere. Kind-3 `data` is therefore persisted as a
 * NIP-44 encrypt-to-self envelope (same scheme as the Spark mnemonic
 * in $lib/spark/storage.ts) — the encryption key never sits at rest
 * for NIP-07 and vault sessions. In memory, `data` stays the plaintext
 * string so every consumer (connect, display, export) is unchanged.
 *
 * Legacy plaintext entries are used as-is and transparently re-saved
 * encrypted (silent migration, same as Spark V1→V2).
 */
interface EncryptedData {
  enc: string;
  method: EncryptionMethod;
}

interface StoredWallet extends Omit<Wallet, 'data'> {
  data: string | EncryptedData;
}

// Entries held back for deferred decryption — data is always an envelope
// (that's the only way they get here).
type PendingEncryptedWallet = Omit<StoredWallet, 'data'> & { data: EncryptedData };

const STORAGE_KEY = 'zapcooking_wallets';

function isNwcConnectionString(data: string): boolean {
  return (
    data.startsWith('nostr+walletconnect://') || data.startsWith('nostrwalletconnect://')
  );
}

function isEncryptedData(value: unknown): value is EncryptedData {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as EncryptedData).enc === 'string' &&
    typeof (value as EncryptedData).method === 'string'
  );
}

// Last envelope seen per wallet id — lets a save whose re-encrypt fails
// (signer denied) keep the prior envelope instead of dropping to
// plaintext or losing the wallet.
const lastEnvelopeById = new Map<number, EncryptedData>();

// Envelope entries not yet decrypted (e.g. vault still locked, NIP-07
// not ready on page load). They must survive every storage write so the
// wallets aren't lost while undecrypted.
let pendingEncrypted: PendingEncryptedWallet[] = [];

let plaintextFallbackWarned = false;

async function encryptForStorage(
  pubkey: string,
  id: number,
  data: string
): Promise<string | EncryptedData> {
  if (isNwcConnectionString(data) && canCreateNostrBackup()) {
    try {
      const { ciphertext, method } = await encrypt(pubkey, data);
      const envelope: EncryptedData = { enc: ciphertext, method };
      return envelope;
    } catch (e) {
      console.warn('[WalletStore] NWC encryption failed:', e);
      // Prefer the prior envelope over plaintext — an undecryptable copy
      // is better than a plaintext secret.
      const prior = lastEnvelopeById.get(id);
      if (prior) return prior;
      if (!plaintextFallbackWarned) {
        plaintextFallbackWarned = true;
        console.warn(
          '[WalletStore] NWC connection string could not be encrypted (signer denied?). It will be stored in plaintext.'
        );
      }
    }
  }
  return data;
}

// Serialize + persist. Async (encryption round-trips through the
// signer); serialized through a promise chain so the last write wins.
async function persistWallets(list: Wallet[]): Promise<void> {
  if (!browser) return;
  const pubkey = get(userPublickey);
  const stored: StoredWallet[] = [];
  for (const w of list) {
    const data = await encryptForStorage(pubkey, w.id, w.data);
    if (isEncryptedData(data)) lastEnvelopeById.set(w.id, data);
    stored.push({ ...w, data });
  }
  // Keep still-encrypted entries that haven't made it into the store.
  const inStore = new Set(list.map((w) => w.id));
  for (const pending of pendingEncrypted) {
    if (!inStore.has(pending.id)) stored.push({ ...pending });
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch (e) {
    console.error('[WalletStore] Failed to save wallets:', e);
  }
}

let persistChain: Promise<void> = Promise.resolve();
let latestPendingSave: Wallet[] | null = null;

function schedulePersist(list: Wallet[]): void {
  if (!browser) return;
  latestPendingSave = list;
  persistChain = persistChain.then(async () => {
    const snapshot = latestPendingSave;
    latestPendingSave = null;
    if (snapshot) await persistWallets(snapshot);
  });
}

// Load wallets from localStorage. Entries whose kind-3 data is an
// encrypted envelope are held back (they need the signer); everything
// else is returned immediately.
function loadWallets(): Wallet[] {
  if (!browser) return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as StoredWallet[];
      const ready: Wallet[] = [];
      const envelopes: PendingEncryptedWallet[] = [];
      for (const w of parsed) {
        if (isEncryptedData(w.data)) {
          lastEnvelopeById.set(w.id, w.data);
          envelopes.push({ ...w, data: w.data });
        } else {
          ready.push({ ...w, data: w.data as string });
        }
      }
      pendingEncrypted = envelopes;
      return ready;
    }
  } catch (e) {
    console.error('[WalletStore] Failed to load wallets:', e);
  }
  pendingEncrypted = [];
  return [];
}

// ── Deferred envelope decryption ────────────────────────────────────
//
// The signer may not exist yet when the page loads (passkey vault
// locked, NIP-07 extension still registering, bunker still pairing).
// Poll lightly and decrypt as soon as it's available; the
// encryptionService decrypt cache + denial circuit-breaker prevent
// signer-popup floods while we wait.

let decryptTimer: ReturnType<typeof setInterval> | null = null;

function scheduleEnvelopeDecrypt(): void {
  if (!browser || decryptTimer) return;
  decryptTimer = setInterval(() => {
    if (pendingEncrypted.length === 0) {
      if (decryptTimer) clearInterval(decryptTimer);
      decryptTimer = null;
      return;
    }
    const pubkey = get(userPublickey);
    const signer = get(ndk).signer;
    if (!pubkey || !signer) return;
    void decryptPendingEnvelopes(pubkey);
  }, 5000);
}

async function decryptPendingEnvelopes(pubkey: string): Promise<void> {
  const stillPending: PendingEncryptedWallet[] = [];
  let merged = false;
  for (const pending of pendingEncrypted) {
    try {
      const plaintext = await decrypt(pubkey, pending.data.enc, pending.data.method);
      mergeDecryptedWallet({ ...pending, data: plaintext });
      merged = true;
    } catch (e) {
      // Signer denied or not ready — keep the envelope for a later retry.
      stillPending.push(pending);
      console.warn(
        '[WalletStore] Wallet decryption unavailable, will retry:',
        e instanceof Error ? e.message : e
      );
    }
  }
  pendingEncrypted = stillPending;
  if (merged) walletsDecrypted.update((n) => n + 1);
}

function mergeDecryptedWallet(wallet: Wallet): void {
  wallets.update((current) => {
    const idx = current.findIndex((w) => w.id === wallet.id);
    if (idx === -1) return [...current, wallet];
    const next = [...current];
    next[idx] = wallet;
    return next;
  });
}

/**
 * Fires (counter) whenever encrypted wallets finish decrypting, so the
 * wallet manager can restore connectivity for an NWC wallet that
 * wasn't connectable at init time.
 */
export const walletsDecrypted = writable<number>(0);

// --- Stores ---

// All connected wallets - initialize empty to match SSR, load on client
export const wallets = writable<Wallet[]>([]);

// Track if we've loaded from storage (to avoid clearing on initial SSR)
let hasLoadedFromStorage = false;

// Load wallets from localStorage on client (after hydration)
if (browser) {
  // Use setTimeout to defer loading until after hydration
  setTimeout(() => {
    const saved = loadWallets();
    hasLoadedFromStorage = true;
    if (saved.length > 0) {
      wallets.set(saved);
    }
    if (pendingEncrypted.length > 0) {
      scheduleEnvelopeDecrypt();
    }
  }, 0);
}

// Subscribe to persist changes
wallets.subscribe((value) => {
  if (browser && hasLoadedFromStorage) {
    schedulePersist(value);
  }
});

// Currently active wallet
export const activeWallet = derived(wallets, ($wallets) => $wallets.find((w) => w.active) || null);

// Cached balance storage key
const CACHED_BALANCE_KEY = 'zapcooking_cached_balance';

function getCachedBalance(walletId: number): number | null {
  if (!browser) return null;
  try {
    const stored = localStorage.getItem(`${CACHED_BALANCE_KEY}_${walletId}`);
    if (stored) {
      return parseInt(stored, 10);
    }
  } catch {
    // Ignore storage errors
  }
  return null;
}

function setCachedBalance(walletId: number, balance: number): void {
  if (!browser) return;
  try {
    localStorage.setItem(`${CACHED_BALANCE_KEY}_${walletId}`, String(balance));
  } catch {
    // Ignore storage errors
  }
}

function clearCachedBalance(walletId: number): void {
  if (!browser) return;
  try {
    localStorage.removeItem(`${CACHED_BALANCE_KEY}_${walletId}`);
  } catch {
    // Ignore storage errors
  }
}

// Wallet balance in sats (updated by wallet manager)
export const walletBalance = writable<number | null>(null);

// Load cached balance for active wallet on startup
if (browser) {
  setTimeout(() => {
    const active = get(wallets).find((w) => w.active);
    if (active) {
      const cached = getCachedBalance(active.id);
      if (cached !== null) {
        walletBalance.set(cached);
      }
    }
  }, 0);
}

// Cache balance when it changes.
//
// Hiding the balance is a privacy setting — someone with the screen or the
// device shouldn't see the amount. Writing it to localStorage anyway would
// undercut that, so the cache is only written while the balance is visible.
walletBalance.subscribe((balance) => {
  if (browser && balance !== null && loadBalanceVisibility()) {
    const active = get(wallets).find((w) => w.active);
    if (active) {
      setCachedBalance(active.id, balance);
    }
  }
});

// Whether any wallet is connected and ready
export const walletConnected = derived(activeWallet, ($active) => $active !== null);

// Loading state for balance fetching
export const walletLoading = writable<boolean>(false);

// Last sync timestamp
export const walletLastSync = writable<number | null>(null);

// Balance visibility (privacy feature)
const BALANCE_VISIBLE_KEY = 'zapcooking_balance_visible';
const NAV_BALANCE_VISIBLE_KEY = 'zapcooking_nav_balance_visible';

function loadBalanceVisibility(): boolean {
  if (!browser) return true;
  try {
    const stored = localStorage.getItem(BALANCE_VISIBLE_KEY);
    return stored !== 'false'; // Default to visible
  } catch {
    return true;
  }
}

function loadNavBalanceVisibility(): boolean {
  if (!browser) return true;
  try {
    const stored = localStorage.getItem(NAV_BALANCE_VISIBLE_KEY);
    return stored !== 'false'; // Default to visible
  } catch {
    return true;
  }
}

export const balanceVisible = writable<boolean>(true);
export const navBalanceVisible = writable<boolean>(true);

// Initialize on client
if (browser) {
  setTimeout(() => {
    balanceVisible.set(loadBalanceVisibility());
    navBalanceVisible.set(loadNavBalanceVisibility());
  }, 0);
}

// Persist changes
balanceVisible.subscribe((visible) => {
  if (browser) {
    try {
      localStorage.setItem(BALANCE_VISIBLE_KEY, String(visible));
    } catch {
      // Ignore storage errors
    }
  }
});

navBalanceVisible.subscribe((visible) => {
  if (browser) {
    try {
      localStorage.setItem(NAV_BALANCE_VISIBLE_KEY, String(visible));
    } catch {
      // Ignore storage errors
    }
  }
});

/**
 * Toggle balance visibility.
 *
 * Hiding also drops the already-cached amount for the active wallet —
 * otherwise the last visible balance would sit in localStorage for
 * anyone inspecting the device, which is the thing hiding it is meant
 * to prevent.
 */
export function toggleBalanceVisibility(): void {
  balanceVisible.update((v) => {
    const next = !v;
    if (!next && browser) {
      const active = get(wallets).find((w) => w.active);
      if (active) clearCachedBalance(active.id);
    }
    return next;
  });
}

export function setNavBalanceVisible(visible: boolean): void {
  navBalanceVisible.set(visible);
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
  };

  wallets.update((current) => {
    if (current.length === 0) newWallet.active = true;
    return [...current, newWallet];
  });
  return newWallet;
}

/**
 * Remove a wallet by ID
 */
export function removeWallet(id: number): void {
  wallets.update((current) => {
    const filtered = current.filter((w) => w.id !== id);
    if (!filtered.some((w) => w.active) && filtered.length > 0) {
      filtered[0].active = true;
    }
    return filtered;
  });
  walletBalance.set(null);
  walletLastSync.set(null);
}

/**
 * Set the active wallet
 */
export function setActiveWallet(id: number): void {
  wallets.update((current) => current.map((w) => ({ ...w, active: w.id === id })));
  walletBalance.set(null);
  walletLastSync.set(null);
}

/**
 * Update wallet name
 */
export function updateWalletName(id: number, name: string): void {
  wallets.update((current) => current.map((w) => (w.id === id ? { ...w, name } : w)));
}

/**
 * Get wallet by kind (useful for checking if a wallet type is already connected)
 */
export function getWalletByKind(kind: WalletKind): Wallet | undefined {
  return get(wallets).find((w) => w.kind === kind);
}

/**
 * Check if a specific wallet type is connected
 */
export function hasWalletKind(kind: WalletKind): boolean {
  return get(wallets).some((w) => w.kind === kind);
}

/**
 * Get the currently active wallet
 */
export function getActiveWallet(): Wallet | null {
  return get(activeWallet);
}

/**
 * Clear all wallets
 */
export function clearAllWallets(): void {
  // Also drop still-encrypted entries so the storage write that follows
  // doesn't resurrect them (and so logout actually removes wallet data).
  pendingEncrypted = [];
  wallets.set([]);
  walletBalance.set(null);
  walletLastSync.set(null);
}

/**
 * Get wallet kind display name
 */
export function getWalletKindName(kind: WalletKind): string {
  switch (kind) {
    case 1:
      return 'WebLN';
    case 3:
      return 'NWC';
    case 4:
      return 'Self-custodial';
    default:
      return 'Unknown';
  }
}
