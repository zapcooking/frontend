/**
 * Go live — the "watching now" counter for one session.
 *
 * Runs inside the session's Durable Object (workers/live-presence). The
 * object also keeps each code in its own storage until it expires, so a
 * restart does not empty the count (see `restore`). Pure and clock-
 * injected so it can be tested without the Workers runtime.
 *
 * A watch page sends a heartbeat about every 30 s while its tab is
 * visible, carrying a random code made fresh on every page load. The
 * count is the number of distinct codes heard in the last WINDOW_MS. A
 * code that goes quiet simply drops out; there is no "leave" message.
 *
 * Rate limit. Heartbeats are limited per source (a salted hash of the
 * sender's address that the Durable Object makes and keeps in memory for
 * one window). A source may send `beatsPerWindow` heartbeats and introduce
 * `newCodesPerWindow` codes per window. The source is never linked to a
 * code: the counter keeps two numbers per source, not which codes it sent.
 * `maxCodes` bounds memory for the whole session.
 */

export interface PresenceLimits {
  /** A code not heard for this long no longer counts. */
  windowMs: number;
  /** Heartbeats one source may send per window. */
  beatsPerWindow: number;
  /** New codes one source may introduce per window. */
  newCodesPerWindow: number;
  /** Codes held at once, all sources. Past it new codes are not counted. */
  maxCodes: number;
}

/**
 * At a 30 s heartbeat, one address can carry about 30 viewers (60 beats)
 * and bring 20 new ones a minute: enough for a household or a small
 * office behind one address, while one script cannot pad the count by
 * more than 20 a minute from one address.
 */
export const DEFAULT_PRESENCE_LIMITS: PresenceLimits = {
  windowMs: 60_000,
  beatsPerWindow: 60,
  newCodesPerWindow: 20,
  maxCodes: 10_000
};

/** A heartbeat code: 32 lowercase hex characters (128 random bits). */
export const HEARTBEAT_CODE_RE = /^[0-9a-f]{32}$/;

export function isHeartbeatCode(value: unknown): value is string {
  return typeof value === 'string' && HEARTBEAT_CODE_RE.test(value);
}

export type BeatResult =
  | {
      ok: true;
      /** Distinct codes heard in the window, this one included when counted. */
      watching: number;
      /** The highest `watching` this object has seen. */
      peak: number;
      /** This beat raised the peak. */
      newPeak: boolean;
    }
  | { ok: false; reason: 'rate_limited' };

interface Bucket {
  start: number;
  beats: number;
  newCodes: number;
}

export class PresenceCounter {
  /** code → last heard (ms). */
  private codes = new Map<string, number>();
  /** source → counters for its current window. */
  private buckets = new Map<string, Bucket>();
  private peakSeen = 0;

  constructor(private readonly limits: PresenceLimits = DEFAULT_PRESENCE_LIMITS) {}

  /**
   * Drop codes and buckets older than one window. Runs on every call, so
   * an expired code never counts toward `watching`, the peak or maxCodes.
   */
  private prune(now: number): void {
    const cutoff = now - this.limits.windowMs;
    for (const [code, seen] of this.codes) if (seen <= cutoff) this.codes.delete(code);
    for (const [source, b] of this.buckets) if (b.start <= cutoff) this.buckets.delete(source);
  }

  beat(code: string, source: string, now: number): BeatResult {
    this.prune(now);
    let bucket = this.buckets.get(source);
    if (!bucket || now - bucket.start >= this.limits.windowMs) {
      bucket = { start: now, beats: 0, newCodes: 0 };
      this.buckets.set(source, bucket);
    }
    if (bucket.beats >= this.limits.beatsPerWindow) return { ok: false, reason: 'rate_limited' };
    bucket.beats++;

    const seen = this.codes.get(code);
    const known = seen !== undefined && seen > now - this.limits.windowMs;
    if (!known) {
      if (bucket.newCodes >= this.limits.newCodesPerWindow) {
        return { ok: false, reason: 'rate_limited' };
      }
      if (this.codes.size >= this.limits.maxCodes) {
        // Full: answer with the count, but this code is not added.
        return { ok: true, watching: this.codes.size, peak: this.peakSeen, newPeak: false };
      }
      bucket.newCodes++;
    }
    this.codes.set(code, now);
    const watching = this.codes.size;
    const newPeak = watching > this.peakSeen;
    if (newPeak) this.peakSeen = watching;
    return { ok: true, watching, peak: this.peakSeen, newPeak };
  }

  /**
   * Put back a code heard at `seen` (ms), after the object restarted.
   * Ignored when already expired, or when the session is full.
   */
  restore(code: string, seen: number, now: number): void {
    if (!isHeartbeatCode(code) || !Number.isFinite(seen)) return;
    if (seen <= now - this.limits.windowMs || this.codes.size >= this.limits.maxCodes) return;
    const held = this.codes.get(code);
    if (held === undefined || held < seen) this.codes.set(code, seen);
  }

  /** Put back the peak after a restart (it never moves down). */
  restorePeak(peak: number): void {
    if (Number.isSafeInteger(peak) && peak > this.peakSeen) this.peakSeen = peak;
  }

  /** Whether this code is currently counted. */
  has(code: string): boolean {
    return this.codes.has(code);
  }

  /** The highest count seen. */
  get peak(): number {
    return this.peakSeen;
  }

  /** The window length (ms). */
  get windowMs(): number {
    return this.limits.windowMs;
  }

  /** Distinct codes heard in the last window. */
  watching(now: number): number {
    this.prune(now);
    const cutoff = now - this.limits.windowMs;
    let n = 0;
    for (const seen of this.codes.values()) if (seen > cutoff) n++;
    return n;
  }
}
