/**
 * Main-thread driver for the mining worker.
 *
 * One worker, kept warm between posts so a 16-bit mine does not spend longer
 * starting the thread than hashing on it. Canceling terminates it rather
 * than messaging it: the mining loop never yields, so a "stop" message would
 * sit unread in the queue until the work it was meant to interrupt had
 * already finished. The next mine builds a fresh one.
 */
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import type { MinableEvent, MineProgress, MineResult } from './pow';

const CANCELED = 'pow-canceled';

/** A mine the user stopped, which is an answer and not an error. */
export function isPowCanceled(err: unknown): boolean {
  return err instanceof Error && err.message === CANCELED;
}

type Pending = {
  resolve: (r: MineResult) => void;
  reject: (e: Error) => void;
  onProgress?: (p: MineProgress) => void;
};

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function settleAll(err: Error) {
  for (const [id, p] of pending) {
    pending.delete(id);
    p.reject(err);
  }
}

/**
 * Stop whatever is being mined. Also called when the composer closes: the
 * worker outlives the pane it is drawn in, and the post would otherwise
 * resume on the far side of its await to sign and publish a note the user
 * had already walked away from.
 */
export function powCancel(): void {
  // Only when something is actually running. This is called on every
  // composer close, and terminating an idle worker there would make the next
  // mine pay for a fresh one.
  if (!pending.size) return;
  if (worker) {
    worker.terminate();
    worker = null;
  }
  settleAll(new Error(CANCELED));
}

/** True while a mine is in flight. */
export function powBusy(): boolean {
  return pending.size > 0;
}

/**
 * Resolves with the mined event: same fields, plus a nonce tag, and possibly
 * a fresher created_at than it went in with.
 */
export async function minePow(
  event: MinableEvent,
  bits: number,
  onProgress?: (p: MineProgress) => void
): Promise<MineResult> {
  // No `browser` import on purpose: this module is imported by the mining
  // tests, and dragging in $app/environment drags in the whole app runtime
  // with it. Absent Worker is the same condition anyway — SSR has none.
  if (typeof Worker === 'undefined') {
    throw new Error('This browser cannot mine in the background');
  }

  if (!worker) {
    const { default: PowWorker } = await import('./pow.worker?worker');
    worker = new PowWorker();
    worker.onmessage = (e: MessageEvent) => {
      const { id, ok, event: mined, error, progress, attempts, best, difficulty } = e.data || {};
      const p = pending.get(id);
      if (!p) return;
      if (progress) {
        p.onProgress?.({ attempts, best });
        return;
      }
      pending.delete(id);
      if (ok) p.resolve({ event: mined, attempts, difficulty });
      else p.reject(new Error(error || 'Mining failed'));
    };
    worker.onerror = () => settleAll(new Error('Mining failed'));
  }

  const id = ++seq;
  return new Promise<MineResult>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    worker?.postMessage({ id, event, bits });
  });
}

/**
 * Mine proof of work into an NDKEvent, in the one order that works.
 *
 * The signature covers the id, and the id is the hash of exactly
 * pubkey/created_at/kind/tags/content. `toNostrEvent()` settles all five — it
 * fills pubkey and created_at and runs `generateTags()`, which rewrites tags
 * and content — so mining after it hashes the same bytes the signer will.
 * `sign()` runs that pass a second time and it comes out identical, which
 * pow.test.ts mines and signs for real to prove.
 *
 * Leaves the event unsigned with its mined tags in place; the caller signs.
 * Mining after signing would invalidate the signature it was mined under.
 */
export async function minePowIntoEvent(
  event: NDKEvent,
  bits: number,
  onProgress?: (p: MineProgress) => void
): Promise<MineResult> {
  const settled = await settleForMining(event);
  const mined = await minePow(settled, bits, onProgress);
  applyMined(event, mined);
  return mined;
}

/**
 * Settle every field the id commits to, and hand back a copy to mine.
 *
 * `toNostrEvent()` fills pubkey and created_at and runs `generateTags()`,
 * which rewrites tags and content — so this is the moment the bytes stop
 * moving. The copy is what crosses into the worker; the draft must not.
 */
export async function settleForMining(event: NDKEvent): Promise<MinableEvent> {
  await event.toNostrEvent();
  return {
    pubkey: event.pubkey,
    created_at: event.created_at as number,
    kind: event.kind as number,
    tags: event.tags.map((t) => [...t]),
    content: event.content
  };
}

/**
 * Write a mined result back onto the event, leaving it unsigned.
 *
 * `created_at` comes back too: a long mine re-stamps it rather than
 * publishing an event that says it was written a minute before it was.
 * Clearing the id makes sure nothing downstream reuses the pre-mine one.
 */
export function applyMined(event: NDKEvent, mined: MineResult): void {
  event.tags = mined.event.tags;
  event.created_at = mined.event.created_at;
  event.id = '';
}
