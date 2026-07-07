/**
 * Google Identity Services (GIS) — web port of the Android GoogleSignInManager.
 *
 * PARITY: identity is the ID-token `sub` claim, decoded byte-for-byte the same
 * way Android's GoogleSignInManager.extractSubFromJwt does (base64url segment[1]
 * → JSON → `sub`, NOT the email / `credential.id`). If web and Android disagree
 * on `sub`, the per-account salt diverges and no backup cross-decrypts — see
 * googleBackupCrypto.ts. This is the single highest-risk parity point.
 *
 * We deliberately use TWO GIS surfaces (Approach A), mirroring Android's split
 * of a signed ID token (identity) from a separate OAuth authorization (Drive):
 *   1. google.accounts.id — renders the Sign In With Google button, whose
 *      callback delivers a real JWT credential we decode for `sub`.
 *   2. google.accounts.oauth2 token client — requests the drive.appdata access
 *      token. It returns NO id_token, which is exactly why step 1 is separate.
 * Two Google prompts on web is the accepted cost of reproducing Android's
 * `sub` extraction verbatim.
 *
 * Client ID comes ONLY from PUBLIC_GOOGLE_WEB_CLIENT_ID and must equal the same
 * web OAuth client Android passes as its serverClientId (shared Cloud project ⇒
 * shared appDataFolder). Never hardcode it.
 */

import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

// Minimal ambient typings for the slice of GIS we use. Kept local (not global)
// to avoid colliding with any future @types/google.accounts.
interface GisCredentialResponse {
  credential: string; // JWT ID token
}
interface GisTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}
interface GisTokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}
interface GoogleAccounts {
  id: {
    initialize(config: {
      client_id: string;
      callback: (res: GisCredentialResponse) => void;
      auto_select?: boolean;
      cancel_on_tap_outside?: boolean;
      use_fedcm_for_prompt?: boolean;
    }): void;
    renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
    cancel(): void;
  };
  oauth2: {
    initTokenClient(config: {
      client_id: string;
      scope: string;
      callback: (res: GisTokenResponse) => void;
      error_callback?: (err: { type?: string; message?: string }) => void;
    }): GisTokenClient;
  };
}

function googleAccounts(): GoogleAccounts | undefined {
  return (window as unknown as { google?: { accounts?: GoogleAccounts } }).google?.accounts;
}

/** Read PUBLIC_GOOGLE_WEB_CLIENT_ID, or throw a clear, actionable error. */
export function getWebClientId(): string {
  const id = env.PUBLIC_GOOGLE_WEB_CLIENT_ID;
  if (!id) {
    throw new Error(
      'Google backup is not configured: PUBLIC_GOOGLE_WEB_CLIENT_ID is unset. ' +
        'Set it to the same web OAuth client ID the Android app uses.'
    );
  }
  return id;
}

let gisLoadPromise: Promise<void> | null = null;

/** Inject the GIS client script once; resolve when window.google.accounts exists. */
export function loadGoogleIdentityServices(): Promise<void> {
  if (!browser) return Promise.reject(new Error('Browser environment required'));
  if (googleAccounts()) return Promise.resolve();
  if (gisLoadPromise) return gisLoadPromise;

  gisLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    const onReady = () => {
      if (googleAccounts()) resolve();
      else
        reject(new Error('Google Identity Services loaded but window.google.accounts is missing'));
    };
    if (existing) {
      existing.addEventListener('load', onReady, { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('Failed to load Google Identity Services')),
        {
          once: true
        }
      );
      // Script tag may already be loaded from a prior attempt.
      if (googleAccounts()) resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = onReady;
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
  // Let a failed load be retried on a later call.
  gisLoadPromise.catch(() => {
    gisLoadPromise = null;
  });
  return gisLoadPromise;
}

/**
 * Decode the `sub` claim from a JWT ID token — the byte-for-byte web equivalent
 * of Android's extractSubFromJwt (base64url, no padding, UTF-8, JSON `sub`).
 * We only DECODE the token; Google already validated its signature.
 */
export function decodeJwtSub(idToken: string): string {
  const parts = idToken.split('.');
  if (parts.length < 2) {
    throw new Error('Malformed ID token: expected at least two JWT segments');
  }
  let payloadJson: string;
  try {
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    payloadJson = new TextDecoder().decode(bytes);
  } catch {
    throw new Error('Malformed ID token payload encoding');
  }
  let sub: unknown;
  try {
    sub = JSON.parse(payloadJson).sub;
  } catch {
    throw new Error('ID token payload is not valid JSON');
  }
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new Error('ID token missing sub claim');
  }
  return sub;
}

/**
 * Render the Sign In With Google button into `container` and resolve with the
 * decoded `sub` (plus the raw idToken) once the user completes the credential
 * flow. Rendering the official button is the reliable client-only way to obtain
 * a JWT on demand (One Tap / prompt() can be silently suppressed by FedCM).
 */
export function getGoogleIdentity(
  container: HTMLElement
): Promise<{ sub: string; idToken: string }> {
  return loadGoogleIdentityServices().then(
    () =>
      new Promise<{ sub: string; idToken: string }>((resolve, reject) => {
        const accounts = googleAccounts();
        if (!accounts) {
          reject(new Error('Google Identity Services unavailable'));
          return;
        }
        const clientId = getWebClientId();
        accounts.id.initialize({
          client_id: clientId,
          cancel_on_tap_outside: false,
          use_fedcm_for_prompt: true,
          callback: (res: GisCredentialResponse) => {
            try {
              const sub = decodeJwtSub(res.credential);
              // Raw-sub logging for the cross-device parity test — DEV ONLY.
              // `sub` is a stable per-account identifier, so it must never reach
              // production logs; in dev, eyeball it against Android's logged
              // `sub` — they MUST match.
              if (import.meta.env.DEV) {
                console.log('[GoogleBackup] Google sub (verify parity with Android):', sub);
              }
              resolve({ sub, idToken: res.credential });
            } catch (e) {
              reject(e instanceof Error ? e : new Error('Failed to decode Google identity'));
            }
          }
        });
        container.replaceChildren();
        accounts.id.renderButton(container, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          logo_alignment: 'left',
          width: 280
        });
      })
  );
}

/**
 * Request an OAuth access token scoped to drive.appdata via the GIS token
 * client. Separate popup from getGoogleIdentity (see file header). Returns the
 * access token string used as the Bearer for Drive REST calls.
 *
 * ⚠️ iOS-CRITICAL: this MUST be invoked synchronously inside a user-gesture
 * handler (a real tap), with NO `await`/`.then` between the tap and this call.
 * The token client opens a popup via window.open, and mobile Safari blocks any
 * popup opened after an async gap ("Failed to open popup window"). We therefore
 * do NOT await loadGoogleIdentityServices() here — GIS must already be loaded
 * (getGoogleIdentity loads it during the identity step). The Promise executor
 * below runs synchronously when the Promise is constructed, so requestAccessToken
 * fires in the same tick as the caller's tap. `await requestDriveAccessToken()`
 * is safe because the call expression is evaluated (opening the popup) before
 * the await suspends.
 */
export function requestDriveAccessToken(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const accounts = googleAccounts();
    if (!accounts) {
      reject(
        new Error('Google Identity Services is not loaded yet. Please sign in with Google first.')
      );
      return;
    }
    const clientId = getWebClientId();
    let settled = false;
    const client = accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_APPDATA_SCOPE,
      callback: (res: GisTokenResponse) => {
        if (settled) return;
        settled = true;
        if (res.access_token) {
          resolve(res.access_token);
        } else {
          reject(
            new Error(
              res.error_description || res.error || 'Google did not return a Drive access token'
            )
          );
        }
      },
      error_callback: (err) => {
        if (settled) return;
        settled = true;
        reject(new Error(err.message || err.type || 'Google authorization was cancelled'));
      }
    });
    // Synchronous — opens the consent popup in the caller's gesture (see above).
    client.requestAccessToken();
  });
}
