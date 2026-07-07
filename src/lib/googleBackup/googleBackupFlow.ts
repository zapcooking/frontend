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

import { requestDriveAccessToken, getGoogleIdentity } from './gis';
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
 * Step 1 of the two-tap flow: render the SIWG button into `container` and
 * resolve with the decoded ID-token `sub`. Loads GIS as a side effect, so by
 * the time step 2 runs the token client can be invoked synchronously.
 */
export async function getGoogleSub(container: HTMLElement): Promise<string> {
  const { sub } = await getGoogleIdentity(container);
  return sub;
}

/**
 * Step 2 of the two-tap flow: request the drive.appdata token and check for an
 * existing backup. MUST be called from a user-gesture handler with no `await`
 * before it — requestDriveAccessToken opens a popup that mobile Safari blocks
 * outside a gesture. The `await requestDriveAccessToken()` expression evaluates
 * (opening the popup) before the await suspends, so the gesture is preserved.
 */
export async function connectDrive(sub: string): Promise<GoogleSession> {
  const accessToken = await requestDriveAccessToken();
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
