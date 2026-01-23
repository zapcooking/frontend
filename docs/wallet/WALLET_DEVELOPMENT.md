# Wallet System Development Notes

This document outlines the multi-wallet system architecture to ensure future changes don't break existing functionality.

## Architecture Overview

The wallet system supports two **embedded wallet** types and two **external wallet** options:

### Embedded Wallets (Full Features)
- **NWC (kind: 3)** - Nostr Wallet Connect protocol
- **Spark (kind: 4)** - Self-custodial Breez SDK wallet

Embedded wallets provide: balance display, transaction history, send/receive, lightning addresses, and wallet widget in the header.

### External Wallets

#### WebLN (Browser Extension)
- **WebLN** - Direct connection to browser's Lightning wallet extension (e.g., Alby)
- Available when `window.webln` exists in the browser
- Uses flag-based state (`weblnConnected` store) similar to Bitcoin Connect
- Provides: payment capability, limited balance support (provider-dependent)
- When connected, disables embedded wallet options until disconnected

#### Bitcoin Connect
- **Bitcoin Connect** - External wallet connection via `@getalby/bitcoin-connect`
- Lightweight option for users who don't want to configure an embedded wallet
- Supports: Alby extension, NWC, LNbits, and other WebLN providers
- Provides: payment capability only (no balance, no history, no header widget)

## Key Files

```
src/lib/wallet/
├── index.ts           # Re-exports all wallet functions
├── walletStore.ts     # Svelte stores for wallet state
├── walletManager.ts   # Unified wallet operations
├── nwc.ts             # NWC implementation (NIP-47)
├── bitcoinConnect.ts  # Bitcoin Connect external wallet state
└── webln.ts           # WebLN browser extension support (stores, connection management)

src/lib/spark/
├── index.ts           # Breez SDK Spark integration
├── storage.ts         # Encrypted mnemonic storage
└── profileSync.ts     # Nostr profile lud16 sync functionality

src/lib/
├── encryptionService.ts # Unified NIP-44/NIP-04 encryption (signer-agnostic)
├── lightningService.ts  # Bitcoin Connect payment modal integration
└── autoZapSettings.ts   # One-Tap Zap settings (local + relay sync)

src/components/
├── CheckRelayBackupsModal.svelte  # Modal showing relay backup status
├── WalletRecoveryHelpModal.svelte # Modal with recovery information
├── BottomNav.svelte               # Mobile bottom navigation (includes Wallet)
└── icons/
    ├── BitcoinConnectLogo.svelte  # Bitcoin Connect logo icon
    └── WeblnLogo.svelte           # WebLN logo icon (orange lightning bolt)

src/routes/wallet/
└── +page.svelte       # Main wallet page with all wallet UI
```

## State Management

### Wallet Store (`walletStore.ts`)
- `wallets` - Array of saved wallets (persisted to localStorage)
- `activeWallet` - Currently selected wallet
- `walletBalance` - Balance in sats (number | null)
- `walletLoading` - Loading state
- `walletConnected` - Derived: true if activeWallet exists

### Module-Level State (Important!)
Each wallet module maintains its own connection state:

**NWC (`nwc.ts`)**:
- `nwcRelay` - NDKRelay instance
- `nwcSecret` - NIP-47 secret key
- `nwcWalletPubkey` - Wallet's pubkey
- `currentConnectionUrl` - Saved connection URL

**WebLN (`webln.ts`)**:
- `weblnProvider` - window.webln reference

**Spark (`spark/index.ts`)**:
- `_sdkInstance` - Breez SDK instance
- `_wasmInitialized` - WASM module loaded
- `_currentPubkey` - User's pubkey

**WebLN (`webln.ts`)**:
- `weblnConnected` - Svelte store (boolean, persisted to localStorage)
- `weblnWalletName` - Svelte store (string, provider name for display)
- `weblnProvider` - window.webln reference

**Bitcoin Connect (`bitcoinConnect.ts`)**:
- `bitcoinConnectEnabled` - Svelte store (boolean, persisted to localStorage)

## WebLN (External Browser Wallet)

WebLN provides direct integration with browser Lightning wallet extensions like Alby.

### Key Differences from Embedded Wallets

| Feature | Embedded Wallets | WebLN |
|---------|------------------|-------|
| Balance display | Yes | Limited (provider-dependent) |
| Transaction history | Yes | No |
| Header widget | Yes | No |
| Lightning address | Yes (Spark) | No |
| Payment capability | Yes | Yes |
| Wallet page UI | Full management | External wallet display |

### State Management

WebLN uses flag-based state similar to Bitcoin Connect:

```typescript
// src/lib/wallet/webln.ts
const STORAGE_KEY = 'zapcooking_webln_connected'
const NAME_STORAGE_KEY = 'zapcooking_webln_wallet_name'

export const weblnConnected = writable<boolean>(false)
export const weblnWalletName = writable<string>('')

export function enableWebln(walletName: string = ''): void {
  weblnConnected.set(true)
  weblnWalletName.set(walletName)
  // Persisted to localStorage via subscription
}

export function disableWebln(): void {
  weblnConnected.set(false)
  weblnWalletName.set('')
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(NAME_STORAGE_KEY)
}

export function reconnectWeblnIfEnabled(): void {
  // Called on app init to restore connection state
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'true') {
    weblnConnected.set(true)
    weblnWalletName.set(localStorage.getItem(NAME_STORAGE_KEY) || '')
  }
}
```

### UI Flow

WebLN appears in the "Add Wallet" modal under "Browser / External Wallets" section **only when `window.webln` exists**:

```
Add Embedded Wallet
├── NWC (Nostr Wallet Connect)      [disabled if WebLN connected]
├── Breez Spark (Self-Custodial)    [disabled if WebLN connected]
│
├── ─── Browser / External Wallets ───
│
├── [WebLN Icon] Browser Wallet (WebLN)
└── [Connect Wallet] (Bitcoin Connect button)
```

Once connected:
- Wallet page shows WebLN in Connected Wallets section with WebLN icon
- "Disconnect" button to disable WebLN
- Embedded wallet options are disabled until WebLN is disconnected

### Interaction with Embedded Wallets

When WebLN is connected:
- NWC and Spark options in Add Wallet modal are disabled
- Message shown: "Disconnect browser wallet to add embedded wallets"
- WebLN takes precedence for payments

### Migration from Legacy WebLN (kind 1)

On app load, if a kind 1 wallet exists in the wallets array, it is migrated:
1. Set `weblnConnected = true`
2. Store the wallet name
3. Remove the kind 1 wallet from the wallets array

This ensures backward compatibility with existing WebLN wallet configurations.

## Bitcoin Connect (External Wallet)

Bitcoin Connect provides a lightweight external wallet option for users who don't want to set up an embedded wallet (NWC or Spark).

### Key Differences from Embedded Wallets

| Feature | Embedded Wallets | Bitcoin Connect |
|---------|------------------|-----------------|
| Balance display | Yes | No |
| Transaction history | Yes | No |
| Header widget | Yes | No |
| Lightning address | Yes (Spark) | No |
| Payment capability | Yes | Yes |
| Wallet page UI | Full wallet management | Simple on/off toggle |

### State Management

Bitcoin Connect uses a simple boolean store persisted to localStorage:

```typescript
// src/lib/wallet/bitcoinConnect.ts
const STORAGE_KEY = 'zapcooking_bitcoin_connect_enabled'

export const bitcoinConnectEnabled = writable<boolean>(false)

export function enableBitcoinConnect(): void {
  bitcoinConnectEnabled.set(true)
}

export function disableBitcoinConnect(): void {
  bitcoinConnectEnabled.set(false)
  // Also disconnect any active BC session
  import('@getalby/bitcoin-connect').then(({ disconnect }) => {
    disconnect()
  })
}
```

### UI Flow

The Bitcoin Connect option appears in the "Add Wallet" modal **only when no embedded wallets exist**:

```
Add Embedded Wallet
├── NWC (Nostr Wallet Connect)
├── Breez Spark (Self-Custodial)
│
├── ─── or choose a wallet to connect ───
│
└── [Connect Wallet] (Bitcoin Connect button)
```

Once connected:
- Wallet page shows "External wallet connected" with Bitcoin Connect logo
- "Remove External Wallet" button with confirmation modal
- Users can still add embedded wallets via the "Add Wallet" button

### Payment Flow

When a user initiates a zap or payment:

1. **If embedded wallet exists**: Uses `sendPayment()` from walletManager
2. **If no embedded wallet**: Falls back to Bitcoin Connect via `lightningService.launchPayment()`

The `lightningService.ts` handles the Bitcoin Connect modal:

```typescript
// src/lib/lightningService.ts
export const lightningService = {
  async init() {
    const { init } = await import('@getalby/bitcoin-connect')
    init({ appName: 'zap.cooking', showBalance: true })
  },

  async launchPayment(invoice: string, options?: { amount?: number }) {
    const { launchPaymentModal } = await import('@getalby/bitcoin-connect')
    const result = await launchPaymentModal({ invoice, ...options })
    return result
  }
}
```

### Connection Persistence

Bitcoin Connect handles its own connection persistence:
- `persistConnection: true` - Connection survives page refreshes
- `autoConnect: true` - Automatically reconnects on page load

The `bitcoinConnectEnabled` store tracks whether the user has opted into using Bitcoin Connect, separate from the actual connection state.

## Critical Flow: Wallet Switching

When switching between wallets, **module state may be lost**. The `ensureWalletConnected()` function handles reconnection:

```typescript
async function ensureWalletConnected(wallet: Wallet): Promise<boolean> {
  switch (wallet.kind) {
    case 1: // WebLN
      if (!isWeblnConnected()) {
        await connectWebln()
      }
      break
    case 3: // NWC
      if (!isNwcConnected()) {
        await connectNwc(wallet.data) // Uses saved connection URL
      }
      break
    case 4: // Spark
      if (!get(sparkInitialized)) {
        await connectSparkWallet(pubkey, apiKey)
      }
      break
  }
}
```

This is called automatically in:
- `refreshBalance()`
- `getPaymentHistory()`
- `sendPayment()` - **Critical fix**: Ensures wallet is reconnected before attempting payment

## NWC Connection Flow

1. User pastes connection URL: `nostr+walletconnect://pubkey?relay=wss://...&secret=...`
2. `parseNwcUrl()` extracts pubkey, relay, secret (trims whitespace/newlines)
3. `connectNwc()` creates NDKRelay and connects **independently** (not added to NDK pool)
4. Module state is stored (nwcSecret, nwcWalletPubkey, nwcRelay)
5. Wallet is saved to store with `data` field containing the connection URL

### NWC URL Parsing Fix
The `parseNwcUrl()` function MUST trim whitespace and newlines:
```typescript
let cleaned = url.trim().replace(/[\r\n\t]/g, '')
```
Without this, pasted URLs with trailing newlines cause relay connection timeouts.

### NWC Relay Pool Fix - CRITICAL
**Do NOT add the NWC relay to NDK's pool!** NDK's automatic connection management interferes with NWC's specific relay requirements:

```typescript
// WRONG - causes immediate RECONNECTING state (status 4) and timeouts
nwcRelay = new NDKRelay(relayUrl, undefined, ndkInstance)
ndkInstance.pool.addRelay(nwcRelay)  // DON'T DO THIS

// CORRECT - manage relay connection independently
nwcRelay = new NDKRelay(relayUrl, undefined, ndkInstance)
// Don't add to pool - connect manually
relay.connect()
```

The relay still works for publishing and subscriptions via `NDKRelaySet` without being in the pool.

### NWC URL Normalization
NDK normalizes relay URLs by adding a trailing slash. Always normalize the relay URL before using:
```typescript
let relayUrl = parsed.relay
if (!relayUrl.endsWith('/')) {
  relayUrl = relayUrl + '/'
}
```

## Initialization Flow

On app load (`+layout.svelte`):
1. `initializeWalletManager()` is called
2. Waits for `ndkReady` promise
3. Finds active wallet from saved wallets
4. Reconnects based on wallet kind
5. Calls `refreshBalance()`

## Wallet Data Storage

Wallets are stored in localStorage key `zapcooking_wallets`:
```typescript
interface Wallet {
  id: number        // timestamp-based ID
  kind: WalletKind  // 1, 3, or 4
  name: string      // Display name
  data: string      // Kind-specific data (NWC URL, etc.)
  active: boolean   // Is this the active wallet
}
```

## Relay Backups & Restore

Relay backups use NIP-78 (kind `30078`) addressable events:
- **Spark backups (legacy)**: `d` tag `spark-wallet-backup`
- **Spark backups (wallet-specific)**: `d` tag `spark-wallet-backup:<walletId>`
- **NWC backups**: `d` tag `zapcooking-nwc-backup`

Backups are encrypted with NIP-44/NIP-04 via `encryptionService.ts` when a signer supports it. The Add Wallet modal checks for relay backups on Spark/NWC and shows a status banner ("Backup found on Nostr" / "No backup found on relays"). If multiple Spark backups exist, users get a chooser when restoring. If any Spark backup exists, creating a new Spark wallet prompts for confirmation because backing up again will replace the wallet-specific backup entry for that wallet ID (it does not delete other Spark wallet backups).

## One-Tap Zaps (Relay Sync)

One-Tap Zap preferences are stored locally and synced to relays:
- **kind**: `30078`
- **d tag**: `one-tap-zap-settings`
- **content**: JSON `{ enabled: boolean, amount: number }`

`autoZapSettings.ts` loads local settings immediately, then fetches relay settings for authenticated users and publishes changes when toggled in Settings.

## Custom Lightning Address Domain (Breez)

You don't need to set up a hosted server if you want to use Breez's hosted server. Follow the instructions in option #1 here:
https://sdk-doc-spark.breez.technology/guide/receive_lnurl_pay.html#lnurl-server

Once your custom domain is configured, share it with Breez via email at contact@breez.technology so they can whitelist it.

## Balance Display Logic

In wallet page (`+page.svelte`):
```svelte
{#if $walletLoading || $walletBalance === null}
  <span class="animate-pulse">...</span>
{:else}
  {formatBalance($walletBalance)} sats
{/if}
```

Balance shows "..." when:
- `walletLoading` is true
- `walletBalance` is null (not connected or fetch failed)

## Transaction History

### Transaction Interface
```typescript
interface Transaction {
  id: string
  type: 'incoming' | 'outgoing'
  amount: number // in sats
  description?: string
  comment?: string // Zap comment from kind 9734 content field
  timestamp: number // unix timestamp
  fees?: number // in sats
  status?: 'pending' | 'completed' | 'failed'
}
```

### Zap Comment Display
Zap transactions display the sender/recipient name and any comment from the kind 9734 zap request event:

```svelte
<div class="font-medium">{tx.description}</div>  <!-- "⚡ Zap from Alice" -->
{#if tx.comment}
  <div class="text-sm italic">"{tx.comment}"</div>
{/if}
```

The `parseZapFromDescription()` function extracts the comment from the zap request's `content` field, and `enrichTransactionsWithZapInfo()` looks up profile names for the pubkeys.

### NWC Transaction Deduplication
NWC relays can return duplicate transactions with the same `payment_hash`. This causes Svelte's keyed `{#each}` to error. Transactions are deduplicated by ID after loading:

```typescript
const seenIds = new Set<string>();
transactions = transactions.filter(tx => {
  if (seenIds.has(tx.id)) return false;
  seenIds.add(tx.id);
  return true;
});
```

### Receive Modal UX
When a payment is received:
1. Success message with checkmark and amount is displayed
2. No buttons or X close button shown
3. Modal auto-closes after 2 seconds

## Breez Spark Wallet - Complete Guide

The Spark wallet is a self-custodial Lightning wallet built on the Breez SDK. It provides full wallet functionality including payments, receiving, and lightning addresses.

### Key Files

```
src/lib/spark/
├── index.ts           # Main SDK integration, all wallet operations
├── storage.ts         # Encrypted mnemonic storage (XChaCha20-Poly1305)
└── profileSync.ts     # Nostr profile lud16 sync functionality
```

### Wallet Limits

**Maximum 2 wallets total** (one of each type). The "Add Wallet" button is hidden when the limit is reached.

**Only one Spark wallet can be connected at a time.** This prevents conflicts with the SDK's storage and state management.

```typescript
// In wallet page - check limits
$: hasExistingSparkWallet = $wallets.some(w => w.kind === 4);
$: hasExistingNwcWallet = $wallets.some(w => w.kind === 3);
$: hasMaxWallets = $wallets.length >= 2;

// Hide Add Wallet button when max reached
{#if !hasMaxWallets}
  <Button on:click={() => showAddWallet = true}>Add Wallet</Button>
{/if}
```

### Wallet List UI

Each connected wallet displays its type icon:
- **Spark**: Orange Spark logo
- **NWC**: Purple NWC logo

```svelte
{#if wallet.kind === 4}
  <SparkLogo size={24} className="text-orange-500" />
{:else if wallet.kind === 3}
  <NwcLogo size={24} className="text-purple-500" />
{/if}
```

#### Mobile Responsive Layout
The wallet list uses responsive classes for better mobile display:
- Wallet type label hidden on mobile: `hidden sm:block`
- Reduced padding on mobile: `p-3 sm:p-4`
- Smaller gaps on mobile: `gap-2 sm:gap-4`
- Wallet names truncate: `truncate`

#### Wallet Options Section
When a wallet row is expanded, it shows a "Wallet Options" section with action buttons.

**Spark Wallet Options:**
- Backup to Nostr
- Download Backup
- Show Recovery Phrase
- Recovery Help (opens WalletRecoveryHelpModal)
- Check Relay Backups (opens CheckRelayBackupsModal)
- Delete Wallet (red, destructive)

**NWC Wallet Options:**
- Wallet Info
- Copy Connection
- Download Backup
- Delete Wallet (red, destructive)

### Mobile Navigation

The bottom navigation bar (`src/components/BottomNav.svelte`) includes:
- Recipes (MagnifyingGlass icon)
- Community (ForkKnife icon)
- Explore (Compass icon)
- Wallet (Lightning icon)

The Wallet link goes to `/wallet` for quick access to wallet features on mobile.

### SDK Connection Pattern - CRITICAL
The Spark SDK uses the `connect()` pattern. **Event listener setup immediately after connect is critical for real-time payment detection.**

```typescript
const { defaultConfig, connect } = await import('@breeztech/breez-sdk-spark/web')
const config = defaultConfig('mainnet')
config.apiKey = apiKey
config.privateEnabledDefault = true  // Required for some payment types

// Connect with timeout
const sdk = await withTimeout(
  connect({
    config,
    seed: { type: 'mnemonic', mnemonic },
    storageDir: 'zapcooking-spark'  // Fixed name, not per-user
  }),
  60000,
  'SDK connect'
)

// CRITICAL: Set up event listener IMMEDIATELY after connect
await setupEventListener()

// Then sync (with timeout, non-blocking if fails)
try {
  await withTimeout(sdk.syncWallet({}), 15000, 'Initial sync')
} catch (e) {
  console.warn('Sync failed, events will handle updates')
}
```

### Event Listener Setup - CRITICAL FOR INCOMING PAYMENTS

**This is the fix for incoming payment detection.** The event listener MUST be:
1. A dedicated function
2. Called immediately after `connect()`
3. Store the listener ID for cleanup on disconnect

```typescript
// Module state
let _eventListenerId: string | null = null

// Dedicated setup function (following jumble-spark pattern)
async function setupEventListener(): Promise<void> {
  if (!_sdkInstance) return

  const listener = {
    onEvent: (event: any) => {
      console.log('[Spark] SDK Event:', event.type, event)

      // Handle payment events
      if (event.type === 'paymentSucceeded' && event.payment) {
        recentSparkPayments.update(payments => {
          if (!payments.find(p => p.id === event.payment.id)) {
            return [event.payment, ...payments].slice(0, 20)
          }
          return payments
        })
        refreshBalanceInternal()
      }

      // Handle sync events
      if (event.type === 'synced') {
        refreshBalanceInternal()
      }

      // Notify registered callbacks
      _eventCallbacks.forEach(callback => callback(event))
    }
  }

  _eventListenerId = await _sdkInstance.addEventListener(listener)
}
```

### Disconnect with Cleanup
Always remove the event listener before disconnecting:

```typescript
async function disconnectWallet(): Promise<void> {
  if (_sdkInstance) {
    // Remove event listener FIRST
    if (_eventListenerId) {
      await _sdkInstance.removeEventListener(_eventListenerId)
      _eventListenerId = null
    }

    await _sdkInstance.disconnect()
  }
  // Reset all state...
}
```

### What NOT To Do (Caused Incoming Payment Bug)

The following patterns broke incoming payment detection:

```typescript
// BAD: Connection locks and complex state management
let _connectionInProgress = false
let _connectionPromise: Promise<boolean> | null = null
let _syncInProgress = false  // This flag caused sync requests to be skipped

// BAD: Inline event listener in initializeSdk (not a dedicated function)
const listener = { onEvent: ... }
await _sdkInstance.addEventListener(listener)
// Without storing the listener ID!

// BAD: Excessive timeout wrapping on everything
_sdkInstance = await withTimeout(connect(...), 60000, 'connect')
await withTimeout(setupEventListener(), 5000, 'listener')  // Don't timeout this!
await withTimeout(syncWallet(), 15000, 'sync')
await withTimeout(refreshBalance(), 10000, 'balance')
// Events never fired because something was interfering
```

The fix: Follow the **jumble-spark pattern** exactly - simple, dedicated functions, minimal state flags.

### Balance Fetch - CRITICAL
**Never use `ensureSynced: true` for initial balance!** It causes 30+ second hangs waiting for network sync.

```typescript
// GOOD - immediate response with cached balance
const info = await sdk.getInfo({ ensureSynced: false })

// BAD - hangs for 30+ seconds
const info = await sdk.getInfo({ ensureSynced: true })
```

If you need synced data, trigger it in the background without blocking:
```typescript
sdk.getInfo({ ensureSynced: true }).then(syncedInfo => {
  // Update balance when ready
}).catch(e => console.warn('Background sync failed'))
```

### Payment History Property Names
The SDK returns payments with these property names:
```typescript
{
  id: "uuid",
  paymentType: "send" | "receive",  // NOT "sent"/"received"
  status: "completed",
  amount: "21",        // String, in sats
  fees: "3",           // String, in sats
  timestamp: 1766936554,  // Unix seconds
  method: "lightning",
  details: { ... }
}
```

Map them like this:
```typescript
const isIncoming = p.paymentType === 'receive'
const amount = Number(p.amount || p.amountSat || 0)
const timestamp = p.timestamp || p.createdAt || Date.now() / 1000
```

### Timeout Handling
All SDK operations should have timeouts to prevent UI hangs:
```typescript
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${operation} timed out`)), timeoutMs)
    )
  ])
}

// Usage
await withTimeout(sdk.getInfo({ ensureSynced: false }), 10000, 'Balance refresh')
```

### Restore from Backup Flow
When restoring a wallet, close the UI immediately after SDK connects - don't wait for balance:
```typescript
const success = await restoreFromBackup(pubkey, backup, apiKey, decryptFn)
if (success) {
  // Close modal immediately
  showModal = false
  successMessage = 'Wallet restored!'

  // Register in wallet store in background (don't await)
  connectWallet(4, 'spark').catch(e => console.warn('Background registration:', e))
}
```

### Mnemonic Storage
Mnemonics are encrypted using XChaCha20-Poly1305 with a key derived from the user's pubkey:
```typescript
function deriveKey(pubkey: string): Uint8Array {
  return sha256(new TextEncoder().encode(pubkey))
}
```

### Lightning Address (breez.tips)

Spark wallets can have a lightning address (e.g., `username@breez.tips`) for easy receiving.

#### Lightning Address State
```typescript
// Store for the current lightning address
export const lightningAddress = writable<string | null>(null)

// Helper to extract address from SDK response (handles object or string)
function extractLightningAddressString(addr: unknown): string | null {
  if (typeof addr === 'string') return addr
  if (typeof addr === 'object' && addr !== null) {
    // Try common property names: lightningAddress, address, etc.
    // Look for any string containing @
  }
  return null
}
```

#### Registration Flow
```typescript
// Check availability (debounced, 500ms)
const isAvailable = await sdk.checkLightningAddressAvailable({ username })

// Register if available
const address = await sdk.registerLightningAddress({
  username,
  description: 'zap.cooking user'
})
lightningAddress.set(address) // e.g., "username@breez.tips"
```

#### Delete Address
```typescript
await sdk.deleteLightningAddress()
lightningAddress.set(null)
```

#### Fetching After Restore
When restoring a wallet, the lightning address must be explicitly fetched:
```typescript
// After successful SDK initialization in any restore function
try {
  const addr = await getLightningAddress()
  logger.info('[Spark] Wallet lightning address:', addr || 'none')
} catch (e) {
  logger.warn('[Spark] Could not fetch lightning address after restore:', String(e))
}
```

This is added to all three restore functions:
- `restoreFromMnemonic()`
- `restoreFromBackup()`
- `restoreWalletFromNostr()`

### Profile Sync (lud16)

The `profileSync.ts` module handles syncing the lightning address to the user's Nostr profile.

#### Safety Pattern - CRITICAL
When updating the profile, we must preserve ALL existing fields:

```typescript
// src/lib/spark/profileSync.ts
export async function syncLightningAddressToProfile(
  lightningAddress: string,
  pubkey: string,
  ndk: NDK
): Promise<void> {
  // 1. Fetch current kind 0 event
  const events = await ndk.fetchEvents({
    kinds: [0],
    authors: [pubkey],
    limit: 1
  })

  // 2. Parse existing content
  const existingProfile = JSON.parse(event.content)

  // 3. Check if already synced (avoid unnecessary publishes)
  if (existingProfile.lud16 === lightningAddress) {
    return // Already synced
  }

  // 4. Merge with spread operator - preserves ALL fields
  const newProfile = {
    ...existingProfile,
    lud16: lightningAddress
  }

  // 5. Validate no data loss
  if (Object.keys(newProfile).length < Object.keys(existingProfile).length) {
    throw new Error('Profile merge would lose data')
  }

  // 6. Create and publish new kind 0 event
  const event = new NDKEvent(ndk)
  event.kind = 0
  event.content = JSON.stringify(newProfile)
  await event.publish()
}
```

#### UI Sync Status
The wallet page shows whether the profile is synced:
```typescript
// Fetch user's current profile lud16
let profileLud16: string | null = null

// Compare with Spark wallet address
$: isProfileSynced = profileLud16 && $sparkLightningAddressStore &&
  profileLud16.toLowerCase().trim() === $sparkLightningAddressStore.toLowerCase().trim()
```

Visual indicators:
- ✅ Green checkmark: Profile lud16 matches Spark address
- ⚠️ Amber warning: Profile has different lud16 or none set

### Backup & Restore

Spark wallets support multiple backup and restore methods.

#### Backup Types

**1. Nostr Relay Backup (Recommended)**
Uses NIP-78 (kind 30078) replaceable events with encrypted mnemonic:
```typescript
const BACKUP_EVENT_KIND = 30078
const BACKUP_D_TAG = 'spark-wallet-backup'
const walletId = getSparkWalletId(mnemonic)
const dTag = `${BACKUP_D_TAG}:${walletId}` // Legacy backups use BACKUP_D_TAG

// Event structure
{
  kind: 30078,
  tags: [
    ['d', dTag],
    ['client', 'zap.cooking'],
    ['encryption', 'nip44']  // or 'nip04'
  ],
  content: encryptedMnemonic  // NIP-44 or NIP-04 encrypted
}
```

**2. JSON Backup File**
Downloaded file with encrypted mnemonic:
```typescript
interface SparkWalletBackup {
  version: number           // 1 or 2
  type: 'spark-wallet-backup'
  encryption?: 'nip44' | 'nip04'  // Optional for v1
  pubkey: string
  encryptedMnemonic: string
  walletId?: string
  createdAt: number
  createdBy?: string
}
```

#### Backup File Versions

| Version | Encryption | Format |
|---------|------------|--------|
| 1 (Yakihonne/sparkihonne) | NIP-04 | No explicit encryption field |
| 2 (zap.cooking, Primal) | NIP-44 or NIP-04 | Has encryption field |

#### Encryption Detection (for imports)
```typescript
// Smart detection for backup file imports
let useNip44 = false
if (backup.encryption) {
  // Explicit field (v2 backups)
  useNip44 = backup.encryption === 'nip44'
} else if (ciphertext.includes('?iv=')) {
  // NIP-04 format has ?iv= separator
  useNip44 = false
} else {
  // Default: v2 = NIP-44, v1 = NIP-04
  useNip44 = backup.version === 2
}
```

#### Unified Encryption Service

All encryption/decryption operations use the unified `encryptionService.ts` which provides signer-agnostic encryption that works with:
- NIP-07 (browser extensions like Alby, nos2x)
- NIP-46 (remote signers like Amber)
- Private key signers

```typescript
// src/lib/encryptionService.ts
import { encrypt, decrypt, hasEncryptionSupport, getEncryptionMethod } from '$lib/encryptionService'

// Check if encryption is available
if (!hasEncryptionSupport()) {
  throw new Error('No encryption method available')
}

// Encrypt (uses best available method)
const { ciphertext, method } = await encrypt(recipientPubkey, plaintext)

// Decrypt (with automatic fallback)
const plaintext = await decrypt(senderPubkey, ciphertext, method)
```

#### Decrypt Priority Order - CRITICAL

The decrypt function prioritizes `window.nostr` over NDK signer for cross-signer compatibility:

```typescript
// Order of attempts in decrypt():
// 1. window.nostr.nip44.decrypt (NIP-07 direct)
// 2. window.nostr.nip04.decrypt (NIP-07 fallback)
// 3. ndk.signer.nip44Decrypt (NDK signer)
// 4. ndk.signer.nip04Decrypt (NDK signer fallback)
```

**Why this order matters:** Backups created on one signer (e.g., Chrome/Alby) may fail to decrypt when restored with a different signer (e.g., iOS Safari) if NDK signer is tried first. The `window.nostr` interface provides more consistent behavior across different NIP-07 implementations.

#### Automatic Method Fallback

If decryption fails with the primary method (NIP-44), the service automatically tries the alternative method (NIP-04):

```typescript
// In decrypt():
const methods: EncryptionMethod[] = method === 'nip44'
  ? ['nip44', 'nip04']
  : ['nip04', 'nip44']

for (const tryMethod of methods) {
  try {
    // Try window.nostr first, then NDK signer
    // Return on success
  } catch (e) {
    // Log and try next method
  }
}
```

#### NIP-44 vs NIP-04 Detection
Some browser extensions (e.g., keys.band) don't support NIP-44. The service detects support:
```typescript
export function hasEncryptionSupport(): boolean {
  // NDK signers always support encryption
  if (ndkInstance.signer) return true

  // Fallback to window.nostr check
  const nostr = window.nostr
  return !!(nostr?.nip44?.encrypt || nostr?.nip04?.encrypt)
}

export function getBestEncryptionMethod(): 'nip44' | 'nip04' | null {
  if (ndkInstance.signer) return 'nip44'  // NDK signers prefer NIP-44
  if (nostr?.nip44?.encrypt) return 'nip44'
  if (nostr?.nip04?.encrypt) return 'nip04'
  return null
}
```

#### Restore from Nostr Backup
```typescript
async function restoreWalletFromNostr(pubkey: string, apiKey: string) {
  // 1. Fetch backups (legacy + wallet-specific)
  const backups = await listSparkBackups(pubkey)

  // 2. If multiple backups exist, show a chooser in UI
  const backup = backups[0]

  // 3. Decrypt using unified service (handles fallback automatically)
  const mnemonic = await decrypt(pubkey, backup.content, backup.encryptionMethod)

  // 4. Initialize SDK
  await initializeSdk(pubkey, mnemonic, apiKey)

  // 5. Fetch lightning address for this wallet
  await getLightningAddress()
}
```

#### Decrypt Timeout - CRITICAL
**Decrypt operations can hang indefinitely** if the user doesn't approve the prompt or the signer has issues. Always wrap with a 15-second timeout:

```typescript
const DECRYPT_TIMEOUT = 15000

const withTimeout = <T>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms)
    )
  ])
}

// Usage
mnemonic = await withTimeout(
  decrypt(pubkey, encryptedContent, encryptionMethod),
  DECRYPT_TIMEOUT,
  'Decryption timed out. Please approve the request in your signer app.'
)
```

This prevents the UI from hanging forever when:
- User ignores the extension popup
- Extension crashes or becomes unresponsive
- Extension doesn't properly handle the decrypt request

#### Pubkey Validation
When restoring from backup file, verify the backup belongs to the current user:
```typescript
if (backup.pubkey && backup.pubkey !== pubkey) {
  throw new Error(
    'This backup belongs to a different Nostr account. ' +
    'Please log in with the correct account or use a backup file created with your current account.'
  )
}
```

#### Backup Reminder on Delete
When removing a Spark wallet, show backup options before allowing deletion:
```svelte
{#if walletToDelete.kind === 4}
  <div class="warning-box">
    <p>Back up your wallet first!</p>
    <button on:click={handleBackupToNostr}>Backup to Nostr</button>
    <button on:click={handleDownloadBackup}>Download Backup</button>
  </div>
{/if}
```

### Check Relay Backups

The "Check Relay Backups" feature allows users to see which relays have their wallet backup stored.

#### Component
`src/components/CheckRelayBackupsModal.svelte` - Modal displaying relay backup status

#### Function
```typescript
// src/lib/spark/index.ts
export interface RelayBackupStatus {
  relay: string
  hasBackup: boolean
  timestamp?: number
  error?: string
}

export async function checkRelayBackups(pubkey: string): Promise<RelayBackupStatus[]>
```

#### How It Works
1. Gets the list of configured relays from NDK
2. Queries each relay individually for the backup event (kind 30078, d-tag: `spark-wallet-backup` or `spark-wallet-backup:<walletId>`)
3. Uses `NDKRelaySet.fromRelayUrls()` to query specific relays
4. Returns status for each relay: has backup, timestamp, or error

#### UI Display
- Green checkmark: Relay has the backup (with timestamp)
- Red X: No backup found on relay
- Amber warning: Relay not connected or error
- Summary showing "X of Y relays have backup"
- Refresh button to re-check
- Tips when backups are missing

### Wallet Recovery Help Modal

`src/components/WalletRecoveryHelpModal.svelte` - Modal with recovery information for Spark wallets.

#### Content Sections
1. **Introduction** - Explains wallet uses Breez Spark, recoverable with 12-word seed
2. **How it Works** - Seed phrase explanation, non-custodial nature
3. **Compatible Wallets** - Spark ecosystem, Blitz Wallet example
4. **Recovery Process** - High-level steps
5. **Security Reminder** - Keep seed safe, never share

#### External Links
- Breez SDK docs: https://sdk-doc-spark.breez.technology/
- Blitz Wallet: https://blitzwalletapp.com
- Blitz Recovery Tool: https://recover.blitz-wallet.com/ (with third-party disclaimer)

### SDK Version
Currently using `@breeztech/breez-sdk-spark@0.6.3`.

Upgraded from 0.4.2 after confirming the event listener pattern works correctly with the newer SDK.

### WASM Loading
The Breez SDK requires WASM. Vite config must include:
```typescript
assetsInclude: ['**/*.wasm'],
optimizeDeps: {
  exclude: ['@breeztech/breez-sdk-spark']
}
```

### Common Spark Errors

**"Could not establish connection. Receiving end does not exist"**
- Browser extension communication issue
- Usually harmless, caused by extension message ports timing out
- The SDK should still work after this error

**Balance shows "..." indefinitely**
- Check if `getInfo({ ensureSynced: true })` is being called
- Change to `ensureSynced: false` for immediate response

**"SDK connect timed out"**
- Network connectivity issue
- User should refresh page and try again

## Testing Checklist

Before any wallet changes, verify:

### NWC
- [ ] NWC connects with pasted URL
- [ ] NWC balance displays after connection
- [ ] Transaction history loads for NWC
- [ ] NWC backup file downloads with connection string on separate line
- [ ] Backup reminder shown when deleting NWC wallet

### Spark
- [ ] Create new Spark wallet shows mnemonic
- [ ] Restore from mnemonic works
- [ ] Restore from backup file works (NIP-44 decryption)
- [ ] Restore from backup file works (NIP-04 / v1 format)
- [ ] Restore from Nostr backup works
- [ ] **Cross-signer restore works** (backup on Chrome/Alby, restore on iOS Safari/different signer)
- [ ] Balance displays immediately (not hanging)
- [ ] **Incoming payment detected in real-time** (check console for `[Spark] SDK Event: paymentSucceeded`)
- [ ] Balance updates automatically after receiving payment
- [ ] Transaction history shows with correct amounts/timestamps
- [ ] Modal closes promptly after restore (no hanging)
- [ ] Cannot add second Spark wallet (option disabled)
- [ ] Lightning address after restore shows correctly (not [object Object])
- [ ] Backup reminder shown when deleting Spark wallet

### Lightning Address
- [ ] Can register new lightning address
- [ ] Username availability check works (debounced)
- [ ] Address displays after registration
- [ ] Can delete lightning address
- [ ] Profile sync status shows correctly (green/amber indicator)
- [ ] "Sync to Profile" updates Nostr kind 0 lud16

### Wallet UI
- [ ] Wallet Options section shows all buttons for Spark
- [ ] Wallet Options section shows all buttons for NWC
- [ ] Delete button is inside expanded section (not in wallet row)
- [ ] Check Relay Backups modal opens and shows relay status
- [ ] Recovery Help modal opens with correct content
- [ ] Mobile: Wallet type label hidden, names truncate
- [ ] Mobile: Bottom nav shows Wallet with lightning icon

### WebLN
- [ ] WebLN option appears in Add Wallet modal when browser has `window.webln`
- [ ] WebLN option hidden when browser lacks WebLN support
- [ ] Connecting WebLN shows success and displays in Connected Wallets
- [ ] WebLN connected state persists across page refreshes
- [ ] When WebLN connected, embedded wallet options (NWC, Spark) are disabled
- [ ] Disconnect button removes WebLN and re-enables embedded wallet options
- [ ] Legacy kind 1 wallets are migrated to new WebLN flag system
- [ ] Payments work via WebLN when connected

### Bitcoin Connect
- [ ] Bitcoin Connect option appears in modal when no wallets exist
- [ ] Clicking "Connect Wallet" opens Bitcoin Connect modal
- [ ] After connecting, wallet page shows "External wallet connected" with BC logo
- [ ] "Remove External Wallet" shows confirmation modal
- [ ] Confirming removal disables Bitcoin Connect
- [ ] Zaps work via Bitcoin Connect when no embedded wallet exists
- [ ] Bitcoin Connect button disabled when already connected
- [ ] Can add embedded wallet while Bitcoin Connect is enabled

### General
- [ ] Switching between wallets shows correct balance
- [ ] Page refresh restores active wallet and shows balance
- [ ] Wallet deletion works with confirmation
- [ ] Restore order: Nostr Backup → Backup File → Recovery Phrase
- [ ] **Payment with embedded wallet works after page refresh** (ensureWalletConnected fix)

## Known Issues

### Spark Wallet - Stale Transaction History (Intermittent)
**Status**: Under investigation - deferred to future build
**Symptom**: Breez/Spark wallet occasionally shows stale/old transaction data in history on initial load.
**Potential Cause**: The SDK's `listPayments()` returns all historical transactions from IndexedDB storage.

**Attempted Fix (disabled)**: Added `fromTimestamp` filter to limit history to recent transactions.
- The SDK supports `fromTimestamp` in `ListPaymentsRequest`
- However, enabling this caused transactions to not appear until sync completed (~1 minute delay)
- Filter code exists but is disabled pending further investigation

**Future Work**:
1. Investigate SDK sync timing - transactions take 1+ minute to appear after restore
2. Consider client-side filtering after fetch instead of SDK-level filter
3. Add loading states to better communicate sync progress to users

```typescript
// spark/index.ts - fromTimestamp filter (currently DISABLED)
// SDK supports: fromTimestamp, toTimestamp, typeFilter, statusFilter
const request = { offset, limit, fromTimestamp: thirtyDaysAgo }
await _sdkInstance.listPayments(request)
```

### NWC Wallet - Restore from Nostr (FIXED)
**Status**: Fixed in `nwc-safari-fix` branch
**Root Cause**: Multiple TDZ (Temporal Dead Zone) errors in `nwc.ts`:
1. `isNwcConnectedTo()` called before defined in `connectNwc()`
2. `cleanup()` referencing `onConnect`/`onDisconnect` before defined in `waitForRelayConnection()`
**Fix**: Inlined checks and reordered variable declarations to avoid TDZ.

---

## TDZ (Temporal Dead Zone) Prevention - CRITICAL

JavaScript bundlers convert `export function foo()` to `const foo = () => {}` which are NOT hoisted. Functions must be defined BEFORE they are called in file order.

**Pattern to Avoid**:
```typescript
// BAD - causes "Cannot access uninitialized variable" error
export async function connectNwc() {
  if (isNwcConnectedTo(url)) { ... }  // Called before defined!
}
export function isNwcConnectedTo() { ... }  // Defined after use
```

**Safe Pattern**:
```typescript
// GOOD - inline the check
export async function connectNwc() {
  // Inline check instead of calling function defined later
  if (currentUrl === url && secret !== null && relay?.status === 1) { ... }
}
```

This affected the Safari iOS NWC fixes in `nwc.ts`.

---

## Common Issues

### "Relay connection timeout"
- Check for whitespace/newlines in NWC URL
- Verify relay is accessible
- Check NDK is ready before connecting

### Balance shows "..."
- Wallet not connected (check module state)
- Balance fetch failed (check console for errors)
- `ensureWalletConnected()` not reconnecting

### "NWC not connected" after switching wallets
- Module state was lost
- `ensureWalletConnected()` should handle this automatically
- Verify wallet.data contains the connection URL
