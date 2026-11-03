import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The account nudge's "first wallet setup" moment: a wallet the user
 * connects counts, the login-time auto-restore doesn't.
 */
const mocks = vi.hoisted(() => ({ recordNudgeMoment: vi.fn() }));

vi.mock('$app/environment', () => ({ browser: false }));
vi.mock('$lib/accountNudge', () => ({ recordNudgeMoment: mocks.recordNudgeMoment }));
vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return {
    userPublickey: writable('a'.repeat(64)),
    ndkReady: Promise.resolve(),
    ndk: writable(null)
  };
});

beforeEach(() => mocks.recordNudgeMoment.mockClear());

describe('connectWallet origin', () => {
  it("records the moment for a user's setup", async () => {
    const { connectWallet } = await import('./walletManager');
    const result = await connectWallet(4, 'spark-id');
    expect(result.success).toBe(true);
    expect(mocks.recordNudgeMoment).toHaveBeenCalledWith('a'.repeat(64), 'wallet');
  });

  it('does not for the login-time restore', async () => {
    const { connectWallet } = await import('./walletManager');
    const result = await connectWallet(4, 'spark-id', 'restore');
    expect(result.success).toBe(true);
    expect(mocks.recordNudgeMoment).not.toHaveBeenCalled();
  });
});
