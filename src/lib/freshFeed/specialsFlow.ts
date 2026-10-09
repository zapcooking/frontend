import type { Kind, SpecialsLoader } from './specialsLoader';

/**
 * Keeps one spotlight and one memory card ready for the feed, retrying
 * when a try came back empty or the relay refused:
 *
 * - empty (nothing eligible right now, a dropped request): again after
 *   EMPTY_RETRY_MS;
 * - the relay refused the spotlight preview (`auth-required:` from a relay
 *   that doesn't serve previews, `restricted:` on a held member
 *   connection): again when the loader's hold ends (it grows with
 *   refusals in a row);
 * - memories (members only) waiting for the feed login to count: no
 *   timer — the feed prepares again when the login happens;
 * - out of unshown content for the session: no more tries.
 *
 * Nothing here logs in or asks the signer. One pending retry per kind.
 * Nothing touches the DOM; FreshFeed decides its slots when told
 * (`onReady`).
 */

export const EMPTY_RETRY_MS = 15_000;

export interface SpecialsFlowDeps {
  loader: SpecialsLoader;
  /** A card became ready (or not): decide slots again. */
  onReady: () => void;
  /** Timers (tests inject). Returns a cancel. */
  setTimer?: (fn: () => void, ms: number) => () => void;
}

export class SpecialsFlow {
  /** One pending retry per kind. */
  private retry: Partial<Record<Kind, () => void>> = {};
  private disposed = false;

  constructor(private d: SpecialsFlowDeps) {}

  private retryIn(kind: Kind, ms: number): void {
    if (this.disposed) return;
    this.retry[kind]?.();
    const set =
      this.d.setTimer ??
      ((f, m) => {
        const t = setTimeout(f, m);
        return () => clearTimeout(t);
      });
    this.retry[kind] = set(() => {
      delete this.retry[kind];
      if (!this.disposed) this.prepare(kind);
    }, ms);
  }

  /** Keep one `kind` ready; an empty or refused try is retried. */
  prepare(kind: Kind): void {
    if (this.disposed) return;
    const loader = this.d.loader;
    const p = kind === 'spotlight' ? loader.prepareSpotlight() : loader.prepareMemory();
    p.then(() => {
      if (this.disposed) return;
      this.d.onReady();
      const ready = kind === 'spotlight' ? loader.spotlight : loader.memory;
      if (ready || loader.isOut(kind)) return;
      if (kind === 'memory' && (loader.waitingForLogin() || !loader.memberAccess())) return;
      const hold = kind === 'spotlight' ? loader.previewHoldLeftMs() : 0;
      this.retryIn(kind, hold > 0 ? hold + 50 : EMPTY_RETRY_MS);
    }).catch(() => {});
  }

  /** Leaving the feed: no more timers. */
  dispose(): void {
    this.disposed = true;
    for (const cancel of Object.values(this.retry)) cancel?.();
    this.retry = {};
  }
}
