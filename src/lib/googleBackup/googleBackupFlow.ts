/**
 * Orchestration for the Google Drive nsec backup/restore flow.
 *
 * These helpers stitch together gis.ts (identity + Drive token), driveBackup.ts
 * (REST), and googleBackupCrypto.ts (parity crypto). They deliberately do NOT
 * touch authManager: the caller (LoginOverlay) already holds the auth manager
 * and logs in via its private-key path, exactly like the nsec/bunker flows.
 * Google is a backup transport, not a login method — there is no 'google'
 * authMethod.
 */

import { getDriveAccessToken, getGoogleIdentity } from './gis';
import { listBackups, downloadBackup, uploadBackup } from './driveBackup';
import { deriveBackupKey, encryptNsec, decryptNsec } from './googleBackupCrypto';
import { bytesToHex } from '@noble/hashes/utils.js';

export interface GoogleSession {
  sub: string;
  accessToken: string;
  /** First existing backup file id, or null if this is a new user. */
  existingFileId: string | null;
}

/**
 * Sign in to Google (renders the SIWG button into `container`), obtain the
 * Drive access token, and check for an existing backup. Two Google prompts:
 * identity, then Drive authorization (Approach A).
 */
export async function signInToGoogle(container: HTMLElement): Promise<GoogleSession> {
  const { sub } = await getGoogleIdentity(container);
  const accessToken = await getDriveAccessToken();
  const backups = await listBackups(accessToken);
  return { sub, accessToken, existingFileId: backups[0]?.fileId ?? null };
}

/**
 * Returning user: download + decrypt the existing backup with the PIN-derived
 * key. Returns the 64-char lowercase-hex nsec for
 * authManager.authenticateWithPrivateKey. A wrong PIN fails the NIP-44 HMAC and
 * throws — never a silent wrong-key login.
 */
export async function restoreFromBackup(
  session: GoogleSession,
  fileId: string,
  pin: string
): Promise<string> {
  const key = deriveBackupKey(session.sub, pin);
  const payload = await downloadBackup(session.accessToken, fileId);
  const nsec = decryptNsec(payload, key); // throws on wrong PIN (HMAC) or bad data
  return bytesToHex(nsec);
}

/**
 * New user: encrypt the freshly generated nsec with the PIN-derived key and
 * upload it to Drive. `privateKey` is the raw 32-byte secret key (as returned
 * by AuthManager.generateKeyPair). Returns the 64-char hex nsec so the caller
 * can log in via the private-key path.
 */
export async function createAndUploadBackup(
  session: GoogleSession,
  pin: string,
  privateKey: Uint8Array
): Promise<string> {
  const key = deriveBackupKey(session.sub, pin);
  const payload = encryptNsec(privateKey, key);
  await uploadBackup(session.accessToken, payload);
  return bytesToHex(privateKey);
}
