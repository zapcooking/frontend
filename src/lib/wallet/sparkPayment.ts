export interface SparkPaymentAsset {
  ticker: string;
  amount: string;
  decimals: number;
}

function conversionSides(payment: any): any[] {
  const conversions = payment.conversionDetails?.conversions || payment.conversion_details?.conversions || [];
  return conversions.flatMap((conversion: any) => [conversion.from, conversion.to].filter(Boolean));
}

/**
 * Spark keeps the original Lightning method for stable-balance receives. The
 * token amount is instead recorded on the token side of conversionDetails.
 */
export function extractSparkPaymentAsset(payment: any): SparkPaymentAsset | undefined {
  const amount = String(payment.amount ?? 0);
  const directMetadata = payment.details?.type === 'token' ? payment.details.metadata : undefined;
  if (directMetadata) {
    return {
      ticker: directMetadata.ticker || directMetadata.name || 'Token',
      amount,
      decimals: Number(directMetadata.decimals ?? 0)
    };
  }

  const tokenSide = conversionSides(payment).find((side: any) => side?.asset?.identifier);
  if (!tokenSide) return undefined;

  return {
    ticker: tokenSide.asset.ticker || 'Token',
    amount: String(tokenSide.amount ?? 0),
    decimals: Number(tokenSide.asset.decimals ?? 0)
  };
}

/**
 * Transaction.amount is always sats. Token payment payloads may put token
 * base units in payment.amount, so derive their sat value from the BTC leg.
 */
export function extractSparkPaymentSats(payment: any, hasTokenAsset: boolean): number {
  const explicitSats = payment.amountSat ?? payment.amount_sat;
  if (explicitSats !== undefined && explicitSats !== null) return Number(explicitSats);

  const amountMsat = payment.amountMsat ?? payment.amount_msat ?? payment.amountMSat;
  if (amountMsat !== undefined && amountMsat !== null) return Math.floor(Number(amountMsat) / 1000);

  if (hasTokenAsset) {
    const bitcoinSide = conversionSides(payment).find(
      (side: any) => side?.asset?.ticker === 'BTC' || side?.asset?.ticker === 'Bitcoin'
    );
    return Number(bitcoinSide?.amount ?? 0);
  }

  return Number(payment.amount ?? 0);
}
