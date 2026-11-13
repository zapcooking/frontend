/**
 * Go live — device-side helpers for the host page that carry no UI:
 * which platform this is, what a camera error means, the one-time 18+
 * confirmation, and the session kept across a reload.
 */
import type { HostSession } from './hostApi';

export type HostPlatform = 'ios' | 'android' | 'other';

export function detectPlatform(userAgent: string, maxTouchPoints = 0): HostPlatform {
  if (/android/i.test(userAgent)) return 'android';
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  if (/iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && maxTouchPoints > 1)) {
    return 'ios';
  }
  return 'other';
}

export type MediaProblem =
  /** The person, or the device's settings, refused camera or microphone access. */
  | 'blocked'
  /** No camera or microphone was found. */
  | 'not_found'
  /** Another app or tab is using the camera. */
  | 'in_use'
  /** This browser cannot capture at all (an in-app browser, or not a secure page). */
  | 'unsupported'
  | 'other';

/** What a getUserMedia failure means. `error` is whatever was thrown. */
export function classifyMediaError(error: unknown): MediaProblem {
  const name = (error as { name?: unknown } | null)?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'blocked';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'not_found';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'in_use';
    case 'TypeError':
      return 'unsupported';
    default:
      return 'other';
  }
}

/** The size asked of every camera, front or rear, so a flip keeps the same picture. */
export const CAMERA_SIZE = { width: { ideal: 1280 }, height: { ideal: 720 } } as const;

/**
 * The video constraints to try, in order, for one camera.
 *
 * First the camera is REQUIRED (`exact`): on an iPhone a mere preference
 * for the rear camera can still open the front one. If the device has no
 * such camera (a laptop has no rear camera) that request fails, and the
 * second one asks for it only as a preference, which opens whatever
 * camera there is.
 */
export function cameraAttempts(which: 'environment' | 'user'): MediaTrackConstraints[] {
  return [
    { facingMode: { exact: which }, ...CAMERA_SIZE },
    { facingMode: which, ...CAMERA_SIZE }
  ];
}

/** True when a failed camera request is worth repeating with looser constraints. */
export function isConstraintFailure(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return (
    name === 'OverconstrainedError' || name === 'NotFoundError' || name === 'DevicesNotFoundError'
  );
}

export interface MediaHelp {
  title: string;
  /** What to change, one step per entry. Empty when there is nothing to change. */
  steps: string[];
}

/** What to tell the host, and what to change, for a camera or microphone problem. */
export function mediaHelp(problem: MediaProblem, platform: HostPlatform): MediaHelp {
  if (problem === 'blocked') {
    if (platform === 'ios') {
      return {
        title: 'Camera or microphone access is blocked',
        steps: [
          'Open the Settings app and go to Apps, then Safari (or the browser you are using).',
          'Under Camera and under Microphone, choose Ask or Allow.',
          'If you use Chrome, also check Settings, Apps, Chrome: turn on Camera and Microphone.',
          'Come back here and reload this page, then allow access when asked.'
        ]
      };
    }
    if (platform === 'android') {
      return {
        title: 'Camera or microphone access is blocked',
        steps: [
          'Tap the icon at the left of the address bar, then Permissions.',
          'Set Camera and Microphone to Allow.',
          'If they are still blocked: open Android Settings, Apps, Chrome, Permissions, and allow Camera and Microphone.',
          'Come back here and reload this page.'
        ]
      };
    }
    return {
      title: 'Camera or microphone access is blocked',
      steps: [
        'Click the icon at the left of the address bar and allow Camera and Microphone for this site.',
        'Check that your system settings let this browser use the camera and microphone.',
        'Reload this page.'
      ]
    };
  }
  if (problem === 'not_found') {
    return {
      title: 'No camera or microphone was found',
      steps: ['Connect a camera and microphone, then reload this page.']
    };
  }
  if (problem === 'in_use') {
    return {
      title: 'The camera is being used by something else',
      steps: ['Close other apps or tabs that are using the camera, then try again.']
    };
  }
  if (problem === 'unsupported') {
    return {
      title: 'This browser cannot use the camera',
      steps: [
        platform === 'ios'
          ? 'Open this page in Safari: use the share or menu button and choose Open in Safari.'
          : platform === 'android'
            ? 'Open this page in Chrome: use the menu and choose Open in Chrome.'
            : 'Open this page in a current version of Safari, Chrome or Firefox.'
      ]
    };
  }
  return { title: 'The camera could not be started', steps: ['Reload this page and try again.'] };
}

// ── One-time 18+ confirmation ───────────────────────────────────────
//
// Hosts must be 18 or older (Terms). The host confirms once, the first
// time they go live on a device; the confirmation is remembered on that
// device, per account. It is a statement by the host, not age verification.

const AGE_KEY_PREFIX = 'zc_live_host_18_confirmed:';

type KeyValue = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function safely<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function hasConfirmedAge(pubkey: string, storage: KeyValue | undefined): boolean {
  if (!pubkey || !storage) return false;
  return safely(() => storage.getItem(AGE_KEY_PREFIX + pubkey) !== null, false);
}

/** Remember the confirmation. Returns false when it could not be stored. */
export function rememberAgeConfirmed(
  pubkey: string,
  storage: KeyValue | undefined,
  now = Date.now()
): boolean {
  if (!pubkey || !storage) return false;
  return safely(() => {
    storage.setItem(AGE_KEY_PREFIX + pubkey, new Date(now).toISOString());
    return true;
  }, false);
}

// ── The session, kept across a reload ───────────────────────────────
//
// sessionStorage: it lasts as long as the tab, is not shared with other
// tabs, and is gone when the tab closes. The host token is never put in
// a URL or in localStorage.

const SESSION_KEY = 'zc_live_host_session';

export interface StoredHostSession extends HostSession {
  pubkey: string;
  title: string;
  attempts: number;
}

export function loadStoredSession(
  storage: KeyValue | undefined,
  pubkey: string
): StoredHostSession | null {
  if (!storage) return null;
  return safely(() => {
    const raw = storage.getItem(SESSION_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StoredHostSession>;
    if (
      typeof v.id !== 'string' ||
      !/^[0-9a-f]{32}$/.test(v.id) ||
      typeof v.token !== 'string' ||
      !/^[0-9a-f]{64}$/.test(v.token) ||
      v.pubkey !== pubkey
    ) {
      return null;
    }
    return {
      id: v.id,
      token: v.token,
      pubkey,
      title: typeof v.title === 'string' ? v.title : '',
      attempts: typeof v.attempts === 'number' && v.attempts >= 0 ? Math.floor(v.attempts) : 0
    };
  }, null);
}

export function storeSession(storage: KeyValue | undefined, session: StoredHostSession): void {
  if (!storage) return;
  safely(() => storage.setItem(SESSION_KEY, JSON.stringify(session)), undefined);
}

export function clearStoredSession(storage: KeyValue | undefined): void {
  if (!storage) return;
  safely(() => storage.removeItem(SESSION_KEY), undefined);
}

/** The address `<kind>:<pubkey>:<d>` and title handed over from a recipe page, if well formed. */
export function readRecipeHandoff(
  params: URLSearchParams
): { recipeA: string; title: string } | null {
  const a = params.get('a') ?? '';
  if (!/^(30023|35000):[0-9a-f]{64}:.{1,200}$/.test(a)) return null;
  const title = (params.get('title') ?? '').trim().slice(0, 120);
  return { recipeA: a, title: title || 'Live cook-along' };
}
