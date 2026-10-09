import { describe, it, expect, vi } from 'vitest';
import { MemberUnlock } from './memberUnlock';

describe('tap to unlock', () => {
  it('no prompt before the tap; the first members-only slot gets the unlock card, once', () => {
    const login = vi.fn(async () => true);
    const u = new MemberUnlock(login);
    expect(u.open).toBe(false);
    expect(u.canOffer).toBe(true);
    u.offer();
    expect(u.canOffer).toBe(false); // no second unlock card
    expect(u.open).toBe(false); // members-only cards wait (recipes go on)
    expect(login).not.toHaveBeenCalled();
  });

  it('one tap: one prompt, then members-only cards just work', async () => {
    const login = vi.fn(async () => true);
    const u = new MemberUnlock(login);
    u.offer();
    expect(await u.tap()).toBe(true);
    expect(login).toHaveBeenCalledTimes(1);
    expect(u.open).toBe(true);
    expect(await u.tap()).toBe(true); // already unlocked: no second prompt
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('declined: no members-only cards this session and no further prompts', async () => {
    const login = vi.fn(async () => false);
    const u = new MemberUnlock(login);
    u.offer();
    expect(await u.tap()).toBe(false);
    expect(u.state).toBe('declined');
    expect(u.open).toBe(false);
    expect(u.canOffer).toBe(false);
    expect(await u.tap()).toBe(false);
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('a failing signer counts as a decline', async () => {
    const u = new MemberUnlock(async () => {
      throw new Error('no signer');
    });
    u.offer();
    expect(await u.tap()).toBe(false);
    expect(u.state).toBe('declined');
  });

  it('logging in elsewhere (a topic, the finish line) unlocks too', () => {
    const u = new MemberUnlock(async () => true);
    u.loggedIn();
    expect(u.open).toBe(true);
    expect(u.canOffer).toBe(false);
  });
});

describe('session and reconnects', () => {
  it('a login lost to a reconnect offers the unlock card again (not stuck)', async () => {
    const u = new MemberUnlock(async () => true);
    u.offer();
    await u.tap();
    u.lost();
    expect(u.open).toBe(false);
    expect(u.canOffer).toBe(true);
  });

  it('a decline elsewhere (another feed login prompt) means no unlock prompts either', async () => {
    const login = vi.fn(async () => true);
    const u = new MemberUnlock(login);
    u.declinedElsewhere();
    expect(u.canOffer).toBe(false);
    u.offer();
    expect(await u.tap()).toBe(false);
    expect(login).not.toHaveBeenCalled();
  });

  it('a decline is never undone by lost(); a different account starts over', async () => {
    let account = 'alice';
    const u = new MemberUnlock(
      async () => false,
      () => account
    );
    u.offer();
    await u.tap();
    u.lost();
    expect(u.state).toBe('declined');
    account = 'bob';
    expect(u.canOffer).toBe(true);
  });

  it('an offered card that was never tapped is withdrawn, so a later visit offers it again', () => {
    const u = new MemberUnlock(async () => true);
    expect(u.canOffer).toBe(true);
    u.offer();
    expect(u.canOffer).toBe(false);
    u.withdraw();
    expect(u.canOffer).toBe(true);
    u.offer();
    u.declinedElsewhere();
    u.withdraw();
    expect(u.canOffer).toBe(false);
  });
});

describe('the remembered unlock (auto)', () => {
  it('one automatic login per session; on success the cards just work and no tap card is offered', async () => {
    const login = vi.fn(async () => true);
    const u = new MemberUnlock(login);
    expect(await u.auto()).toBe(true);
    expect(login).toHaveBeenCalledTimes(1);
    expect(u.open).toBe(true);
    expect(u.canOffer).toBe(false);
    expect(await u.auto()).toBe(true); // already unlocked: nothing asked
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('declined: the tap card is offered once; its tap asks again; nothing asks on its own', async () => {
    let answer = false;
    const login = vi.fn(async () => answer);
    const u = new MemberUnlock(login);
    expect(await u.auto()).toBe(false);
    expect(login).toHaveBeenCalledTimes(1);
    expect(u.state).toBe('idle');
    expect(u.canOffer).toBe(true); // the tap card, once
    expect(await u.auto()).toBe(false); // never a second automatic request
    expect(login).toHaveBeenCalledTimes(1);
    // The decline reached the login state too: that must not retire the tap card.
    u.declinedElsewhere();
    expect(u.canOffer).toBe(true);
    u.offer();
    expect(u.canOffer).toBe(false);
    answer = true;
    expect(await u.tap()).toBe(true); // the tap: one more prompt
    expect(login).toHaveBeenCalledTimes(2);
    expect(u.open).toBe(true);
  });

  it('declined twice (auto, then the tap): no members-only cards and no more prompts this session', async () => {
    const login = vi.fn(async () => false);
    const u = new MemberUnlock(login);
    await u.auto();
    u.offer();
    expect(await u.tap()).toBe(false);
    expect(u.state).toBe('declined');
    expect(u.canOffer).toBe(false);
    expect(await u.auto()).toBe(false);
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('a failing signer counts as a decline for the automatic attempt too', async () => {
    const u = new MemberUnlock(async () => {
      throw new Error('no signer');
    });
    expect(await u.auto()).toBe(false);
    expect(u.autoFailed).toBe(true);
    expect(u.canOffer).toBe(true);
  });

  it('a different account starts over (one automatic attempt for it)', async () => {
    let who = 'a';
    const login = vi.fn(async () => false);
    const u = new MemberUnlock(login, () => who);
    await u.auto();
    expect(u.autoTried).toBe(true);
    who = 'b';
    expect(u.canOffer).toBe(true);
    expect(u.autoTried).toBe(false);
    await u.auto();
    expect(login).toHaveBeenCalledTimes(2);
  });
});
