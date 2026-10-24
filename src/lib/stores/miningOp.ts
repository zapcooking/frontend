import { writable } from 'svelte/store';

/**
 * The one mine in flight, if there is one.
 *
 * Global rather than composer-local because the indicator has to outlive
 * the composer: mining a note can take the better part of a minute, and a
 * progress row nailed inside the editor means the editor has to stay open
 * and in the way for exactly that long. The store is what lets the composer
 * hand the work off and get out of the reader's way.
 *
 * Only one at a time, which matches the miner — it keeps a single worker,
 * and a second mine would be competing for the same core anyway.
 */
export interface MiningOp {
  /** Target difficulty in leading zero bits. */
  bits: number;
  /** When the mine started, for an elapsed clock the indicator owns. */
  startedAt: number;
  /** Best difficulty reached so far; the honest signal that it is alive. */
  best: number;
  /** Nonce found — signing and the relays still have to happen. */
  found: boolean;
  /** What the Stop button calls. */
  stop: () => void;
}

export const miningOp = writable<MiningOp | null>(null);

export function startMiningOp(bits: number, stop: () => void): void {
  miningOp.set({ bits, startedAt: Date.now(), best: 0, found: false, stop });
}

export function reportMiningBest(best: number): void {
  miningOp.update((op) => (op && best > op.best ? { ...op, best } : op));
}

export function markMiningFound(): void {
  miningOp.update((op) => (op ? { ...op, found: true } : op));
}

export function endMiningOp(): void {
  miningOp.set(null);
}
