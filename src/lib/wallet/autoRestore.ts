/**
 * Auto-restore the user's wallet at login.
 *
 * Logout deliberately wipes wallet data from the device (shared-device
 * safety): the NWC connection string and the Spark mnemonic only survive
 * as Nostr backups encrypted to the user's key. Without this module the
 * user logs back in to what looks like a wallet-less account, and the
 * only way back is a manual "Restore from Nostr" button.
 *
 * A per-pubkey record of the last-used wallet (kind + fingerprint — no
 * secrets, so it can survive the logout wipe) drives the restore:
 *
 * - kind 3 (NWC): the single replaceable backup must fingerprint-match
 *   the remembered connection, else the slot now holds someone else's
 *   string and we leave it alone.
 * - kind 4 (Spark): the per-wallet backup with the remembered wallet id,
 *   falling back to the newest backup if that one is gone.
 *
 * No record (fresh device / never had a wallet) → no auto-restore; the
 * wallet picker with its "Backup found" hints stays the entry point.
 */

import { browser } from '$app/environment';
import { writable, get } from 'svelte/store';
import { ndkReady, userPublickey } from '$lib/nostr';
import { showToast } from '$lib/toast';
import { wallets, hasPersistedWallets, fingerprintWalletData } from './walletStore';
import { connectWallet } from './walletManager';
import { restoreNwcFromNostr } from './nwcBackup';
import { listSparkBackups, restoreSparkBackup, getSparkWalletId } from '$lib/spark';

/**
 * True while a login auto-restore is in flight. The header mini-wallet
 * renders its restoring pill from this instead of implying the user has
 * no wallet during the fetch/decrypt round-trip.
 */
export const walletRestoring = writable(false);

interface LastWalletRecord {
  kind: 3 | 4;
  id: string; // fingerprint of the NWC string, or the Spark wallet id
  at: number;
}

function recordKey(pubkey: string): string {
  return `zapcooking_last_wallet_${pubkey}`;
}

/** Remember the active wallet so the next login can put it back. */
export function rememberActiveWallet(wallet: { kind: number; data: string } | null): void {
  if (!browser) return;
  const pubkey = get(userPublickey);
  if (!pubkey || !wallet || (wallet.kind !== 3 && wallet.kind !== 4) || !wallet.data) return;
  const record: LastWalletRecord = {
    kind: wallet.kind,
    id: wallet.kind === 3 ? fingerprintWalletData(wallet.data) : wallet.data,
    at: Date.now()
  };
  try {
    localStorage.setItem(recordKey(pubkey), JSON.stringify(record));
  } catch {
    /* storage blocked — next login just won't auto-restore */
  }
}

/** The last wallet this pubkey used on this device, if any. */
export function getLastWalletRecord(pubkey: string | null | undefined): LastWalletRecord | null {
  if (!browser || !pubkey) return null;
  try {
    const raw = localStorage.getItem(recordKey(pubkey));
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && (parsed.kind === 3 || parsed.kind === 4) && typeof parsed.id === 'string') {
      return parsed as LastWalletRecord;
    }
  } catch {
    /* corrupt record — ignore */
  }
  return null;
}

// One attempt per pubkey per session — a failed restore must not retry
// behind the user's back, since each attempt can ask the signer (NIP-07
// extension, bunker) to decrypt.
let attemptedPubkey = '';

/**
 * Restore + connect the remembered wallet from the user's Nostr backups.
 * Call shortly after login. Returns true when a wallet was restored.
 */
export async function autoRestoreWalletAtLogin(pubkey: string | null | undefined): Promise<boolean> {
  if (!browser || !pubkey || attemptedPubkey === pubkey) return false;

  // The device still has wallets (possibly still-encrypted envelopes) —
  // the regular init/decrypt path owns reconnecting them; don't race it.
  if (get(wallets).length > 0 || hasPersistedWallets()) return false;

  const record = getLastWalletRecord(pubkey);
  if (!record) return false;

  attemptedPubkey = pubkey;
  await ndkReady;
  walletRestoring.set(true);

  try {
    let result: { success: boolean; wallet?: { name: string } } | null = null;
    if (record.kind === 3) {
      const connectionString = await restoreNwcFromNostr(pubkey);
      if (!connectionString || fingerprintWalletData(connectionString) !== record.id) {
        // No NWC backup, or the backup slot now holds a different
        // connection than the one this device remembers.
        return false;
      }
      result = await connectWallet(3, connectionString);
    } else {
      const apiKey = import.meta.env.VITE_BREEZ_API_KEY;
      if (!apiKey) return false;

      const backups = await listSparkBackups(pubkey);
      // The remembered wallet when its backup still exists, else the
      // newest — presence on the relays means it was never deleted.
      const chosen = backups.find((b) => b.walletId === record.id) || backups[0];
      if (!chosen) return false;

      const mnemonic = await restoreSparkBackup(pubkey, apiKey, chosen);
      if (!mnemonic) return false;

      result = await connectWallet(4, getSparkWalletId(mnemonic));
    }

    if (result.success) {
      showToast('success', `${result.wallet?.name ?? 'Wallet'} restored from your backup`, 4000);
    }
    return result.success;
  } catch (e) {
    // Signer denied a decrypt, relays unreachable, SDK failed to init —
    // all recoverable via the manual restore button in the wallet panel.
    console.warn('[Wallet] Auto-restore at login failed:', e);
    return false;
  } finally {
    walletRestoring.set(false);
  }
}
