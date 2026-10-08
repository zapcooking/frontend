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
 */
export type UnlockState = 'idle' | 'offered' | 'unlocking' | 'unlocked' | 'declined';

export class MemberUnlock {
  state: UnlockState = 'idle';

  /** `login`: the manual feed login (asks the signer once); true = member access. */
  constructor(private login: () => Promise<boolean>) {}

  /** Can a members-only card (spotlight, memory) appear now? */
  get open(): boolean {
    return this.state === 'unlocked';
  }

  /** Should the next members-only slot be an unlock card? (once) */
  get canOffer(): boolean {
    return this.state === 'idle';
  }

  /** The unlock card was placed. */
  offer(): void {
    if (this.state === 'idle') this.state = 'offered';
  }

  /** The tap: one login prompt; true when the feed is now unlocked. */
  async tap(): Promise<boolean> {
    if (this.state === 'unlocked') return true;
    if (this.state !== 'offered') return false;
    this.state = 'unlocking';
    const ok = await this.login().catch(() => false);
    if (this.state === 'unlocking') this.state = ok ? 'unlocked' : 'declined';
    return this.state === 'unlocked';
  }

  /** Logged in some other way (a topic, the finish line's button). */
  loggedIn(): void {
    this.state = 'unlocked';
  }
}
