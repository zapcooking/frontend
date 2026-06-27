import { NDKEvent } from '@nostr-dev-kit/ndk';
import type NDK from '@nostr-dev-kit/ndk';

const NOSTR_BUILD_URL = 'https://nostr.build/api/v2/upload/files';
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_GIF_SIZE = 15 * 1024 * 1024; // 15MB — animated files are often larger than static images
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_VIDEO_DURATION = 60; // seconds

/**
 * Bring the (possibly remote) signer to a ready state. NIP-46 bunkers such
 * as Primal need a relay round-trip — and, the first time the app asks them
 * to sign a kind:27235 event, a one-time user-approval prompt. We block on
 * that here, BEFORE stamping the NIP-98 timestamp, so the slow connect/
 * approval doesn't eat into the auth token's freshness window. Local-key and
 * extension signers resolve effectively instantly. Non-fatal on timeout —
 * the subsequent sign attempt surfaces any real error.
 */
async function warmSigner(ndk: NDK): Promise<void> {
  const signer = ndk.signer as { blockUntilReady?: () => Promise<unknown> } | undefined;
  if (!signer?.blockUntilReady) return;
  try {
    await Promise.race([
      signer.blockUntilReady(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('signer warm timeout')), 30000))
    ]);
  } catch {
    // Ignore — proceed and let the sign attempt report the real problem.
  }
}

/**
 * Sign the event with a timeout so a blocked extension popup or an unanswered
 * remote-signer approval surfaces an error instead of hanging the upload
 * forever. Generous (60s) because remote signers (Amber/Primal) require manual
 * approval; warmSigner has already absorbed the connection latency by now.
 */
async function signWithTimeout(template: NDKEvent, ms = 60000): Promise<void> {
  await Promise.race([
    template.sign(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              'Signing timed out — approve the request in your signer (extension, Amber, or Primal).'
            )
          ),
        ms
      )
    )
  ]);
}

/** True if a failed upload response looks like a rejected/expired NIP-98 token. */
function isAuthFailure(status: number, bodyText: string): boolean {
  if (status === 401 || status === 403) return true;
  // nostr.build sometimes returns 400 for a stale/invalid auth event.
  const t = bodyText.toLowerCase();
  return /nip[\s-]?98|unauthor|expired|timestamp|created_at|invalid auth/.test(t);
}

/**
 * Build + sign a fresh NIP-98 Authorization header for the given URL. Stamps
 * `created_at` at call time, so re-invoking on a retry yields a fresh token.
 */
async function buildAuthHeader(ndk: NDK, url: string): Promise<string> {
  const template = new NDKEvent(ndk);
  template.kind = 27235;
  const now = Math.floor(Date.now() / 1000);
  template.created_at = now;
  template.content = '';
  template.tags = [
    ['u', url],
    ['method', 'POST'],
    ['expiration', String(now + 60)]
  ];

  await signWithTimeout(template);

  const authEvent = {
    id: template.id,
    pubkey: template.pubkey,
    created_at: template.created_at,
    kind: template.kind,
    tags: template.tags,
    content: template.content,
    sig: template.sig
  };

  return `Nostr ${btoa(JSON.stringify(authEvent))}`;
}

function parseUploadError(bodyText: string, status: number, statusText: string): string {
  try {
    const data = JSON.parse(bodyText);
    return data.message || data.error || `Upload failed with status ${status}`;
  } catch {
    return bodyText || `HTTP ${status}: ${statusText}`;
  }
}

/**
 * Upload files to nostr.build with NIP-98 authentication.
 *
 * nostr.build verifies that the NIP-98 event's `created_at` is recent
 * (~60s). Remote signers (NIP-46, e.g. Primal) add round-trip + first-time
 * approval latency, so a token signed up front can arrive already expired.
 * To handle that we warm the signer first, then build a freshly-signed,
 * freshly-stamped header on each attempt and retry once on an auth failure —
 * by the retry the signer auto-approves kind:27235, so the new timestamp
 * lands well inside the window.
 *
 * @param opts.url override endpoint (defaults to the general files endpoint;
 *   ProfileEditModal uses the profile endpoint for square-cropped avatars).
 */
export async function uploadToNostrBuild(ndk: NDK, body: FormData, opts: { url?: string } = {}) {
  if (!ndk.signer) {
    throw new Error('You must be signed in to upload.');
  }

  const url = opts.url ?? NOSTR_BUILD_URL;

  await warmSigner(ndk);

  const attempt = async () => {
    const authorization = await buildAuthHeader(ndk, url);
    return fetch(url, { method: 'POST', body, headers: { Authorization: authorization } });
  };

  let response = await attempt();

  if (!response.ok) {
    const firstText = await response.text();
    if (isAuthFailure(response.status, firstText)) {
      // Token likely arrived stale (slow remote sign). Retry once with a
      // fresh timestamp — the signer is warm and approval is now granted.
      response = await attempt();
      if (!response.ok) {
        const text = await response.text();
        throw new Error(parseUploadError(text, response.status, response.statusText));
      }
    } else {
      throw new Error(parseUploadError(firstText, response.status, response.statusText));
    }
  }

  return await response.json();
}

/**
 * Upload an image file, returning the URL on success.
 * Tries the user's Blossom servers (kind:10063) first; falls back to nostr.build.
 * Throws on validation failure or upload error.
 */
export async function uploadImage(ndk: NDK, file: File): Promise<string> {
  if (file.size > MAX_IMAGE_SIZE) {
    throw new Error('Image must be less than 5MB');
  }

  if (ndk.signer) {
    try {
      const { fetchBlossomServers, uploadWithBlossom } = await import('./blossomUpload');
      const user = await ndk.signer.user();
      const servers = await fetchBlossomServers(ndk, user.pubkey);
      if (servers.length > 0) {
        return await uploadWithBlossom(ndk, file, servers);
      }
    } catch (e) {
      console.warn('[Upload] Blossom failed, falling back to nostr.build:', e);
    }
  }

  const body = new FormData();
  body.append('file[]', file);
  const result = await uploadToNostrBuild(ndk, body);

  if (result?.data?.[0]?.url) {
    return result.data[0].url;
  }
  throw new Error(result?.message || result?.error || 'Failed to upload image');
}

/**
 * Upload a GIF or animated WebP, returning the URL on success.
 * Uses a higher 15MB limit since animated files are often larger than static images.
 * Throws on validation failure or upload error.
 */
export async function uploadGif(ndk: NDK, file: File): Promise<string> {
  if (file.size > MAX_GIF_SIZE) {
    throw new Error('GIF must be less than 15MB');
  }

  const body = new FormData();
  body.append('file[]', file);
  const result = await uploadToNostrBuild(ndk, body);

  if (result?.data?.[0]?.url) {
    return result.data[0].url;
  }
  throw new Error(result?.message || result?.error || 'Failed to upload GIF');
}

/**
 * Upload a video file, returning the URL on success.
 * Validates size and duration. Tries Blossom first, falls back to nostr.build.
 * Throws on failure.
 */
export async function uploadVideo(ndk: NDK, file: File): Promise<string> {
  if (file.size > MAX_VIDEO_SIZE) {
    throw new Error('Video must be less than 50MB');
  }

  // Validate video duration
  try {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const objectUrl = URL.createObjectURL(file);

    try {
      const duration = await new Promise<number>((resolve, reject) => {
        video.onloadedmetadata = () => resolve(video.duration);
        video.onerror = () => reject(new Error('Failed to load video metadata'));
        video.src = objectUrl;
      });

      if (duration > 0 && duration > MAX_VIDEO_DURATION) {
        throw new Error('Video must be less than 60 seconds');
      }
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch (metaError) {
    // Re-throw validation errors, but ignore metadata read failures
    if (metaError instanceof Error && metaError.message.includes('less than')) {
      throw metaError;
    }
    console.warn('Could not read video metadata:', metaError);
  }

  if (ndk.signer) {
    try {
      const { fetchBlossomServers, uploadWithBlossom } = await import('./blossomUpload');
      const user = await ndk.signer.user();
      const servers = await fetchBlossomServers(ndk, user.pubkey);
      if (servers.length > 0) {
        return await uploadWithBlossom(ndk, file, servers);
      }
    } catch (e) {
      console.warn('[Upload] Blossom failed, falling back to nostr.build:', e);
    }
  }

  const body = new FormData();
  body.append('file[]', file);
  const result = await uploadToNostrBuild(ndk, body);

  if (result?.data?.[0]?.url) {
    return result.data[0].url;
  }
  throw new Error(result?.message || result?.error || 'Failed to upload video');
}
