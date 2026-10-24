import type {
  InputType,
  LnurlPayRequestDetails,
  PrepareLnurlPayRequest,
  PrepareSendPaymentRequest,
  PrepareSendPaymentResponse,
  SendPaymentRequest,
  ReceivePaymentRequest,
  ClaimDepositRequest,
  RefundDepositRequest,
  OnchainConfirmationSpeed
} from '@breeztech/breez-sdk-spark/web';
import { BREEZ_COMPLETION_TIMEOUT_SECS } from '$lib/wallet/paymentOutcome';

/**
 * Every request the app sends to the Breez Spark SDK, built here and typed
 * against the installed SDK's own definitions (@breeztech/breez-sdk-spark,
 * see package.json). If an SDK upgrade changes a request shape, these stop
 * type-checking and CI's `check` job fails, instead of the call throwing
 * at runtime (as happened after the 0.11 → 0.23 upgrade, when a bare
 * invoice string was still passed where 0.23 expects a tagged
 * PaymentRequest). sdkRequests.test.ts pins the runtime shapes too.
 */

/** Prepare a send to a bolt11 invoice, Spark address or Bitcoin address. */
export function prepareSendRequest(
  destination: string,
  amountSats?: number
): PrepareSendPaymentRequest {
  const request: PrepareSendPaymentRequest = {
    paymentRequest: { type: 'input', input: destination }
  };
  if (amountSats !== undefined && amountSats > 0) request.amount = BigInt(Math.floor(amountSats));
  return request;
}

/**
 * Send a prepared payment. Lightning invoices wait for the payment to
 * complete (or fail) before returning, instead of returning while it's
 * still in flight; callers decide by the returned payment's status
 * ($lib/wallet/paymentOutcome), and still pending after the wait is
 * reported as pending, never as sent. preferSpark: false keeps standard
 * Lightning routing.
 */
export function buildSendPaymentRequest(
  inputType: string,
  prepareResponse: PrepareSendPaymentResponse
): SendPaymentRequest {
  const request: SendPaymentRequest = { prepareResponse };
  if (inputType === 'bolt11Invoice') {
    request.options = {
      type: 'bolt11Invoice',
      preferSpark: false,
      completionTimeoutSecs: BREEZ_COMPLETION_TIMEOUT_SECS
    };
  }
  return request;
}

/** An on-chain send of a prepared payment at the chosen confirmation speed. */
export function onchainSendRequest(
  prepareResponse: PrepareSendPaymentResponse,
  confirmationSpeed: OnchainConfirmationSpeed
): SendPaymentRequest {
  return { prepareResponse, options: { type: 'bitcoinAddress', confirmationSpeed } };
}

/**
 * The LNURL pay request inside a parsed input: a Lightning address carries
 * it as `payRequest`; an LNURL-pay input *is* the pay request.
 */
export function payRequestOf(parsed: InputType): LnurlPayRequestDetails | null {
  if (parsed.type === 'lightningAddress') return parsed.payRequest;
  if (parsed.type === 'lnurlPay') {
    const { type: _type, ...details } = parsed;
    return details;
  }
  return null;
}

/** Prepare an LNURL / Lightning-address payment. */
export function prepareLnurlRequest(
  payRequest: LnurlPayRequestDetails,
  amountSats: number,
  comment?: string
): PrepareLnurlPayRequest {
  const request: PrepareLnurlPayRequest = { payRequest, amount: BigInt(Math.floor(amountSats)) };
  if (comment) request.comment = comment;
  return request;
}

export function bolt11ReceiveRequest(
  amountSats: number,
  description: string
): ReceivePaymentRequest {
  return { paymentMethod: { type: 'bolt11Invoice', amountSats, description } };
}

export function bitcoinAddressReceiveRequest(): ReceivePaymentRequest {
  return { paymentMethod: { type: 'bitcoinAddress' } };
}

export function sparkAddressReceiveRequest(): ReceivePaymentRequest {
  return { paymentMethod: { type: 'sparkAddress' } };
}

export function claimDepositRequest(
  txid: string,
  vout: number,
  maxFee?: { fixedSats: number } | { leewaySatPerVbyte: number }
): ClaimDepositRequest {
  const request: ClaimDepositRequest = { txid, vout };
  if (maxFee && 'fixedSats' in maxFee) request.maxFee = { type: 'fixed', amount: maxFee.fixedSats };
  else if (maxFee)
    request.maxFee = { type: 'networkRecommended', leewaySatPerVbyte: maxFee.leewaySatPerVbyte };
  return request;
}

export function refundDepositRequest(
  txid: string,
  vout: number,
  destinationAddress: string,
  satPerVbyte: number
): RefundDepositRequest {
  return { txid, vout, destinationAddress, fee: { type: 'rate', satPerVbyte } };
}
