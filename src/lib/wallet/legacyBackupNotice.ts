import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import {
  getNostrBackupBlocker,
  noteLegacyMigration,
  type DecryptSource
} from '$lib/encryptionService';

/**
 * One-time "save your recovery phrase" notice, per Spark wallet, for
 * NIP-46 sessions whose wallet backup opened only through the legacy
 * decrypt fallback (#897). NIP-46 sessions can't create backups, so that
 * backup can't be migrated and stays readable only while the legacy source
 * (leftover stored nsec, browser extension) exists.
 *
 * Persisted: the login auto-restore can open the backup while the wallet
 * panel is closed, and the notice must still appear when it next opens.
 */
const STORAGE_KEY = 'zapcooking_legacy_backup_notice';

interface NoticeState {
  pending: string[]; // wallet ids waiting for the notice
  shown: string[]; // wallet ids that already had it
}

function load(): NoticeState {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (Array.isArray(parsed?.pending) && Array.isArray(parsed?.shown)) return parsed;
  } catch {
    // Unreadable or unavailable storage — start over
  }
  return { pending: [], shown: [] };
}

// In-memory state is authoritative for the session; localStorage only
// carries it across reloads, so a failed write never loses the notice.
const state: NoticeState = browser ? load() : { pending: [], shown: [] };

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode or a full quota — the notice just won't survive a reload
  }
  legacyBackupNoticePending.set([...state.pending]);
}

/** Wallet ids with a notice waiting to be shown. */
export const legacyBackupNoticePending = writable<string[]>([...state.pending]);

/** Queue the notice for a wallet, unless it's queued or was already shown. */
export function flagLegacyBackupNotice(walletId: string): void {
  if (state.pending.includes(walletId) || state.shown.includes(walletId)) return;
  state.pending.push(walletId);
  save();
}

/** Claim the notice for display: true once per wallet, then never again. */
export function takeLegacyBackupNotice(walletId: string): boolean {
  if (!state.pending.includes(walletId)) return false;
  state.pending = state.pending.filter((id) => id !== walletId);
  state.shown.push(walletId);
  save();
  return true;
}

/**
 * The Spark wallet (by id) to show the notice for now, if any: one that is
 * pending and present in `wallets`. Claims it, so it's returned only once.
 */
export function claimLegacyBackupNotice(
  pending: string[],
  wallets: Array<{ kind: number; data: string }>
): string | null {
  const wallet = wallets.find((w) => w.kind === 4 && pending.includes(w.data));
  return wallet && takeLegacyBackupNotice(wallet.data) ? wallet.data : null;
}

/**
 * After a Spark backup restore: a legacy-decrypted backup is republished
 * under the session key, or, when the session can't create backups
 * (NIP-46), flagged for the notice instead.
 */
export async function settleLegacySparkBackup(
  walletId: string,
  source: DecryptSource,
  republish: () => Promise<unknown>
): Promise<void> {
  if (source === 'session') return;
  if (getNostrBackupBlocker() === 'nip46') {
    flagLegacyBackupNotice(walletId);
    return;
  }
  try {
    await republish();
    noteLegacyMigration('Spark wallet backup', source);
  } catch (e) {
    console.warn('[Spark] Legacy-encrypted backup not migrated:', String(e));
  }
}
