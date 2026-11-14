/**
 * Go live — when the viewer rejoins.
 *
 * The browser is not told when a broadcast goes away or is replaced: the
 * connection stays "connected" while video stops. So the player watches
 * the frames it decodes, and this decides what to do about it. It owns no
 * network or video code, which is what makes it testable.
 *
 * Rules (from the PR 1.3 and PR 2 gates):
 *  - No picture within 8 s of a join: rejoin. (A join can land on an input
 *    the host is just replacing and never receive video.)
 *  - Video that was flowing stalls for 4 s: rejoin.
 *  - Never rejoin from a hidden tab. Browsers pause background video, which
 *    looks like a stall, and every guest rejoin can cost a slot. A rejoin
 *    that comes due while hidden waits until the tab is visible again.
 *  - "Not live yet" and network or Cloudflare failures: try again after
 *    2, 4, 8, then 15 s.
 *  - Ended, switched off, or full: stop for good.
 *  - At most MAX_ATTEMPTS joins, then give up ("unavailable").
 */
import type { JoinFailure } from './joinClient';

export const NO_PICTURE_MS = 8000;
export const STALL_MS = 4000;
export const RETRY_MS = [2000, 4000, 8000, 15000] as const;
export const MAX_ATTEMPTS = 60;

export type WatchStop = 'ended' | 'off' | 'full' | 'gave_up';

export interface WatchDeps {
  /** Start a new join now. The player calls `joinStarted()` when it does. */
  rejoin: (reason: 'no_picture' | 'stalled' | 'retry') => void;
  stop: (reason: WatchStop) => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

export function retryDelayMs(failuresInARow: number): number {
  return RETRY_MS[Math.max(0, Math.min(failuresInARow, RETRY_MS.length - 1))];
}

export class WatchPolicy {
  private timer: unknown = null;
  private attempts = 0;
  private failuresInARow = 0;
  private joining = false;
  private watching = false;
  private stopped = false;
  private hidden = false;
  /** A rejoin came due while hidden. */
  private pending: 'no_picture' | 'stalled' | 'retry' | null = null;
  private joinedAt = 0;
  private sawFrame = false;
  private lastFrames = -1;
  private lastChange = 0;

  constructor(
    private readonly deps: WatchDeps,
    private readonly now: () => number = () => Date.now()
  ) {}

  get attemptsUsed(): number {
    return this.attempts;
  }

  joinStarted(): void {
    this.cancelTimer();
    this.joining = true;
    this.watching = false;
    this.attempts++;
  }

  joinSucceeded(): void {
    this.joining = false;
    this.watching = true;
    this.joinedAt = this.now();
    this.sawFrame = false;
    this.lastFrames = -1;
    this.lastChange = this.joinedAt;
  }

  joinFailed(failure: JoinFailure): void {
    this.joining = false;
    this.watching = false;
    if (this.stopped) return;
    if (failure === 'ended' || failure === 'off' || failure === 'full') {
      this.stopNow(failure);
      return;
    }
    const wait = retryDelayMs(this.failuresInARow);
    this.failuresInARow++;
    this.schedule('retry', wait);
  }

  /** Called about once a second with the decoded-frame count. */
  frames(count: number): void {
    if (this.stopped || this.joining || !this.watching) return;
    const t = this.now();
    if (count !== this.lastFrames) {
      if (count > 0) this.sawFrame = true;
      this.lastFrames = count;
      this.lastChange = t;
      if (this.sawFrame) this.failuresInARow = 0;
      return;
    }
    if (this.hidden) return; // judged again when visible
    if (!this.sawFrame && t - this.joinedAt >= NO_PICTURE_MS) this.due('no_picture');
    else if (this.sawFrame && t - this.lastChange >= STALL_MS) this.due('stalled');
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden || this.stopped) return;
    if (this.pending) {
      const reason = this.pending;
      this.pending = null;
      this.schedule(reason, 0);
      return;
    }
    // Back in view: give the video a fresh grace period instead of
    // treating the time spent hidden as a stall.
    const t = this.now();
    this.lastChange = t;
    if (!this.sawFrame) this.joinedAt = t;
  }

  shutdown(): void {
    this.stopped = true;
    this.joining = false;
    this.watching = false;
    this.pending = null;
    this.cancelTimer();
  }

  private due(reason: 'no_picture' | 'stalled'): void {
    this.watching = false;
    this.schedule(reason, 0);
  }

  private schedule(reason: 'no_picture' | 'stalled' | 'retry', ms: number): void {
    this.cancelTimer();
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      if (this.stopped) return;
      if (this.hidden) {
        this.pending = reason;
        return;
      }
      if (this.attempts >= MAX_ATTEMPTS) {
        this.stopNow('gave_up');
        return;
      }
      this.deps.rejoin(reason);
    }, ms);
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
  }

  private stopNow(reason: WatchStop): void {
    this.shutdown();
    this.deps.stop(reason);
  }
}
