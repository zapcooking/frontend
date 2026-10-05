import { writable, type Readable } from 'svelte/store';
import type { RelayLike } from './relay';

/**
 * Member login to the Fresh relay (NIP-42), lazily, at most once per
 * connection.
 *
 * The relay sends its challenge when the connection opens; nostr-tools keeps
 * it and (with no `onauth`) does nothing. This module signs it only when a
 * signed-in *member* first needs depth: paging past the 14-day floor, or
 * opening a topic feed. A reader who stays in the last two weeks never sees
 * a signer prompt, and a non-member or a signed-out reader is never asked.
 *
 * A decline, or no answer in 30 s (Alby silently drops requests from origins
 * it has rejected), is remembered in memory for the session: no automatic
 * re-prompt, only the "Log in to the feed" button (`access(relay, true)`).
 * If the relay then says the reader isn't a member (`restricted:`, or an
 * empty first page of history), that's remembered too, and nothing retries.
 *
 * nostr-tools never settles a login whose signer throws and caches that
 * promise for the connection, so every failed attempt closes the connection;
 * the next attempt gets a fresh one and a fresh challenge.
 *
 * Nothing is stored, and nothing goes anywhere but the AUTH event to
 * wss://feed.zap.cooking. The relay uses the login only for the access check.
 */

export interface AuthTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface SignedAuthEvent extends AuthTemplate {
  id: string;
  pubkey: string;
  sig: string;
}

export type SignAuth = (template: AuthTemplate) => Promise<SignedAuthEvent>;

/** A connection that can answer the relay's challenge (nostr-tools `Relay`). */
export interface AuthRelay extends RelayLike {
  auth(sign: (template: AuthTemplate) => Promise<SignedAuthEvent>): Promise<string>;
}

export type LoginState =
  | 'idle' // not logged in on this connection (nothing asked yet)
  | 'pending' // waiting for the signer
  | 'authed' // logged in on the current connection
  | 'declined' // declined, timed out or failed: only the button logs in
  | 'not-member'; // logged in, but the relay says not a member

export interface LoginDeps {
  /** The signed-in key (hex), or '' / null when signed out. */
  pubkey: () => string | null | undefined;
  /** The app's membership answer for that key (`membershipStatusMap[pk]?.active`). */
  isMember: () => boolean;
  sign: SignAuth;
  /** How long to wait for the signer (default 30 s). */
  timeoutMs?: number;
  /** Between checks for a challenge on a fresh connection (default 250 ms). */
  challengeWaitMs?: number;
}

export const LOGIN_TIMEOUT_MS = 30_000;

/**
 * A fresh connection (after a decline closed the last one) may not have
 * received the relay's challenge yet when the "Log in to the feed" button
 * asks; nostr-tools then throws "no challenge" before signing anything.
 * Check again for about 3 s (inside the overall timeout) before giving up.
 */
export const CHALLENGE_CHECKS = 12;

export class MemberLogin {
  private readonly _state = writable<LoginState>('idle');
  readonly state: Readable<LoginState> = { subscribe: this._state.subscribe };

  private current: LoginState = 'idle';
  private authedOn: RelayLike | null = null;
  private inflight: Promise<boolean> | null = null;
  private owner: string | null = null;

  constructor(private deps: LoginDeps) {}

  /** Logged in on this connection? */
  authed(relay: RelayLike | null): boolean {
    this.syncOwner();
    return relay !== null && relay === this.authedOn && this.current === 'authed';
  }

  /**
   * Make sure this reader has member access on `relay`, logging in if
   * needed. Automatic calls (`manual` false) never prompt after a decline or
   * a "not a member" answer; the button (`manual` true) asks again once.
   * Concurrent calls share one prompt.
   */
  async access(relay: AuthRelay | RelayLike, manual = false): Promise<boolean> {
    this.syncOwner();
    if (this.authed(relay)) return true;
    if (!this.deps.pubkey() || !this.deps.isMember()) return false;
    if (!manual && (this.current === 'declined' || this.current === 'not-member')) return false;
    if (!('auth' in relay) || typeof relay.auth !== 'function') return false;
    if (!this.inflight) {
      this.inflight = this.login(relay as AuthRelay).finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  /** The relay said this reader isn't a member: stop asking. */
  denied(): void {
    this.authedOn = null;
    this.set('not-member');
  }

  /** Signed out or switched accounts: forget everything. */
  reset(): void {
    this.authedOn = null;
    this.owner = this.deps.pubkey() || null;
    this.set('idle');
  }

  private syncOwner(): void {
    const pk = this.deps.pubkey() || null;
    if (pk !== this.owner) this.reset();
  }

  private async login(relay: AuthRelay): Promise<boolean> {
    this.set('pending');
    const timeoutMs = this.deps.timeoutMs ?? LOGIN_TIMEOUT_MS;
    const waitMs = this.deps.challengeWaitMs ?? 250;
    const outcome = await new Promise<'ok' | 'declined' | 'failed'>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => done('declined'), timeoutMs);
      function done(o: 'ok' | 'declined' | 'failed') {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(o);
      }
      const sign = async (template: AuthTemplate) => {
        try {
          return await this.deps.sign(template);
        } catch (err) {
          // nostr-tools swallows this and never settles: settle here.
          done('declined');
          throw err;
        }
      };
      const attempt = (checksLeft: number) => {
        if (settled) return;
        relay.auth(sign).then(
          () => done('ok'),
          (err) => {
            const noChallenge = /no challenge/i.test(String(err?.message ?? err));
            if (noChallenge && checksLeft > 0) setTimeout(() => attempt(checksLeft - 1), waitMs);
            else done('failed');
          }
        );
      };
      attempt(CHALLENGE_CHECKS);
    });
    // The account may have changed while the signer was open.
    if (this.owner !== (this.deps.pubkey() || null)) return false;
    if (outcome === 'ok') {
      this.authedOn = relay;
      this.set('authed');
      return true;
    }
    relay.close();
    this.set('declined');
    return false;
  }

  private set(s: LoginState): void {
    this.current = s;
    this._state.set(s);
  }
}
