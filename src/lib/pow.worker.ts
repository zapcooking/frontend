/**
 * NIP-13 mining, off the main thread.
 *
 * The loop is 2^N hashes on average and unbounded in the worst case; at 22
 * bits that is routinely tens of seconds. On the main thread that would
 * freeze the composer, every animation and the button offering to stop it,
 * for exactly as long as it ran.
 *
 * The loop itself lives in $lib/pow so it can be tested without a worker.
 */
import { minePowEvent, type MinableEvent } from './pow';

export interface PowRequest {
  id: number;
  event: MinableEvent;
  bits: number;
}

self.onmessage = (e: MessageEvent<PowRequest>) => {
  const { id, event, bits } = e.data || ({} as PowRequest);
  try {
    // The event arrived through structured clone, so this is already a
    // private copy: mutating it here cannot reach the composer's draft.
    const out = minePowEvent(event, bits, (p) =>
      self.postMessage({ id, progress: true, ...p })
    );
    self.postMessage({
      id,
      ok: true,
      event: out.event,
      attempts: out.attempts,
      difficulty: out.difficulty
    });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err as Error)?.message || err) });
  }
};

export {};
