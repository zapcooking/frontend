/**
 * Drive REST v3 client for the nsec backup — web port of the Android
 * DriveBackupService. PARITY-CRITICAL naming so both platforms see the same
 * files in the shared appDataFolder:
 *   - filenames: `wisp_bk_<uuid>.bin` (the `wisp_` prefix is inherited from
 *     upstream and preserved for the same reason as the salt — renaming it to
 *     `zap` would orphan every existing Android backup).
 *   - space: appDataFolder (scoped per Cloud project; both platforms share ONE
 *     project, so files are mutually visible and invisible to other apps).
 *   - file BODY is the raw NIP-44 v2 base64 string from encryptNsec() — NO JSON
 *     envelope (confirmed against DriveBackupService.uploadBackup). Download
 *     returns that string verbatim for decryptNsec().
 */

const BACKUP_PREFIX = 'wisp_bk_';
const BACKUP_SUFFIX = '.bin';
const APP_DATA_FOLDER = 'appDataFolder';

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

export interface BackupFile {
  fileId: string;
  name: string;
}

/**
 * Thrown when Drive returns 401 — the access token expired or the user revoked
 * the app's Drive authorization. Web equivalent of Android's
 * DriveAuthorizationExpiredException: the caller should re-run the GIS token
 * client to obtain a fresh token and retry.
 */
export class DriveAuthorizationError extends Error {
  constructor(op: string) {
    super(`Drive ${op} failed: 401 (Google authorization expired or revoked)`);
    this.name = 'DriveAuthorizationError';
  }
}

function assertOk(res: Response, op: string): void {
  if (res.status === 401) throw new DriveAuthorizationError(op);
  if (!res.ok) throw new Error(`Drive ${op} failed: ${res.status} ${res.statusText}`);
}

/**
 * List backup files in appDataFolder, matching the `wisp_bk_…​.bin` naming.
 * Excludes trashed files and orders newest-first so callers that take the first
 * entry restore the most recent backup rather than an arbitrary or stale one.
 */
export async function listBackups(accessToken: string): Promise<BackupFile[]> {
  const params = new URLSearchParams({
    spaces: APP_DATA_FOLDER,
    q: `name contains '${BACKUP_PREFIX}' and trashed = false`,
    orderBy: 'modifiedTime desc',
    fields: 'files(id,name,modifiedTime)',
    pageSize: '100'
  });
  const res = await fetch(`${DRIVE_FILES_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  assertOk(res, 'list');
  const body = (await res.json()) as { files?: Array<{ id?: string; name?: string }> };
  const files = body.files ?? [];
  return files
    .filter(
      (f): f is { id: string; name: string } =>
        typeof f.id === 'string' &&
        typeof f.name === 'string' &&
        f.name.startsWith(BACKUP_PREFIX) &&
        f.name.endsWith(BACKUP_SUFFIX)
    )
    .map((f) => ({ fileId: f.id, name: f.name }));
}

/** Download a backup file's body — the raw NIP-44 base64 payload. */
export async function downloadBackup(accessToken: string, fileId: string): Promise<string> {
  const res = await fetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  assertOk(res, 'download');
  return res.text();
}

/**
 * Create a new backup file with a fresh random-UUID filename, matching the
 * Android multipart/related upload. Each call creates a distinct file (there is
 * no in-place replace), sidestepping the delete-then-upload race.
 */
export async function uploadBackup(accessToken: string, payload: string): Promise<void> {
  const filename = `${BACKUP_PREFIX}${crypto.randomUUID()}${BACKUP_SUFFIX}`;
  const metadata = JSON.stringify({ name: filename, parents: [APP_DATA_FOLDER] });
  const boundary = `wisp-${crypto.randomUUID()}`;
  const crlf = '\r\n';
  const body =
    `--${boundary}${crlf}` +
    `Content-Type: application/json; charset=UTF-8${crlf}${crlf}` +
    `${metadata}${crlf}` +
    `--${boundary}${crlf}` +
    `Content-Type: application/octet-stream${crlf}${crlf}` +
    `${payload}${crlf}` +
    `--${boundary}--${crlf}`;

  const res = await fetch(DRIVE_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body
  });
  assertOk(res, 'upload');
}
