import { describe, expect, it, vi } from 'vitest';
import { TEAM_LIGHTNING_ADDRESS } from './config';
import { ZapError, requestTeamInvoice } from './zap';

const PAY_REQUEST = {
  tag: 'payRequest',
  callback: 'https://sats.zap.cooking/lnurlp/zapcooking/callback',
  minSendable: 1000,
  maxSendable: 100_000_000,
  commentAllowed: 255
};

/** LNURL server double; the invoice it returns decodes to `invoiceSats`. */
function lnurl(opts: { invoiceSats?: number | null; payRequest?: object; callbackBody?: object } = {}) {
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    urls.push(url);
    if (url.includes('/.well-known/lnurlp/')) {
      return new Response(JSON.stringify(opts.payRequest ?? PAY_REQUEST));
    }
    return new Response(JSON.stringify(opts.callbackBody ?? { pr: 'lnbc-test-invoice', verify: 'https://v' }));
  }) as unknown as typeof fetch;
  const decode = vi.fn(() =>
    opts.invoiceSats === null ? null : { satoshi: opts.invoiceSats ?? 2100 }
  );
  return { fetchImpl, decode, urls };
}

describe('requestTeamInvoice', () => {
  it('returns an invoice whose decoded amount equals the one asked for', async () => {
    const s = lnurl({ invoiceSats: 2100 });
    const inv = await requestTeamInvoice(2100, ' thanks! ', s);
    expect(inv).toEqual({ invoice: 'lnbc-test-invoice', verify: 'https://v', amountSats: 2100 });
    expect(s.urls[0]).toBe('https://sats.zap.cooking/.well-known/lnurlp/zapcooking');
    const cb = new URL(s.urls[1]);
    expect(cb.searchParams.get('amount')).toBe('2100000');
    expect(cb.searchParams.get('comment')).toBe('thanks!');
    expect(s.decode).toHaveBeenCalledWith('lnbc-test-invoice');
    expect(TEAM_LIGHTNING_ADDRESS).toBe('zapcooking@sats.zap.cooking');
  });

  it('refuses an invoice for a different amount', async () => {
    for (const invoiceSats of [21_000, 2099, 0]) {
      await expect(requestTeamInvoice(2100, '', lnurl({ invoiceSats }))).rejects.toThrow(
        "The invoice amount didn't match. Nothing was paid."
      );
    }
  });

  it('refuses an invoice it cannot decode', async () => {
    await expect(requestTeamInvoice(2100, '', lnurl({ invoiceSats: null }))).rejects.toBeInstanceOf(
      ZapError
    );
  });

  it('checks amount bounds and comment length before asking for an invoice', async () => {
    const s = lnurl();
    await expect(requestTeamInvoice(0, '', s)).rejects.toThrow('Choose an amount');
    await expect(requestTeamInvoice(1.5, '', s)).rejects.toThrow('Choose an amount');
    await expect(
      requestTeamInvoice(2100, '', lnurl({ payRequest: { ...PAY_REQUEST, minSendable: 5_000_000 } }))
    ).rejects.toThrow('between 5000');
    await expect(
      requestTeamInvoice(2100, 'x'.repeat(256), lnurl())
    ).rejects.toThrow('limited to 255');
    const noComments = lnurl({ payRequest: { ...PAY_REQUEST, commentAllowed: 0 } });
    await expect(requestTeamInvoice(2100, 'hi', noComments)).rejects.toThrow('not accepted');
    expect(noComments.urls).toHaveLength(1); // never reached the callback
  });

  it('surfaces LNURL errors as ZapError', async () => {
    await expect(
      requestTeamInvoice(2100, '', lnurl({ callbackBody: { status: 'ERROR', reason: 'nope' } }))
    ).rejects.toBeInstanceOf(ZapError);
    await expect(
      requestTeamInvoice(2100, '', lnurl({ payRequest: { status: 'ERROR' } }))
    ).rejects.toBeInstanceOf(ZapError);
  });
});
