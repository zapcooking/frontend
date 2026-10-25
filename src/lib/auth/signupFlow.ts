/**
 * Signup, two screens (login plan PR 3):
 *
 *   1. "Pick a name" — display name + optional photo. The keypair is made
 *      in memory when the flow opens; the photo is held on the device.
 *   2. "Keep your account safe" — EITHER a passkey (where the browser can
 *      do PRF; sync on by default) OR a backup key (Download · Copy).
 *
 * Nothing is signed in, uploaded or published until screen 2 succeeds;
 * closing earlier discards the key (and any passkey vault saved for it).
 * These are the rules SignupFlow follows, kept pure so they're tested.
 */
import type { PasskeyMethodLabel } from './passkeyLabel';

export const MAX_SIGNUP_NAME_LENGTH = 64;

/** Screen 1 can continue once there's a name (trimmed, not too long). */
export function isValidSignupName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_SIGNUP_NAME_LENGTH;
}

/** Only http(s) links count as a pasted photo. */
export function isValidPhotoUrl(url: string): boolean {
  const trimmed = url.trim();
  return /^https?:\/\/\S+$/i.test(trimmed);
}

/**
 * Why screen 2 is showing the backup key, which decides the copy and what
 * the finish button does.
 *   chosen        — "Save a backup key instead" (or no passkey here)
 *   sync-off      — passkey with sync off: backup first, passkey after
 *   upload-failed — passkey-only, but the off-device copy didn't land
 *   passkey-failed— the passkey couldn't be set up on this device
 *   unconfirmed   — one-prompt passkey: nothing has shown it can unlock yet
 */
export type BackupReason =
  | 'chosen'
  | 'sync-off'
  | 'upload-failed'
  | 'passkey-failed'
  | 'unconfirmed';

export type SafeStep =
  | { kind: 'choose' }
  | { kind: 'backup'; reason: BackupReason }
  | { kind: 'done' };

/** Tapping the passkey button: with sync off, the backup key comes first. */
export function onPasskeyChosen(syncOn: boolean): SafeStep | 'run-passkey' {
  return syncOn ? 'run-passkey' : { kind: 'backup', reason: 'sync-off' };
}

/**
 * After the passkey ceremony succeeded. Passkey-only (sync on) needs the
 * encrypted copy to have reached the server; otherwise there is no
 * off-device way back in, so a backup key is required before finishing.
 * With sync off the backup key was already saved (it came first).
 *
 * An UNCONFIRMED passkey (one-prompt setup) whose copy landed, or with sync
 * off, ends on the 'unconfirmed' step: it explains that the first unlock
 * finishes the setup and that the key stays in this browser until then.
 * There the backup key is optional (backupRequired): either-or, as decided
 * for sync on; sync off already saved it. If that first unlock later fails,
 * the backup-key message covers it.
 */
export function afterPasskey(
  syncOn: boolean,
  uploaded: boolean | null,
  confirmed = true
): SafeStep {
  if (syncOn && uploaded !== true) return { kind: 'backup', reason: 'upload-failed' };
  if (!confirmed) return { kind: 'backup', reason: 'unconfirmed' };
  return { kind: 'done' };
}

/** Whether the backup step's Finish waits for a saved backup key (optional only on 'unconfirmed'). */
export function backupRequired(reason: BackupReason): boolean {
  return reason !== 'unconfirmed';
}

/** The finish button on the backup step: runs the passkey only when it's still to come. */
export function backupFinishRunsPasskey(reason: BackupReason): boolean {
  return reason === 'sync-off';
}

/** Whether "Back" may return to the choice (not once a passkey exists for the key). */
export function backupCanGoBack(reason: BackupReason): boolean {
  return reason === 'chosen' || reason === 'sync-off';
}

/** "Protect with Touch ID" / "Protect with a passkey". */
export function protectWithText(label: PasskeyMethodLabel): string {
  return label === 'passkey' ? 'Protect with a passkey' : `Protect with ${label}`;
}

/** "Finish with Touch ID" (sync off: after the backup key). */
export function finishWithText(label: PasskeyMethodLabel): string {
  return label === 'passkey' ? 'Finish with a passkey' : `Finish with ${label}`;
}

/** Where a new member lands when no action is waiting: the Fresh tab. */
export const SIGNUP_LANDING = '/feed?tab=fresh';
