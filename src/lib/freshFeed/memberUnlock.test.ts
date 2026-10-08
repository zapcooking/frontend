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
