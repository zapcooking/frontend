# Wallet System Development Notes

This document outlines the multi-wallet system architecture to ensure future changes don't break existing functionality.

## Architecture Overview

The wallet system supports two wallet types:
- **NWC (kind: 3)** - Nostr Wallet Connect protocol
- **Spark (kind: 4)** - Self-custodial Breez SDK wallet

### Removed: WebLN (kind: 1)
WebLN browser extension support was removed to simplify the wallet options. WebLN had compatibility issues:
- Unable to display balance (not supported by most providers)
- No transaction history support
- Inconsistent behavior across different extensions

The code infrastructure for WebLN still exists in `webln.ts` but is not exposed in the UI. This simplifies the user experience by focusing on the two most reliable options.

## Key Files

```
src/lib/wallet/
├── index.ts           # Re-exports all wallet functions
├── walletStore.ts     # Svelte stores for wallet state
├── walletManager.ts   # Unified wallet operations
├── nwc.ts             # NWC implementation (NIP-47)
└── webln.ts           # WebLN implementation

src/lib/spark/
├── index.ts           # Breez SDK Spark integration
└── storage.ts         # Encrypted mnemonic storage
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

## NWC Connection Flow

1. User pastes connection URL: `nostr+walletconnect://pubkey?relay=wss://...&secret=...`
2. `parseNwcUrl()` extracts pubkey, relay, secret (trims whitespace/newlines)
3. `connectNwc()` creates NDKRelay and connects
4. Module state is stored (nwcSecret, nwcWalletPubkey, nwcRelay)
5. Wallet is saved to store with `data` field containing the connection URL

### NWC URL Parsing Fix
The `parseNwcUrl()` function MUST trim whitespace and newlines:
```typescript
let cleaned = url.trim().replace(/[\r\n\t]/g, '')
```
Without this, pasted URLs with trailing newlines cause relay connection timeouts.

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

## Spark-Specific Notes

### SDK Connection Pattern
The Spark SDK uses the `connect()` pattern (not `SdkBuilder`):
```typescript
const { defaultConfig, connect } = await import('@breeztech/breez-sdk-spark/web')
const config = defaultConfig('mainnet')
config.apiKey = apiKey
config.realTimeSyncServerUrl = undefined // Disable to avoid sync loop issues

const sdk = await connect({
  config,
  seed: { type: 'mnemonic', mnemonic },
  storageDir: `spark-${pubkey.slice(0, 8)}`
})
```

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

### Spark
- [ ] Create new Spark wallet shows mnemonic
- [ ] Restore from mnemonic works
- [ ] Restore from backup file works (NIP-44 decryption)
- [ ] Balance displays immediately (not hanging)
- [ ] Transaction history shows with correct amounts/timestamps
- [ ] Modal closes promptly after restore (no hanging)

### General
- [ ] Switching between wallets shows correct balance
- [ ] Page refresh restores active wallet and shows balance
- [ ] Wallet deletion works with confirmation

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
