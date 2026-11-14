/**
 * Helpers for the replay seek bar.
 */

/** `75` → `1:15`, `3725` → `1:02:05`. Anything not a finite, non-negative number reads as `0:00`. */
export function formatClock(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * A seek bar only makes sense for media with a known, finite length — a
 * replay. A live HLS playlist reports an infinite (or NaN) duration.
 */
export function isSeekableDuration(duration: number): boolean {
  return Number.isFinite(duration) && duration > 0;
}

/** Clamp a seek target into the playable range. */
export function clampSeek(target: number, duration: number): number {
  if (!Number.isFinite(target)) return 0;
  const max = isSeekableDuration(duration) ? duration : Infinity;
  return Math.min(Math.max(target, 0), max);
}

/** Percentage (0–100) of `value` within `max`, for the filled part of the track. */
export function percentOf(value: number, max: number): number {
  if (!isSeekableDuration(max) || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}
