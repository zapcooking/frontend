import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: false, dev: false }));
import { buildSendPaymentRequest } from './index';
import { BREEZ_COMPLETION_TIMEOUT_SECS } from '$lib/wallet/paymentOutcome';

describe('Breez send request', () => {
  it('Lightning invoices wait for completion (~30 s) on standard Lightning routing', () => {
    const prep = { id: 'p' };
    expect(buildSendPaymentRequest('bolt11Invoice', prep)).toEqual({
      prepareResponse: prep,
      options: {
        type: 'bolt11Invoice',
        preferSpark: false,
        completionTimeoutSecs: BREEZ_COMPLETION_TIMEOUT_SECS
      }
    });
    expect(BREEZ_COMPLETION_TIMEOUT_SECS).toBe(30);
  });

  it('other destinations (Spark address, on-chain) get no bolt11 options', () => {
    for (const t of ['sparkAddress', 'bitcoinAddress', 'sparkInvoice'])
      expect(buildSendPaymentRequest(t, {})).toEqual({ prepareResponse: {} });
  });
});
