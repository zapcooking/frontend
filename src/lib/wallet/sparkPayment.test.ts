import { describe, expect, it } from 'vitest';
import {
  conversionDestinedForBitcoin,
  extractSparkPaymentAsset,
  extractSparkPaymentConversionFrom,
  extractSparkPaymentSats
} from './sparkPayment';

// The USDB→Bitcoin leg of a USD-mode round-trip: disabling USD mode
// converts the token balance back. payment.amount may hold the token units
// that left; the bitcoin leg records what arrived.
const usdbExit = {
  conversionDetails: {
    conversions: [
      {
        from: {
          asset: { identifier: 'usdb-token', ticker: 'USDB', decimals: 6 },
          amount: '1200000'
        },
        to: { asset: { ticker: 'BTC', decimals: 0 }, amount: '1950' }
      }
    ]
  }
};

describe('conversionDestinedForBitcoin', () => {
  it('is true for a USDB to Bitcoin conversion', () => {
    expect(conversionDestinedForBitcoin(usdbExit)).toBe(true);
  });

  it('is false for a Bitcoin to USDB conversion', () => {
    expect(
      conversionDestinedForBitcoin({
        conversionDetails: {
          conversions: [
            {
              from: { asset: { ticker: 'BTC', decimals: 0 }, amount: '1950' },
              to: {
                asset: { identifier: 'usdb-token', ticker: 'USDB', decimals: 6 },
                amount: '1200000'
              }
            }
          ]
        }
      })
    ).toBe(false);
  });

  it('is false with no conversions', () => {
    expect(conversionDestinedForBitcoin({})).toBe(false);
  });
});

describe('to-bitcoin conversion rows', () => {
  it('denominate the row in sats from the bitcoin leg', () => {
    const payment = { amount: 1_200_000n, method: 'token', ...usdbExit };
    // The caller gates the asset on the conversion's destination: a
    // to-bitcoin conversion is a plain sats row.
    expect(conversionDestinedForBitcoin(payment)).toBe(true);
    expect(extractSparkPaymentSats(payment, true)).toBe(1_950);
    expect(extractSparkPaymentConversionFrom(payment)).toBe('USDB');
  });
});

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
