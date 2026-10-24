/**
 * Key-backup gate: the logic behind KeyBackupGate.svelte, extracted so it is
 * unit-testable (this repo has no Svelte component-test infra).
 *
 * The gate sits in front of every passkey enrollment path (signup, the
 * login-time prompt, Settings) so the user has a real copy of their nsec
 * BEFORE the ceremony deletes the plaintext key. Two saves can be observed —
 * a download click and a clipboard write that actually landed — and a third
 * (self-attested) is allowed only where the caller opts in: an existing user
 * enrolling from Settings or the prompt may already hold a backup, while a
 * brand-new signup cannot, so signup never offers the acknowledgement.
 */

import { browser } from '$app/environment';

export interface BackupGateInputs {
  /** The backup file download was triggered (cannot be verified further). */
  downloaded: boolean;
  /** A clipboard write of the nsec succeeded (a rejected write must not count). */
  copiedVerified: boolean;
  /** "I already have my nsec backed up somewhere safe" is ticked. */
  acknowledged: boolean;
  /** Whether the acknowledgement counts at all (false for signup). */
  allowAcknowledge: boolean;
}

export function backupGateSatisfied(i: BackupGateInputs): boolean {
  if (i.downloaded || i.copiedVerified) return true;
  return i.allowAcknowledge && i.acknowledged;
}

/** Contents of the downloadable backup file (pure, unit-tested). */
export function buildKeysBackupText(nsec: string, npub: string): string {
  return [
    'Zap Cooking Nostr Backup',
    '',
    `Public key (npub): ${npub}`,
    '',
    `Private key (nsec): ${nsec}`,
    '',
    'Keep this file safe:',
    '- Do not share your private key.',
    '- Store in a secure password manager or offline storage.',
    '- You can restore your profile in any Nostr client.',
    '- Zap Cooking: https://zap.cooking',
    '- Anyone with this file can access your profile.'
  ].join('\n');
}

/** File name for the backup, dated so repeated downloads do not collide. */
export function keysBackupFileName(now = new Date()): string {
  return `zapcooking-keys-${now.toISOString().slice(0, 10)}.txt`;
}

/**
 * Trigger the browser download of the backup file. Returns true when the
 * click was dispatched — the save dialog itself cannot be observed.
 */
export function downloadKeysBackupFile(nsec: string, npub: string): boolean {
  if (!browser) return false;
  const blob = new Blob([buildKeysBackupText(nsec, npub)], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = keysBackupFileName();
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return true;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}
