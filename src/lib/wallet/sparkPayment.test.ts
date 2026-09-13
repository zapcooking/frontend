import { describe, expect, it } from 'vitest';
import {
  extractSparkPaymentAsset,
  extractSparkPaymentConversionFrom,
  extractSparkPaymentSats
} from './sparkPayment';

describe('extractSparkPaymentAsset', () => {
  it('uses conversion details for a stable-balance Lightning receive', () => {
    expect(
      extractSparkPaymentAsset({
        amount: 15_866_330n,
        method: 'lightning',
        details: { type: 'lightning' },
        conversionDetails: {
          conversions: [
            {
              from: { asset: { ticker: 'BTC', decimals: 0 }, amount: '23914' },
              to: {
                asset: { identifier: 'usdb-token', ticker: 'USDB', decimals: 6 },
                amount: '15866330'
              }
            }
          ]
        }
      })
    ).toEqual({ ticker: 'USDB', amount: '15866330', decimals: 6 });
  });

  it('does not re-denominate ordinary Lightning payments', () => {
    expect(
      extractSparkPaymentAsset({
        amount: 21n,
        method: 'lightning',
        details: { type: 'lightning' }
      })
    ).toBeUndefined();
  });

  it('uses the token leg even when payment.amount is Lightning sats', () => {
    const payment = {
      amount: 23_914n,
      conversionDetails: {
        conversions: [
          {
            from: { asset: { ticker: 'BTC', decimals: 0 }, amount: '23914' },
            to: {
              asset: { identifier: 'usdb-token', ticker: 'USDB', decimals: 6 },
              amount: '15866330'
            }
          }
        ]
      }
    };

    expect(extractSparkPaymentAsset(payment)).toEqual({
      ticker: 'USDB',
      amount: '15866330',
      decimals: 6
    });
    expect(extractSparkPaymentSats(payment, true)).toBe(23_914);
    expect(extractSparkPaymentConversionFrom(payment)).toBe('Bitcoin');
  });

  it('identifies a conversion from USDB', () => {
    expect(
      extractSparkPaymentConversionFrom({
        conversionDetails: {
          conversions: [
            {
              from: { asset: { identifier: 'usdb-token', ticker: 'USDB' }, amount: '15800000' },
              to: { asset: { ticker: 'BTC' }, amount: '20339' }
            }
          ]
        }
      })
    ).toBe('USDB');
  });

  it('never treats token base units as sats', () => {
    expect(
      extractSparkPaymentSats(
        { amount: 15_866_330n, details: { type: 'token' } },
        true
      )
    ).toBe(0);
  });
});
