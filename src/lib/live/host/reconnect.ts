/**
 * Go live — when the host page republishes.
 *
 * A phone's connection does not always come back by itself (an iPhone was
 * left `failed` after a ten-second drop in testing; Android recovered).
 * This decides, from connection events and publish results, when to
 * publish again, and when to stop. It owns no network or camera code: the
 * page gives it two callbacks and a timer, which is what makes it testable.
 *
 * Rules:
 *  - `disconnected`: wait RECOVERY_GRACE_MS for the connection to recover
 *    by itself. If it has not, republish.
 *  - `failed`: it will not recover. Republish after a short pause.
 *  - A publish that fails with "try again" is retried with backoff:
 *    1 s, 2 s, 4 s, 8 s, then 15 s between attempts.
 *  - Coming back online skips the rest of any wait.
 *  - `connected` cancels any pending republish and resets the backoff.
 *  - Every republish uses one of the session's publish attempts on the
 *    server. This stops at `maxAttempts`, kept below the server's cap so
 *    the page stops itself cleanly instead of being refused.
 */
import { LIVE_MAX_PUBLISH_ATTEMPTS } from '../config';
import type { PublishFailure } from './hostApi';

/** How long a `disconnected` connection is given to recover by itself. */
export const RECOVERY_GRACE_MS = 5000;
/** Pause before republishing after `failed`, or after coming back online. */
export const QUICK_RETRY_MS = 500;
/** Waits between consecutive failed publish attempts. */
export const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000] as const;
/** Attempts the page allows itself: a margin below the server's cap. */
export const HOST_MAX_ATTEMPTS = LIVE_MAX_PUBLISH_ATTEMPTS - 4;

export function backoffDelayMs(failuresInARow: number): number {
  const i = Math.max(0, Math.min(failuresInARow, BACKOFF_MS.length - 1));
  return BACKOFF_MS[i];
}

export type StopReason = 'ended' | 'off' | 'limit' | 'auth';

export interface ReconnectDeps {
  /** Start a publish now. The page calls `publishStarted()` when it does. */
  republish: () => void;
  /** Stop for good, for this reason. */
  stop: (reason: StopReason) => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  maxAttempts?: number;
}

export class ReconnectPolicy {
  private timer: unknown = null;
  private timerDueAt = 0;
  private failuresInARow = 0;
  private attempts = 0;
  private stopped = false;
  private publishing = false;
  private readonly maxAttempts: number;

  constructor(
    private readonly deps: ReconnectDeps,
    private readonly now: () => number = () => Date.now()
  ) {
    this.maxAttempts = deps.maxAttempts ?? HOST_MAX_ATTEMPTS;
  }

  /** Publish attempts made so far in this session, the first Go live included. */
  get attemptsUsed(): number {
    return this.attempts;
  }

  /** True while a republish is scheduled or in flight: the page shows "Reconnecting…". */
  get waiting(): boolean {
    return !this.stopped && (this.timer !== null || this.publishing);
  }

  /** Carry over attempts already used (a session resumed after a reload). */
  seedAttempts(used: number): void {
    this.attempts = Math.max(this.attempts, used);
  }

  /** The page is starting a publish (the first one, or a republish). */
  publishStarted(): void {
    this.cancelTimer();
    this.publishing = true;
    this.attempts++;
  }

  /** The publish handshake succeeded. Media may still take a moment to connect. */
  publishSucceeded(): void {
    this.publishing = false;
  }

  publishFailed(failure: PublishFailure): void {
    this.publishing = false;
    if (this.stopped) return;
    if (failure === 'ended' || failure === 'off' || failure === 'limit' || failure === 'auth') {
      this.stopNow(failure);
      return;
    }
    // 'retry' and 'rejected': try again, more slowly each time.
    this.schedule(backoffDelayMs(this.failuresInARow));
    this.failuresInARow++;
  }

  /** The peer connection reports `connected`. */
  connected(): void {
    this.cancelTimer();
    this.failuresInARow = 0;
  }

  /** The peer connection reports `disconnected`: it may recover by itself. */
  disconnected(): void {
    if (this.stopped || this.publishing || this.timer !== null) return;
    this.schedule(RECOVERY_GRACE_MS);
  }

  /** The peer connection reports `failed`: it will not recover by itself. */
  failed(): void {
    if (this.stopped || this.publishing) return;
    this.schedule(QUICK_RETRY_MS, true);
  }

  /** The device came back online: do not sit out the rest of a wait. */
  online(): void {
    if (this.stopped || this.publishing || this.timer === null) return;
    this.schedule(QUICK_RETRY_MS, true);
  }

  /** The session is over (ended by the host, the server or an admin). */
  shutdown(): void {
    this.stopped = true;
    this.publishing = false;
    this.cancelTimer();
  }

  private schedule(ms: number, onlyIfSooner = false): void {
    const due = this.now() + ms;
    if (this.timer !== null) {
      if (onlyIfSooner && due >= this.timerDueAt) return;
      this.cancelTimer();
    }
    this.timerDueAt = due;
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      if (this.stopped) return;
      if (this.attempts >= this.maxAttempts) {
        this.stopNow('limit');
        return;
      }
      this.deps.republish();
    }, ms);
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
  }

  private stopNow(reason: StopReason): void {
    this.shutdown();
    this.deps.stop(reason);
  }
}
