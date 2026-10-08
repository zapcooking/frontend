/**
 * "Tap to unlock with your membership": members are never asked to log in
 * to the feed relay on their own. When the first members-only card
 * (spotlight or memory) comes up and the feed isn't logged in, it is shown
 * as an unlock card instead; one tap asks the signer once and fills it.
 *
 * - idle: nothing offered yet (the next members-only slot gets the unlock card)
 * - offered: the unlock card is on screen; members-only types wait (recipes go on)
 * - unlocking: the signer is open
 * - unlocked: logged in; members-only cards just work
 * - declined: no members-only cards this session, and no more prompts
 *
 * One per tab session (freshSession), so leaving Fresh and coming back
 * doesn't forget a decline; a different account starts over.
 */
export type UnlockState = 'idle' | 'offered' | 'unlocking' | 'unlocked' | 'declined';

export class MemberUnlock {
  state: UnlockState = 'idle';

  private owner: string | null | undefined;

  /**
   * `login`: the manual feed login (asks the signer once); true = member
   * access. `account`: the signed-in key, so a different account starts over.
   */
  constructor(
    private login: () => Promise<boolean>,
    private account: () => string | null | undefined = () => null
  ) {}

  private sync(): void {
    const who = this.account() || null;
    if (this.owner !== undefined && who !== this.owner) this.state = 'idle';
    this.owner = who;
  }

  /** Can a members-only card (spotlight, memory) appear now? */
  get open(): boolean {
    this.sync();
    return this.state === 'unlocked';
  }

  /** Should the next members-only slot be an unlock card? (once) */
  get canOffer(): boolean {
    this.sync();
    return this.state === 'idle';
  }

  /**
   * The feed login was lost (the connection was replaced): offer the
   * unlock card again rather than leaving members-only cards stuck.
   */
  lost(): void {
    if (this.state === 'unlocked') this.state = 'idle';
  }

  /** A feed login was declined some other way: no unlock prompts either. */
  declinedElsewhere(): void {
    this.sync();
    if (this.state === 'idle' || this.state === 'offered') this.state = 'declined';
  }

  /**
   * The unlock card left the screen without a tap (the feed was left or
   * reloaded): the next members-only slot may offer it again. Without this
   * the state stuck at 'offered' and members lost the card for the tab.
   */
  withdraw(): void {
    if (this.state === 'offered') this.state = 'idle';
  }

  /** The unlock card was placed. */
  offer(): void {
    this.sync();
    if (this.state === 'idle') this.state = 'offered';
  }

  /** The tap: one login prompt; true when the feed is now unlocked. */
  async tap(): Promise<boolean> {
    this.sync();
    if (this.state === 'unlocked') return true;
    if (this.state !== 'offered') return false;
    this.state = 'unlocking';
    const ok = await this.login().catch(() => false);
    if (this.state === 'unlocking') this.state = ok ? 'unlocked' : 'declined';
    return this.state === 'unlocked';
  }

  /** Logged in some other way (a topic, the finish line's button). */
  loggedIn(): void {
    this.sync();
    this.state = 'unlocked';
  }
}
