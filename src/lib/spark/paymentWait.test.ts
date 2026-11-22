import { describe, it, expect, vi, afterEach } from 'vitest';
import { waitForSparkPayment, type SparkPaymentEvent, type SparkPaymentLike } from './paymentWait';

/**
 * lnurlPay returns while the payment is in flight; waitForSparkPayment
 * turns that into the settled payment using the SDK's own events.
 */

function fakeSdk(current: SparkPaymentLike | null = null) {
  const listeners = new Set<(e: SparkPaymentEvent) => void>();
  return {
    listeners,
    emit: (e: SparkPaymentEvent) => [...listeners].forEach((l) => l(e)),
    deps: {
      onEvent: (cb: (e: SparkPaymentEvent) => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      getPayment: vi.fn(async () => current)
    }
  };
}

const inFlight = { id: 'pay-1', status: 'pending' };

afterEach(() => vi.useRealTimers());

describe('waitForSparkPayment', () => {
  it('resolves with the settled payment when its paymentSucceeded event arrives', async () => {
    const sdk = fakeSdk({ ...inFlight });
    const wait = waitForSparkPayment(inFlight, sdk.deps, 30_000);
    await Promise.resolve();
    sdk.emit({ type: 'paymentSucceeded', payment: { id: 'other', status: 'completed' } });
    sdk.emit({ type: 'paymentSucceeded', payment: { id: 'pay-1', status: 'completed', fees: 33 } });
    expect(await wait).toMatchObject({ id: 'pay-1', status: 'completed', fees: 33 });
    expect(sdk.listeners.size).toBe(0);
  });

  it('resolves failed on paymentFailed', async () => {
    const sdk = fakeSdk();
    const wait = waitForSparkPayment(inFlight, sdk.deps, 30_000);
    sdk.emit({ type: 'paymentFailed', payment: { id: 'pay-1', status: 'failed' } });
    expect((await wait).status).toBe('failed');
  });

  it('catches a payment that settled before the listener was attached', async () => {
    const sdk = fakeSdk({ id: 'pay-1', status: 'completed' });
    expect((await waitForSparkPayment(inFlight, sdk.deps, 30_000)).status).toBe('completed');
    expect(sdk.listeners.size).toBe(0);
  });

  it('still in flight after the wait → the pending payment, and the listener is removed', async () => {
    vi.useFakeTimers();
    const sdk = fakeSdk({ ...inFlight });
    const wait = waitForSparkPayment(inFlight, sdk.deps, 30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await wait).status).toBe('pending');
    expect(sdk.listeners.size).toBe(0);
  });

  it('an already-settled payment returns at once without subscribing', async () => {
    const sdk = fakeSdk();
    const done = { id: 'pay-1', status: 'completed' };
    expect(await waitForSparkPayment(done, sdk.deps, 30_000)).toBe(done);
    expect(sdk.deps.getPayment).not.toHaveBeenCalled();
  });
});
