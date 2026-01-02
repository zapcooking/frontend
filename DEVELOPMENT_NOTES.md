# Development Notes

## Known Issues

### 1. Spark Wallet - Stale Transaction History (Intermittent)
**Status**: Unresolved - low priority
**Symptom**: Breez/Spark wallet occasionally shows stale transaction data in history with no clear pattern.
**Location**: Transaction merging logic in `src/lib/wallet/walletManager.ts:680-737`
**Notes**:
- Could be IndexedDB caching old data
- Could be `recentSparkPayments` store not clearing properly
- Could be deduplication/ordering issue when merging `recentFromEvents` with `listSparkPayments()`
- Live zap.cooking works fine, so may be environment-specific

### 2. NWC Wallet - Restore from Nostr Not Working
**Status**: Under investigation
**Symptom**: NWC wallet restore from Nostr relays doesn't work properly.
**Location**:
- `src/lib/wallet/nwcBackup.ts` - backup/restore logic
- `src/routes/wallet/+page.svelte:1205-1231` - restore handler
- `src/lib/wallet/nwc.ts` - connection logic

**Restore Flow**:
1. `restoreNwcFromNostr(pubkey)` fetches backup event from relays
2. Decrypts with NIP-44 or NIP-04 via extension
3. Calls `connectWallet(3, connectionString)`
4. `connectWallet` calls `connectNwc(data)` then `refreshBalance()`

**Potential Issues**:
- Connection may succeed but balance/history not loading
- Relay fetch may be timing out or not finding events
- Decryption may be silently failing

---

## Safari iOS WebSocket Fixes (Implemented)

### Branch: `nwc-safari-fix`

**Problem**: NWC had WebSocket connection issues on Safari iOS mobile:
- "WebSocket is closed before connection established" from concurrent connection attempts
- Empty `onDisconnect` handler caused hangs
- `isNwcConnected()` didn't check actual relay status

**Solution** (in `src/lib/wallet/nwc.ts`):
1. Added `connectionInProgress` mutex to prevent concurrent connections
2. Fixed `waitForRelayConnection` disconnect handler - now rejects properly
3. Added `nwcRelay?.status === 1` check to `isNwcConnected()`
4. Added `isNwcConnectedTo()` helper function
5. **CRITICAL**: All checks are INLINED to avoid TDZ bundler errors

### TDZ (Temporal Dead Zone) Error Prevention

**Root Cause**: JavaScript bundlers convert `export function foo()` to `const foo = () => {}` which are NOT hoisted. Functions must be defined BEFORE they are called in file order.

**Pattern to Avoid**:
```typescript
// BAD - causes TDZ error
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

---

## Branch Strategy

- **`main`**: Uses `adapter-cloudflare` - for upstream PR compatibility
- **`vercel`**: Uses `adapter-auto` - deployed to Vercel production
- **`nwc-safari-fix`**: NWC Safari iOS fixes (branched from `vercel`)

When syncing with upstream:
1. Pull/merge upstream changes into `main`
2. Merge `main` into `vercel` to keep both in sync

---

## Scrapped Branches (Reference Only)

These branches were abandoned due to various issues but may contain useful code:

- `mobile-wallet-performance-fixes` - Many failed attempts, mixed Spark and NWC changes
- `nwc-fixes-only` - First NWC-only attempt, had TDZ errors
- `nwc-fixes-only-v2` - Second attempt, still had issues
