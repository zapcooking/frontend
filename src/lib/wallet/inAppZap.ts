import type { PaymentResult } from './paymentOutcome';
import { NO_WALLET_MESSAGE } from './paymentOutcome';

/**
 * The in-app zap sequence behind ZapModal (and testable without it):
 * check a wallet is usable here → connect → get the invoice → pay, then
 * decide by the payment's outcome. `onCompleted` ("zap complete", "Sent")
 * runs only after the wallet confirms the payment completed.
 */

export type ZapStep = 'connecting your wallet' | 'getting the invoice' | 'sending the payment';

export type InAppZapOutcome =
  | { kind: 'completed' }
  | { kind: 'pending'; message: string }
  | { kind: 'error'; message: string };

export interface InAppZapDeps {
  availability: () => 'ready' | 'connectable' | 'none';
  ensureReady: () => Promise<boolean>;
  createInvoice: () => Promise<string>;
  pay: (invoice: string) => Promise<PaymentResult>;
  onStep?: (step: ZapStep) => void;
  /** Runs only for a confirmed payment. */
  onCompleted: () => void;
  /** True once the caller gave up (its timeout fired): stop before paying. */
  abandoned?: () => boolean;
}

export async function runInAppZap(d: InAppZapDeps): Promise<InAppZapOutcome | null> {
  if (d.availability() === 'none') return { kind: 'error', message: NO_WALLET_MESSAGE };
  try {
    d.onStep?.('connecting your wallet');
    if (!(await d.ensureReady())) return { kind: 'error', message: NO_WALLET_MESSAGE };

    d.onStep?.('getting the invoice');
    const invoice = await d.createInvoice();
    if (d.abandoned?.()) return null;

    d.onStep?.('sending the payment');
    const result = await d.pay(invoice);
    if (d.abandoned?.()) return null;

    if (result.status === 'completed') {
      d.onCompleted();
      return { kind: 'completed' };
    }
    if (result.status === 'pending') return { kind: 'pending', message: result.error || '' };
    return { kind: 'error', message: result.error || 'Payment failed' };
  } catch (e) {
    if (d.abandoned?.()) return null;
    return { kind: 'error', message: e instanceof Error ? e.message : 'Payment failed' };
  }
}
