/**
 * Wait for an in-flight Spark payment to finish.
 *
 * `lnurlPay` (Lightning addresses, LNURL-pay) returns as soon as the SDK
 * hands the payment off — it takes no completion timeout, unlike bolt11
 * `sendPayment` — so the caller gets a `pending` payment even when it
 * settles a second later. This waits for the SDK's own `paymentSucceeded`
 * / `paymentFailed` event for that payment, up to `timeoutMs`, and returns
 * the settled payment; still in flight after the wait, it returns the
 * pending payment unchanged (the caller reports it as pending, never sent).
 *
 * Pure apart from the injected SDK hooks, so it's testable without WASM.
 */

export interface SparkPaymentLike {
  id: string;
  status: string;
  [key: string]: unknown;
}

export interface SparkPaymentEvent {
  type: string;
  payment?: SparkPaymentLike;
}

export interface PaymentWaitDeps {
  /** Register for SDK events; returns an unsubscribe function. */
  onEvent: (callback: (event: SparkPaymentEvent) => void) => () => void;
  /** Look the payment up (closes the race where it settled before we subscribed). */
  getPayment: (id: string) => Promise<SparkPaymentLike | null>;
}

const SETTLED = new Set(['completed', 'failed']);

export function waitForSparkPayment(
  payment: SparkPaymentLike,
  deps: PaymentWaitDeps,
  timeoutMs: number
): Promise<SparkPaymentLike> {
  if (!payment?.id || SETTLED.has(payment.status)) return Promise.resolve(payment);

  return new Promise((resolve) => {
    let done = false;
    let unsubscribe: () => void = () => {};
    const finish = (settled: SparkPaymentLike) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(settled);
    };
    const timer = setTimeout(() => finish(payment), timeoutMs);

    unsubscribe = deps.onEvent((event) => {
      if (
        (event.type === 'paymentSucceeded' || event.type === 'paymentFailed') &&
        event.payment?.id === payment.id
      ) {
        finish(event.payment);
      }
    });
    if (done) unsubscribe();

    deps
      .getPayment(payment.id)
      .then((current) => {
        if (current && SETTLED.has(current.status)) finish(current);
      })
      .catch(() => {});
  });
}
