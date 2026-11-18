/**
 * Whether the "Watch live on Zap Cooking: <link>" chat message may keep
 * repeating for a stream.
 *
 * The repeat is a new signature every 15 minutes. A signer that answers
 * at once (a key on this device, an extension that was told to always
 * allow) does it unseen. One that takes a while is asking the host to
 * approve each one, or is far away: the host is cooking, and must not be
 * interrupted every 15 minutes. So every watch-message signature is
 * timed, and the first one that takes longer than `WATCH_SIGN_FAST_MS`,
 * or fails, stops the repeats for that stream. The pinned message and
 * the announcement's own link are not affected.
 */

export const WATCH_SIGN_FAST_MS = 1500;

export class WatchRepeatGate {
  private stopped: string | null = null;

  constructor(private readonly limitMs = WATCH_SIGN_FAST_MS) {}

  /** May this stream sign another watch-link message? */
  allows(sessionId: string): boolean {
    return this.stopped !== sessionId;
  }

  /**
   * Run one watch-message signature for a stream. Repeats stop as soon
   * as it has been pending longer than the limit (not only once it
   * answers: a request left waiting must not be joined by another), and
   * when it fails. The signature's own result or error is passed on.
   */
  async timed<T>(sessionId: string, sign: () => Promise<T>): Promise<T> {
    const slow = setTimeout(() => {
      this.stopped = sessionId;
    }, this.limitMs);
    try {
      return await sign();
    } catch (err) {
      this.stopped = sessionId;
      throw err;
    } finally {
      clearTimeout(slow);
    }
  }
}
