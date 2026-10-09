import type { MemberLogin } from './memberLogin';
import type { MemberUnlock } from './memberUnlock';
import type { SpecialsLoader } from './specialsLoader';
import type { Special } from './specials';

/**
 * Members-only cards (topic spotlights, memories) between the tap on the
 * unlock card and the card on screen, as one piece FreshFeed drives:
 *
 * - `open()`: may members-only cards load now? Only on a feed connection
 *   that is logged in. A login lost to a reconnect offers the unlock card
 *   again; a relay hold (`restricted:` on a logged-in connection, which the
 *   relay answers for a minute after a failed or unresolved membership
 *   lookup) just waits, with no new card and no new prompt.
 * - `prepare(kind)`: keeps one spotlight / memory ready, retrying an empty
 *   or refused try: after 15 s, or when the relay's hold ends.
 * - `autoUnlock()`: the remembered unlock ("Auto-unlock member content"):
 *   when a members-only slot comes up and the feed isn't logged in, one
 *   login attempt per session without a tap. Prompting signers only (a
 *   local key is logged in on load by FreshFeed's own silent path). A
 *   decline or failure leaves the tap card to the next slot, once.
 * - `tap(for)`: the unlock card's button. One signer prompt; when the feed
 *   is logged in, the tapped card gets the first ready card of its kind
 *   (the other kind if its own has nothing) — at once, or when a retry
 *   delivers it (`onFill`). The loader's own flags are reset on login, so
 *   nothing gathered before it (an empty "on this day", months that came
 *   back empty) is reused.
 *
 * Nothing here touches the DOM; FreshFeed renders what it is told.
 */

export const EMPTY_RETRY_MS = 15_000;
/** Relay holds waited out for the tapped card before it gives up (≈ 3 minutes). */
export const MAX_HOLDS = 3;

export type Kind = 'spotlight' | 'memory';

export interface UnlockFlowDeps {
  login: MemberLogin;
  loader: SpecialsLoader;
  unlock: MemberUnlock;
  /** The feed connection, as it is now, is logged in (FreshClient.authedNow). */
  authedNow: () => boolean;
  /** The app's membership answer for the viewer. */
  member: () => boolean;
  /** "Auto-unlock member content" is on for this device. */
  remembered?: () => boolean;
  /** The app's signer is attached (FreshFeed's signerReady); until then no automatic attempt. */
  signerReady?: () => boolean;
  /** A card became ready (or not): decide slots again. */
  onReady: () => void;
  /** The tapped card's content arrived later (null: gave up). */
  onFill: (special: Special | null) => void;
  /** Timers (tests inject). Returns a cancel. */
  setTimer?: (fn: () => void, ms: number) => () => void;
}

export class UnlockFlow {
  /** The tapped card is waiting for content of this kind. */
  pendingFor: Kind | null = null;
  private holdsWaited = 0;
  private lastHold = 0;
  /** One pending retry per kind (a recovery and a timer may both ask). */
  private retry: Partial<Record<Kind, () => void>> = {};
  private disposed = false;

  constructor(private d: UnlockFlowDeps) {}

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

  /** An automatic login is in flight (the slot waits, no tap card yet). */
  autoBusy = false;

  /**
   * The remembered unlock, when a members-only slot needs it: at most one
   * automatic signer request per session, and none for a silent signer (it
   * is logged in on load), when the login was declined elsewhere, or when
   * the device's toggle is off. Resolves to whether the feed is open now.
   */
  async autoUnlock(): Promise<boolean> {
    if (this.open()) return true;
    if (this.autoBusy) return false;
    if (!this.d.remembered?.() || this.d.login.silent) return false;
    // The app restores the signer after the pubkey is known: an attempt
    // before that would throw "not signed in" and count as the decline.
    if (this.d.signerReady && !this.d.signerReady()) return false;

    if (!this.d.unlock.canOffer || this.d.unlock.autoTried) return false;
    if (this.d.login.held) return false;
    this.autoBusy = true;
    try {
      const ok = await this.d.unlock.auto();
      if (this.disposed) return false;
      if (ok) {
        this.d.loader.loggedIn();
        this.prepare('spotlight');
        this.prepare('memory');
      }
      return ok;
    } finally {
      this.autoBusy = false;
      if (!this.disposed) this.d.onReady();
    }
  }

  /** May members-only cards load now? (see above) */
  open(): boolean {
    if (!this.d.member()) return false;
    if (this.d.authedNow()) {
      // The login counts: the loader's "wait for a login" / "denied" flags
      // are stale if set (a hold that ended, a login made elsewhere).
      this.d.loader.loggedIn();
      return true;
    }
    // Logged in, but the relay's verdict is held: wait it out. The unlock
    // card is not offered again (the login is fine) and nothing is asked.
    if (this.d.login.held) return false;
    if (this.d.unlock.open) this.d.unlock.lost();
    return false;
  }

  /** Keep one `kind` ready; an empty, failed or held try is retried. */
  prepare(kind: Kind): void {
    if (!this.open()) {
      if (this.d.login.held) this.retryIn(kind, this.d.login.holdLeftMs() + 50);
      return;
    }
    const loader = this.d.loader;
    const p = kind === 'spotlight' ? loader.prepareSpotlight() : loader.prepareMemory();
    p.then(() => {
      if (this.disposed) return;
      const filled = this.fillPending();
      if (filled) this.prepare(filled); // the tapped card took it: ready the next one
      this.d.onReady();
      const ready = kind === 'spotlight' ? loader.spotlight : loader.memory;
      if (this.pendingFor && loader.isOut('spotlight') && loader.isOut('memory')) this.giveUp();
      if (ready || loader.isOut(kind)) return;
      if (this.d.login.held) {
        // The relay refused this logged-in connection: ask again when the
        // hold ends (the same login, no prompt). The tapped card waits too,
        // but not forever.
        const hold = this.d.login.deniedSince;
        if (this.pendingFor && hold !== this.lastHold) {
          this.lastHold = hold;
          if (++this.holdsWaited > MAX_HOLDS) this.giveUp();
        }
        this.retryIn(kind, this.d.login.holdLeftMs() + 50);
      } else {
        this.retryIn(kind, EMPTY_RETRY_MS);
      }
    }).catch(() => {});
  }

  /**
   * The unlock card's tap: one login prompt. Returns the card to show in
   * its place: a spotlight / memory, 'loading' (logged in, content on its
   * way: `onFill` delivers it), or 'declined'.
   */
  async tap(wanted: Kind): Promise<Special | 'loading' | 'declined'> {
    const ok = await this.d.unlock.tap();
    if (this.disposed) return 'declined';
    if (!ok) return 'declined';
    const loader = this.d.loader;
    loader.loggedIn();
    this.pendingFor = wanted;
    this.holdsWaited = 0;
    // Its own kind first, then the other; a relay hold ends the attempt
    // (the retries below pick it up when the hold ends).
    const order: Kind[] = wanted === 'memory' ? ['memory', 'spotlight'] : ['spotlight', 'memory'];
    let found: Special | null = null;
    for (const k of order) {
      await (k === 'spotlight' ? loader.prepareSpotlight() : loader.prepareMemory());
      if (this.disposed) return 'declined';
      found = this.take();
      if (found || this.d.login.held) break;
    }
    if (found) this.pendingFor = null;
    this.prepare('spotlight');
    this.prepare('memory');
    return found ?? 'loading';
  }

  /** The ready card for the tapped slot: its own kind first, then the other. */
  private take(): Special | null {
    const loader = this.d.loader;
    const order: Kind[] = this.pendingFor === 'memory' ? ['memory', 'spotlight'] : ['spotlight', 'memory'];
    for (const k of order) {
      const s = k === 'spotlight' ? loader.takeSpotlight() : loader.takeMemory();
      if (s) return s;
    }
    return null;
  }

  /** The tapped card gets a ready card; returns the kind it took. */
  private fillPending(): Kind | null {
    if (!this.pendingFor) return null;
    const s = this.take();
    if (!s) return null;
    this.pendingFor = null;
    this.d.onFill(s);
    return s.type === 'memory' ? 'memory' : 'spotlight';
  }

  private giveUp(): void {
    this.pendingFor = null;
    this.d.onFill(null);
  }

  /** Leaving the feed: no more timers or fills. */
  dispose(): void {
    this.disposed = true;
    for (const cancel of Object.values(this.retry)) cancel?.();
    this.retry = {};
  }
}
