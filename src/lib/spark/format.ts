/**
 * Format a Spark stable-balance token amount (e.g. USDB) for display.
 *
 * `amount` is the raw integer token amount and `decimals` is the token's
 * precision. The result is truncated (not rounded) to two decimal places and
 * the whole part is locale-formatted, e.g. 1234567n / 6 → "1.23".
 *
 * Shared by the mini wallet pill and the wallet panel so both render the
 * balance identically.
 */
export function formatStableBalance(amount: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fraction = (amount % divisor).toString().padStart(decimals, '0').slice(0, 2);
  return `${whole.toLocaleString()}.${fraction}`;
}
