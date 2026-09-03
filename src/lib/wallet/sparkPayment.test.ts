import { describe, expect, it } from 'vitest';
import { extractSparkPaymentAsset } from './sparkPayment';

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
});
