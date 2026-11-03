import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * One-tap zaps count as sent only after the wallet confirms the payment;
 * every other outcome undoes the optimistic count.
 */

const m = vi.hoisted(() => ({
  availability: 'ready' as 'ready' | 'connectable' | 'none',
  canConnect: true,
  createZap: vi.fn(),
  sendPayment: vi.fn(),
  optimistic: vi.fn(),
  revert: vi.fn(),
  completedMark: vi.fn()
}));

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return { ndk: writable({}), userPublickey: writable('f'.repeat(64)) };
});
vi.mock('$lib/wallet', async () => {
  const { writable } = await import('svelte/store');
  return { activeWallet: writable({ id: 's', kind: 4, data: 'x' }) };
});
vi.mock('$lib/autoZapSettings', async () => {
  const { writable } = await import('svelte/store');
  return {
    oneTapZapEnabled: writable(true),
    oneTapZapAmount: writable(21),
    defaultZapMessage: writable('')
  };
});
vi.mock('$lib/wallet/walletManager', () => ({
  sendPayment: m.sendPayment,
  walletAvailability: () => m.availability,
  ensurePaymentWalletReady: async () => m.availability !== 'none' && m.canConnect
}));
vi.mock('$lib/zapManager', () => ({
  ZapManager: class {
    createZap = m.createZap;
  }
}));
vi.mock('$lib/engagementCache', () => ({
  optimisticZapUpdate: m.optimistic,
  revertOptimisticZap: m.revert,
  markSelfZapCompleted: m.completedMark
}));
vi.mock('@nostr-dev-kit/ndk', () => ({
  NDKUser: class {},
  NDKEvent: class {}
}));

const target = {
  id: 'e'.repeat(64),
  pubkey: 'b'.repeat(64),
  author: { hexpubkey: 'b'.repeat(64) }
} as never;

beforeEach(() => {
  m.availability = 'ready';
  m.canConnect = true;
  for (const f of [m.createZap, m.sendPayment, m.optimistic, m.revert, m.completedMark])
    f.mockReset();
  m.createZap.mockResolvedValue({ invoice: 'lnbc1...' });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

async function zap() {
  const { sendOneTapZap } = await import('./oneTapZap');
  return sendOneTapZap(target);
}

describe('sendOneTapZap', () => {
  it('no wallet on this site: "No wallet connected" at once, no invoice, no optimistic zap', async () => {
    m.availability = 'none';
    expect(await zap()).toEqual({
      success: false,
      status: 'unavailable',
      error: 'No wallet connected'
    });
    expect(m.createZap).not.toHaveBeenCalled();
    expect(m.optimistic).not.toHaveBeenCalled();
  });

  it("a wallet that can't connect here: same, before any invoice", async () => {
    m.availability = 'connectable';
    m.canConnect = false;
    expect((await zap()).status).toBe('unavailable');
    expect(m.createZap).not.toHaveBeenCalled();
  });

  it('completed: sent, the optimistic count stays, the celebration fires', async () => {
    m.sendPayment.mockResolvedValue({ success: true, status: 'completed', preimage: 'p' });
    expect(await zap()).toMatchObject({ success: true, status: 'completed', amount: 21 });
    expect(m.optimistic).toHaveBeenCalledTimes(1);
    expect(m.revert).not.toHaveBeenCalled();
    expect(m.completedMark).toHaveBeenCalledTimes(1);
  });

  for (const status of ['pending', 'failed', 'unavailable'] as const) {
    it(`${status}: not sent, the optimistic count is undone`, async () => {
      m.sendPayment.mockResolvedValue({ success: false, status, error: 'x' });
      expect(await zap()).toMatchObject({ success: false, status });
      expect(m.revert).toHaveBeenCalledTimes(1);
      expect(m.completedMark).not.toHaveBeenCalled();
    });
  }

  it('failing before the payment (no Lightning address) is a preparation failure', async () => {
    m.createZap.mockRejectedValue(new Error('User has no lightning address'));
    expect(await zap()).toMatchObject({ success: false, status: 'prepare' });
    expect(m.sendPayment).not.toHaveBeenCalled();
    expect(m.optimistic).not.toHaveBeenCalled();
  });
});
