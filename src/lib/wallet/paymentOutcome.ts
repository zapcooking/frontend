/**
 * What a payment attempt actually did, for every wallet kind.
 *
 * A zap is "sent" only when the wallet confirms the payment completed.
 * Anything else is reported as such, never as success:
 *   - 'unavailable': no wallet usable on this site; nothing was attempted
 *   - 'failed': the wallet says the payment failed; no money moved
 *   - 'pending': the payment may still complete (Breez still in flight
 *     after its completion wait, an NWC request that timed out, a wallet
 *     that answered without a preimage). Callers must not retry or offer
 *     another payment method: that could pay twice.
 *
 * Pure (no wallet imports) so the rules are testable.
 */

export type PaymentStatus = 'completed' | 'pending' | 'failed' | 'unavailable';

export interface PaymentResult {
  success: boolean;
  status: PaymentStatus;
  preimage?: string;
  error?: string;
}

export const NO_WALLET_MESSAGE = 'No wallet connected';
export const PENDING_MESSAGE = 'Payment still pending, check your wallet';

/** Seconds Breez waits for a Lightning payment to complete before returning. */
export const BREEZ_COMPLETION_TIMEOUT_SECS = 30;

const HEX64 = /^[0-9a-f]{64}$/i;

export function completed(preimage: string): PaymentResult {
  return { success: true, status: 'completed', preimage };
}

export function failed(error: string): PaymentResult {
  return { success: false, status: 'failed', error: error || 'Payment failed' };
}

export function pending(): PaymentResult {
  return { success: false, status: 'pending', error: PENDING_MESSAGE };
}

export function unavailable(error = NO_WALLET_MESSAGE): PaymentResult {
  return { success: false, status: 'unavailable', error };
}

/**
 * A Breez (Spark SDK) send result: the SDK's `{ payment }` (or the payment
 * itself). Decided by `payment.status`; the preimage comes from the
 * Lightning HTLC details. A completed Spark-to-Spark transfer has no
 * Lightning preimage and is still completed.
 */
export function fromBreez(result: unknown): PaymentResult {
  const r = result as { payment?: unknown } | null | undefined;
  const payment = (r && typeof r === 'object' && 'payment' in r ? r.payment : r) as
    | {
        status?: string;
        details?: { type?: string; htlcDetails?: { preimage?: string } };
      }
    | null
    | undefined;
  if (!payment || typeof payment !== 'object') return pending();
  switch (payment.status) {
    case 'completed':
      return completed(
        payment.details?.type === 'lightning' ? payment.details.htlcDetails?.preimage || '' : ''
      );
    case 'failed':
      return failed('The payment failed. No sats were sent.');
    default:
      return pending();
  }
}

/** An NWC / WebLN answer: completed only with a real preimage. */
export function fromPreimage(preimage: unknown): PaymentResult {
  return typeof preimage === 'string' && HEX64.test(preimage) ? completed(preimage) : pending();
}

/**
 * An error thrown mid-payment. A timeout means the payment may still go
 * through, so it's pending, never failed.
 */
export function fromError(err: unknown): PaymentResult {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (/timed? ?out|timeout/i.test(msg)) return pending();
  return failed(msg || 'Payment failed');
}
