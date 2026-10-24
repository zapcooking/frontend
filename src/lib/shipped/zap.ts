/**
 * "Zap the team" for /pow: resolve TEAM_LIGHTNING_ADDRESS over LNURL-pay
 * and get an invoice, refusing any invoice whose amount isn't exactly the
 * amount asked for. Every payment path pays only an invoice that passed
 * that check.
 *
 * Self-contained on purpose: the marketplace's LNURL helpers
 * (getInvoiceFromLightningAddress) live in a module that imports NDK, and
 * they don't check the returned amount — they hand back data.pr as-is.
 */

import { decodeInvoice } from '@getalby/lightning-tools';
import { TEAM_LIGHTNING_ADDRESS } from './config';

export class ZapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZapError';
  }
}

export interface PayRequest {
  callback: string;
  minSats: number;
  maxSats: number;
  /** Longest comment the recipient accepts (0 = none). */
  commentAllowed: number;
}

export interface TeamInvoice {
  invoice: string;
  verify?: string;
  amountSats: number;
}

function lnurlpUrl(address: string): string {
  const [name, domain] = address.split('@');
  if (!name || !domain) throw new ZapError('Invalid Lightning address');
  return `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`;
}

export async function fetchPayRequest(
  address = TEAM_LIGHTNING_ADDRESS,
  fetchImpl: typeof fetch = fetch
): Promise<PayRequest> {
  const res = await fetchImpl(lnurlpUrl(address));
  if (!res.ok) throw new ZapError('Could not reach the Lightning address');
  const data = await res.json();
  if (data.status === 'ERROR' || data.tag !== 'payRequest' || typeof data.callback !== 'string') {
    throw new ZapError('The Lightning address is not accepting payments');
  }
  return {
    callback: data.callback,
    minSats: Math.ceil((data.minSendable ?? 1000) / 1000),
    maxSats: Math.floor((data.maxSendable ?? 1_000_000_000) / 1000),
    commentAllowed: Number.isFinite(data.commentAllowed) ? data.commentAllowed : 0
  };
}

/**
 * An invoice for exactly `amountSats`, or a ZapError. The returned bolt11
 * is decoded and its amount compared before anything can pay it.
 */
export async function requestTeamInvoice(
  amountSats: number,
  comment = '',
  deps: {
    address?: string;
    fetchImpl?: typeof fetch;
    decode?: (pr: string) => { satoshi: number } | null;
  } = {}
): Promise<TeamInvoice> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const decode = deps.decode ?? decodeInvoice;

  if (!Number.isInteger(amountSats) || amountSats <= 0) throw new ZapError('Choose an amount');
  const pay = await fetchPayRequest(deps.address, fetchImpl);
  if (amountSats < pay.minSats || amountSats > pay.maxSats) {
    throw new ZapError(`Amount must be between ${pay.minSats} and ${pay.maxSats} sats`);
  }
  const note = comment.trim();
  if (note.length > pay.commentAllowed) {
    throw new ZapError(
      pay.commentAllowed ? `Comments are limited to ${pay.commentAllowed} characters` : 'Comments are not accepted'
    );
  }

  const url = new URL(pay.callback);
  url.searchParams.set('amount', String(amountSats * 1000));
  if (note) url.searchParams.set('comment', note);
  const res = await fetchImpl(url.toString());
  if (!res.ok) throw new ZapError('Could not get an invoice');
  const data = await res.json();
  if (data.status === 'ERROR' || typeof data.pr !== 'string' || !data.pr) {
    throw new ZapError('Could not get an invoice');
  }

  // The check the rest of the flow relies on: never pay an invoice for an
  // amount other than the one the person chose.
  const decoded = decode(data.pr);
  if (!decoded || decoded.satoshi !== amountSats) {
    throw new ZapError("The invoice amount didn't match. Nothing was paid.");
  }
  return {
    invoice: data.pr,
    verify: typeof data.verify === 'string' ? data.verify : undefined,
    amountSats
  };
}
