import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InputType, PrepareSendPaymentResponse } from '@breeztech/breez-sdk-spark/web';
import {
  prepareSendRequest,
  buildSendPaymentRequest,
  onchainSendRequest,
  payRequestOf,
  prepareLnurlRequest,
  bolt11ReceiveRequest,
  claimDepositRequest,
  refundDepositRequest
} from './sdkRequests';

/**
 * The Breez SDK request shapes the app sends. Fixtures are typed against
 * the installed SDK, so `pnpm check` fails if the SDK changes them; the
 * last block also reads the SDK's own type definitions at test time.
 */

const INVOICE = 'lnbc1u1p4vgxexample';

const prepared: PrepareSendPaymentResponse = {
  paymentMethod: {
    type: 'bolt11Invoice',
    invoiceDetails: {} as never,
    lightningFeeSats: 1
  },
  amount: 100n,
  feePolicy: 'feesExcluded'
} as PrepareSendPaymentResponse;

const lnurlDetails = {
  callback: 'https://primal.net/lnurlp/lemon/callback',
  minSendable: 1000,
  maxSendable: 1e11,
  metadataStr: '[]',
  commentAllowed: 0,
  domain: 'primal.net',
  url: 'https://primal.net/.well-known/lnurlp/lemon',
  allowsNostr: true,
  nostrPubkey: 'f'.repeat(64)
} as unknown as Extract<InputType, { type: 'lnurlPay' }>;

describe('sending', () => {
  it('a bolt11 invoice goes in a tagged PaymentRequest, never as a bare string', () => {
    expect(prepareSendRequest(INVOICE)).toEqual({
      paymentRequest: { type: 'input', input: INVOICE }
    });
    expect(prepareSendRequest('bc1qaddress', 5000)).toEqual({
      paymentRequest: { type: 'input', input: 'bc1qaddress' },
      amount: 5000n
    });
  });

  it('Lightning invoices wait ~30 s for completion on standard routing', () => {
    expect(buildSendPaymentRequest('bolt11Invoice', prepared)).toEqual({
      prepareResponse: prepared,
      options: { type: 'bolt11Invoice', preferSpark: false, completionTimeoutSecs: 30 }
    });
    for (const t of ['sparkAddress', 'bitcoinAddress', 'sparkInvoice'])
      expect(buildSendPaymentRequest(t, prepared)).toEqual({ prepareResponse: prepared });
  });

  it('on-chain sends carry the confirmation speed', () => {
    expect(onchainSendRequest(prepared, 'fast')).toEqual({
      prepareResponse: prepared,
      options: { type: 'bitcoinAddress', confirmationSpeed: 'fast' }
    });
  });
});

describe('LNURL / Lightning address', () => {
  it('a Lightning address carries its pay request; an LNURL input is one', () => {
    const { type: _t, ...details } = { ...lnurlDetails, type: 'lnurlPay' as const };
    expect(payRequestOf({ type: 'lnurlPay', ...details } as InputType)).toEqual(details);
    expect(
      payRequestOf({
        type: 'lightningAddress',
        address: 'lemon@primal.net',
        payRequest: details
      } as InputType)
    ).toBe(details);
    expect(payRequestOf({ type: 'bolt11Invoice' } as InputType)).toBeNull();
  });

  it('amount is a bigint `amount`, not `amountSats`', () => {
    const r = prepareLnurlRequest(lnurlDetails, 21, 'thanks');
    expect(r.amount).toBe(21n);
    expect(r.comment).toBe('thanks');
    expect('amountSats' in r).toBe(false);
  });
});

describe('receiving and deposits', () => {
  it('builds the 0.23 shapes', () => {
    expect(bolt11ReceiveRequest(21, 'zap')).toEqual({
      paymentMethod: { type: 'bolt11Invoice', amountSats: 21, description: 'zap' }
    });
    expect(claimDepositRequest('t', 0, { fixedSats: 500 })).toEqual({
      txid: 't',
      vout: 0,
      maxFee: { type: 'fixed', amount: 500 }
    });
    expect(claimDepositRequest('t', 1, { leewaySatPerVbyte: 2 }).maxFee).toEqual({
      type: 'networkRecommended',
      leewaySatPerVbyte: 2
    });
    expect(refundDepositRequest('t', 0, 'bc1q', 3).fee).toEqual({ type: 'rate', satPerVbyte: 3 });
  });
});

describe('the installed SDK still has these shapes', () => {
  const root = join(process.cwd(), 'node_modules/@breeztech/breez-sdk-spark');
  const dts = readFileSync(join(root, 'web/breez_sdk_spark_wasm.d.ts'), 'utf8');
  const pinned = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).dependencies[
    '@breeztech/breez-sdk-spark'
  ];
  const installed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

  it('the installed version is the pinned one (upgrading means revisiting sdkRequests.ts)', () => {
    expect(installed).toBe(pinned);
  });

  it('PaymentRequest is tagged with an `input` variant; prepare takes it', () => {
    expect(dts).toMatch(/export type PaymentRequest = \{ type: "input"; input: string \}/);
    expect(dts).toMatch(/interface PrepareSendPaymentRequest \{\s*paymentRequest: PaymentRequest;/);
  });

  it('bolt11 send options still take completionTimeoutSecs; payments still carry a status', () => {
    expect(dts).toMatch(
      /\{ type: "bolt11Invoice"; preferSpark: boolean; completionTimeoutSecs\?: number \}/
    );
    expect(dts).toMatch(/export type PaymentStatus = "completed" \| "pending" \| "failed";/);
  });
});
