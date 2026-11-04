/**
 * The "PLATED" stamp: the cook's just-published photo on a plate, stamped,
 * for a moment after a successful publish. Decoration only — the success
 * toast stays the announcement.
 */
import { platedImage, type PlatedEventLike } from './plated';

/** Everything on screen, start to gone (stays under 1.5 s). */
export const PLATED_STAMP_MS = 1400;

/**
 * How long the photo may take to load before the stamp is skipped. A stamp
 * that turns up seconds after the "Plated!" toast reads as a glitch, not a
 * celebration.
 */
export const PLATED_STAMP_LOAD_MS = 2500;

/** The published plate's photo, or null (no stamp without one). */
export function platedStampPhoto(event: PlatedEventLike | null | undefined): string | null {
  return event ? platedImage(event) : null;
}

export interface PlatedStampTimer {
  /** The photo loaded: show the stamp, then finish after PLATED_STAMP_MS. */
  loaded(): void;
  /** The photo failed: finish without ever showing. */
  failed(): void;
  /** Stop everything (unmount); neither callback fires afterwards. */
  cancel(): void;
}

/**
 * One stamp's lifecycle: wait for the photo (up to PLATED_STAMP_LOAD_MS),
 * show it, finish. `onDone` fires exactly once, whether or not it showed.
 */
export function platedStampTimer(onShow: () => void, onDone: () => void): PlatedStampTimer {
  let state: 'loading' | 'showing' | 'done' = 'loading';
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(finish, PLATED_STAMP_LOAD_MS);

  function clear() {
    if (timer) clearTimeout(timer);
    timer = null;
  }
  function finish() {
    if (state === 'done') return;
    clear();
    state = 'done';
    onDone();
  }

  return {
    loaded() {
      if (state !== 'loading') return;
      clear();
      state = 'showing';
      onShow();
      timer = setTimeout(finish, PLATED_STAMP_MS);
    },
    failed() {
      if (state === 'loading') finish();
    },
    cancel() {
      clear();
      state = 'done';
    }
  };
}
