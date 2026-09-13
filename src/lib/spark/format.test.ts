import { describe, expect, it } from 'vitest';
import { formatStableBalance } from './format';

describe('formatStableBalance', () => {
  it('formats a zero balance', () => {
    expect(formatStableBalance(0n, 6)).toBe('0.00');
  });

  it('formats whole and fractional parts with two decimals', () => {
    expect(formatStableBalance(12_345_678n, 6)).toBe('12.34');
  });

  it('pads small fractional amounts', () => {
    expect(formatStableBalance(5_000n, 6)).toBe('0.00');
    expect(formatStableBalance(50_000n, 6)).toBe('0.05');
  });

  it('truncates rather than rounds', () => {
    expect(formatStableBalance(1_999_999n, 6)).toBe('1.99');
  });

  it('respects the token decimals', () => {
    expect(formatStableBalance(1_234n, 2)).toBe('12.34');
  });

  it('locale-formats the whole part', () => {
    expect(formatStableBalance(1_234_567_000_000n, 6)).toBe((1_234_567n).toLocaleString() + '.00');
  });
});
