import { describe, it, expect, vi } from 'vitest';
import { runInAppZap, type InAppZapDeps } from './inAppZap';

function deps(o: Partial<InAppZapDeps> = {}) {
  const order: string[] = [];
  const d: InAppZapDeps = {
    availability: () => 'ready',
    ensureReady: async () => true,
    createInvoice: vi.fn(async () => {
      order.push('invoice');
      return 'lnbc1';
    }),
    pay: vi.fn(async () => {
      order.push('pay');
      return { success: true, status: 'completed' as const, preimage: 'p' };
    }),
    onStep: (s) => order.push(`step:${s}`),
    onCompleted: vi.fn(() => order.push('zap-complete')),
    ...o
  };
  return { d, order };
}

describe('the in-app zap sequence', () => {
  it('"zap complete" fires only after the payment is confirmed, never before', async () => {
    const { d, order } = deps();
    expect(await runInAppZap(d)).toEqual({ kind: 'completed' });
    expect(order).toEqual([
      'step:connecting your wallet',
      'step:getting the invoice',
      'invoice',
      'step:sending the payment',
      'pay',
      'zap-complete'
    ]);
  });

  it('no wallet on this site: "No wallet connected" at once, nothing else happens', async () => {
    const { d, order } = deps({ availability: () => 'none' });
    expect(await runInAppZap(d)).toEqual({ kind: 'error', message: 'No wallet connected' });
    expect(order).toEqual([]);
  });

  it('a wallet that fails to connect: the same error, before any invoice', async () => {
    const { d } = deps({ availability: () => 'connectable', ensureReady: async () => false });
    expect(await runInAppZap(d)).toMatchObject({ kind: 'error', message: 'No wallet connected' });
    expect(d.createInvoice).not.toHaveBeenCalled();
  });

  it('pending: reported as pending, "zap complete" never fires', async () => {
    const { d } = deps({
      pay: async () => ({
        success: false,
        status: 'pending',
        error: 'Payment still pending, check your wallet'
      })
    });
    expect(await runInAppZap(d)).toEqual({
      kind: 'pending',
      message: 'Payment still pending, check your wallet'
    });
    expect(d.onCompleted).not.toHaveBeenCalled();
  });

  it('failed: a clear error, "zap complete" never fires', async () => {
    const { d } = deps({
      pay: async () => ({
        success: false,
        status: 'failed',
        error: 'The payment failed. No sats were sent.'
      })
    });
    expect(await runInAppZap(d)).toEqual({
      kind: 'error',
      message: 'The payment failed. No sats were sent.'
    });
    expect(d.onCompleted).not.toHaveBeenCalled();
  });

  it('an invoice error is reported, nothing is paid', async () => {
    const { d } = deps({
      createInvoice: async () => {
        throw new Error('User has no lightning address');
      }
    });
    expect(await runInAppZap(d)).toMatchObject({ kind: 'error' });
    expect(d.pay).not.toHaveBeenCalled();
  });

  it('after the caller timed out, it stops before paying and reports nothing', async () => {
    let gaveUp = false;
    const { d } = deps({
      createInvoice: async () => {
        gaveUp = true;
        return 'lnbc1';
      },
      abandoned: () => gaveUp
    });
    expect(await runInAppZap(d)).toBeNull();
    expect(d.pay).not.toHaveBeenCalled();
  });
});
