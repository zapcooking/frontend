export interface SparkPaymentAsset {
  ticker: string;
  amount: string;
  decimals: number;
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

  const conversions = payment.conversionDetails?.conversions || payment.conversion_details?.conversions || [];
  const tokenSides = conversions.flatMap((conversion: any) =>
    [conversion.from, conversion.to].filter((side: any) => side?.asset?.identifier)
  );
  const tokenSide = tokenSides.find((side: any) => String(side.amount) === amount);
  if (!tokenSide) return undefined;

  return {
    ticker: tokenSide.asset.ticker || 'Token',
    amount,
    decimals: Number(tokenSide.asset.decimals ?? 0)
  };
}
