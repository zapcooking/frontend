/**
 * Go live — sharing the host's screen instead of the camera.
 *
 * The broadcast keeps ONE video track and ONE audio track for its whole
 * life. Sharing swaps the video track (RTCRtpSender.replaceTrack) and,
 * when the browser offers tab or system audio, swaps the audio track for
 * a mix of that audio and the host's microphone. Nothing is renegotiated
 * and nothing is republished, so the session, the Cloudflare input and
 * every viewer's connection stay as they are.
 *
 * Desktop only: phones and tablets either have no getDisplayMedia or
 * cannot use it from a web page.
 */
import type { HostPlatform } from './hostDevice';

export interface ShareSupport {
  platform: HostPlatform;
  /** `typeof navigator.mediaDevices?.getDisplayMedia === 'function'` */
  hasGetDisplayMedia: boolean;
  /** `matchMedia('(any-pointer: fine)').matches`: a mouse or trackpad. */
  finePointer: boolean;
}

/**
 * Whether to show "Share screen". Needs the API, a desktop platform, and
 * a mouse or trackpad (a phone asking for the desktop site reports a
 * desktop user agent but still has only a touch screen).
 */
export function canShareScreen(s: ShareSupport): boolean {
  return s.hasGetDisplayMedia && s.platform === 'other' && s.finePointer;
}

/** The largest picture asked for: bigger screens are scaled down, which also keeps text readable on phones. */
const SCREEN_VIDEO = {
  width: { max: 1920 },
  height: { max: 1080 },
  frameRate: { max: 30 }
} as const;

/**
 * The getDisplayMedia requests to try, in order. The first carries
 * Chrome's picker hints (other browsers ignore unknown members):
 *  - selfBrowserSurface 'exclude': this tab is not offered, so the host
 *    cannot share the page that shows their own preview (an endless
 *    mirror).
 *  - surfaceSwitching 'include': "Share this tab instead" in Chrome's bar.
 *  - systemAudio 'include': offer system audio where the OS allows it.
 * If a browser rejects the request itself (not the person), the later
 * ones ask for less.
 */
export function displayMediaAttempts(): DisplayMediaStreamOptions[] {
  return [
    {
      video: { ...SCREEN_VIDEO },
      audio: true,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      systemAudio: 'include',
      preferCurrentTab: false
    } as DisplayMediaStreamOptions,
    { video: true, audio: true },
    { video: true }
  ];
}

export type ShareProblem =
  /** The person closed the picker or chose Cancel. Say nothing. */
  | 'cancelled'
  /** macOS (or another OS) does not let this browser record the screen. */
  | 'system_blocked'
  /** This request shape was refused by the browser: try the next one. */
  | 'retry'
  | 'other';

export function classifyShareError(error: unknown): ShareProblem {
  const e = error as { name?: unknown; message?: unknown } | null;
  const name = e?.name;
  const message = typeof e?.message === 'string' ? e.message : '';
  if (name === 'NotAllowedError') {
    // Chrome: "Permission denied by system" when macOS Screen Recording is off.
    return /system/i.test(message) ? 'system_blocked' : 'cancelled';
  }
  if (name === 'AbortError') return 'cancelled';
  if (name === 'TypeError' || name === 'OverconstrainedError' || name === 'NotSupportedError') {
    return 'retry';
  }
  return 'other';
}

/** What to tell the host when sharing could not start. Null: nothing to say. */
export function shareProblemMessage(problem: ShareProblem): string | null {
  if (problem === 'cancelled') return null;
  if (problem === 'system_blocked') {
    return 'Your computer is not letting this browser share the screen. On a Mac, open System Settings, Privacy & Security, Screen & System Audio Recording, turn on your browser, then reopen it.';
  }
  return "Your screen couldn't be shared. Please try again.";
}

/**
 * The banner's second line. A whole screen shows everything on it,
 * notifications included, so that gets a stronger line than a window.
 */
export function shareHint(displaySurface: string | undefined): string {
  if (displaySurface === 'monitor') {
    return 'Viewers see your whole screen, including notifications. Sharing one window or tab is safer.';
  }
  return 'Share one window or tab, not your whole screen.';
}

export interface AudioMix {
  /** The mixed track to send in place of the microphone. */
  track: MediaStreamTrack;
  close(): void;
}

type AudioContextCtor = new () => AudioContext;

/**
 * Mix several audio tracks (the microphone and the shared tab's audio)
 * into one. One track keeps the connection's single audio sender, so no
 * renegotiation. Null when Web Audio is unavailable: the caller keeps
 * the microphone alone.
 */
export function mixAudio(tracks: MediaStreamTrack[], Ctx?: AudioContextCtor): AudioMix | null {
  const Ctor =
    Ctx ??
    (typeof window !== 'undefined'
      ? ((window.AudioContext ??
          (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext) as
          AudioContextCtor | undefined)
      : undefined);
  if (!Ctor) return null;
  try {
    const ctx = new Ctor();
    const out = ctx.createMediaStreamDestination();
    for (const t of tracks) ctx.createMediaStreamSource(new MediaStream([t])).connect(out);
    // Created after an await, a context can start suspended.
    void ctx.resume().catch(() => undefined);
    const track = out.stream.getAudioTracks()[0];
    if (!track) {
      void ctx.close().catch(() => undefined);
      return null;
    }
    return {
      track,
      close() {
        track.stop();
        void ctx.close().catch(() => undefined);
      }
    };
  } catch {
    return null;
  }
}
