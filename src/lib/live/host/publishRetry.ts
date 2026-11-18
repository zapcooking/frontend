/**
 * Publish one already-signed event, trying again when no relay took it.
 *
 * For the "ended" announcement at the end of a stream: it is the one
 * event that takes the LIVE card away in other Nostr apps, so a relay
 * hiccup must not lose it. Every try sends the SAME signed event, so the
 * host's signer is asked once however many tries it takes.
 */

export const PUBLISH_TRY_TIMEOUT_MS = 10_000;
/** Waits before the second and third try. Two retries in all. */
export const PUBLISH_RETRY_DELAYS_MS: readonly number[] = [2000, 5000];

export interface PublishRetryOptions {
  timeoutMs?: number;
  delaysMs?: readonly number[];
  /** Injectable for tests. */
  wait?: (ms: number) => Promise<void>;
}

/**
 * Run `publish` until it succeeds, at most `delaysMs.length + 1` times.
 * A try fails when it rejects (no relay accepted) or takes longer than
 * `timeoutMs`. Returns the number of tries it took, or 0 when all failed.
 * Never throws.
 */
export async function publishWithRetry(
  publish: () => Promise<unknown>,
  opts: PublishRetryOptions = {}
): Promise<number> {
  const timeoutMs = opts.timeoutMs ?? PUBLISH_TRY_TIMEOUT_MS;
  const delays = opts.delaysMs ?? PUBLISH_RETRY_DELAYS_MS;
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; attempt <= delays.length + 1; attempt++) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        // Inside a promise, so a publish that throws at once is a failed try.
        Promise.resolve().then(publish),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        })
      ]);
      return attempt;
    } catch {
      if (attempt <= delays.length) await wait(delays[attempt - 1]);
    } finally {
      clearTimeout(timer);
    }
  }
  return 0;
}
